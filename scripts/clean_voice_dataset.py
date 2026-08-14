"""Audit and non-destructively clean an RVC speaker dataset.

The audit creates a hash-locked manifest. Applying that manifest first copies
the complete active dataset to a versioned backup, verifies every copy, then
moves rejected WAVs and their checksum sidecars into a quarantine directory.
Nothing is permanently deleted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import time
from typing import Any

import librosa
import numpy as np
import soundfile as sf
import torch
from transformers import AutoFeatureExtractor, WavLMForXVector


SAMPLE_RATE = 16_000


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_mono(path: Path) -> tuple[np.ndarray, int]:
    audio, sample_rate = sf.read(path, always_2d=True, dtype="float32")
    mono = audio.mean(axis=1)
    if sample_rate != SAMPLE_RATE:
        mono = librosa.resample(mono, orig_sr=sample_rate, target_sr=SAMPLE_RATE)
        sample_rate = SAMPLE_RATE
    return np.asarray(mono, dtype=np.float32), sample_rate


def audio_metrics(audio: np.ndarray, sample_rate: int) -> dict[str, float]:
    if audio.size == 0:
        raise ValueError("audio is empty")
    duration = audio.size / sample_rate
    rms = float(np.sqrt(np.mean(np.square(audio, dtype=np.float64)) + 1e-12))
    intervals = librosa.effects.split(audio, top_db=35, frame_length=1024, hop_length=256)
    speech_samples = int(sum(max(0, int(end) - int(start)) for start, end in intervals))
    speech_seconds = min(duration, speech_samples / sample_rate)
    return {
        "durationSeconds": round(duration, 4),
        "speechSeconds": round(speech_seconds, 4),
        "speechRatio": round(speech_seconds / duration if duration else 0.0, 5),
        "rmsDbfs": round(20 * math.log10(max(rms, 1e-12)), 3),
        "peak": round(float(np.max(np.abs(audio))), 6),
        "clippedPercent": round(float(np.mean(np.abs(audio) >= 0.999)) * 100, 5),
        "nearSilentPercent": round(float(np.mean(np.abs(audio) < 0.002)) * 100, 3),
    }


def embed(
    audio: np.ndarray,
    extractor: AutoFeatureExtractor,
    model: WavLMForXVector,
    device: torch.device,
) -> torch.Tensor:
    maximum = SAMPLE_RATE * 12
    if audio.size > maximum:
        offset = (audio.size - maximum) // 2
        audio = audio[offset : offset + maximum]
    values = extractor(audio, sampling_rate=SAMPLE_RATE, return_tensors="pt", padding=True)
    values = {name: tensor.to(device) for name, tensor in values.items()}
    with torch.inference_mode():
        vector = model(**values).embeddings[0]
    return torch.nn.functional.normalize(vector.float().cpu(), dim=0)


def robust_centroid(vectors: list[torch.Tensor]) -> torch.Tensor:
    if len(vectors) < 3:
        raise RuntimeError("Need at least three usable clips to build a speaker centroid")
    stack = torch.stack(vectors)
    selected = torch.arange(stack.shape[0])
    for _ in range(3):
        centroid = torch.nn.functional.normalize(stack[selected].mean(dim=0), dim=0)
        scores = torch.mv(stack, centroid)
        cutoff = torch.quantile(scores, 0.25)
        selected = torch.nonzero(scores >= cutoff, as_tuple=False).flatten()
        if selected.numel() < 3:
            selected = torch.argsort(scores, descending=True)[: max(3, stack.shape[0] // 2)]
    return torch.nn.functional.normalize(stack[selected].mean(dim=0), dim=0)


def rejection_reasons(
    metrics: dict[str, float],
    similarity: float | None,
    *,
    min_duration: float,
    min_speech: float,
    min_rms_dbfs: float,
    max_clipped_percent: float,
    min_similarity: float,
) -> list[str]:
    reasons: list[str] = []
    if metrics["durationSeconds"] < min_duration:
        reasons.append("too_short")
    if metrics["speechSeconds"] < min_speech:
        reasons.append("too_little_audible_speech")
    if metrics["rmsDbfs"] < min_rms_dbfs:
        reasons.append("too_quiet")
    if metrics["clippedPercent"] > max_clipped_percent:
        reasons.append("clipped")
    if similarity is None or similarity < min_similarity:
        reasons.append("speaker_identity_outlier")
    return reasons


def audit(args: argparse.Namespace) -> int:
    samples_dir = args.speaker_dir.resolve() / "samples"
    paths = sorted(samples_dir.glob("*.wav"))
    if not paths:
        raise RuntimeError(f"No WAV files found in {samples_dir}")

    device = torch.device(args.device if args.device == "cpu" or torch.cuda.is_available() else "cpu")
    extractor = AutoFeatureExtractor.from_pretrained(args.model)
    model = WavLMForXVector.from_pretrained(args.model).to(device).eval()

    rows: list[dict[str, Any]] = []
    embedding_rows: list[int] = []
    vectors: list[torch.Tensor] = []
    audio_cache: dict[int, np.ndarray] = {}
    for index, path in enumerate(paths):
        row: dict[str, Any] = {"filename": path.name, "sha256": sha256(path)}
        try:
            audio, sample_rate = load_mono(path)
            row["audio"] = audio_metrics(audio, sample_rate)
            if row["audio"]["durationSeconds"] >= 0.8 and row["audio"]["rmsDbfs"] >= -48:
                audio_cache[index] = audio
                embedding_rows.append(index)
        except Exception as error:
            row["error"] = str(error)[:300]
        rows.append(row)

    for index in embedding_rows:
        vectors.append(embed(audio_cache.pop(index), extractor, model, device))
    centroid = robust_centroid(vectors)
    similarities = [float(torch.dot(vector, centroid)) for vector in vectors]
    similarity_by_row = dict(zip(embedding_rows, similarities))

    kept_count = 0
    kept_duration = 0.0
    kept_speech = 0.0
    rejected_count = 0
    rejected_duration = 0.0
    reason_counts: dict[str, int] = {}
    for index, row in enumerate(rows):
        metrics = row.get("audio")
        similarity = similarity_by_row.get(index)
        row["speakerSimilarity"] = round(similarity, 5) if similarity is not None else None
        if metrics is None:
            reasons = ["invalid_audio"]
        else:
            reasons = rejection_reasons(
                metrics,
                similarity,
                min_duration=args.min_duration,
                min_speech=args.min_speech,
                min_rms_dbfs=args.min_rms_dbfs,
                max_clipped_percent=args.max_clipped_percent,
                min_similarity=args.min_similarity,
            )
        row["decision"] = "reject" if reasons else "keep"
        row["reasons"] = reasons
        for reason in reasons:
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
        duration = float(metrics.get("durationSeconds", 0)) if metrics else 0.0
        speech = float(metrics.get("speechSeconds", 0)) if metrics else 0.0
        if reasons:
            rejected_count += 1
            rejected_duration += duration
        else:
            kept_count += 1
            kept_duration += duration
            kept_speech += speech

    run_id = f"cleaning_{int(time.time())}"
    manifest = {
        "version": 1,
        "runId": run_id,
        "createdAt": int(time.time() * 1000),
        "speakerDir": str(args.speaker_dir.resolve()),
        "samplesDir": str(samples_dir),
        "embeddingModel": args.model,
        "device": str(device),
        "thresholds": {
            "minDurationSeconds": args.min_duration,
            "minSpeechSeconds": args.min_speech,
            "minRmsDbfs": args.min_rms_dbfs,
            "maxClippedPercent": args.max_clipped_percent,
            "minSpeakerSimilarity": args.min_similarity,
        },
        "summary": {
            "originalCount": len(rows),
            "originalDurationSeconds": round(kept_duration + rejected_duration, 3),
            "keptCount": kept_count,
            "keptDurationSeconds": round(kept_duration, 3),
            "estimatedKeptSpeechSeconds": round(kept_speech, 3),
            "rejectedCount": rejected_count,
            "rejectedDurationSeconds": round(rejected_duration, 3),
            "reasonCounts": reason_counts,
        },
        "samples": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"manifest": str(args.output.resolve()), **manifest["summary"]}, ensure_ascii=False, indent=2))
    return 0


def apply_manifest(args: argparse.Namespace) -> int:
    manifest_path = args.apply_manifest.resolve(strict=True)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    speaker_dir = Path(manifest["speakerDir"]).resolve(strict=True)
    samples_dir = (speaker_dir / "samples").resolve(strict=True)
    if samples_dir.parent != speaker_dir:
        raise RuntimeError("Unsafe samples path in manifest")
    rows = manifest.get("samples")
    if not isinstance(rows, list) or not rows:
        raise RuntimeError("Manifest contains no samples")

    expected_names = {str(row["filename"]) for row in rows}
    active_names = {path.name for path in samples_dir.glob("*.wav")}
    if active_names != expected_names:
        raise RuntimeError("Active dataset changed after the audit; create a fresh manifest")
    for row in rows:
        path = samples_dir / row["filename"]
        if sha256(path) != row["sha256"]:
            raise RuntimeError(f"Hash changed after audit: {path.name}")

    run_id = str(manifest["runId"])
    backup_dir = speaker_dir / "dataset_backups" / run_id
    quarantine_dir = speaker_dir / "quarantine" / run_id
    if backup_dir.exists() or quarantine_dir.exists():
        raise RuntimeError(f"Cleaning run {run_id} was already applied")
    backup_samples = backup_dir / "samples"
    backup_samples.mkdir(parents=True)
    quarantine_dir.mkdir(parents=True)

    # Complete backup first. Training models/current.json live outside samples and remain untouched.
    for row in rows:
        source = samples_dir / row["filename"]
        shutil.copy2(source, backup_samples / source.name)
        sidecar = source.with_suffix(".sha256")
        if sidecar.is_file():
            shutil.copy2(sidecar, backup_samples / sidecar.name)
    shutil.copy2(manifest_path, backup_dir / "cleaning_manifest.json")
    for row in rows:
        copied = backup_samples / row["filename"]
        if sha256(copied) != row["sha256"]:
            raise RuntimeError(f"Backup verification failed: {copied.name}")

    moved = 0
    for row in rows:
        if row.get("decision") != "reject":
            continue
        source = samples_dir / row["filename"]
        os.replace(source, quarantine_dir / source.name)
        sidecar = source.with_suffix(".sha256")
        if sidecar.is_file():
            os.replace(sidecar, quarantine_dir / sidecar.name)
        moved += 1
    shutil.copy2(manifest_path, quarantine_dir / "cleaning_manifest.json")

    remaining = list(samples_dir.glob("*.wav"))
    result = {
        "runId": run_id,
        "backupDir": str(backup_dir),
        "quarantineDir": str(quarantine_dir),
        "rejectedMoved": moved,
        "remainingCount": len(remaining),
        "restorable": True,
    }
    (backup_dir / "applied_result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--speaker-dir", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--model", default="microsoft/wavlm-base-plus-sv")
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--min-duration", type=float, default=1.2)
    parser.add_argument("--min-speech", type=float, default=0.8)
    parser.add_argument("--min-rms-dbfs", type=float, default=-38.0)
    parser.add_argument("--max-clipped-percent", type=float, default=0.1)
    parser.add_argument("--min-similarity", type=float, default=0.75)
    parser.add_argument("--apply-manifest", type=Path)
    args = parser.parse_args()
    if args.apply_manifest:
        return apply_manifest(args)
    if not args.speaker_dir or not args.output:
        parser.error("audit mode requires --speaker-dir and --output")
    return audit(args)


if __name__ == "__main__":
    raise SystemExit(main())
