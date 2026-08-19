#!/usr/bin/env python3
"""Benchmark the authenticated persistent JaiTTS service on this machine.

Start the service with JAITTS_ALLOW_BENCHMARK_CONTROLS=true before running.
The script stores every WAV so latency numbers can be paired with listening,
instead of claiming that the fastest diffusion setting is also the best voice.
"""

from __future__ import annotations

import argparse
from array import array
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import wave
from io import BytesIO


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def load_dotenv_value(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if value:
        return value
    dotenv = PROJECT_ROOT / ".env"
    if not dotenv.is_file():
        return ""
    for raw_line in dotenv.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, raw_value = line.split("=", 1)
        if key.strip() == name:
            return raw_value.strip().strip('"').strip("'")
    return ""


def choose_speaker(explicit: str) -> str:
    if explicit:
        return explicit
    root = PROJECT_ROOT / "data" / "local_voice" / "speakers"
    candidates = sorted(
        path.name for path in root.glob("*")
        if path.name.isdigit() and (path / "tts_references.json").is_file()
    )
    if not candidates:
        raise RuntimeError("No speaker with tts_references.json was found; pass --speaker-id.")
    return candidates[0]


def request_json(url: str, token: str, path: str, method: str = "GET") -> dict[str, Any]:
    request = Request(
        f"{url}{path}",
        data=b"" if method == "POST" else None,
        method=method,
        headers={"Authorization": f"Bearer {token}"},
    )
    with urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def wav_metrics(data: bytes) -> dict[str, Any]:
    with wave.open(BytesIO(data), "rb") as reader:
        channels = reader.getnchannels()
        sample_width = reader.getsampwidth()
        sample_rate = reader.getframerate()
        frames = reader.getnframes()
        pcm = reader.readframes(frames)
    if sample_width != 2:
        raise RuntimeError(f"Expected PCM16 WAV, received sample width {sample_width}.")
    samples = array("h")
    samples.frombytes(pcm)
    if sys.byteorder != "little":
        samples.byteswap()
    peak = max((abs(value) for value in samples), default=0) / 32768.0
    rms = math.sqrt(sum(value * value for value in samples) / max(1, len(samples))) / 32768.0
    return {
        "durationSeconds": round(frames / max(1, sample_rate), 4),
        "sampleRate": sample_rate,
        "channels": channels,
        "peak": round(peak, 5),
        "rms": round(rms, 5),
        "clippedSampleRatio": round(sum(abs(value) >= 32760 for value in samples) / max(1, len(samples)), 7),
    }


def synthesize(
    base_url: str,
    token: str,
    speaker_id: str,
    text: str,
    label: str,
    output_dir: Path,
    steps: int,
    cfg_strength: float,
) -> dict[str, Any]:
    safe_label = re.sub(r"[^A-Za-z0-9_-]", "_", label)
    turn_id = f"benchmark_{safe_label}_{int(time.time() * 1000)}"
    payload = json.dumps({
        "speakerId": speaker_id,
        "text": text,
        "style": "casual",
        "variationSeed": "fixed:42",
        "turnId": turn_id,
        "nfeSteps": steps,
        "cfgStrength": cfg_strength,
    }, ensure_ascii=False).encode("utf-8")
    request = Request(
        f"{base_url}/v1/generate",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    started = time.perf_counter()
    try:
        with urlopen(request, timeout=180) as response:
            audio = response.read()
            headers = {key.lower(): value for key, value in response.headers.items()}
    except HTTPError as error:
        detail = error.read(1024).decode("utf-8", errors="replace")
        raise RuntimeError(f"JaiTTS returned HTTP {error.code}: {detail}") from error
    except (URLError, TimeoutError, OSError) as error:
        raise RuntimeError(f"JaiTTS request failed: {error}") from error
    wall_seconds = time.perf_counter() - started
    returned_steps = int(headers.get("x-jaitts-steps", "0"))
    returned_cfg = float(headers.get("x-jaitts-cfg-strength", "0"))
    if returned_steps != steps or abs(returned_cfg - cfg_strength) > 0.001:
        raise RuntimeError(
            "The service ignored benchmark controls. Restart with "
            "JAITTS_ALLOW_BENCHMARK_CONTROLS=true."
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{label}_nfe{steps}_cfg{cfg_strength:g}.wav"
    output_path.write_bytes(audio)
    metrics = wav_metrics(audio)
    metrics.update({
        "label": label,
        "steps": returned_steps,
        "cfgStrength": returned_cfg,
        "wallSeconds": round(wall_seconds, 4),
        "generationSeconds": round(float(headers.get("x-jaitts-generation-ms", "0")) / 1000, 4),
        "rtf": round(float(headers.get("x-jaitts-rtf", "0")), 4),
        "peakVramMb": round(float(headers.get("x-jaitts-peak-vram-mb", "0")), 1),
        "referenceId": headers.get("x-jaitts-reference-id", ""),
        "sha256": hashlib.sha256(audio).hexdigest(),
        "audioFile": str(output_path.relative_to(PROJECT_ROOT)).replace("\\", "/"),
    })
    return metrics


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8768")
    parser.add_argument("--speaker-id", default="")
    parser.add_argument("--text", default="วันนี้เล่นเกมกันไหม เดี๋ยวกูเข้าไปด้วย")
    parser.add_argument("--output-dir", default="benchmarks/jaitts_audio")
    args = parser.parse_args()

    token = load_dotenv_value("JAITTS_API_TOKEN") or load_dotenv_value("VOICE_API_TOKEN")
    token_file = PROJECT_ROOT / ".runtime" / "voice_api_token"
    if not token and token_file.is_file():
        token = token_file.read_text(encoding="utf-8").strip()
    if len(token) < 24:
        raise RuntimeError("JAITTS_API_TOKEN or VOICE_API_TOKEN is missing.")
    speaker_id = choose_speaker(args.speaker_id)
    base_url = args.base_url.rstrip("/")
    output_dir = (PROJECT_ROOT / args.output_dir).resolve()
    health = request_json(base_url, token, "/health")
    if not health.get("modelReady"):
        raise RuntimeError("JaiTTS is not ready yet.")

    cases = [(f"nfe_{steps}", steps, 2.0) for steps in (8, 12, 16, 24, 32)]
    cases.extend((f"cfg_{cfg:g}", 16, cfg) for cfg in (1.5, 2.0, 2.5, 3.0))
    results: list[dict[str, Any]] = []
    for index, (label, steps, cfg_strength) in enumerate(cases, start=1):
        print(f"[{index}/{len(cases)}] {label}: NFE={steps}, CFG={cfg_strength}", flush=True)
        result = synthesize(base_url, token, speaker_id, args.text, label, output_dir, steps, cfg_strength)
        results.append(result)
        print(
            f"  wall={result['wallSeconds']}s audio={result['durationSeconds']}s "
            f"RTF={result['rtf']} peakVRAM={result['peakVramMb']}MB",
            flush=True,
        )

    valid = [item for item in results if item["durationSeconds"] >= 0.4 and item["clippedSampleRatio"] < 0.001]
    fastest = min(valid, key=lambda item: item["wallSeconds"]) if valid else None
    report = {
        "schemaVersion": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "service": {
            "baseUrl": base_url,
            "model": health.get("model"),
            "torchVersion": health.get("torchVersion"),
            "cudaVersion": health.get("cudaVersion"),
            "cudaDevice": health.get("cudaDevice"),
            "precision": health.get("precision"),
        },
        "speakerId": speaker_id,
        "text": args.text,
        "fixedSeed": 42,
        "results": results,
        "latencyCandidate": {
            "steps": fastest["steps"],
            "cfgStrength": fastest["cfgStrength"],
            "audioFile": fastest["audioFile"],
        } if fastest else None,
        "decisionNote": (
            "Latency candidate only. Listen to all saved WAVs and compare speaker similarity before changing the default preset."
        ),
        "finalMetrics": request_json(base_url, token, "/metrics"),
    }
    report_path = PROJECT_ROOT / "benchmarks" / "jaitts_nfe_results.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
