#!/usr/bin/env python3
"""Authenticated local Discord recording, RVC training, and inference service.

The same service can still use Google Drive when VOICE_DATA_ROOT points to a mounted
Drive folder, but Windows-local storage is now the default.
"""

from __future__ import annotations

import asyncio
import base64
from contextlib import contextmanager
import hashlib
import hmac
from io import BytesIO
import json
import math
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
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest, urlopen
import wave

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask
from cloud_training_export import (
    create_training_export as create_cloud_training_export,
    preview_training_export as preview_cloud_training_export,
)
from voice_prosody import plan_edge_prosody
from voice_delivery import estimate_delivery_profile
from voice_output_audio import (
    configured_question_tail_lift,
    polish_generated_wav,
    shape_rising_question_tail,
    should_use_jaitts,
)
from song_conversion import (
    demucs_available,
    finalize_isolated_vocal,
    merge_converted_chunks,
    prepare_vocal_for_rvc,
    remix_song,
    separate_vocals,
    split_audio_for_rvc,
)


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SPEAKER_RE = re.compile(r"^\d{5,30}$")
FILENAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,120}\.wav$")
MODEL_VERSION_RE = re.compile(r"^job_\d+_[a-f0-9]{8}$")
DATASET_VERSION_RE = re.compile(r"^[A-Za-z0-9_-]{1,120}$")
RVC_ROOT = Path(os.environ.get(
    "RVC_ROOT",
    str(PROJECT_ROOT / ".runtime" / "Retrieval-based-Voice-Conversion-WebUI"),
)).resolve()
DRIVE_ROOT = Path(os.environ.get(
    "VOICE_DATA_ROOT",
    os.environ.get("VOICE_DRIVE_ROOT", str(PROJECT_ROOT / "data" / "local_voice")),
)).resolve()
WORK_ROOT = Path(os.environ.get(
    "VOICE_WORK_ROOT",
    str(PROJECT_ROOT / ".runtime" / "voice-work"),
)).resolve()
API_TOKEN = os.environ.get("VOICE_API_TOKEN", os.environ.get("COLAB_API_TOKEN", "")).strip()
MIN_MANUAL_SECONDS = float(os.environ.get("MIN_TRAIN_SECONDS", "120"))
AUTO_TRAIN_SECONDS = float(os.environ.get("AUTO_TRAIN_MIN_SECONDS", "120"))
RETRAIN_NEW_SECONDS = float(os.environ.get("RETRAIN_NEW_SECONDS", "180"))
AUTO_RETRAIN_ENABLED = os.environ.get("AUTO_RETRAIN_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
AUTO_TRAIN_ON_UPLOAD = os.environ.get("AUTO_TRAIN_ON_UPLOAD", "false").strip().lower() in ("1", "true", "yes", "on")
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_VOICE_UPLOAD_BYTES", str(25 * 1024 * 1024)))
MAX_CONVERSION_BYTES = int(os.environ.get("MAX_VOICE_CONVERSION_BYTES", str(100 * 1024 * 1024)))
MAX_CONVERSION_SECONDS = float(os.environ.get("MAX_VOICE_CONVERSION_SECONDS", "600"))
RVC_EPOCHS = int(os.environ.get("RVC_EPOCHS", "200"))
RVC_BATCH_SIZE = int(os.environ.get("RVC_BATCH_SIZE", "2"))
RVC_WORKERS = int(os.environ.get("RVC_WORKERS", "2"))
RVC_LOW_PRIORITY = os.environ.get("RVC_LOW_PRIORITY", "true").strip().lower() in ("1", "true", "yes", "on")
RVC_CPU_THREADS = int(os.environ.get("RVC_CPU_THREADS", "2"))
RVC_FINETUNE_LR_SCALE = float(os.environ.get("RVC_FINETUNE_LR_SCALE", "0.25"))
RVC_INDEX_RATE = float(os.environ.get("RVC_INDEX_RATE", "0.75"))
RVC_RMS_MIX_RATE = float(os.environ.get("RVC_RMS_MIX_RATE", "1.0"))
RVC_PROTECT = float(os.environ.get("RVC_PROTECT", "0.33"))
SONG_RVC_INDEX_RATE = float(os.environ.get("SONG_RVC_INDEX_RATE", "0.85"))
SONG_RVC_RMS_MIX_RATE = float(os.environ.get("SONG_RVC_RMS_MIX_RATE", "0.50"))
SONG_RVC_PROTECT = float(os.environ.get("SONG_RVC_PROTECT", "0.18"))
SONG_SEPARATOR_MODEL = os.environ.get("SONG_SEPARATOR_MODEL", "htdemucs").strip() or "htdemucs"
SONG_SEPARATOR_DEVICE = os.environ.get("SONG_SEPARATOR_DEVICE", "cuda").strip().lower() or "cuda"
SONG_VOCAL_BOOST_DB = float(os.environ.get("SONG_VOCAL_BOOST_DB", "3.0"))
SINGING_INFERENCE_PROFILES: dict[str, tuple[float, float, float]] = {
    "configured": (SONG_RVC_INDEX_RATE, SONG_RVC_RMS_MIX_RATE, SONG_RVC_PROTECT),
    "identity": (0.85, 0.50, 0.18),
    "balanced": (0.72, 0.35, 0.25),
    "expressive": (0.58, 0.12, 0.35),
}
EDGE_TTS_VOICE = os.environ.get("EDGE_TTS_VOICE", "th-TH-NiwatNeural")
EDGE_TTS_RATE = os.environ.get("EDGE_TTS_RATE", "-8%")
EDGE_TTS_PITCH = os.environ.get("EDGE_TTS_PITCH", "+0Hz")
EDGE_TTS_VOLUME = os.environ.get("EDGE_TTS_VOLUME", "+0%")
EDGE_TTS_REFERENCE_PITCH_HZ = float(os.environ.get("EDGE_TTS_REFERENCE_PITCH_HZ", "160"))
EDGE_TTS_REFERENCE_RATE_WPS = float(os.environ.get("EDGE_TTS_REFERENCE_RATE_WPS", "5.5"))
EDGE_TTS_LEARN_RATE = os.environ.get("EDGE_TTS_LEARN_RATE", "false").strip().lower() in ("1", "true", "yes", "on")
JAITTS_ENABLED = os.environ.get("JAITTS_ENABLED", "true").strip().lower() in ("1", "true", "yes", "on")
JAITTS_BASE_URL = os.environ.get("JAITTS_BASE_URL", "http://127.0.0.1:8768").rstrip("/")
JAITTS_API_TOKEN = os.environ.get("JAITTS_API_TOKEN", API_TOKEN).strip()
JAITTS_TIMEOUT_SECONDS = max(5.0, float(os.environ.get("JAITTS_TIMEOUT_MS", "30000")) / 1000.0)
JAITTS_PRESET = os.environ.get("JAITTS_PRESET", "default").strip().lower()
VOICE_CAPTURE_ROOT = Path(os.environ.get(
    "VOICE_CAPTURE_ROOT",
    str(PROJECT_ROOT / "data" / "voice_samples"),
)).resolve()

if len(API_TOKEN) < 24:
    raise RuntimeError("VOICE_API_TOKEN must be a random secret containing at least 24 characters.")
if not 1 <= RVC_CPU_THREADS <= 64:
    raise RuntimeError("RVC_CPU_THREADS must be between 1 and 64.")
if not 0.01 <= RVC_FINETUNE_LR_SCALE <= 1.0:
    raise RuntimeError("RVC_FINETUNE_LR_SCALE must be between 0.01 and 1.0.")
for setting_name, setting_value in (
    ("RVC_INDEX_RATE", RVC_INDEX_RATE),
    ("RVC_RMS_MIX_RATE", RVC_RMS_MIX_RATE),
    ("RVC_PROTECT", RVC_PROTECT),
    ("SONG_RVC_INDEX_RATE", SONG_RVC_INDEX_RATE),
    ("SONG_RVC_RMS_MIX_RATE", SONG_RVC_RMS_MIX_RATE),
    ("SONG_RVC_PROTECT", SONG_RVC_PROTECT),
):
    if not 0.0 <= setting_value <= 1.0:
        raise RuntimeError(f"{setting_name} must be between 0 and 1.")


TURN_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,120}$")


class TurnCancellationRegistry:
    """Thread-safe, bounded memory of voice turns that should not be published."""

    def __init__(self, ttl_seconds: float = 300.0) -> None:
        self.ttl_seconds = max(10.0, ttl_seconds)
        self._cancelled: dict[str, float] = {}
        self._lock = threading.Lock()

    def cancel(self, turn_id: str) -> bool:
        if not TURN_ID_RE.fullmatch(turn_id):
            return False
        with self._lock:
            self._prune_locked()
            self._cancelled[turn_id] = time.monotonic()
        return True

    def is_cancelled(self, turn_id: str) -> bool:
        with self._lock:
            self._prune_locked()
            return turn_id in self._cancelled

    def forget(self, turn_id: str) -> None:
        with self._lock:
            self._cancelled.pop(turn_id, None)

    def _prune_locked(self) -> None:
        cutoff = time.monotonic() - self.ttl_seconds
        for turn_id, timestamp in list(self._cancelled.items()):
            if timestamp < cutoff:
                self._cancelled.pop(turn_id, None)


cancelled_turns = TurnCancellationRegistry()


def ensure_turn_active(turn_id: str) -> None:
    if cancelled_turns.is_cancelled(turn_id):
        raise HTTPException(status_code=409, detail=f"voice turn {turn_id} was cancelled")


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def atomic_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{secrets.token_hex(4)}.tmp")
    try:
        shutil.copy2(source, temporary)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def safe_response_header(value: Any, maximum_length: int = 160) -> str:
    """Return a CRLF-free Latin-1 value accepted by Starlette headers."""
    text = re.sub(r"[\r\n\x00]", "", str(value or ""))[:maximum_length]
    try:
        text.encode("latin-1")
        return text
    except UnicodeEncodeError:
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]
        return f"utf8-sha256-{digest}"


def safe_speaker_id(value: Any) -> str:
    speaker_id = str(value or "").strip()
    if not SPEAKER_RE.fullmatch(speaker_id):
        raise HTTPException(status_code=400, detail="speakerId must be a Discord numeric user ID")
    return speaker_id


def request_jaitts_source(payload: dict[str, Any], destination: Path) -> dict[str, str]:
    """Generate a reference-conditioned Thai source WAV or raise for Edge fallback."""
    if not JAITTS_ENABLED:
        raise RuntimeError("JaiTTS is disabled")
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = UrlRequest(
        f"{JAITTS_BASE_URL}/v1/generate",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {JAITTS_API_TOKEN}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    try:
        with urlopen(request, timeout=JAITTS_TIMEOUT_SECONDS) as response:
            audio = response.read()
            headers = {key.lower(): value for key, value in response.headers.items()}
    except HTTPError as error:
        detail = error.read(512).decode("utf-8", errors="replace")
        raise RuntimeError(f"JaiTTS returned {error.code}: {detail}") from error
    except (URLError, TimeoutError, OSError) as error:
        raise RuntimeError(f"JaiTTS is unavailable: {error}") from error
    if len(audio) < 44 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        raise RuntimeError("JaiTTS returned invalid WAV audio")
    destination.write_bytes(audio)
    return headers


def cancel_jaitts_turn(turn_id: str) -> bool:
    """Tell the persistent source model to discard its current result when possible."""
    if not JAITTS_ENABLED:
        return False
    request = UrlRequest(
        f"{JAITTS_BASE_URL}/v1/cancel/{turn_id}",
        data=b"",
        method="POST",
        headers={"Authorization": f"Bearer {JAITTS_API_TOKEN}"},
    )
    try:
        with urlopen(request, timeout=5.0) as response:
            return 200 <= int(response.status) < 300
    except (HTTPError, URLError, TimeoutError, OSError):
        return False


def normalize_training_options(
    training_mode: Any,
    model_selection: Any,
    epochs: Any,
) -> tuple[str, str, int]:
    mode = str(training_mode or "fresh").strip().lower()
    selection = str(model_selection or "best").strip().lower()
    if mode not in ("fresh", "finetune"):
        raise ValueError("trainingMode must be fresh or finetune")
    if selection not in ("best", "latest"):
        raise ValueError("modelSelection must be best or latest")
    if isinstance(epochs, bool):
        raise ValueError("epochs must be a whole number between 1 and 1200")
    try:
        epoch_count = int(epochs)
    except (TypeError, ValueError) as error:
        raise ValueError("epochs must be a whole number between 1 and 1200") from error
    if str(epochs).strip() != str(epoch_count) or not 1 <= epoch_count <= 1200:
        raise ValueError("epochs must be a whole number between 1 and 1200")
    return mode, selection, epoch_count


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


CONVERSION_AUDIO_EXTENSIONS = {
    ".aac",
    ".flac",
    ".m4a",
    ".mp3",
    ".ogg",
    ".opus",
    ".wav",
    ".webm",
}
CONVERSION_CONTENT_TYPE_EXTENSIONS = {
    "audio/aac": ".aac",
    "audio/flac": ".flac",
    "audio/m4a": ".m4a",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/opus": ".opus",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/webm": ".webm",
}


def conversion_audio_suffix(request: Request) -> str:
    """Resolve a safe decoder hint without trusting the uploaded filename."""
    requested = str(request.headers.get("x-audio-extension") or "").strip().lower()
    if requested and not requested.startswith("."):
        requested = f".{requested}"
    if requested in CONVERSION_AUDIO_EXTENSIONS:
        return requested
    content_type = str(request.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    suffix = CONVERSION_CONTENT_TYPE_EXTENSIONS.get(content_type)
    if suffix:
        return suffix
    raise HTTPException(
        status_code=415,
        detail="audio must be WAV, MP3, FLAC, M4A/AAC, OGG/Opus, or WebM",
    )


def probe_conversion_audio(path: Path) -> float:
    """Validate that FFmpeg can decode an audio stream and return its duration."""
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_name:format=duration",
        "-of",
        "json",
        str(path),
    ]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError(f"could not inspect uploaded audio: {error}") from error
    if completed.returncode != 0:
        detail = completed.stderr.strip()[-400:] or "FFmpeg could not decode this file"
        raise ValueError(f"invalid or unsupported audio: {detail}")
    try:
        payload = json.loads(completed.stdout)
        streams = payload.get("streams") or []
        duration = float((payload.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("uploaded audio has no readable duration") from error
    if not streams or not streams[0].get("codec_name"):
        raise ValueError("uploaded file has no audio stream")
    if not math.isfinite(duration) or duration < 0.35:
        raise ValueError("audio must be at least 0.35 seconds long")
    if duration > MAX_CONVERSION_SECONDS:
        raise ValueError(f"audio must be {MAX_CONVERSION_SECONDS:g} seconds or shorter")
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
        self.delivery_profile_cache: dict[str, tuple[int, dict[str, Any] | None]] = {}
        self.sample_stats_cache: dict[str, tuple[int, int, float]] = {}
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
            if job.get("status") in ("training", "stopping"):
                job["status"] = "failed"
                job["message"] = "The local voice service stopped while this job was training; start a new job."
                job["finishedAt"] = int(time.time() * 1000)
            elif job.get("status") == "queued":
                self.jobs.put(job_id)
        self._save_state()

    def speaker_dir(self, speaker_id: str) -> Path:
        return self.speakers_root / speaker_id

    def _measured_delivery_profile(self, speaker_id: str) -> dict[str, Any] | None:
        metadata_root = VOICE_CAPTURE_ROOT / speaker_id
        try:
            version = metadata_root.stat().st_mtime_ns
        except OSError:
            version = 0
        cached = self.delivery_profile_cache.get(speaker_id)
        if cached and cached[0] == version:
            return cached[1]
        profile = estimate_delivery_profile(metadata_root)
        self.delivery_profile_cache[speaker_id] = (version, profile)
        return profile

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
        try:
            version = samples.stat().st_mtime_ns
        except OSError:
            version = 0
        cached = self.sample_stats_cache.get(speaker_id)
        if cached and cached[0] == version:
            return cached[1], cached[2]
        for sample in samples.glob("*.wav"):
            try:
                with wave.open(str(sample), "rb") as reader:
                    duration += reader.getnframes() / reader.getframerate()
                count += 1
            except Exception:
                continue
        self.sample_stats_cache[speaker_id] = (version, count, duration)
        return count, duration

    @staticmethod
    def _wav_directory_stats(samples: Path) -> tuple[int, float]:
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

    def _training_samples(self, speaker_id: str, dataset_version_id: str | None) -> Path:
        default = self.speaker_dir(speaker_id) / "samples"
        if not dataset_version_id:
            return default
        if not DATASET_VERSION_RE.fullmatch(dataset_version_id):
            raise ValueError("datasetVersionId contains unsupported characters")
        speaker_root = self.speaker_dir(speaker_id).resolve()
        versioned = (speaker_root / "datasets" / dataset_version_id / "samples").resolve()
        if not versioned.is_relative_to(speaker_root):
            raise ValueError("The selected dataset path is unsafe")
        # Learning-session IDs created before dataset snapshots were introduced
        # still refer to the speaker's accepted sample set. A real snapshot takes
        # precedence and guarantees that only its files enter this training job.
        return versioned if versioned.is_dir() else default

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
                current_epoch = job.get("currentEpoch")
                experiment = str(job.get("experiment") or "")
                metrics_path = RVC_ROOT / "logs" / experiment / "checkpoint_metrics.json"
                if experiment and metrics_path.is_file():
                    try:
                        metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
                        current_epoch = metrics.get("latestEpoch", current_epoch)
                    except Exception:
                        pass
                job_summary = {
                    "id": job["id"],
                    "status": job["status"],
                    "message": job.get("message", ""),
                    "trainingMode": job.get("trainingMode", "fresh"),
                    "modelSelection": job.get("modelSelection"),
                    "epochs": job.get("epochs", RVC_EPOCHS),
                    "completedEpochs": job.get("completedEpochs"),
                    "datasetVersionId": job.get("datasetVersionId"),
                    "learningSessionId": job.get("learningSessionId"),
                    "modelLabel": job.get("modelLabel"),
                    "currentEpoch": current_epoch,
                    "stopAfterEpoch": job.get("stopAfterEpoch"),
                    "stopRequested": job.get("status") == "stopping",
                }
            model_versions = []
            current_job_id = current.get("jobId") if current else None
            current_job = self.state["jobs"].get(str(current_job_id), {}) if current_job_id else {}
            current_label = (
                current.get("modelLabel") if current else None
            ) or current_job.get("modelLabel") or ("Gam Voice" if current else None)
            for version_job in self.state["jobs"].values():
                if version_job.get("speakerId") != speaker_id or version_job.get("status") != "ready":
                    continue
                version_id = str(version_job.get("id", ""))
                model_dir = self.speaker_dir(speaker_id) / "models" / version_id
                if not (model_dir / "best_model.pth").is_file():
                    continue
                is_current = version_id == current_job_id
                model_versions.append({
                    "id": version_id,
                    "isCurrent": is_current,
                    "label": (
                        current_label if is_current else version_job.get("modelLabel")
                    ) or ("Gam Voice" if version_job.get("trainingMode") != "fresh" else "Gam Base"),
                    "createdAt": int(version_job.get("createdAt", 0)),
                    "finishedAt": version_job.get("finishedAt"),
                    "trainingMode": version_job.get("trainingMode", "fresh"),
                    "baseModelSelection": version_job.get("modelSelection"),
                    "epochs": int(version_job.get("completedEpochs", version_job.get("epochs", RVC_EPOCHS))),
                    "bestEpoch": current.get("bestEpoch") if is_current and current else version_job.get("bestEpoch"),
                    "bestScore": current.get("bestScore") if is_current and current else version_job.get("bestScore"),
                    "latestEpoch": current.get("latestEpoch") if is_current and current else version_job.get("latestEpoch"),
                    "datasetVersionId": version_job.get("datasetVersionId"),
                    "learningSessionId": version_job.get("learningSessionId"),
                    "availableModels": {
                        "best": (model_dir / "best_model.pth").is_file(),
                        "latest": (model_dir / "latest_model.pth").is_file(),
                    },
                })
            model_versions.sort(key=lambda item: item["createdAt"], reverse=True)
            return {
                "speakerId": speaker_id,
                "displayName": profile.get("displayName", speaker_id),
                "sampleCount": sample_count,
                "durationSeconds": round(duration, 3),
                "modelReady": current is not None,
                "activeModelVersionId": current.get("jobId") if current else None,
                "activeModelLabel": current_label,
                "trainedDurationSeconds": float(current.get("trainedDurationSeconds", 0)) if current else 0,
                "checkpointSelection": {
                    "active": current.get("activeModelSelection", "best"),
                    "bestEpoch": current.get("bestEpoch"),
                    "bestScore": current.get("bestScore"),
                    "latestEpoch": current.get("latestEpoch"),
                    "metric": current.get("selectionMetric"),
                } if current and current.get("bestModelPath") else None,
                "availableModels": {
                    "best": bool(current and current.get("bestModelPath")),
                    "latest": bool(current and current.get("latestModelPath")),
                },
                "modelVersions": model_versions,
                "job": job_summary,
            }

    def list_speakers(self) -> list[dict[str, Any]]:
        result = []
        if self.speakers_root.is_dir():
            for item in sorted(self.speakers_root.iterdir()):
                if item.is_dir() and SPEAKER_RE.fullmatch(item.name):
                    result.append(self.status(item.name))
        return result

    def preview_export(self, speaker_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        status = self.status(speaker_id)
        return preview_cloud_training_export(
            self.speaker_dir(speaker_id),
            PROJECT_ROOT / "data" / "voice_samples" / speaker_id,
            status,
            payload,
        )

    def create_export(self, speaker_id: str, payload: dict[str, Any]) -> tuple[Path, dict[str, Any]]:
        status = self.status(speaker_id)
        return create_cloud_training_export(
            PROJECT_ROOT,
            self.speaker_dir(speaker_id),
            PROJECT_ROOT / "data" / "voice_samples" / speaker_id,
            status,
            payload,
            PROJECT_ROOT / "output" / "cloud_exports",
        )

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
        # Learning sessions upload only quality-approved clips while listening.
        # Training is deliberately queued by the bot after the session is stopped,
        # so the dataset manifest is immutable and no GPU job starts mid-capture.
        should_auto_train = AUTO_TRAIN_ON_UPLOAD and (current is None or AUTO_RETRAIN_ENABLED)
        if should_auto_train and status["durationSeconds"] - trained_duration >= threshold:
            try:
                self.queue_training(speaker_id, display_name, automatic=True)
            except (ValueError, RuntimeError):
                pass
        return self.status(speaker_id)

    def _resolve_published_model(self, speaker_id: str, selection: str) -> tuple[Path, str]:
        current = self._current_metadata(speaker_id)
        if current is None:
            raise ValueError("Fine-tuning requires a completed voice model for this person.")
        key = "bestModelPath" if selection == "best" else "latestModelPath"
        relative_value = current.get(key)
        if not isinstance(relative_value, str) or not relative_value.strip():
            raise ValueError(f"The selected {selection} model is not available for this person.")
        relative = Path(relative_value)
        root = self.speaker_dir(speaker_id).resolve()
        candidate = (root / relative).resolve()
        if relative.is_absolute() or not candidate.is_relative_to(root):
            raise ValueError("The selected model path is unsafe.")
        if not candidate.is_file() or candidate.suffix.lower() != ".pth":
            raise ValueError(f"The selected {selection} model file is missing.")
        return candidate, str(candidate.relative_to(root))

    def queue_training(
        self,
        speaker_id: str,
        display_name: str,
        automatic: bool,
        training_mode: str = "fresh",
        model_selection: str = "best",
        epochs: int | None = None,
        dataset_version_id: str | None = None,
        learning_session_id: str | None = None,
        model_label: str | None = None,
    ) -> dict[str, Any]:
        with self.state_lock:
            mode, selection, epoch_count = normalize_training_options(
                training_mode,
                model_selection,
                RVC_EPOCHS if epochs is None else epochs,
            )
            status = self.status(speaker_id)
            training_samples = self._training_samples(speaker_id, dataset_version_id)
            dataset_count, dataset_duration = self._wav_directory_stats(training_samples)
            minimum = AUTO_TRAIN_SECONDS if automatic and not status["modelReady"] else (
                RETRAIN_NEW_SECONDS if automatic else MIN_MANUAL_SECONDS
            )
            trained = float(status.get("trainedDurationSeconds", 0))
            if dataset_version_id and training_samples != self.speaker_dir(speaker_id) / "samples":
                available = dataset_duration
            else:
                available = status["durationSeconds"] - trained if automatic and status["modelReady"] else status["durationSeconds"]
            if available < minimum:
                raise ValueError(f"Need {minimum:.0f}s of eligible clean audio; currently {available:.1f}s is available.")
            if dataset_count < 1:
                raise ValueError("The selected training dataset contains no readable WAV files.")
            base_model_relative = None
            if mode == "finetune":
                _, base_model_relative = self._resolve_published_model(speaker_id, selection)
            for job in self.state["jobs"].values():
                if job.get("speakerId") == speaker_id and job.get("status") in ("queued", "training", "stopping"):
                    return self.status(speaker_id)

            job_id = f"job_{int(time.time())}_{secrets.token_hex(4)}"
            self.state["jobs"][job_id] = {
                "id": job_id,
                "speakerId": speaker_id,
                "displayName": display_name,
                "status": "queued",
                "message": "Waiting for the local GPU worker.",
                "automatic": automatic,
                "trainingMode": mode,
                "modelSelection": selection if mode == "finetune" else None,
                "baseModelRelativePath": base_model_relative,
                "epochs": epoch_count,
                "createdAt": int(time.time() * 1000),
                "durationSeconds": dataset_duration,
                "datasetSampleCount": dataset_count,
                "datasetVersionId": dataset_version_id,
                "learningSessionId": learning_session_id,
                "modelLabel": (model_label or display_name)[:80],
            }
            self._save_state()
            self.jobs.put(job_id)
            return self.status(speaker_id)

    def request_stop_after_epoch(self, speaker_id: str) -> dict[str, Any]:
        with self.state_lock:
            job = self._latest_job(speaker_id)
            if not job or job.get("status") not in ("training", "stopping"):
                raise ValueError("No active training job is available to stop.")
            if job.get("status") == "stopping":
                return self.status(speaker_id)

            experiment = str(job.get("experiment") or "")
            current_epoch = 0
            metrics_path = RVC_ROOT / "logs" / experiment / "checkpoint_metrics.json"
            if experiment and metrics_path.is_file():
                try:
                    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
                    current_epoch = max(0, int(metrics.get("latestEpoch") or 0))
                except Exception:
                    current_epoch = 0
            stop_after_epoch = current_epoch + 1
            stop_request = WORK_ROOT / str(job["id"]) / "stop_after_epoch.json"
            atomic_json(stop_request, {
                "requestedAt": int(time.time() * 1000),
                "afterEpoch": stop_after_epoch,
            })
            job.update({
                "status": "stopping",
                "stopAfterEpoch": stop_after_epoch,
                "message": f"Stopping safely after epoch {stop_after_epoch}, then building the index and publishing Best/Latest.",
            })
            self._save_state()
            return self.status(speaker_id)

    def delete_speaker(self, speaker_id: str) -> bool:
        with self.state_lock:
            speaker_job_ids = [
                job_id for job_id, job in self.state["jobs"].items()
                if job.get("speakerId") == speaker_id
            ]
            for job in self.state["jobs"].values():
                if job.get("speakerId") == speaker_id and job.get("status") in ("training", "stopping"):
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
            for stale_model in (RVC_ROOT / "assets" / "weights").glob(f"voice_{speaker_id}_*.pth"):
                stale_model.unlink(missing_ok=True)
            for stale_index in (RVC_ROOT / "assets" / "indices").glob(f"voice_{speaker_id}_*.index"):
                stale_index.unlink(missing_ok=True)
            for job_id in speaker_job_ids:
                work_dir = (WORK_ROOT / job_id).resolve()
                if work_dir.parent == WORK_ROOT.resolve():
                    shutil.rmtree(work_dir, ignore_errors=True)
            for experiment_dir in (RVC_ROOT / "logs").glob(f"voice_{speaker_id}_*"):
                resolved_experiment = experiment_dir.resolve()
                if resolved_experiment.parent == (RVC_ROOT / "logs").resolve():
                    shutil.rmtree(resolved_experiment, ignore_errors=True)
            self.local_versions.pop(speaker_id, None)
            self.sample_stats_cache.pop(speaker_id, None)
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
        training_samples = self._training_samples(speaker_id, job.get("datasetVersionId"))
        for sample in training_samples.glob("*.wav"):
            shutil.copy2(sample, dataset / sample.name)
        if not any(dataset.glob("*.wav")):
            raise RuntimeError("No WAV samples were available when the training job started.")

        experiment = f"voice_{speaker_id}_{job_id[-8:]}"
        stop_request_path = work_dir / "stop_after_epoch.json"
        command = [
            sys.executable,
            str(PROJECT_ROOT / "colab" / "rvc_train_runner.py"),
            "--rvc-root", str(RVC_ROOT),
            "--dataset", str(dataset),
            "--experiment", experiment,
            "--epochs", str(job.get("epochs", RVC_EPOCHS)),
            "--batch-size", str(RVC_BATCH_SIZE),
            "--workers", str(RVC_WORKERS),
            "--training-mode", str(job.get("trainingMode", "fresh")),
            "--learning-rate-scale", str(RVC_FINETUNE_LR_SCALE if job.get("trainingMode") == "finetune" else 1.0),
            "--stop-request-file", str(stop_request_path),
            "--result-json", str(result_json),
        ]
        if job.get("trainingMode") == "finetune":
            relative = Path(str(job.get("baseModelRelativePath") or ""))
            speaker_root = self.speaker_dir(speaker_id).resolve()
            base_model = (speaker_root / relative).resolve()
            if relative.is_absolute() or not base_model.is_relative_to(speaker_root) or not base_model.is_file():
                raise RuntimeError("The selected fine-tune model is no longer available.")
            command.extend([
                "--base-model", str(base_model),
                "--base-model-selection", str(job.get("modelSelection") or "best"),
            ])
        mode_label = "Fine-tuning" if job.get("trainingMode") == "finetune" else "Fresh training"
        self._set_job(
            job_id,
            status="training",
            message=f"{mode_label} on the local GPU for {job.get('epochs', RVC_EPOCHS)} epochs.",
            startedAt=int(time.time() * 1000),
            experiment=experiment,
        )
        self.training_job_id = job_id
        try:
            with self.gpu_lock, log_path.open("w", encoding="utf-8") as log:
                if self.inference_engine is not None and self.loaded_model_key is not None:
                    try:
                        self.inference_engine.get_vc("")
                    except Exception as error:
                        print(f"[voice-service] Could not fully unload the inference model before training: {error}", flush=True)
                    self.loaded_model_key = None
                    # Upstream get_vc("") deletes net_g after unloading. Reusing
                    # that VC instance after training therefore crashes on the
                    # first model load. Force a clean engine on next inference.
                    self.inference_engine = None
                    self.inference_config = None

                training_environment = os.environ.copy()
                for thread_setting in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
                    training_environment[thread_setting] = str(RVC_CPU_THREADS)
                creation_flags = 0
                if os.name == "nt" and RVC_LOW_PRIORITY:
                    creation_flags = subprocess.BELOW_NORMAL_PRIORITY_CLASS
                process = subprocess.Popen(
                    command,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    env=training_environment,
                    creationflags=creation_flags,
                )
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
        best_model_source = Path(result.get("bestModelPath", result["modelPath"]))
        latest_model_source = Path(result.get("latestModelPath", result["modelPath"]))
        index_source = Path(result["indexPath"])
        published = self.speaker_dir(speaker_id) / "models" / job_id
        published.mkdir(parents=True, exist_ok=True)
        drive_model = published / "model.pth"
        drive_best_model = published / "best_model.pth"
        drive_latest_model = published / "latest_model.pth"
        drive_index = published / "model.index"
        shutil.copy2(best_model_source, drive_best_model)
        shutil.copy2(latest_model_source, drive_latest_model)
        active_selection = "latest" if result.get("stoppedEarly") else "best"
        shutil.copy2(drive_latest_model if active_selection == "latest" else drive_best_model, drive_model)
        shutil.copy2(index_source, drive_index)
        shutil.copy2(log_path, published / "training.log")
        epoch_log = Path(result.get("logDirectory", "")) / "train.log"
        if epoch_log.is_file():
            shutil.copy2(epoch_log, published / "epoch_training.log")
        checkpoint_metrics = Path(result.get("checkpointMetricsPath", ""))
        if checkpoint_metrics.is_file():
            shutil.copy2(checkpoint_metrics, published / "checkpoint_metrics.json")

        current = {
            "speakerId": speaker_id,
            "jobId": job_id,
            "modelPath": str(drive_model.relative_to(self.speaker_dir(speaker_id))),
            "indexPath": str(drive_index.relative_to(self.speaker_dir(speaker_id))),
            "trainedDurationSeconds": float(job["durationSeconds"]),
            "publishedAt": int(time.time() * 1000),
            "rvcEpochs": int(result.get("epochs", job.get("epochs", RVC_EPOCHS))),
            "trainingMode": result.get("trainingMode", job.get("trainingMode", "fresh")),
            "baseModelSelection": result.get("baseModelSelection", job.get("modelSelection")),
            "requestedEpochs": result.get("requestedEpochs", job.get("epochs", RVC_EPOCHS)),
            "stoppedEarly": bool(result.get("stoppedEarly", False)),
            "learningRateScale": result.get("learningRateScale"),
            "bestModelPath": str(drive_best_model.relative_to(self.speaker_dir(speaker_id))),
            "latestModelPath": str(drive_latest_model.relative_to(self.speaker_dir(speaker_id))),
            "bestEpoch": result.get("bestEpoch"),
            "bestScore": result.get("bestScore"),
            "latestEpoch": result.get("latestEpoch"),
            "selectionMetric": result.get("selectionMetric"),
            "activeModelSelection": active_selection,
            "datasetVersionId": job.get("datasetVersionId"),
            "learningSessionId": job.get("learningSessionId"),
            "modelLabel": job.get("modelLabel") or job.get("displayName") or speaker_id,
        }
        atomic_json(self.speaker_dir(speaker_id) / "current.json", current)
        self.local_versions[speaker_id] = job_id
        if self.loaded_model_key and self.loaded_model_key[0] == speaker_id:
            self.loaded_model_key = None
        self._set_job(
            job_id,
            status="ready",
            message=(
                f"Stopped safely and published Best epoch {result.get('bestEpoch')} plus Latest epoch {result.get('latestEpoch')}."
                if result.get("stoppedEarly")
                else f"Best epoch {result.get('bestEpoch')} and latest epoch {result.get('latestEpoch')} published to local storage."
            ),
            finishedAt=int(time.time() * 1000),
            bestEpoch=result.get("bestEpoch"),
            bestScore=result.get("bestScore"),
            latestEpoch=result.get("latestEpoch"),
            completedEpochs=result.get("epochs"),
            stoppedEarly=bool(result.get("stoppedEarly", False)),
        )

        for source_model in {model_source, best_model_source, latest_model_source}:
            if source_model.parent.resolve() == (RVC_ROOT / "assets" / "weights").resolve():
                source_model.unlink(missing_ok=True)
        if index_source.parent.resolve() == (RVC_ROOT / "assets" / "indices").resolve():
            index_source.unlink(missing_ok=True)
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

    def _resolve_model_version(
        self,
        speaker_id: str,
        model_version_id: str,
    ) -> tuple[dict[str, Any], Path, dict[str, Any]]:
        version_id = str(model_version_id or "").strip()
        if not MODEL_VERSION_RE.fullmatch(version_id):
            raise ValueError("modelVersionId is invalid")
        job = self.state["jobs"].get(version_id)
        if not job or job.get("speakerId") != speaker_id or job.get("status") != "ready":
            raise ValueError("The selected model version is not available for this person")
        speaker_root = self.speaker_dir(speaker_id).resolve()
        model_dir = (speaker_root / "models" / version_id).resolve()
        if not model_dir.is_relative_to(speaker_root) or not model_dir.is_dir():
            raise ValueError("The selected model version directory is missing")
        metrics: dict[str, Any] = {}
        metrics_path = model_dir / "checkpoint_metrics.json"
        if metrics_path.is_file():
            try:
                value = json.loads(metrics_path.read_text(encoding="utf-8"))
                if isinstance(value, dict):
                    metrics = value
            except Exception:
                pass
        return job, model_dir, metrics

    def _ensure_local_model(
        self,
        speaker_id: str,
        model_selection: str | None = None,
        model_version_id: str | None = None,
    ) -> tuple[Path, Path, str]:
        current = self._current_metadata(speaker_id)
        if current is None:
            raise FileNotFoundError("voice model is not trained yet")
        job_id = str(model_version_id or current["jobId"])
        selection = str(model_selection or current.get("activeModelSelection") or "best").strip().lower()
        if selection not in ("best", "latest"):
            raise ValueError("modelSelection must be best or latest")
        if model_version_id:
            _, model_dir, _ = self._resolve_model_version(speaker_id, job_id)
            model_source = model_dir / f"{selection}_model.pth"
            index_source = model_dir / "model.index"
        else:
            model_key = "bestModelPath" if selection == "best" else "latestModelPath"
            model_relative = current.get(model_key) or current.get("modelPath")
            if not isinstance(model_relative, str) or not model_relative.strip():
                raise FileNotFoundError(f"the {selection} voice model is not available")
            model_source = self.speaker_dir(speaker_id) / model_relative
            index_source = self.speaker_dir(speaker_id) / current["indexPath"]
        if not model_source.is_file() or not index_source.is_file():
            raise FileNotFoundError(f"the {selection} checkpoint for this model version is missing")
        local_model = RVC_ROOT / "assets" / "weights" / f"dm_{speaker_id}.pth"
        local_index = RVC_ROOT / "assets" / "indices" / f"dm_{speaker_id}.index"
        version_key = f"{job_id}:{selection}:{model_source.stat().st_mtime_ns}:{model_source.stat().st_size}"
        if self.local_versions.get(speaker_id) != version_key or not local_model.is_file() or not local_index.is_file():
            atomic_copy(model_source, local_model)
            atomic_copy(index_source, local_index)
            self.local_versions[speaker_id] = version_key
        return local_model, local_index, version_key

    def select_active_model(
        self,
        speaker_id: str,
        model_selection: str,
        model_version_id: str | None = None,
    ) -> dict[str, Any]:
        selection = str(model_selection or "").strip().lower()
        if selection not in ("best", "latest"):
            raise ValueError("modelSelection must be best or latest")
        if self.training_job_id is not None:
            raise GpuBusyError("the local GPU is training; wait until training publishes the model")
        if not self.gpu_lock.acquire(blocking=False):
            raise GpuBusyError("the local GPU is generating speech; retry in a moment")
        try:
            if self.training_job_id is not None:
                raise GpuBusyError("the local GPU is training; wait until training publishes the model")
            with self.state_lock:
                current = self._current_metadata(speaker_id)
                if current is None:
                    raise ValueError("voice model is not trained yet")
                speaker_root = self.speaker_dir(speaker_id).resolve()
                version_id = str(model_version_id or current.get("jobId") or "")
                job, model_dir, metrics = self._resolve_model_version(speaker_id, version_id)
                selected_model = model_dir / f"{selection}_model.pth"
                index_model = model_dir / "model.index"
                if not selected_model.is_file() or not index_model.is_file():
                    raise ValueError(f"The selected {selection} checkpoint is missing")
                if self.inference_engine is not None and self.loaded_model_key and self.loaded_model_key[0] == speaker_id:
                    try:
                        self.inference_engine.get_vc("")
                    except Exception as error:
                        print(f"[voice-service] Could not fully unload {speaker_id} before model switch: {error}", flush=True)
                self.loaded_model_key = None
                best_model = model_dir / "best_model.pth"
                latest_model = model_dir / "latest_model.pth"
                replacement = {
                    "speakerId": speaker_id,
                    "jobId": version_id,
                    "modelPath": str(selected_model.relative_to(speaker_root)),
                    "indexPath": str(index_model.relative_to(speaker_root)),
                    "trainedDurationSeconds": float(job.get("durationSeconds", 0)),
                    "publishedAt": int(job.get("finishedAt") or job.get("createdAt") or time.time() * 1000),
                    "rvcEpochs": int(job.get("completedEpochs") or job.get("epochs") or 0),
                    "trainingMode": job.get("trainingMode", "fresh"),
                    "baseModelSelection": job.get("modelSelection"),
                    "requestedEpochs": job.get("epochs"),
                    "stoppedEarly": bool(job.get("stoppedEarly", False)),
                    "bestModelPath": str(best_model.relative_to(speaker_root)),
                    "latestModelPath": str(latest_model.relative_to(speaker_root)),
                    "bestEpoch": metrics.get("bestEpoch", job.get("bestEpoch")),
                    "bestScore": metrics.get("bestScore", job.get("bestScore")),
                    "latestEpoch": metrics.get("latestEpoch", job.get("latestEpoch")),
                    "selectionMetric": metrics.get("selectionMetric", "mean_generator_training_loss"),
                    "activeModelSelection": selection,
                    "datasetVersionId": job.get("datasetVersionId"),
                    "learningSessionId": job.get("learningSessionId"),
                    "modelLabel": job.get("modelLabel") or ("Gam Voice" if job.get("trainingMode") != "fresh" else "Gam Base"),
                    "activeModelChangedAt": int(time.time() * 1000),
                }
                atomic_json(self.speaker_dir(speaker_id) / "current.json", replacement)
                self.local_versions.pop(speaker_id, None)
            return self.status(speaker_id)
        finally:
            self.gpu_lock.release()

    def _load_engine(self) -> Any:
        if self.inference_engine is not None and hasattr(self.inference_engine, "net_g"):
            return self.inference_engine
        self.inference_engine = None
        self.inference_config = None
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

    def learned_voice_delivery(self, speaker_id: str) -> dict[str, Any]:
        result = {
            "rateDeltaPercent": 0,
            "f0ShiftSemitones": 0,
            "sampleCount": 0,
            "cleanSeconds": 0.0,
        }
        brain_path = PROJECT_ROOT / "data" / "brain" / "brain_state.json"
        try:
            brain = json.loads(brain_path.read_text(encoding="utf-8"))
            style = brain.get("people", {}).get(speaker_id, {}).get("style", {})
            sample_count = int(style.get("voiceSampleCount", 0))
            clean_seconds = float(style.get("cleanVoiceSeconds", 0))
            measured = self._measured_delivery_profile(speaker_id)
            if measured:
                sample_count = int(measured["sampleCount"])
                clean_seconds = float(measured["cleanSeconds"])
            result["sampleCount"] = sample_count
            result["cleanSeconds"] = round(clean_seconds, 3)
            confidence = min(1.0, sample_count / 20.0, clean_seconds / 60.0)
            speaking_rate_count = int(style.get("speakingRateCount", 0))
            measured_rate = measured.get("targetRateWordsPerSecond") if measured else None
            if measured_rate is not None or speaking_rate_count >= 3:
                speaking_rate = float(measured_rate) if measured_rate is not None else (
                    float(style.get("speakingRateTotal", 0)) / speaking_rate_count
                )
                raw_rate_delta = round((speaking_rate / EDGE_TTS_REFERENCE_RATE_WPS - 1.0) * 100)
                if EDGE_TTS_LEARN_RATE:
                    result["rateDeltaPercent"] = round(max(-16, min(12, raw_rate_delta)) * confidence)
                result["targetRateWordsPerSecond"] = round(speaking_rate, 3)
            pitch_count = int(style.get("pitchMedianHzCount", 0))
            measured_pitch = measured.get("targetPitchHz") if measured else None
            if (measured_pitch is not None or pitch_count >= 3) and EDGE_TTS_REFERENCE_PITCH_HZ > 0:
                target_pitch = float(measured_pitch) if measured_pitch is not None else (
                    float(style.get("pitchMedianHzTotal", 0)) / pitch_count
                )
                if target_pitch > 0:
                    raw_semitones = round(12 * math.log2(target_pitch / EDGE_TTS_REFERENCE_PITCH_HZ))
                    result["f0ShiftSemitones"] = round(max(-6, min(6, raw_semitones)) * confidence)
                    result["targetPitchHz"] = round(target_pitch, 2)
        except Exception as error:
            print(f"[voice-service] Learned delivery profile unavailable for {speaker_id}: {error}", flush=True)
        return result

    def convert(
        self,
        speaker_id: str,
        input_audio: Path,
        output_audio: Path,
        f0_shift_semitones: int = 0,
        model_selection: str | None = None,
        conversion_mode: str = "speech",
        singing_profile: str = "configured",
        model_version_id: str | None = None,
    ) -> None:
        if not self.gpu_lock.acquire(blocking=False):
            raise GpuBusyError("the local GPU is training; cloned inference is temporarily unavailable")
        try:
            model, index, model_version = self._ensure_local_model(
                speaker_id, model_selection, model_version_id
            )
            engine = self._load_engine()
            model_key = (speaker_id, model_version)
            if self.loaded_model_key != model_key:
                engine.get_vc(model.name)
                self.loaded_model_key = model_key
            self._convert_with_engine(
                engine,
                index,
                input_audio,
                output_audio,
                f0_shift_semitones,
                conversion_mode,
                singing_profile,
            )
        finally:
            self.gpu_lock.release()

    def convert_many(
        self,
        speaker_id: str,
        inputs: list[Path],
        outputs: list[Path],
        f0_shift_semitones: int = 0,
        model_selection: str | None = None,
        conversion_mode: str = "speech",
        singing_profile: str = "configured",
        model_version_id: str | None = None,
    ) -> None:
        """Convert bounded chunks while keeping one model and one GPU lock loaded."""
        if not inputs or len(inputs) != len(outputs):
            raise ValueError("RVC input/output chunk lists do not match")
        if not self.gpu_lock.acquire(blocking=False):
            raise GpuBusyError("the local GPU is training; cloned inference is temporarily unavailable")
        try:
            model, index, model_version = self._ensure_local_model(
                speaker_id, model_selection, model_version_id
            )
            engine = self._load_engine()
            model_key = (speaker_id, model_version)
            if self.loaded_model_key != model_key:
                engine.get_vc(model.name)
                self.loaded_model_key = model_key
            for input_audio, output_audio in zip(inputs, outputs):
                self._convert_with_engine(
                    engine,
                    index,
                    input_audio,
                    output_audio,
                    f0_shift_semitones,
                    conversion_mode,
                    singing_profile,
                )
        finally:
            self.gpu_lock.release()

    @staticmethod
    def _convert_with_engine(
        engine: Any,
        index: Path,
        input_audio: Path,
        output_audio: Path,
        f0_shift_semitones: int,
        conversion_mode: str,
        singing_profile: str,
    ) -> None:
        is_singing = conversion_mode in ("vocal", "song")
        singing_settings = SINGING_INFERENCE_PROFILES.get(singing_profile, SINGING_INFERENCE_PROFILES["configured"])
        index_rate = singing_settings[0] if is_singing else RVC_INDEX_RATE
        rms_mix_rate = singing_settings[1] if is_singing else RVC_RMS_MIX_RATE
        protect = singing_settings[2] if is_singing else RVC_PROTECT
        status, result = engine.vc_single(
            0,
            str(input_audio),
            int(max(-12, min(12, f0_shift_semitones))),
            "rmvpe",
            str(index),
            index_rate,
            0,
            rms_mix_rate,
            protect,
        )
        if not result or result[0] is None or result[1] is None:
            raise RuntimeError(f"RVC inference failed: {status}")
        import soundfile as sf

        sf.write(str(output_audio), result[1], result[0], format="WAV", subtype="PCM_16")


pipeline = VoicePipeline()
app = FastAPI(title="Digital Me RVC Voice Service", version="1.0")
SYNTHESIS_LOCK = asyncio.Lock()


@app.middleware("http")
async def serialize_voice_generation(request: Request, call_next: Any) -> Any:
    """Keep JaiTTS and RVC from overlapping separate requests on an 8 GB GPU."""
    if request.method == "POST" and request.url.path in ("/v1/generate", "/v1/convert"):
        async with SYNTHESIS_LOCK:
            return await call_next(request)
    return await call_next(request)


def require_auth(request: Request) -> None:
    header = request.headers.get("authorization", "")
    supplied = header[7:] if header.lower().startswith("bearer ") else ""
    if not hmac.compare_digest(supplied, API_TOKEN):
        raise HTTPException(status_code=401, detail="invalid bearer token")


@app.post("/v1/cancel/{turn_id}")
async def cancel_voice_turn(turn_id: str, request: Request) -> dict[str, Any]:
    require_auth(request)
    if not cancelled_turns.cancel(turn_id):
        raise HTTPException(status_code=400, detail="invalid turn id")
    forwarded = await asyncio.to_thread(cancel_jaitts_turn, turn_id)
    return {
        "cancelled": True,
        "turnId": turn_id,
        "jaittsForwarded": forwarded,
        "granularity": "discard-between-source-and-rvc-stages",
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    try:
        import torch
        cuda_available = bool(torch.cuda.is_available())
        cuda_device = torch.cuda.get_device_name(0) if cuda_available else None
    except Exception:
        cuda_available = False
        cuda_device = None
    return {
        "status": "ok",
        "processId": os.getpid(),
        "storageReady": DRIVE_ROOT.exists(),
        "storageRoot": str(DRIVE_ROOT),
        "rvcInstalled": (RVC_ROOT / "infer" / "vc" / "modules.py").is_file(),
        "cudaAvailable": cuda_available,
        "cudaDevice": cuda_device,
        "training": pipeline.training_job_id is not None,
        "automaticTrainingOnUpload": AUTO_TRAIN_ON_UPLOAD,
        "automaticRetraining": AUTO_RETRAIN_ENABLED,
        "trainingConfig": {
            "epochs": RVC_EPOCHS,
            "batchSize": RVC_BATCH_SIZE,
            "workers": RVC_WORKERS,
            "cpuThreads": RVC_CPU_THREADS,
            "lowPriority": RVC_LOW_PRIORITY,
            "fineTuneLearningRateScale": RVC_FINETUNE_LR_SCALE,
        },
        "inference": {
            "indexRate": RVC_INDEX_RATE,
            "rmsMixRate": RVC_RMS_MIX_RATE,
            "protect": RVC_PROTECT,
            "expressiveProsody": True,
            "sourceVoice": "JaiTTS reference -> RVC" if JAITTS_ENABLED else EDGE_TTS_VOICE,
            "sourceVoiceFallback": EDGE_TTS_VOICE,
            "jaittsEnabled": JAITTS_ENABLED,
            "jaittsBaseUrl": JAITTS_BASE_URL if JAITTS_ENABLED else None,
            "jaittsPreset": JAITTS_PRESET if JAITTS_ENABLED else None,
            "deliveryRateLearning": EDGE_TTS_LEARN_RATE,
            "songConversion": {
                "vocalSeparatorInstalled": demucs_available(),
                "separatorModel": SONG_SEPARATOR_MODEL,
                "separatorDevice": SONG_SEPARATOR_DEVICE,
                "indexRate": SONG_RVC_INDEX_RATE,
                "rmsMixRate": SONG_RVC_RMS_MIX_RATE,
                "protect": SONG_RVC_PROTECT,
            },
        },
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
        mode, selection, epochs = normalize_training_options(
            payload.get("trainingMode", "fresh"),
            payload.get("modelSelection", "best"),
            payload.get("epochs", RVC_EPOCHS),
        )
        dataset_version_id = str(payload.get("datasetVersionId") or "")[:120] or None
        learning_session_id = str(payload.get("learningSessionId") or "")[:120] or None
        model_label = str(payload.get("modelLabel") or display_name).strip()[:80]
        if not model_label or any(ord(character) < 32 for character in model_label):
            raise ValueError("modelLabel contains unsupported characters")
        for value, label in ((dataset_version_id, "datasetVersionId"), (learning_session_id, "learningSessionId")):
            if value is not None and not re.fullmatch(r"[A-Za-z0-9_-]+", value):
                raise ValueError(f"{label} contains unsupported characters")
        return await asyncio.to_thread(
            pipeline.queue_training,
            speaker_id,
            display_name,
            False,
            mode,
            selection,
            epochs,
            dataset_version_id,
            learning_session_id,
            model_label,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/v1/train/stop")
async def stop_training(request: Request) -> dict[str, Any]:
    require_auth(request)
    payload = await request.json()
    speaker_id = safe_speaker_id(payload.get("speakerId"))
    try:
        return await asyncio.to_thread(pipeline.request_stop_after_epoch, speaker_id)
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


@app.post("/v1/models/select")
async def select_model(request: Request) -> dict[str, Any]:
    require_auth(request)
    payload = await request.json()
    speaker_id = safe_speaker_id(payload.get("speakerId"))
    selection = str(payload.get("modelSelection") or "").strip().lower()
    version_id = str(payload.get("modelVersionId") or "").strip() or None
    try:
        return await asyncio.to_thread(pipeline.select_active_model, speaker_id, selection, version_id)
    except (ValueError, FileNotFoundError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except GpuBusyError as error:
        raise HTTPException(status_code=503, detail=str(error), headers={"Retry-After": "2"}) from error


@app.post("/v1/exports/preview")
async def export_preview(request: Request) -> dict[str, Any]:
    require_auth(request)
    payload = await request.json()
    speaker_id = safe_speaker_id(payload.get("speakerId"))
    try:
        return await asyncio.to_thread(pipeline.preview_export, speaker_id, payload)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/v1/exports")
async def export_training_bundle(request: Request) -> FileResponse:
    require_auth(request)
    payload = await request.json()
    speaker_id = safe_speaker_id(payload.get("speakerId"))
    try:
        archive_path, result = await asyncio.to_thread(pipeline.create_export, speaker_id, payload)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return FileResponse(
        archive_path,
        media_type="application/zip",
        filename=result["filename"],
        headers={
            "X-Digital-Me-Kept-Clips": str(result["keptClips"]),
            "X-Digital-Me-Excluded-Clips": str(result["excludedClips"]),
            "X-Digital-Me-Sha256": str(result["sha256"]),
        },
        background=BackgroundTask(archive_path.unlink, missing_ok=True),
    )


@app.delete("/v1/speakers/{speaker_id}")
async def delete_speaker(speaker_id: str, request: Request) -> dict[str, Any]:
    require_auth(request)
    speaker_id = safe_speaker_id(speaker_id)
    try:
        deleted = await asyncio.to_thread(pipeline.delete_speaker, speaker_id)
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"deleted": deleted}


@app.post("/v1/convert")
async def convert_uploaded_audio(request: Request) -> Response:
    """Convert speech/vocals, or isolate a mixed song before RVC and safe remixing."""
    require_auth(request)
    speaker_id = pipeline.resolve_speaker(str(request.query_params.get("speakerId") or "default"))
    model_selection = str(request.query_params.get("modelSelection") or "").strip().lower()
    if model_selection and model_selection not in ("best", "latest"):
        raise HTTPException(status_code=400, detail="modelSelection must be best or latest")
    model_version_id = str(request.query_params.get("modelVersionId") or "").strip() or None
    if model_version_id and not MODEL_VERSION_RE.fullmatch(model_version_id):
        raise HTTPException(status_code=400, detail="modelVersionId is invalid")
    mode = str(request.query_params.get("mode") or "speech").strip().lower()
    if mode not in ("speech", "vocal", "song"):
        raise HTTPException(status_code=400, detail="mode must be speech, vocal, or song")
    singing_profile = str(request.query_params.get("singingProfile") or "configured").strip().lower()
    if singing_profile not in SINGING_INFERENCE_PROFILES:
        raise HTTPException(status_code=400, detail="singingProfile must be configured, identity, balanced, or expressive")
    try:
        vocal_boost_db = float(str(request.query_params.get("vocalBoostDb") or SONG_VOCAL_BOOST_DB))
    except ValueError as error:
        raise HTTPException(status_code=400, detail="vocalBoostDb must be a number from -6 to 12") from error
    if not math.isfinite(vocal_boost_db) or not -6.0 <= vocal_boost_db <= 12.0:
        raise HTTPException(status_code=400, detail="vocalBoostDb must be a number from -6 to 12")
    try:
        f0_shift = int(str(request.query_params.get("f0Shift") or "0"))
    except ValueError as error:
        raise HTTPException(status_code=400, detail="f0Shift must be a whole number from -12 to 12") from error
    if not -12 <= f0_shift <= 12:
        raise HTTPException(status_code=400, detail="f0Shift must be a whole number from -12 to 12")
    try:
        declared = int(request.headers.get("content-length", "0") or 0)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="invalid Content-Length") from error
    if declared > MAX_CONVERSION_BYTES:
        raise HTTPException(status_code=413, detail="audio exceeds the conversion upload limit")
    suffix = conversion_audio_suffix(request)
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="audio body is empty")
    if len(body) > MAX_CONVERSION_BYTES:
        raise HTTPException(status_code=413, detail="audio exceeds the conversion upload limit")
    if pipeline.training_job_id is not None:
        raise HTTPException(
            status_code=503,
            detail="GPU is currently training; try voice conversion again later",
            headers={"Retry-After": "30"},
        )

    started_at = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="digital-me-convert-") as temporary:
        temporary_path = Path(temporary)
        source = temporary_path / f"source{suffix}"
        converted_raw = temporary_path / "converted-raw.wav"
        converted = temporary_path / "converted.wav"
        source.write_bytes(body)
        processing_pipeline = "speech-rvc"
        separator_metrics: dict[str, Any] = {}
        mastering_metrics: dict[str, float] = {}
        try:
            duration = await asyncio.to_thread(probe_conversion_audio, source)
            rvc_input = temporary_path / "rvc-input.wav"
            original_vocal = source
            accompaniment: Path | None = None
            if mode == "song":
                vocals, accompaniment, separator_metrics = await asyncio.to_thread(
                    separate_vocals,
                    source,
                    temporary_path / "stems",
                    preferred_device=SONG_SEPARATOR_DEVICE,
                    model=SONG_SEPARATOR_MODEL,
                )
                original_vocal = vocals
                processing_pipeline = "demucs-vocal-rvc-remix"
            elif mode == "vocal":
                processing_pipeline = "isolated-vocal-rvc"
            await asyncio.to_thread(prepare_vocal_for_rvc, original_vocal, rvc_input)
            if duration > 45:
                chunks = await asyncio.to_thread(
                    split_audio_for_rvc,
                    rvc_input,
                    temporary_path / "rvc-chunks",
                )
                converted_chunks = [temporary_path / "rvc-output" / f"chunk-{index:04d}.wav" for index in range(len(chunks))]
                (temporary_path / "rvc-output").mkdir(parents=True, exist_ok=True)
                await asyncio.to_thread(
                    pipeline.convert_many,
                    speaker_id,
                    [Path(chunk["path"]) for chunk in chunks],
                    converted_chunks,
                    f0_shift,
                    model_selection or None,
                    mode,
                    singing_profile,
                    model_version_id,
                )
                chunk_metrics = await asyncio.to_thread(
                    merge_converted_chunks,
                    chunks,
                    converted_chunks,
                    converted_raw,
                    duration_seconds=duration,
                )
                processing_pipeline += f"-chunked-{chunk_metrics['chunks']}x"
            else:
                await asyncio.to_thread(
                    pipeline.convert,
                    speaker_id,
                    rvc_input,
                    converted_raw,
                    f0_shift,
                    model_selection or None,
                    mode,
                    singing_profile,
                    model_version_id,
                )
            if accompaniment is not None:
                mastering_metrics = await asyncio.to_thread(
                    remix_song,
                    accompaniment,
                    original_vocal,
                    converted_raw,
                    converted,
                    duration_seconds=duration,
                    vocal_boost_db=vocal_boost_db,
                )
            else:
                mastering_metrics = await asyncio.to_thread(
                    finalize_isolated_vocal,
                    original_vocal,
                    converted_raw,
                    converted,
                    duration_seconds=duration,
                )
        except GpuBusyError as error:
            raise HTTPException(status_code=503, detail=str(error), headers={"Retry-After": "2"}) from error
        except FileNotFoundError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except (RuntimeError, subprocess.SubprocessError) as error:
            raise HTTPException(status_code=500, detail=str(error)) from error
        if not converted.is_file() or converted.stat().st_size < 44:
            raise HTTPException(status_code=500, detail="RVC did not produce a valid output file")
        current = pipeline._current_metadata(speaker_id) or {}
        active_selection = model_selection or str(current.get("activeModelSelection") or "best")
        active_version = model_version_id or str(current.get("jobId") or "")
        elapsed_ms = round((time.perf_counter() - started_at) * 1000)
        return Response(
            content=converted.read_bytes(),
            media_type="audio/wav",
            headers={
                "X-Voice-Speaker-Id": speaker_id,
                "X-Voice-Model-Selection": active_selection,
                "X-Voice-Model-Version": active_version,
                "X-Voice-Conversion-Mode": mode,
                "X-Voice-Source-Duration": f"{duration:.3f}",
                "X-Voice-F0-Shift": str(f0_shift),
                "X-Voice-Processing-Ms": str(elapsed_ms),
                "X-Voice-Processing-Pipeline": processing_pipeline,
                "X-Voice-Separator": str(separator_metrics.get("separator") or "none"),
                "X-Voice-Separator-Device": str(separator_metrics.get("device") or "none"),
                "X-Voice-Vocal-Gain-Db": str(mastering_metrics.get("vocalGainDb", 0)),
                "X-Voice-Vocal-Boost-Db": str(mastering_metrics.get("vocalBoostDb", 0)),
                "X-Voice-Limiter": str(mastering_metrics.get("limiterPeak", 0.94)),
                "X-Voice-Singing-Profile": singing_profile if mode in ("vocal", "song") else "speech",
            },
        )


@app.post("/v1/generate")
async def generate(request: Request) -> Response:
    require_auth(request)
    payload = await request.json()
    text = str(payload.get("text") or "").strip()
    requested_tone = str(payload.get("tone") or "")[:40]
    requested_action = str(payload.get("action") or "")[:40]
    speech_act = str(payload.get("speechAct") or "")[:40]
    emotion = str(payload.get("emotion") or "")[:40]
    context = str(payload.get("context") or "")[-300:]
    variation_seed = str(payload.get("variationSeed") or secrets.token_hex(8))[:120]
    turn_id = str(payload.get("turnId") or f"voice_{secrets.token_hex(12)}")[:120]
    if not TURN_ID_RE.fullmatch(turn_id):
        raise HTTPException(status_code=400, detail="turnId contains unsupported characters")
    ensure_turn_active(turn_id)
    requested_model_selection = str(payload.get("modelSelection") or "").strip().lower()
    if requested_model_selection and requested_model_selection not in ("best", "latest"):
        raise HTTPException(status_code=400, detail="modelSelection must be best or latest")
    requested_model_version = str(payload.get("modelVersionId") or "").strip() or None
    if requested_model_version and not MODEL_VERSION_RE.fullmatch(requested_model_version):
        raise HTTPException(status_code=400, detail="modelVersionId is invalid")

    def bounded_number(name: str, fallback: float, minimum: float, maximum: float) -> float:
        try:
            value = float(payload.get(name, fallback))
        except (TypeError, ValueError):
            value = fallback
        return max(minimum, min(maximum, value))

    intensity = bounded_number("intensity", 0.45, 0.0, 1.0)
    pace = bounded_number("pace", 1.0, 0.85, 1.15)
    energy = bounded_number("energy", 0.5, 0.0, 1.0)
    variation = bounded_number("variation", 0.4, 0.0, 1.0)
    if not text or len(text) > 600:
        raise HTTPException(status_code=400, detail="text must contain 1-600 characters")
    speaker_id = pipeline.resolve_speaker(str(payload.get("speakerId") or "default"))
    current = pipeline._current_metadata(speaker_id) or {}
    model_selection = requested_model_selection or str(current.get("activeModelSelection") or "best")
    if pipeline.training_job_id is not None:
        raise HTTPException(status_code=503, detail="GPU is currently training; try cloned speech again later", headers={"Retry-After": "30"})

    with tempfile.TemporaryDirectory(prefix="digital-me-infer-") as temporary:
        temporary_path = Path(temporary)
        jaitts_source = temporary_path / "source_jaitts.wav"
        edge_source = temporary_path / "source_edge.mp3"
        converted = temporary_path / "converted.wav"
        learned_delivery = pipeline.learned_voice_delivery(speaker_id)
        base_rate_value = int(re.search(r"[-+]?\d+", EDGE_TTS_RATE).group(0)) if re.search(r"[-+]?\d+", EDGE_TTS_RATE) else -2
        learned_rate = max(-18, min(12, base_rate_value + int(learned_delivery["rateDeltaPercent"])))
        prosody = plan_edge_prosody(
            text,
            requested_tone=requested_tone,
            requested_action=requested_action,
            speech_act=speech_act,
            emotion=emotion,
            context=context,
            intensity=intensity,
            pace=pace,
            energy=energy,
            variation=variation,
            variation_seed=variation_seed,
            base_rate=f"{learned_rate:+d}%",
            base_pitch=EDGE_TTS_PITCH,
            base_volume=EDGE_TTS_VOLUME,
        )
        source = jaitts_source
        source_engine = "jaitts"
        source_headers: dict[str, str] = {}
        applied_f0_shift = 0
        source_error: Exception | None = None
        if should_use_jaitts(prosody.text):
            try:
                source_headers = await asyncio.to_thread(
                    request_jaitts_source,
                    {
                        "speakerId": speaker_id,
                        "text": prosody.text,
                        "style": prosody.style,
                        "speechAct": prosody.speech_act,
                        "emotion": emotion,
                        "pace": pace,
                        "energy": energy,
                        "variationSeed": prosody.variation_seed,
                        "turnId": turn_id,
                        "preset": JAITTS_PRESET,
                    },
                    jaitts_source,
                )
            except Exception as error:
                ensure_turn_active(turn_id)
                source_error = error
        else:
            source_error = RuntimeError("short reactions use the stable Edge source")
        if source_error is not None:
            ensure_turn_active(turn_id)
            source = edge_source
            source_engine = "edge-short" if not should_use_jaitts(prosody.text) else "edge"
            applied_f0_shift = int(learned_delivery["f0ShiftSemitones"])
            if source_engine == "edge":
                print(
                    f"[voice-service] JaiTTS source unavailable for {speaker_id}; using Edge fallback: {source_error}",
                    flush=True,
                )
            import edge_tts

            await edge_tts.Communicate(
                prosody.text,
                EDGE_TTS_VOICE,
                rate=prosody.rate,
                pitch=prosody.pitch,
                volume=prosody.volume,
            ).save(str(source))
        ensure_turn_active(turn_id)
        try:
            await asyncio.to_thread(
                pipeline.convert,
                speaker_id,
                source,
                converted,
                applied_f0_shift,
                model_selection,
                "speech",
                "configured",
                requested_model_version,
            )
        except GpuBusyError as error:
            raise HTTPException(status_code=503, detail=str(error), headers={"Retry-After": "30"}) from error
        except FileNotFoundError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        ensure_turn_active(turn_id)
        polish_metrics = await asyncio.to_thread(polish_generated_wav, converted)
        # Tail shaping must run after pause compression. Otherwise trimming can
        # move the corrected final particle and undo the intended contour.
        question_tail_lift = configured_question_tail_lift()
        if question_tail_lift > 0:
            question_tail_metrics = await asyncio.to_thread(
                shape_rising_question_tail,
                converted,
                prosody.text if prosody.style == "question" else "",
                lift_semitones=question_tail_lift,
            )
        else:
            question_tail_metrics = {"changed": 0, "tailLiftSemitones": 0.0}
        ensure_turn_active(turn_id)
        content = converted.read_bytes()
        cancelled_turns.forget(turn_id)
        return Response(
            content=content,
            media_type="audio/wav",
            headers={
                "X-Voice-Speaker-Id": speaker_id,
                "X-Voice-Model-Selection": model_selection,
                "X-Voice-Source-Engine": source_engine,
                "X-Voice-Reference-Id": safe_response_header(source_headers.get("x-jaitts-reference-id", "")),
                "X-Voice-Reference-Style": safe_response_header(source_headers.get("x-jaitts-reference-style", "")),
                "X-Voice-Source-Seed": safe_response_header(source_headers.get("x-jaitts-seed", "")),
                "X-Voice-Prosody": prosody.style,
                "X-Voice-Speech-Act": prosody.speech_act,
                "X-Voice-Variation-Seed": safe_response_header(prosody.variation_seed),
                "X-Voice-Source-Rate": safe_response_header(source_headers.get("x-jaitts-speed", prosody.rate)),
                "X-Voice-Source-Pitch": "reference" if source_engine == "jaitts" else prosody.pitch,
                "X-Voice-Model-Version": requested_model_version or str(current.get("jobId") or ""),
                "X-Voice-Source-Volume": prosody.volume,
                "X-Voice-Learned-Samples": str(learned_delivery["sampleCount"]),
                "X-Voice-Learned-Rate": f"{learned_rate:+d}%",
                "X-Voice-Learned-F0-Shift": str(applied_f0_shift),
                "X-Voice-Compressed-Pauses": str(polish_metrics.get("compressedPauses", 0)),
                "X-Voice-Tail-Padding-Ms": str(polish_metrics.get("trailingMs", 0)),
                "X-Voice-Question-Tail-Lift": str(question_tail_metrics.get("tailLiftSemitones", 0)),
                "X-Voice-Turn-Id": turn_id,
            },
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.environ.get("VOICE_SERVICE_HOST", "127.0.0.1"),
        port=int(os.environ.get("VOICE_SERVICE_PORT", os.environ.get("COLAB_VOICE_PORT", "8766"))),
        workers=1,
    )
