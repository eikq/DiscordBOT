#!/usr/bin/env python3
"""Authenticated Google Drive-backed Discord recording, RVC training, and inference service."""

from __future__ import annotations

import asyncio
import base64
from contextlib import contextmanager
import hashlib
import hmac
from io import BytesIO
import json
import os
from pathlib import Path
import queue
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any
import wave

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response


SPEAKER_RE = re.compile(r"^\d{5,30}$")
FILENAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,120}\.wav$")
RVC_ROOT = Path(os.environ.get("RVC_ROOT", "/content/Retrieval-based-Voice-Conversion-WebUI")).resolve()
DRIVE_ROOT = Path(os.environ.get("VOICE_DRIVE_ROOT", "/content/drive/MyDrive/DigitalMeVoice")).resolve()
WORK_ROOT = Path(os.environ.get("VOICE_WORK_ROOT", "/content/digital-me-voice-work")).resolve()
PROJECT_ROOT = Path(__file__).resolve().parent.parent
API_TOKEN = os.environ.get("COLAB_API_TOKEN", "").strip()
MIN_MANUAL_SECONDS = float(os.environ.get("MIN_TRAIN_SECONDS", "120"))
AUTO_TRAIN_SECONDS = float(os.environ.get("AUTO_TRAIN_MIN_SECONDS", "600"))
RETRAIN_NEW_SECONDS = float(os.environ.get("RETRAIN_NEW_SECONDS", "180"))
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_VOICE_UPLOAD_BYTES", str(25 * 1024 * 1024)))
RVC_EPOCHS = int(os.environ.get("RVC_EPOCHS", "200"))
RVC_BATCH_SIZE = int(os.environ.get("RVC_BATCH_SIZE", "8"))
RVC_WORKERS = int(os.environ.get("RVC_WORKERS", "2"))
EDGE_TTS_VOICE = os.environ.get("EDGE_TTS_VOICE", "th-TH-NiwatNeural")

if len(API_TOKEN) < 24:
    raise RuntimeError("COLAB_API_TOKEN must be a random secret containing at least 24 characters.")


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def safe_speaker_id(value: Any) -> str:
    speaker_id = str(value or "").strip()
    if not SPEAKER_RE.fullmatch(speaker_id):
        raise HTTPException(status_code=400, detail="speakerId must be a Discord numeric user ID")
    return speaker_id


def decode_display_name(value: str | None, fallback: str) -> str:
    if not value:
        return fallback
    try:
        decoded = base64.b64decode(value, validate=True).decode("utf-8").strip()
        return decoded[:100] or fallback
    except Exception:
        return fallback


def inspect_wav(data: bytes) -> float:
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise HTTPException(status_code=400, detail="upload must be a PCM WAV file")
    try:
        with wave.open(BytesIO(data), "rb") as reader:
            channels = reader.getnchannels()
            sample_width = reader.getsampwidth()
            sample_rate = reader.getframerate()
            frames = reader.getnframes()
            compression = reader.getcomptype()
    except wave.Error as error:
        raise HTTPException(status_code=400, detail=f"invalid WAV: {error}") from error
    if compression != "NONE" or channels not in (1, 2) or sample_width != 2 or not 16_000 <= sample_rate <= 48_000:
        raise HTTPException(status_code=400, detail="WAV must be mono/stereo, signed 16-bit PCM, 16-48 kHz")
    duration = frames / sample_rate if sample_rate else 0
    if not 0.5 <= duration <= 120:
        raise HTTPException(status_code=400, detail="each sample must be between 0.5 and 120 seconds")
    return duration


class GpuBusyError(RuntimeError):
    pass


class VoicePipeline:
    def __init__(self) -> None:
        self.speakers_root = DRIVE_ROOT / "speakers"
        self.state_path = DRIVE_ROOT / "service_state.json"
        self.state_lock = threading.RLock()
        self.gpu_lock = threading.Lock()
        self.jobs: queue.Queue[str] = queue.Queue()
        self.training_job_id: str | None = None
        self.inference_engine: Any = None
        self.inference_config: Any = None
        self.loaded_model_key: tuple[str, str] | None = None
        self.local_versions: dict[str, str] = {}
        self.speakers_root.mkdir(parents=True, exist_ok=True)
        WORK_ROOT.mkdir(parents=True, exist_ok=True)
        (RVC_ROOT / "assets" / "weights").mkdir(parents=True, exist_ok=True)
        (RVC_ROOT / "assets" / "indices").mkdir(parents=True, exist_ok=True)
        self.state = self._load_state()
        self._recover_jobs()
        self.worker = threading.Thread(target=self._worker_loop, daemon=True, name="rvc-training-worker")
        self.worker.start()

    def _load_state(self) -> dict[str, Any]:
        if self.state_path.is_file():
            try:
                value = json.loads(self.state_path.read_text(encoding="utf-8"))
                if isinstance(value, dict):
                    value.setdefault("jobs", {})
                    value.setdefault("speakers", {})
                    return value
            except Exception:
                pass
        return {"version": 1, "jobs": {}, "speakers": {}}

    def _save_state(self) -> None:
        with self.state_lock:
            atomic_json(self.state_path, self.state)

    def _recover_jobs(self) -> None:
        for job_id, job in self.state["jobs"].items():
            if job.get("status") == "training":
                job["status"] = "failed"
                job["message"] = "Colab stopped while this job was training; start a new job."
                job["finishedAt"] = int(time.time() * 1000)
            elif job.get("status") == "queued":
                self.jobs.put(job_id)
        self._save_state()

    def speaker_dir(self, speaker_id: str) -> Path:
        return self.speakers_root / speaker_id

    def _profile(self, speaker_id: str) -> dict[str, Any]:
        profile_path = self.speaker_dir(speaker_id) / "profile.json"
        if profile_path.is_file():
            try:
                value = json.loads(profile_path.read_text(encoding="utf-8"))
                if isinstance(value, dict):
                    return value
            except Exception:
                pass
        return {"speakerId": speaker_id, "displayName": speaker_id}

    def _sample_stats(self, speaker_id: str) -> tuple[int, float]:
        samples = self.speaker_dir(speaker_id) / "samples"
        count = 0
        duration = 0.0
        if not samples.is_dir():
            return count, duration
        for sample in samples.glob("*.wav"):
            try:
                with wave.open(str(sample), "rb") as reader:
                    duration += reader.getnframes() / reader.getframerate()
                count += 1
            except Exception:
                continue
        return count, duration

    def _current_metadata(self, speaker_id: str) -> dict[str, Any] | None:
        path = self.speaker_dir(speaker_id) / "current.json"
        if not path.is_file():
            return None
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else None
        except Exception:
            return None

    def _latest_job(self, speaker_id: str) -> dict[str, Any] | None:
        jobs = [job for job in self.state["jobs"].values() if job.get("speakerId") == speaker_id]
        return max(jobs, key=lambda item: int(item.get("createdAt", 0))) if jobs else None

    def status(self, speaker_id: str) -> dict[str, Any]:
        with self.state_lock:
            profile = self._profile(speaker_id)
            sample_count, duration = self._sample_stats(speaker_id)
            current = self._current_metadata(speaker_id)
            job = self._latest_job(speaker_id)
            job_summary = None
            if job:
                job_summary = {
                    "id": job["id"],
                    "status": job["status"],
                    "message": job.get("message", ""),
                }
            return {
                "speakerId": speaker_id,
                "displayName": profile.get("displayName", speaker_id),
                "sampleCount": sample_count,
                "durationSeconds": round(duration, 3),
                "modelReady": current is not None,
                "trainedDurationSeconds": float(current.get("trainedDurationSeconds", 0)) if current else 0,
                "job": job_summary,
            }

    def list_speakers(self) -> list[dict[str, Any]]:
        result = []
        if self.speakers_root.is_dir():
            for item in sorted(self.speakers_root.iterdir()):
                if item.is_dir() and SPEAKER_RE.fullmatch(item.name):
                    result.append(self.status(item.name))
        return result

    def store_sample(self, speaker_id: str, display_name: str, filename: str, data: bytes) -> dict[str, Any]:
        inspect_wav(data)
        speaker = self.speaker_dir(speaker_id)
        samples = speaker / "samples"
        samples.mkdir(parents=True, exist_ok=True)
        safe_name = filename if FILENAME_RE.fullmatch(filename) else f"sample_{int(time.time() * 1000)}.wav"
        destination = samples / safe_name
        digest = hashlib.sha256(data).hexdigest()
        digest_path = destination.with_suffix(".sha256")
        if not destination.is_file() or not digest_path.is_file() or digest_path.read_text().strip() != digest:
            temporary = destination.with_name(f".{destination.name}.tmp")
            temporary.write_bytes(data)
            os.replace(temporary, destination)
            digest_path.write_text(digest, encoding="ascii")
        atomic_json(speaker / "profile.json", {
            "speakerId": speaker_id,
            "displayName": display_name,
            "updatedAt": int(time.time() * 1000),
        })

        status = self.status(speaker_id)
        current = self._current_metadata(speaker_id)
        trained_duration = float(current.get("trainedDurationSeconds", 0)) if current else 0
        threshold = AUTO_TRAIN_SECONDS if current is None else RETRAIN_NEW_SECONDS
        if status["durationSeconds"] - trained_duration >= threshold:
            try:
                self.queue_training(speaker_id, display_name, automatic=True)
            except (ValueError, RuntimeError):
                pass
        return self.status(speaker_id)

    def queue_training(self, speaker_id: str, display_name: str, automatic: bool) -> dict[str, Any]:
        with self.state_lock:
            status = self.status(speaker_id)
            minimum = AUTO_TRAIN_SECONDS if automatic and not status["modelReady"] else (
                RETRAIN_NEW_SECONDS if automatic else MIN_MANUAL_SECONDS
            )
            trained = float(status.get("trainedDurationSeconds", 0))
            available = status["durationSeconds"] - trained if automatic and status["modelReady"] else status["durationSeconds"]
            if available < minimum:
                raise ValueError(f"Need {minimum:.0f}s of eligible clean audio; currently {available:.1f}s is available.")
            for job in self.state["jobs"].values():
                if job.get("speakerId") == speaker_id and job.get("status") in ("queued", "training"):
                    return self.status(speaker_id)

            job_id = f"job_{int(time.time())}_{secrets.token_hex(4)}"
            self.state["jobs"][job_id] = {
                "id": job_id,
                "speakerId": speaker_id,
                "displayName": display_name,
                "status": "queued",
                "message": "Waiting for the Colab GPU worker.",
                "automatic": automatic,
                "createdAt": int(time.time() * 1000),
                "durationSeconds": status["durationSeconds"],
            }
            self._save_state()
            self.jobs.put(job_id)
            return self.status(speaker_id)

    def delete_speaker(self, speaker_id: str) -> bool:
        with self.state_lock:
            for job in self.state["jobs"].values():
                if job.get("speakerId") == speaker_id and job.get("status") == "training":
                    raise RuntimeError("Cannot delete while this speaker is actively training; retry after the job finishes.")
            for job in self.state["jobs"].values():
                if job.get("speakerId") == speaker_id and job.get("status") == "queued":
                    job["status"] = "failed"
                    job["message"] = "Deleted before training started."
            target = self.speaker_dir(speaker_id).resolve()
            if target.parent != self.speakers_root.resolve():
                raise RuntimeError("Refusing unsafe speaker deletion path.")
            existed = target.exists()
            if existed:
                shutil.rmtree(target)
            for suffix in (".pth", ".index"):
                local = RVC_ROOT / "assets" / ("weights" if suffix == ".pth" else "indices") / f"dm_{speaker_id}{suffix}"
                local.unlink(missing_ok=True)
            self.local_versions.pop(speaker_id, None)
            if self.loaded_model_key and self.loaded_model_key[0] == speaker_id:
                self.loaded_model_key = None
            self.state["speakers"].pop(speaker_id, None)
            self.state["jobs"] = {
                job_id: job for job_id, job in self.state["jobs"].items()
                if job.get("speakerId") != speaker_id
            }
            self._save_state()
            return existed

    def _set_job(self, job_id: str, **updates: Any) -> None:
        with self.state_lock:
            self.state["jobs"][job_id].update(updates)
            self._save_state()

    def _worker_loop(self) -> None:
        while True:
            job_id = self.jobs.get()
            try:
                job = self.state["jobs"].get(job_id)
                if not job or job.get("status") != "queued":
                    continue
                self._run_training_job(job_id)
            except Exception as error:
                if job_id in self.state["jobs"]:
                    self._set_job(
                        job_id,
                        status="failed",
                        message=str(error)[-1000:],
                        finishedAt=int(time.time() * 1000),
                    )
                print(f"[voice-service] Training job {job_id} failed: {error}", file=sys.stderr, flush=True)
            finally:
                self.jobs.task_done()

    def _run_training_job(self, job_id: str) -> None:
        job = self.state["jobs"][job_id]
        speaker_id = job["speakerId"]
        work_dir = WORK_ROOT / job_id
        dataset = work_dir / "dataset"
        result_json = work_dir / "result.json"
        log_path = work_dir / "training.log"
        work_dir.mkdir(parents=True, exist_ok=False)
        dataset.mkdir()
        for sample in (self.speaker_dir(speaker_id) / "samples").glob("*.wav"):
            shutil.copy2(sample, dataset / sample.name)
        if not any(dataset.glob("*.wav")):
            raise RuntimeError("No WAV samples were available when the training job started.")

        experiment = f"voice_{speaker_id}_{job_id[-8:]}"
        command = [
            sys.executable,
            str(PROJECT_ROOT / "colab" / "rvc_train_runner.py"),
            "--rvc-root", str(RVC_ROOT),
            "--dataset", str(dataset),
            "--experiment", experiment,
            "--epochs", str(RVC_EPOCHS),
            "--batch-size", str(RVC_BATCH_SIZE),
            "--workers", str(RVC_WORKERS),
            "--result-json", str(result_json),
        ]
        self._set_job(job_id, status="training", message="Preprocessing and training on the Colab GPU.", startedAt=int(time.time() * 1000))
        self.training_job_id = job_id
        try:
            with self.gpu_lock, log_path.open("w", encoding="utf-8") as log:
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
                assert process.stdout is not None
                for line in process.stdout:
                    print(line.rstrip(), flush=True)
                    log.write(line)
                    log.flush()
                code = process.wait()
                if code != 0:
                    raise RuntimeError(f"RVC training runner exited with code {code}")
        finally:
            self.training_job_id = None

        result = json.loads(result_json.read_text(encoding="utf-8"))
        model_source = Path(result["modelPath"])
        index_source = Path(result["indexPath"])
        published = self.speaker_dir(speaker_id) / "models" / job_id
        published.mkdir(parents=True, exist_ok=True)
        drive_model = published / "model.pth"
        drive_index = published / "model.index"
        shutil.copy2(model_source, drive_model)
        shutil.copy2(index_source, drive_index)
        shutil.copy2(log_path, published / "training.log")

        local_model = RVC_ROOT / "assets" / "weights" / f"dm_{speaker_id}.pth"
        local_index = RVC_ROOT / "assets" / "indices" / f"dm_{speaker_id}.index"
        shutil.copy2(drive_model, local_model)
        shutil.copy2(drive_index, local_index)
        current = {
            "speakerId": speaker_id,
            "jobId": job_id,
            "modelPath": str(drive_model.relative_to(self.speaker_dir(speaker_id))),
            "indexPath": str(drive_index.relative_to(self.speaker_dir(speaker_id))),
            "trainedDurationSeconds": float(job["durationSeconds"]),
            "publishedAt": int(time.time() * 1000),
            "rvcEpochs": RVC_EPOCHS,
        }
        atomic_json(self.speaker_dir(speaker_id) / "current.json", current)
        self.local_versions[speaker_id] = job_id
        if self.loaded_model_key and self.loaded_model_key[0] == speaker_id:
            self.loaded_model_key = None
        self._set_job(job_id, status="ready", message="Model and retrieval index published to Google Drive.", finishedAt=int(time.time() * 1000))

        shutil.rmtree(RVC_ROOT / "logs" / experiment, ignore_errors=True)
        shutil.rmtree(work_dir, ignore_errors=True)

    def resolve_speaker(self, requested: str) -> str:
        if requested != "default":
            return safe_speaker_id(requested)
        configured = os.environ.get("DEFAULT_SPEAKER_ID", "").strip()
        if configured and SPEAKER_RE.fullmatch(configured) and self._current_metadata(configured):
            return configured
        ready = [item["speakerId"] for item in self.list_speakers() if item["modelReady"]]
        if not ready:
            raise HTTPException(status_code=409, detail="no trained voice model is ready")
        return ready[0]

    def _ensure_local_model(self, speaker_id: str) -> tuple[Path, Path, str]:
        current = self._current_metadata(speaker_id)
        if current is None:
            raise FileNotFoundError("voice model is not trained yet")
        job_id = str(current["jobId"])
        model_source = self.speaker_dir(speaker_id) / current["modelPath"]
        index_source = self.speaker_dir(speaker_id) / current["indexPath"]
        local_model = RVC_ROOT / "assets" / "weights" / f"dm_{speaker_id}.pth"
        local_index = RVC_ROOT / "assets" / "indices" / f"dm_{speaker_id}.index"
        if self.local_versions.get(speaker_id) != job_id or not local_model.is_file() or not local_index.is_file():
            shutil.copy2(model_source, local_model)
            shutil.copy2(index_source, local_index)
            self.local_versions[speaker_id] = job_id
        return local_model, local_index, job_id

    def _load_engine(self) -> Any:
        if self.inference_engine is not None:
            return self.inference_engine
        os.environ["weight_root"] = str(RVC_ROOT / "assets" / "weights")
        os.environ["index_root"] = str(RVC_ROOT / "logs")
        os.environ["outside_index_root"] = str(RVC_ROOT / "assets" / "indices")
        os.environ["rmvpe_root"] = str(RVC_ROOT / "assets" / "rmvpe")
        os.chdir(RVC_ROOT)
        if str(RVC_ROOT) not in sys.path:
            sys.path.insert(0, str(RVC_ROOT))
        original_argv = sys.argv[:]
        sys.argv = [sys.argv[0]]
        try:
            from configs.config import Config
            from infer.vc.modules import VC

            self.inference_config = Config()
            self.inference_engine = VC(self.inference_config)
        finally:
            sys.argv = original_argv
        return self.inference_engine

    def convert(self, speaker_id: str, input_audio: Path, output_audio: Path) -> None:
        if not self.gpu_lock.acquire(blocking=False):
            raise GpuBusyError("the Colab GPU is training; cloned inference is temporarily unavailable")
        try:
            model, index, job_id = self._ensure_local_model(speaker_id)
            engine = self._load_engine()
            model_key = (speaker_id, job_id)
            if self.loaded_model_key != model_key:
                engine.get_vc(model.name)
                self.loaded_model_key = model_key
            status, result = engine.vc_single(
                0,
                str(input_audio),
                0,
                "rmvpe",
                str(index),
                0.75,
                0,
                1.0,
                0.33,
            )
            if not result or result[0] is None or result[1] is None:
                raise RuntimeError(f"RVC inference failed: {status}")
            import soundfile as sf

            sf.write(str(output_audio), result[1], result[0], format="WAV", subtype="PCM_16")
        finally:
            self.gpu_lock.release()


pipeline = VoicePipeline()
app = FastAPI(title="Digital Me RVC Voice Service", version="1.0")


def require_auth(request: Request) -> None:
    header = request.headers.get("authorization", "")
    supplied = header[7:] if header.lower().startswith("bearer ") else ""
    if not hmac.compare_digest(supplied, API_TOKEN):
        raise HTTPException(status_code=401, detail="invalid bearer token")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "driveMounted": DRIVE_ROOT.exists(),
        "rvcInstalled": (RVC_ROOT / "infer" / "vc" / "modules.py").is_file(),
        "training": pipeline.training_job_id is not None,
    }


@app.post("/v1/samples")
async def upload_sample(request: Request) -> dict[str, Any]:
    require_auth(request)
    speaker_id = safe_speaker_id(request.headers.get("x-discord-user-id"))
    display_name = decode_display_name(request.headers.get("x-display-name-b64"), speaker_id)
    filename = request.headers.get("x-filename", "")
    try:
        declared = int(request.headers.get("content-length", "0") or 0)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="invalid Content-Length") from error
    if declared > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="sample exceeds upload limit")
    body = await request.body()
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="sample exceeds upload limit")
    return await asyncio.to_thread(pipeline.store_sample, speaker_id, display_name, filename, body)


@app.post("/v1/train")
async def train(request: Request) -> dict[str, Any]:
    require_auth(request)
    payload = await request.json()
    speaker_id = safe_speaker_id(payload.get("speakerId"))
    display_name = str(payload.get("displayName") or speaker_id)[:100]
    try:
        return await asyncio.to_thread(pipeline.queue_training, speaker_id, display_name, False)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.get("/v1/speakers")
async def speakers(request: Request) -> dict[str, Any]:
    require_auth(request)
    return {"speakers": await asyncio.to_thread(pipeline.list_speakers)}


@app.get("/v1/speakers/{speaker_id}")
async def speaker_status(speaker_id: str, request: Request) -> dict[str, Any]:
    require_auth(request)
    speaker_id = safe_speaker_id(speaker_id)
    return await asyncio.to_thread(pipeline.status, speaker_id)


@app.delete("/v1/speakers/{speaker_id}")
async def delete_speaker(speaker_id: str, request: Request) -> dict[str, Any]:
    require_auth(request)
    speaker_id = safe_speaker_id(speaker_id)
    try:
        deleted = await asyncio.to_thread(pipeline.delete_speaker, speaker_id)
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"deleted": deleted}


@app.post("/v1/generate")
async def generate(request: Request) -> Response:
    require_auth(request)
    payload = await request.json()
    text = str(payload.get("text") or "").strip()
    if not text or len(text) > 600:
        raise HTTPException(status_code=400, detail="text must contain 1-600 characters")
    speaker_id = pipeline.resolve_speaker(str(payload.get("speakerId") or "default"))
    if pipeline.training_job_id is not None:
        raise HTTPException(status_code=503, detail="GPU is currently training; try cloned speech again later", headers={"Retry-After": "30"})

    import edge_tts

    with tempfile.TemporaryDirectory(prefix="digital-me-infer-") as temporary:
        temporary_path = Path(temporary)
        source = temporary_path / "source.mp3"
        converted = temporary_path / "converted.wav"
        await edge_tts.Communicate(text, EDGE_TTS_VOICE).save(str(source))
        try:
            await asyncio.to_thread(pipeline.convert, speaker_id, source, converted)
        except GpuBusyError as error:
            raise HTTPException(status_code=503, detail=str(error), headers={"Retry-After": "30"}) from error
        except FileNotFoundError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        return Response(content=converted.read_bytes(), media_type="audio/wav", headers={"X-Voice-Speaker-Id": speaker_id})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("COLAB_VOICE_PORT", "8766")), workers=1)
