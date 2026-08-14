"""Robust delivery-profile estimation from captured Discord utterance metadata."""

from __future__ import annotations

import json
from pathlib import Path
from statistics import median
from typing import Any


NEUTRAL_STYLES = {"casual", "soft", "question", "annoyed"}


def estimate_delivery_profile(metadata_root: Path) -> dict[str, Any] | None:
    """Return neutral baseline pitch/rate while rejecting octave and transcript outliers."""
    if not metadata_root.is_dir():
        return None

    pitch_values: list[float] = []
    rate_values: list[float] = []
    clean_seconds = 0.0
    accepted_count = 0
    for metadata_path in metadata_root.glob("*.json"):
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
            analysis = payload.get("analysis", {})
            quality = analysis.get("quality", {})
            audio = analysis.get("audio", {})
            prosody = analysis.get("prosody", {})
            duration = float(audio.get("durationSeconds", payload.get("durationSeconds", 0)) or 0)
            score = float(quality.get("score", 0) or 0)
            style = str(prosody.get("style", "unknown") or "unknown").lower()
            if not quality.get("acceptedForVoiceTraining") or not 1.2 <= duration <= 12 or score < 0.7:
                continue

            # The lightweight real-time autocorrelation occasionally reports a
            # doubled octave for this male speaker. A neutral baseline excludes
            # those high outliers and expressive/excited delivery.
            pitch = float(prosody.get("pitchMedianHz") or 0)
            rate_value = prosody.get("speakingRateWordsPerSecond")
            rate = float(rate_value) if rate_value is not None else 0.0
            if style not in NEUTRAL_STYLES:
                continue
            accepted_count += 1
            clean_seconds += duration
            if 75 <= pitch <= 180:
                pitch_values.append(pitch)
            if 1.5 <= rate <= 8:
                rate_values.append(rate)
        except (OSError, TypeError, ValueError, json.JSONDecodeError):
            continue

    if len(pitch_values) < 5 and len(rate_values) < 5:
        return None
    return {
        "sampleCount": accepted_count,
        "cleanSeconds": round(clean_seconds, 3),
        "targetPitchHz": round(median(pitch_values), 2) if len(pitch_values) >= 5 else None,
        "targetRateWordsPerSecond": round(median(rate_values), 3) if len(rate_values) >= 5 else None,
        "pitchSampleCount": len(pitch_values),
        "rateSampleCount": len(rate_values),
    }
