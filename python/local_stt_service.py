#!/usr/bin/env python3
"""Local Thai-English Qwen3-ASR HTTP service for Discord PCM utterances."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import threading
from typing import Any
from urllib.request import urlopen

import numpy as np
import torch
from qwen_asr import Qwen3ASRModel

from stt_quality import analyze_audio_quality, hallucination_reason


HOST = os.environ.get("STT_HOST", "127.0.0.1")
PORT = int(os.environ.get("STT_PORT", "8765"))
MODEL_ID = os.environ.get("STT_MODEL", "Qwen/Qwen3-ASR-0.6B")
FALLBACK_MODEL_ID = os.environ.get("STT_FALLBACK_MODEL", "Qwen/Qwen3-ASR-0.6B")
LARGE_MODEL_MIN_FREE_GB = float(os.environ.get("STT_LARGE_MODEL_MIN_FREE_GB", "5.25"))
VOICE_HEALTH_URL = os.environ.get("VOICE_HEALTH_URL", "http://127.0.0.1:8766/health")
ASR_CONTEXT = os.environ.get(
    "STT_CONTEXT",
    "",
)
ALLOWED_LANGUAGES = {
    item.strip().casefold()
    for item in os.environ.get("STT_ALLOWED_LANGUAGES", "Thai,English").split(",")
    if item.strip()
}
FALLBACK_LANGUAGE = os.environ.get("STT_FALLBACK_LANGUAGE", "Thai").strip() or "Thai"
MAX_AUDIO_BYTES = int(os.environ.get("STT_MAX_AUDIO_BYTES", str(64 * 1024 * 1024)))
MIN_RMS_DBFS = float(os.environ.get("STT_MIN_RMS_DBFS", "-52"))
RETRY_BLANK_WITH_FALLBACK = os.environ.get("STT_RETRY_BLANK_WITH_FALLBACK", "true").casefold() != "false"


def json_bytes(value: dict[str, Any]) -> bytes:
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def rvc_training_active() -> bool:
    try:
        with urlopen(VOICE_HEALTH_URL, timeout=1.5) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return payload.get("training") is True
    except Exception:
        return False


class Transcriber:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.cuda_available = torch.cuda.is_available()
        device_map = "cuda:0" if self.cuda_available else "cpu"
        dtype = torch.bfloat16 if self.cuda_available else torch.float32
        selected_model = MODEL_ID
        if self.cuda_available and "1.7B" in selected_model:
            free_bytes, _ = torch.cuda.mem_get_info()
            free_gb = free_bytes / (1024 ** 3)
            training_active = rvc_training_active()
            if training_active or free_gb < LARGE_MODEL_MIN_FREE_GB:
                reason = "RVC training is active" if training_active else f"only {free_gb:.2f} GiB VRAM is free"
                print(
                    f"[LocalSTT] {reason}; using {FALLBACK_MODEL_ID} to protect GPU stability.",
                    flush=True,
                )
                selected_model = FALLBACK_MODEL_ID
        print(f"[LocalSTT] Loading {selected_model} on {device_map}...", flush=True)
        try:
            self.model = Qwen3ASRModel.from_pretrained(
                selected_model,
                dtype=dtype,
                device_map=device_map,
                max_inference_batch_size=1,
                max_new_tokens=256,
            )
        except torch.OutOfMemoryError:
            if selected_model == FALLBACK_MODEL_ID:
                raise
            print(f"[LocalSTT] {selected_model} did not fit; falling back to {FALLBACK_MODEL_ID}.", flush=True)
            torch.cuda.empty_cache()
            selected_model = FALLBACK_MODEL_ID
            self.model = Qwen3ASRModel.from_pretrained(
                selected_model,
                dtype=dtype,
                device_map=device_map,
                max_inference_batch_size=1,
                max_new_tokens=256,
            )
        self.model_id = selected_model
        # Trigger CUDA kernels before health becomes available so the first Discord
        # utterance does not pay the one-time model warm-up cost.
        print("[LocalSTT] Warming up CUDA inference...", flush=True)
        with torch.inference_mode():
            self.model.transcribe(
                audio=(np.zeros(16_000, dtype=np.float32), 16_000),
                context=ASR_CONTEXT or None,
                language=None,
            )
        print(f"[LocalSTT] {self.model_id} is ready.", flush=True)

    @staticmethod
    def prepare_audio(body: bytes) -> np.ndarray:
        stereo = np.frombuffer(body, dtype="<i2").reshape(-1, 2)
        mono = stereo.astype(np.float32).mean(axis=1) / 32768.0
        if mono.size == 0:
            return mono
        # Remove a small microphone DC bias, but preserve the original loudness.
        # Peak-normalizing short Discord clips changed Thai consonants enough to
        # make the same model less accurate in replay tests.
        mono -= float(np.mean(mono))
        return np.clip(mono, -1.0, 1.0)

    def transcribe_pcm(self, body: bytes) -> dict[str, Any]:
        if len(body) < 48_000 * 2 * 2 // 4:
            return {"text": "", "language": None, "confidence": None, "model": self.model_id}
        if len(body) % 4 != 0:
            body = body[: len(body) - (len(body) % 4)]
        mono = self.prepare_audio(body)
        diagnostics = analyze_audio_quality(mono, 48_000, MIN_RMS_DBFS)
        duration_seconds = float(diagnostics["durationSeconds"])
        rms_dbfs = float(diagnostics["rmsDbfs"])
        if diagnostics["classification"] != "speech":
            return {
                "text": "", "language": None, "confidence": None,
                "model": self.model_id,
                "classification": diagnostics["classification"],
                "rejectionReason": diagnostics["reason"],
                "displayText": "[เสียงรบกวน]" if diagnostics["classification"] == "noise" else "",
                "diagnostics": diagnostics,
            }

        fallback_applied = False
        blank_retry_applied = False
        try:
            with self.lock, torch.inference_mode():
                results = self.model.transcribe(
                    audio=(mono, 48_000), context=ASR_CONTEXT or None, language=None
                )
                if results:
                    detected = str(getattr(results[0], "language", "")).casefold()
                    if detected and detected not in ALLOWED_LANGUAGES:
                        print(
                            f"[LocalSTT] Detected unsupported language {detected!r}; retrying as {FALLBACK_LANGUAGE}.",
                            flush=True,
                        )
                        retry = self.model.transcribe(
                            audio=(mono, 48_000),
                            context=ASR_CONTEXT or None,
                            language=FALLBACK_LANGUAGE,
                        )
                        if retry:
                            results = retry
                            fallback_applied = True
                auto_text = str(getattr(results[0], "text", "")).strip() if results else ""
                if not auto_text and RETRY_BLANK_WITH_FALLBACK and duration_seconds >= 0.4:
                    print(
                        f"[LocalSTT] Auto language returned blank for {duration_seconds:.2f}s at "
                        f"{rms_dbfs:.1f} dBFS; retrying as {FALLBACK_LANGUAGE}.",
                        flush=True,
                    )
                    retry = self.model.transcribe(
                        audio=(mono, 48_000),
                        context=ASR_CONTEXT or None,
                        language=FALLBACK_LANGUAGE,
                    )
                    if retry:
                        results = retry
                        fallback_applied = True
                        blank_retry_applied = True
        finally:
            if self.cuda_available:
                torch.cuda.empty_cache()
        if not results:
            return {
                "text": "", "language": None, "confidence": None,
                "model": self.model_id, "diagnostics": diagnostics,
            }
        result = results[0]
        raw_text = str(getattr(result, "text", "")).strip()
        rejection_reason = hallucination_reason(raw_text, ASR_CONTEXT, duration_seconds)
        if rejection_reason:
            print(
                f"[LocalSTT] Rejected likely hallucination ({rejection_reason}): {raw_text!r}",
                flush=True,
            )
            return {
                "text": "",
                "rawText": raw_text,
                "language": getattr(result, "language", None),
                "confidence": None,
                "model": self.model_id,
                "classification": "noise",
                "rejectionReason": rejection_reason,
                "displayText": "[เสียงรบกวน]",
                "languageFallbackApplied": fallback_applied,
                "blankRetryApplied": blank_retry_applied,
                "diagnostics": diagnostics,
            }
        return {
            "text": raw_text,
            "language": getattr(result, "language", None),
            # This is signal quality, not a calibrated word probability.  It is
            # still more useful downstream than the old hard-coded zero.
            "confidence": max(0.55, min(0.9, float(diagnostics["speechConfidence"]))),
            "model": self.model_id,
            "classification": "speech",
            "verified": True,
            "verificationMethod": "local_vad_and_hallucination_guard",
            "languageFallbackApplied": fallback_applied,
            "blankRetryApplied": blank_retry_applied,
            "diagnostics": diagnostics,
        }


TRANSCRIBER = Transcriber()


class Handler(BaseHTTPRequestHandler):
    server_version = "DigitalMeLocalSTT/1.0"

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self.send_error(404)
            return
        self.send_json(200, {
            "status": "ok",
            "model": TRANSCRIBER.model_id,
            "cudaAvailable": TRANSCRIBER.cuda_available,
            "languages": ["th", "en"],
            "fallbackLanguage": FALLBACK_LANGUAGE,
        })

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/transcribe":
            self.send_error(404)
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "Invalid Content-Length."})
            return
        if content_length <= 0 or content_length > MAX_AUDIO_BYTES:
            self.send_json(413, {"error": "Audio body is empty or too large."})
            return
        body = self.rfile.read(content_length)
        try:
            self.send_json(200, TRANSCRIBER.transcribe_pcm(body))
        except Exception as error:  # keep the service alive after a bad utterance
            print(f"[LocalSTT] Transcription failed: {error}", flush=True)
            self.send_json(500, {"error": str(error)})

    def log_message(self, format_string: str, *args: object) -> None:
        print(f"[LocalSTT] {self.address_string()} {format_string % args}", flush=True)

    def send_json(self, status: int, value: dict[str, Any]) -> None:
        payload = json_bytes(value)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[LocalSTT] Listening at http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
