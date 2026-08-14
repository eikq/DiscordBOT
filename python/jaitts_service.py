#!/usr/bin/env python3
"""Persistent local JaiTTS source-voice service for expressive Thai RVC input."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import hashlib
import hmac
from io import BytesIO
import json
import os
from pathlib import Path
import re
import secrets
import sys
import threading
import time
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response


PROJECT_ROOT = Path(__file__).resolve().parent.parent
THONBURIAN_ROOT = Path(os.environ.get(
    "THONBURIAN_TTS_ROOT",
    str(PROJECT_ROOT / ".runtime" / "thonburian-tts"),
)).resolve()
if str(THONBURIAN_ROOT) not in sys.path:
    sys.path.insert(0, str(THONBURIAN_ROOT))

from flowtts.inference import AudioConfig, FlowTTSPipeline, ModelConfig, remove_silence_edges  # noqa: E402
from huggingface_hub import hf_hub_download  # noqa: E402
from pydub import AudioSegment  # noqa: E402
import soundfile as sf  # noqa: E402
import torch  # noqa: E402

from jaitts_delivery import (  # noqa: E402
    CancellationRegistry,
    calibrated_speed,
    choose_reference,
    seed_from_variation,
    synthesis_settings,
)


SPEAKER_RE = re.compile(r"^\d{5,30}$")
API_TOKEN = os.environ.get("JAITTS_API_TOKEN", os.environ.get("VOICE_API_TOKEN", "")).strip()
MODEL_ID = os.environ.get("JAITTS_MODEL_ID", "JTS-AI/JaiTTS-F5TTS").strip()
DEFAULT_STEPS = int(os.environ.get("JAITTS_STEPS", "32"))
DEFAULT_CFG_STRENGTH = float(os.environ.get("JAITTS_CFG_STRENGTH", "2.5"))
DEFAULT_SPEED = float(os.environ.get("JAITTS_SPEED", "0.75"))
DEFAULT_PRESET = os.environ.get("JAITTS_PRESET", "default").strip().lower()
ALLOW_BENCHMARK_CONTROLS = os.environ.get("JAITTS_ALLOW_BENCHMARK_CONTROLS", "false").strip().lower() in {
    "1", "true", "yes", "on",
}
REFERENCE_ROOT = Path(os.environ.get(
    "JAITTS_REFERENCE_ROOT",
    str(PROJECT_ROOT / "data" / "local_voice" / "speakers"),
)).resolve()
TEMP_ROOT = Path(os.environ.get(
    "JAITTS_TEMP_ROOT",
    str(PROJECT_ROOT / ".runtime" / "jaitts-temp"),
)).resolve()

if len(API_TOKEN) < 24:
    raise RuntimeError("JAITTS_API_TOKEN or VOICE_API_TOKEN must contain at least 24 characters.")
if not 8 <= DEFAULT_STEPS <= 64:
    raise RuntimeError("JAITTS_STEPS must be between 8 and 64.")
if not 1.0 <= DEFAULT_CFG_STRENGTH <= 4.0:
    raise RuntimeError("JAITTS_CFG_STRENGTH must be between 1.0 and 4.0.")
if not 0.5 <= DEFAULT_SPEED <= 1.5:
    raise RuntimeError("JAITTS_SPEED must be between 0.5 and 1.5.")


def require_auth(request: Request) -> None:
    header = request.headers.get("authorization", "")
    supplied = header[7:] if header.lower().startswith("bearer ") else ""
    if not hmac.compare_digest(supplied, API_TOKEN):
        raise HTTPException(status_code=401, detail="invalid bearer token")


def safe_speaker_id(value: Any) -> str:
    speaker_id = str(value or "").strip()
    if not SPEAKER_RE.fullmatch(speaker_id):
        raise HTTPException(status_code=400, detail="speakerId must be a Discord numeric user ID")
    return speaker_id


def project_file(value: Any) -> Path:
    relative = str(value or "").strip().replace("\\", "/").lstrip("/")
    candidate = (PROJECT_ROOT / relative).resolve()
    try:
        candidate.relative_to(PROJECT_ROOT)
    except ValueError as error:
        raise ValueError("reference audio must stay inside the project") from error
    if not candidate.is_file():
        raise ValueError(f"reference audio is missing: {relative}")
    return candidate


def resolve_reference(
    speaker_id: str,
    requested_style: str = "",
    target_text: str = "",
    variation_seed: str = "",
) -> dict[str, Any]:
    manifest_path = REFERENCE_ROOT / speaker_id / "tts_references.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"speaker {speaker_id} has no approved JaiTTS reference manifest")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as error:
        raise ValueError(f"invalid reference manifest for speaker {speaker_id}: {error}") from error
    references = manifest.get("references", []) if isinstance(manifest, dict) else []
    usable: list[dict[str, Any]] = []
    for item in references:
        if not isinstance(item, dict) or item.get("enabled", True) is False:
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        try:
            audio_path = project_file(item.get("audioPath"))
        except ValueError:
            continue
        usable.append({
            **item,
            "id": str(item.get("id") or audio_path.stem)[:120],
            "style": str(item.get("style") or "casual").strip().lower(),
            "text": text,
            "audioPath": audio_path,
        })
    if not usable:
        raise ValueError(f"speaker {speaker_id} has no usable approved JaiTTS references")
    try:
        return choose_reference(usable, requested_style, target_text, variation_seed)
    except ValueError as error:
        raise ValueError(f"speaker {speaker_id} has no usable approved JaiTTS references") from error


class SynthesisCancelled(RuntimeError):
    pass


cancelled_turns = CancellationRegistry()


class JaiTtsEngine:
    def __init__(self) -> None:
        self.pipeline: FlowTTSPipeline | None = None
        self.lock = threading.Lock()
        self.loaded_at: float | None = None
        self.load_seconds: float | None = None
        self.active_turn_id: str | None = None
        self.request_count = 0
        self.success_count = 0
        self.cancelled_count = 0
        self.failure_count = 0
        self.total_generation_seconds = 0.0
        self.last_generation_seconds: float | None = None
        self.last_audio_seconds: float | None = None
        self.last_rtf: float | None = None
        self.last_peak_vram_mb: float | None = None
        self.last_preset: str | None = None
        self.last_steps: int | None = None
        self.last_cfg_strength: float | None = None
        self._prepared_references: dict[str, Path] = {}

    def load(self) -> None:
        if self.pipeline is not None:
            return
        started = time.perf_counter()
        if not torch.cuda.is_available():
            raise RuntimeError("JaiTTS requires CUDA for real-time local use")
        checkpoint = hf_hub_download(repo_id=MODEL_ID, filename="model.pt")
        vocab = hf_hub_download(repo_id=MODEL_ID, filename="vocab.txt")
        model_config = ModelConfig(
            language="th",
            model_type="F5",
            checkpoint=checkpoint,
            vocab_file=vocab,
            ode_method="euler",
            use_ema=True,
            vocoder="vocos",
            device="cuda",
            seed=-1,
        )
        audio_config = AudioConfig(
            silence_threshold=-45,
            max_audio_length=20_000,
            cfg_strength=DEFAULT_CFG_STRENGTH,
            nfe_step=DEFAULT_STEPS,
            target_rms=0.1,
            cross_fade_duration=0.15,
            speed=DEFAULT_SPEED,
            min_silence_len=500,
            keep_silence=200,
            seek_step=10,
        )
        TEMP_ROOT.mkdir(parents=True, exist_ok=True)
        self.pipeline = FlowTTSPipeline(
            model_config=model_config,
            audio_config=audio_config,
            temp_dir=str(TEMP_ROOT),
        )
        self.loaded_at = time.time()
        self.load_seconds = time.perf_counter() - started

    def _prepared_reference(self, reference: dict[str, Any]) -> Path:
        """Cache the expensive first reference cleanup, never the generated reply."""
        source = Path(reference["audioPath"])
        stat = source.stat()
        cache_key = hashlib.sha256(
            f"{source.resolve()}|{stat.st_size}|{stat.st_mtime_ns}".encode("utf-8")
        ).hexdigest()[:24]
        cached = self._prepared_references.get(cache_key)
        if cached and cached.is_file():
            return cached
        assert self.pipeline is not None
        prepared_root = TEMP_ROOT / "prepared-references"
        prepared_root.mkdir(parents=True, exist_ok=True)
        destination = prepared_root / f"{cache_key}.wav"
        if not destination.is_file():
            audio = AudioSegment.from_file(source)
            cleaned = self.pipeline._process_audio_silence(audio)
            cleaned = remove_silence_edges(cleaned) + AudioSegment.silent(
                duration=self.pipeline.audio_config.silence_padding
            )
            temporary = destination.with_suffix(".tmp.wav")
            cleaned.export(temporary, format="wav")
            os.replace(temporary, destination)
        self._prepared_references[cache_key] = destination
        return destination

    def generate(
        self,
        reference: dict[str, Any],
        text: str,
        speed: float,
        seed: int,
        turn_id: str,
        preset: str,
        steps: int,
        cfg_strength: float,
    ) -> tuple[bytes, int, float, float, float]:
        with self.lock:
            self.load()
            assert self.pipeline is not None
            self.request_count += 1
            self.active_turn_id = turn_id
            self.last_preset = preset
            self.last_steps = steps
            self.last_cfg_strength = cfg_strength
            if cancelled_turns.is_cancelled(turn_id):
                self.cancelled_count += 1
                self.active_turn_id = None
                raise SynthesisCancelled(f"turn {turn_id} was cancelled before synthesis")
            started = time.perf_counter()
            try:
                torch.cuda.reset_peak_memory_stats()
                prepared_reference = self._prepared_reference(reference)
                samples, sample_rate, _ = self.pipeline.model.infer(
                    ref_file=str(prepared_reference),
                    ref_text=reference["text"],
                    gen_text=text,
                    target_rms=self.pipeline.audio_config.target_rms,
                    cross_fade_duration=self.pipeline.audio_config.cross_fade_duration,
                    nfe_step=steps,
                    cfg_strength=cfg_strength,
                    sway_sampling_coef=0.0,
                    speed=speed,
                    fix_duration=None,
                    file_wave=None,
                    seed=seed,
                )
                generation_seconds = time.perf_counter() - started
                audio_seconds = len(samples) / int(sample_rate)
                rtf = generation_seconds / max(0.001, audio_seconds)
                peak_vram_mb = torch.cuda.max_memory_allocated() / (1024 * 1024)
                if cancelled_turns.is_cancelled(turn_id):
                    self.cancelled_count += 1
                    raise SynthesisCancelled(f"turn {turn_id} was cancelled during synthesis")
                output = BytesIO()
                sf.write(output, samples, sample_rate, format="WAV", subtype="PCM_16")
                self.success_count += 1
                self.total_generation_seconds += generation_seconds
                self.last_generation_seconds = generation_seconds
                self.last_audio_seconds = audio_seconds
                self.last_rtf = rtf
                self.last_peak_vram_mb = peak_vram_mb
                return output.getvalue(), int(sample_rate), generation_seconds, audio_seconds, peak_vram_mb
            except SynthesisCancelled:
                raise
            except Exception:
                self.failure_count += 1
                raise
            finally:
                self.active_turn_id = None

    def metrics(self) -> dict[str, Any]:
        cuda = bool(torch.cuda.is_available())
        return {
            "requests": self.request_count,
            "successes": self.success_count,
            "cancelled": self.cancelled_count,
            "failures": self.failure_count,
            "activeTurnId": self.active_turn_id,
            "loadSeconds": round(self.load_seconds, 3) if self.load_seconds is not None else None,
            "uptimeSeconds": round(time.time() - self.loaded_at, 3) if self.loaded_at else None,
            "meanGenerationSeconds": round(self.total_generation_seconds / self.success_count, 3)
            if self.success_count else None,
            "lastGenerationSeconds": round(self.last_generation_seconds, 3)
            if self.last_generation_seconds is not None else None,
            "lastAudioSeconds": round(self.last_audio_seconds, 3) if self.last_audio_seconds is not None else None,
            "lastRtf": round(self.last_rtf, 4) if self.last_rtf is not None else None,
            "lastPeakVramMb": round(self.last_peak_vram_mb, 1) if self.last_peak_vram_mb is not None else None,
            "currentAllocatedVramMb": round(torch.cuda.memory_allocated() / (1024 * 1024), 1) if cuda else None,
            "currentReservedVramMb": round(torch.cuda.memory_reserved() / (1024 * 1024), 1) if cuda else None,
            "preset": self.last_preset,
            "steps": self.last_steps,
            "cfgStrength": self.last_cfg_strength,
        }


engine = JaiTtsEngine()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(engine.load)
    yield


app = FastAPI(title="Digital Me JaiTTS Source Service", version="1.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, Any]:
    cuda_available = bool(torch.cuda.is_available())
    return {
        "status": "ok" if engine.pipeline is not None else "loading",
        "processId": os.getpid(),
        "modelReady": engine.pipeline is not None,
        "model": MODEL_ID,
        "cudaAvailable": cuda_available,
        "cudaDevice": torch.cuda.get_device_name(0) if cuda_available else None,
        "torchVersion": torch.__version__,
        "cudaVersion": torch.version.cuda,
        "precision": "float32 runtime with EMA checkpoint loader",
        "steps": DEFAULT_STEPS,
        "cfgStrength": DEFAULT_CFG_STRENGTH,
        "speed": DEFAULT_SPEED,
        "defaultPreset": DEFAULT_PRESET,
        "metrics": engine.metrics(),
    }


@app.get("/metrics")
async def metrics(request: Request) -> dict[str, Any]:
    require_auth(request)
    return engine.metrics()


@app.post("/v1/cancel/{turn_id}")
async def cancel(turn_id: str, request: Request) -> dict[str, Any]:
    require_auth(request)
    if not cancelled_turns.cancel(turn_id):
        raise HTTPException(status_code=400, detail="invalid turn id")
    return {"cancelled": True, "turnId": turn_id, "granularity": "discard-after-current-gpu-kernel"}


@app.post("/v1/generate")
async def generate(request: Request) -> Response:
    require_auth(request)
    payload = await request.json()
    speaker_id = safe_speaker_id(payload.get("speakerId"))
    text = str(payload.get("text") or "").strip()
    style = str(payload.get("style") or "")[:40]
    variation_seed = str(payload.get("variationSeed") or secrets.token_hex(16))[:120]
    turn_id = str(payload.get("turnId") or f"jaitts_{secrets.token_hex(12)}")[:120]
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", turn_id):
        raise HTTPException(status_code=400, detail="turnId contains unsupported characters")
    synthesis_seed = seed_from_variation(variation_seed, style)
    if not text or len(text) > 600:
        raise HTTPException(status_code=400, detail="text must contain 1-600 characters")
    try:
        pace = float(payload.get("pace", 1.0))
    except (TypeError, ValueError):
        pace = 1.0
    speed = calibrated_speed(DEFAULT_SPEED, style, pace)
    settings = synthesis_settings(
        payload.get("preset", DEFAULT_PRESET),
        DEFAULT_STEPS,
        DEFAULT_CFG_STRENGTH,
        payload.get("nfeSteps"),
        payload.get("cfgStrength"),
        allow_overrides=ALLOW_BENCHMARK_CONTROLS,
    )
    try:
        reference = resolve_reference(speaker_id, style, text, variation_seed)
        audio, sample_rate, generation_seconds, audio_seconds, peak_vram_mb = await asyncio.to_thread(
            engine.generate,
            reference,
            text,
            speed,
            synthesis_seed,
            turn_id,
            str(settings["preset"]),
            int(settings["steps"]),
            float(settings["cfgStrength"]),
        )
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except SynthesisCancelled as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    finally:
        cancelled_turns.forget(turn_id)
    return Response(
        content=audio,
        media_type="audio/wav",
        headers={
            "X-JaiTTS-Reference-Id": str(reference["id"]),
            "X-JaiTTS-Reference-Style": str(reference["style"]),
            "X-JaiTTS-Sample-Rate": str(sample_rate),
            "X-JaiTTS-Preset": str(settings["preset"]),
            "X-JaiTTS-Steps": str(settings["steps"]),
            "X-JaiTTS-CFG-Strength": str(settings["cfgStrength"]),
            "X-JaiTTS-Speed": f"{speed:.3f}",
            "X-JaiTTS-Seed": str(synthesis_seed),
            "X-JaiTTS-Generation-Ms": str(round(generation_seconds * 1000)),
            "X-JaiTTS-Audio-Ms": str(round(audio_seconds * 1000)),
            "X-JaiTTS-RTF": f"{generation_seconds / max(0.001, audio_seconds):.4f}",
            "X-JaiTTS-Peak-VRAM-MB": f"{peak_vram_mb:.1f}",
            "X-JaiTTS-Turn-Id": turn_id,
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.environ.get("JAITTS_HOST", "127.0.0.1"),
        port=int(os.environ.get("JAITTS_PORT", "8768")),
        workers=1,
    )
