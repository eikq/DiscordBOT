"""Isolate a person recorded over a known reference track.

This is deliberately different from ordinary vocal separation.  When the exact
song/reference is available, time-aligning and cancelling that reference removes
the original singer as well as the instruments while retaining the extra voice
present only in the recording.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Iterable

import librosa
import numpy as np
from scipy.signal import butter, sosfiltfilt
import soundfile as sf


def load_mono(path: Path, sample_rate: int) -> np.ndarray:
    audio, _ = librosa.load(path, sr=sample_rate, mono=True)
    return np.asarray(audio, dtype=np.float32)


def dbfs(audio: np.ndarray) -> float:
    rms = float(np.sqrt(np.mean(np.square(audio, dtype=np.float64))))
    return 20.0 * math.log10(max(rms, 1e-12))


def parse_alignment(value: str, sample_rate: int) -> list[tuple[int, int]]:
    """Parse SOURCE_SECONDS:DELAY_SECONDS sections.

    The first section normally starts at source second zero.  A later section
    represents a clock discontinuity/drop in the recording rather than a gradual
    time stretch.
    """
    sections: list[tuple[int, int]] = []
    for item in value.split(","):
        source_seconds, delay_seconds = item.strip().split(":", maxsplit=1)
        sections.append(
            (round(float(source_seconds) * sample_rate), round(float(delay_seconds) * sample_rate))
        )
    sections.sort(key=lambda item: item[0])
    if not sections or sections[0][0] != 0:
        raise ValueError("alignment must begin with source second 0")
    return sections


def align_reference(
    reference: np.ndarray,
    output_samples: int,
    sections: list[tuple[int, int]],
) -> np.ndarray:
    """Map reference samples onto the recording timeline without smearing jumps."""
    aligned = np.zeros(output_samples, dtype=np.float32)
    source_boundaries = [source for source, _ in sections]
    source_boundaries.append(len(reference))

    for index, (source_start, delay) in enumerate(sections):
        source_end = min(source_boundaries[index + 1], len(reference))
        if source_end <= source_start:
            continue
        record_start = source_start + delay
        record_end = source_end + delay

        clipped_record_start = max(0, record_start)
        clipped_record_end = min(output_samples, record_end)
        if clipped_record_end <= clipped_record_start:
            continue
        clipped_source_start = source_start + (clipped_record_start - record_start)
        clipped_source_end = clipped_source_start + (clipped_record_end - clipped_record_start)
        aligned[clipped_record_start:clipped_record_end] = reference[
            clipped_source_start:clipped_source_end
        ]
    return aligned


def estimate_gain_curve(
    recording: np.ndarray,
    aligned_reference: np.ndarray,
    sample_rate: int,
    *,
    correlation_floor: float,
) -> tuple[np.ndarray, list[dict[str, float]]]:
    """Estimate slow playback gain only from reference-dominated one-second windows."""
    window = sample_rate
    anchors: list[tuple[float, float, float]] = []
    all_candidates: list[tuple[float, float, float]] = []
    for start in range(0, min(len(recording), len(aligned_reference)) - window + 1, window):
        reference = aligned_reference[start : start + window].astype(np.float64)
        captured = recording[start : start + window].astype(np.float64)
        reference_energy = float(np.dot(reference, reference))
        if reference_energy <= window * 1e-8:
            continue
        correlation = float(np.corrcoef(captured, reference)[0, 1])
        gain = float(np.dot(captured, reference) / reference_energy)
        if not np.isfinite(correlation) or not np.isfinite(gain) or gain <= 0:
            continue
        candidate = ((start + window / 2) / sample_rate, correlation, gain)
        all_candidates.append(candidate)
        if correlation >= correlation_floor:
            anchors.append(candidate)

    if len(anchors) < 3:
        # A loud target can lower correlation substantially.  Fall back to the
        # cleanest available windows, but never fit the gain independently on
        # every window because that would also cancel the target singer.
        anchors = sorted(all_candidates, key=lambda item: item[1], reverse=True)[:12]
        anchors.sort(key=lambda item: item[0])
    if not anchors:
        raise RuntimeError("No reference-dominated windows were found")

    raw_gains = np.asarray([item[2] for item in anchors], dtype=np.float64)
    median = float(np.median(raw_gains))
    mad = float(np.median(np.abs(raw_gains - median)))
    radius = max(4.0 * mad, median * 0.08, 1e-4)
    anchors = [item for item in anchors if abs(item[2] - median) <= radius]

    anchor_samples = np.asarray([item[0] * sample_rate for item in anchors], dtype=np.float64)
    anchor_gains = np.asarray([item[2] for item in anchors], dtype=np.float64)
    timeline = np.arange(len(recording), dtype=np.float64)
    gain_curve = np.interp(timeline, anchor_samples, anchor_gains).astype(np.float32)
    report = [
        {"second": round(second, 3), "correlation": round(correlation, 6), "gain": round(gain, 7)}
        for second, correlation, gain in anchors
    ]
    return gain_curve, report


def filter_voice_band(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    high = min(16_000.0, sample_rate * 0.45)
    sos = butter(4, [55.0, high], btype="bandpass", fs=sample_rate, output="sos")
    return np.asarray(sosfiltfilt(sos, audio), dtype=np.float32)


def write_listening_copy(path: Path, audio: np.ndarray, sample_rate: int) -> dict[str, float]:
    filtered = filter_voice_band(audio, sample_rate)
    before = dbfs(filtered)
    desired_gain_db = min(18.0, max(-6.0, -20.0 - before))
    normalized = filtered * (10.0 ** (desired_gain_db / 20.0))
    peak = float(np.max(np.abs(normalized))) if len(normalized) else 0.0
    limiter_gain = min(1.0, 0.891 / max(peak, 1e-9))
    normalized *= limiter_gain
    sf.write(path, normalized, sample_rate, subtype="PCM_24")
    return {
        "rawDbfs": round(before, 3),
        "normalizationDb": round(desired_gain_db, 3),
        "limiterDb": round(20.0 * math.log10(max(limiter_gain, 1e-12)), 3),
        "outputDbfs": round(dbfs(normalized), 3),
        "peakDbfs": round(20.0 * math.log10(max(float(np.max(np.abs(normalized))), 1e-12)), 3),
    }


def isolate(
    recording_path: Path,
    reference_path: Path,
    output_root: Path,
    *,
    sample_rate: int,
    alignment: str,
    correlation_floor: float,
    additional_pairs: Iterable[tuple[str, Path, Path]],
) -> dict[str, object]:
    output_root.mkdir(parents=True, exist_ok=True)
    sections = parse_alignment(alignment, sample_rate)
    recording = load_mono(recording_path, sample_rate)
    reference = load_mono(reference_path, sample_rate)
    aligned = align_reference(reference, len(recording), sections)
    gain, anchors = estimate_gain_curve(
        recording,
        aligned,
        sample_rate,
        correlation_floor=correlation_floor,
    )
    residual = recording - aligned * gain

    aligned_path = output_root / "aligned_reference.wav"
    raw_path = output_root / "gam_reference_cancelled_raw.wav"
    listening_path = output_root / "gam_reference_cancelled_listen.wav"
    sf.write(aligned_path, aligned, sample_rate, subtype="PCM_24")
    sf.write(raw_path, residual, sample_rate, subtype="FLOAT")
    outputs: dict[str, object] = {
        "fullMix": {
            "raw": str(raw_path.resolve()),
            "listen": str(listening_path.resolve()),
            **write_listening_copy(listening_path, residual, sample_rate),
        }
    }

    for label, captured_path, reference_stem_path in additional_pairs:
        captured = load_mono(captured_path, sample_rate)
        reference_stem = load_mono(reference_stem_path, sample_rate)
        target_samples = min(len(captured), len(recording))
        captured = captured[:target_samples]
        aligned_stem = align_reference(reference_stem, target_samples, sections)
        stem_gain, stem_anchors = estimate_gain_curve(
            captured,
            aligned_stem,
            sample_rate,
            correlation_floor=max(0.90, correlation_floor - 0.04),
        )
        stem_residual = captured - aligned_stem * stem_gain
        stem_raw = output_root / f"gam_{label}_cancelled_raw.wav"
        stem_listen = output_root / f"gam_{label}_cancelled_listen.wav"
        sf.write(stem_raw, stem_residual, sample_rate, subtype="FLOAT")
        outputs[label] = {
            "raw": str(stem_raw.resolve()),
            "listen": str(stem_listen.resolve()),
            "gainAnchors": stem_anchors,
            **write_listening_copy(stem_listen, stem_residual, sample_rate),
        }

    report: dict[str, object] = {
        "recording": str(recording_path.resolve()),
        "reference": str(reference_path.resolve()),
        "sampleRate": sample_rate,
        "durationSeconds": round(len(recording) / sample_rate, 3),
        "alignment": [
            {
                "sourceSecond": round(source / sample_rate, 6),
                "delaySeconds": round(delay / sample_rate, 9),
                "delaySamples": delay,
            }
            for source, delay in sections
        ],
        "gainAnchors": anchors,
        "outputs": outputs,
        "warning": "Listen for any remaining original singer or overlapping voices before adding clips to training.",
    }
    (output_root / "isolation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recording", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--sample-rate", type=int, default=44_100)
    parser.add_argument(
        "--alignment",
        required=True,
        help="Comma-separated SOURCE_SECONDS:DELAY_SECONDS sections",
    )
    parser.add_argument("--correlation-floor", type=float, default=0.94)
    parser.add_argument("--captured-vocals", type=Path)
    parser.add_argument("--reference-vocals", type=Path)
    args = parser.parse_args()

    extra: list[tuple[str, Path, Path]] = []
    if bool(args.captured_vocals) != bool(args.reference_vocals):
        parser.error("--captured-vocals and --reference-vocals must be provided together")
    if args.captured_vocals and args.reference_vocals:
        extra.append(("vocal_stem", args.captured_vocals, args.reference_vocals))

    report = isolate(
        args.recording,
        args.reference,
        args.output,
        sample_rate=args.sample_rate,
        alignment=args.alignment,
        correlation_floor=args.correlation_floor,
        additional_pairs=extra,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
