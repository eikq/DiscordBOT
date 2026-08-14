#!/usr/bin/env python3
"""Compare timing, pitch, and loudness delivery against one reference WAV."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import librosa
import numpy as np


def _round(value: float | None, digits: int = 3) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(float(value), digits)


def _interpolate_contour(values: np.ndarray, count: int = 160) -> np.ndarray | None:
    finite = np.isfinite(values)
    if int(finite.sum()) < 4:
        return None
    positions = np.linspace(0.0, 1.0, len(values))
    filled = np.interp(positions, positions[finite], values[finite])
    return np.interp(np.linspace(0.0, 1.0, count), positions, filled)


def analyze(path: Path) -> tuple[dict[str, Any], np.ndarray | None]:
    audio, sample_rate = librosa.load(path, sr=24_000, mono=True)
    if audio.size == 0:
        raise ValueError(f"Audio file is empty: {path}")

    frame_length = 2048
    hop_length = 240
    duration = librosa.get_duration(y=audio, sr=sample_rate)
    rms = librosa.feature.rms(
        y=audio,
        frame_length=frame_length,
        hop_length=hop_length,
    )[0]
    rms_db = librosa.amplitude_to_db(np.maximum(rms, 1e-7), ref=1.0)
    peak_db = float(np.max(rms_db))
    speech_mask = rms_db >= max(-48.0, peak_db - 34.0)

    f0, voiced_flag, _voiced_probability = librosa.pyin(
        audio,
        fmin=65.0,
        fmax=350.0,
        sr=sample_rate,
        frame_length=frame_length,
        hop_length=hop_length,
    )
    frame_count = min(len(f0), len(speech_mask))
    f0 = f0[:frame_count]
    voiced = voiced_flag[:frame_count] & speech_mask[:frame_count] & np.isfinite(f0)
    voiced_f0 = f0[voiced]
    semitone_contour = np.full(frame_count, np.nan, dtype=np.float64)
    if voiced_f0.size:
        semitone_contour[voiced] = 12.0 * np.log2(f0[voiced])

    active_db = rms_db[speech_mask]
    intervals = librosa.effects.split(audio, top_db=34, frame_length=frame_length, hop_length=hop_length)
    pauses_ms: list[float] = []
    for current, following in zip(intervals, intervals[1:]):
        gap_ms = (following[0] - current[1]) / sample_rate * 1000.0
        if gap_ms >= 120.0:
            pauses_ms.append(gap_ms)

    pitch_span = None
    pitch_std = None
    pitch_median = None
    pitch_p10 = None
    pitch_p90 = None
    tail_pitch_delta = None
    pitch_step_median = None
    pitch_step_p95 = None
    if voiced_f0.size:
        pitch_p10, pitch_median, pitch_p90 = np.percentile(voiced_f0, [10, 50, 90])
        pitch_span = 12.0 * math.log2(pitch_p90 / pitch_p10) if pitch_p10 > 0 else None
        pitch_std = float(np.std(12.0 * np.log2(voiced_f0 / pitch_median)))
        voiced_indices = np.flatnonzero(voiced)
        tail_values = f0[voiced & (np.arange(frame_count) >= int(frame_count * 0.75))]
        if tail_values.size >= 3 and pitch_median > 0:
            tail_pitch_delta = 12.0 * math.log2(float(np.median(tail_values)) / pitch_median)
        consecutive = np.diff(voiced_indices) == 1
        if np.any(consecutive):
            voiced_semitones = 12.0 * np.log2(voiced_f0)
            steps = np.abs(np.diff(voiced_semitones)[consecutive])
            if steps.size:
                pitch_step_median = float(np.median(steps))
                pitch_step_p95 = float(np.percentile(steps, 95))

    result = {
        "path": str(path.resolve()),
        "durationSeconds": _round(duration),
        "speechRatio": _round(float(np.mean(speech_mask))),
        "voicedRatio": _round(float(np.mean(voiced))) if frame_count else 0.0,
        "pitchMedianHz": _round(pitch_median, 2),
        "pitchP10Hz": _round(pitch_p10, 2),
        "pitchP90Hz": _round(pitch_p90, 2),
        "pitchSpanSemitones": _round(pitch_span),
        "pitchVariationStdSemitones": _round(pitch_std),
        "tailPitchDeltaSemitones": _round(tail_pitch_delta),
        "pitchStepMedianSemitones": _round(pitch_step_median),
        "pitchStepP95Semitones": _round(pitch_step_p95),
        "loudnessMedianDbfs": _round(float(np.median(active_db)) if active_db.size else None),
        "loudnessRangeDb": _round(
            float(np.percentile(active_db, 90) - np.percentile(active_db, 10))
            if active_db.size
            else None
        ),
        "pauseCount": len(pauses_ms),
        "averagePauseMs": _round(float(np.mean(pauses_ms)) if pauses_ms else 0.0, 1),
        "longestPauseMs": _round(max(pauses_ms, default=0.0), 1),
    }
    return result, _interpolate_contour(semitone_contour)


def compare(reference: dict[str, Any], candidate: dict[str, Any], ref_contour: np.ndarray | None,
            candidate_contour: np.ndarray | None) -> dict[str, Any]:
    reference_pitch = reference.get("pitchMedianHz")
    candidate_pitch = candidate.get("pitchMedianHz")
    pitch_delta = None
    if reference_pitch and candidate_pitch:
        pitch_delta = 12.0 * math.log2(candidate_pitch / reference_pitch)

    contour_correlation = None
    if ref_contour is not None and candidate_contour is not None:
        ref_shape = ref_contour - np.mean(ref_contour)
        candidate_shape = candidate_contour - np.mean(candidate_contour)
        if np.std(ref_shape) > 1e-6 and np.std(candidate_shape) > 1e-6:
            contour_correlation = float(np.corrcoef(ref_shape, candidate_shape)[0, 1])

    return {
        "candidate": candidate["path"],
        "durationRatio": _round(candidate["durationSeconds"] / reference["durationSeconds"]),
        "durationDifferenceSeconds": _round(candidate["durationSeconds"] - reference["durationSeconds"]),
        "medianPitchDeltaSemitones": _round(pitch_delta),
        "pitchSpanDifferenceSemitones": _round(
            candidate["pitchSpanSemitones"] - reference["pitchSpanSemitones"]
            if candidate.get("pitchSpanSemitones") is not None
            and reference.get("pitchSpanSemitones") is not None
            else None
        ),
        "tailPitchDeltaDifferenceSemitones": _round(
            candidate["tailPitchDeltaSemitones"] - reference["tailPitchDeltaSemitones"]
            if candidate.get("tailPitchDeltaSemitones") is not None
            and reference.get("tailPitchDeltaSemitones") is not None
            else None
        ),
        "pitchStepP95DifferenceSemitones": _round(
            candidate["pitchStepP95Semitones"] - reference["pitchStepP95Semitones"]
            if candidate.get("pitchStepP95Semitones") is not None
            and reference.get("pitchStepP95Semitones") is not None
            else None
        ),
        "loudnessRangeDifferenceDb": _round(
            candidate["loudnessRangeDb"] - reference["loudnessRangeDb"]
            if candidate.get("loudnessRangeDb") is not None
            and reference.get("loudnessRangeDb") is not None
            else None
        ),
        "pauseCountDifference": candidate["pauseCount"] - reference["pauseCount"],
        "normalizedPitchContourCorrelation": _round(contour_correlation),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidates", nargs="+", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    reference, reference_contour = analyze(args.reference)
    candidates: list[dict[str, Any]] = []
    comparisons: list[dict[str, Any]] = []
    for candidate_path in args.candidates:
        candidate, candidate_contour = analyze(candidate_path)
        candidates.append(candidate)
        comparisons.append(compare(reference, candidate, reference_contour, candidate_contour))

    report = {
        "reference": reference,
        "candidates": candidates,
        "comparisons": comparisons,
    }
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
