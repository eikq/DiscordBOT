"""Signal-quality and hallucination guards for Discord speech recognition.

This module deliberately has no model dependency so it can be unit-tested and
used before expensive ASR inference.  It is not a speaker recognizer; Discord's
per-user SSRC already provides the speaker boundary.
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np


PROMPT_ECHO_TERMS = (
    "move speed",
    "movespeed",
    "movement speed",
    "attack speed",
    "cooldown",
    "damage",
    "item",
    "build",
)


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def analyze_audio_quality(
    mono: np.ndarray,
    sample_rate: int = 48_000,
    minimum_rms_dbfs: float = -52.0,
) -> dict[str, Any]:
    """Classify PCM as speech, noise, or silence using local signal evidence.

    Energy alone is insufficient because keyboard clicks, fans, and Discord VAD
    openings can be loud.  The classifier also measures temporal activity,
    spectral flatness, zero crossings, and short-frame harmonicity.
    """
    audio = np.asarray(mono, dtype=np.float32).reshape(-1)
    duration_seconds = audio.size / max(1, sample_rate)
    if audio.size == 0:
        return {
            "classification": "silence",
            "reason": "empty_audio",
            "durationSeconds": 0.0,
            "rmsDbfs": -120.0,
            "peakDbfs": -120.0,
            "speechRatio": 0.0,
            "voicedRatio": 0.0,
            "speechConfidence": 0.0,
            "energyPresent": False,
        }

    rms = float(np.sqrt(np.mean(np.square(audio, dtype=np.float64)) + 1e-12))
    peak = float(np.max(np.abs(audio)))
    rms_dbfs = float(20 * np.log10(max(rms, 1e-6)))
    peak_dbfs = float(20 * np.log10(max(peak, 1e-6)))

    frame_samples = max(1, round(sample_rate * 0.02))
    frame_levels: list[float] = []
    for start in range(0, audio.size, frame_samples):
        frame = audio[start : start + frame_samples]
        if frame.size < frame_samples // 2:
            continue
        frame_rms = float(np.sqrt(np.mean(np.square(frame, dtype=np.float64)) + 1e-12))
        frame_levels.append(float(20 * np.log10(max(frame_rms, 1e-6))))

    if not frame_levels:
        frame_levels = [rms_dbfs]
    levels = np.asarray(frame_levels, dtype=np.float32)
    noise_floor_dbfs = float(np.percentile(levels, 20))
    high_level_dbfs = float(np.percentile(levels, 85))
    dynamic_range_db = high_level_dbfs - noise_floor_dbfs
    # A dynamic floor adapts to each microphone while the absolute floor stops
    # steady low-level room noise from being treated as speech.
    active_threshold_dbfs = max(-46.0, noise_floor_dbfs + 7.0)
    active_ratio = float(np.mean(levels >= active_threshold_dbfs))

    # Downsample by averaging.  The anti-aliasing need not be studio quality;
    # these samples are only used for voice-activity features, never for ASR.
    factor = max(1, sample_rate // 16_000)
    usable = audio[: audio.size - (audio.size % factor)]
    analysis_audio = usable.reshape(-1, factor).mean(axis=1) if usable.size else audio
    analysis_rate = sample_rate / factor
    activity_frame = max(64, round(analysis_rate * 0.03))
    minimum_lag = max(1, round(analysis_rate / 350))
    maximum_lag = max(minimum_lag + 1, round(analysis_rate / 70))
    flatness_values: list[float] = []
    zcr_values: list[float] = []
    harmonicity_values: list[float] = []
    voiced_frames = 0
    analyzed_frames = 0

    for start in range(0, analysis_audio.size - activity_frame + 1, activity_frame):
        frame = analysis_audio[start : start + activity_frame].astype(np.float64, copy=False)
        frame -= float(np.mean(frame))
        frame_rms = float(np.sqrt(np.mean(frame * frame) + 1e-12))
        frame_dbfs = float(20 * np.log10(max(frame_rms, 1e-6)))
        if frame_dbfs < active_threshold_dbfs:
            continue
        analyzed_frames += 1

        zcr = float(np.mean(np.signbit(frame[1:]) != np.signbit(frame[:-1]))) if frame.size > 1 else 0.0
        spectrum = np.abs(np.fft.rfft(frame * np.hanning(frame.size))) + 1e-9
        flatness = float(np.exp(np.mean(np.log(spectrum))) / np.mean(spectrum))
        correlation = np.correlate(frame, frame, mode="full")[frame.size - 1 :]
        base = float(max(correlation[0], 1e-12))
        lag_end = min(correlation.size, maximum_lag + 1)
        harmonicity = (
            float(np.max(correlation[minimum_lag:lag_end]) / base)
            if lag_end > minimum_lag
            else 0.0
        )
        flatness_values.append(flatness)
        zcr_values.append(zcr)
        harmonicity_values.append(harmonicity)
        if harmonicity >= 0.22 and flatness <= 0.72 and 0.005 <= zcr <= 0.38:
            voiced_frames += 1

    total_activity_frames = max(1, round(duration_seconds / 0.03))
    voiced_ratio = voiced_frames / total_activity_frames
    median_flatness = float(np.median(flatness_values)) if flatness_values else 1.0
    median_zcr = float(np.median(zcr_values)) if zcr_values else 0.0
    median_harmonicity = float(np.median(harmonicity_values)) if harmonicity_values else 0.0
    energy_present = rms_dbfs >= minimum_rms_dbfs

    speech_confidence = _clamp(
        0.34 * _clamp((rms_dbfs - minimum_rms_dbfs) / 24.0, 0.0, 1.0)
        + 0.24 * _clamp(active_ratio / 0.45, 0.0, 1.0)
        + 0.28 * _clamp(voiced_ratio / 0.22, 0.0, 1.0)
        + 0.14 * _clamp((0.8 - median_flatness) / 0.6, 0.0, 1.0),
        0.0,
        1.0,
    )

    if not energy_present:
        classification, reason = "silence", "below_noise_floor"
    elif duration_seconds < 0.20:
        classification, reason = "noise", "too_short_for_speech"
    else:
        has_voiced_evidence = voiced_ratio >= (0.10 if duration_seconds < 0.45 else 0.055)
        has_broad_speech_evidence = (
            active_ratio >= 0.20
            and median_flatness < 0.58
            and median_zcr < 0.34
            and median_harmonicity >= 0.12
        )
        if has_voiced_evidence or has_broad_speech_evidence:
            classification, reason = "speech", "voice_activity_confirmed"
        else:
            classification, reason = "noise", "insufficient_voice_activity"

    return {
        "classification": classification,
        "reason": reason,
        "durationSeconds": round(duration_seconds, 3),
        "rmsDbfs": round(rms_dbfs, 2),
        "peakDbfs": round(peak_dbfs, 2),
        "noiseFloorDbfs": round(noise_floor_dbfs, 2),
        "dynamicRangeDb": round(dynamic_range_db, 2),
        "speechRatio": round(active_ratio, 4),
        "voicedRatio": round(voiced_ratio, 4),
        "medianSpectralFlatness": round(median_flatness, 4),
        "medianZeroCrossingRate": round(median_zcr, 4),
        "medianHarmonicity": round(median_harmonicity, 4),
        "speechConfidence": round(speech_confidence, 4),
        "energyPresent": energy_present,
        "analyzedVoiceFrames": analyzed_frames,
    }


def hallucination_reason(text: str, context: str = "", duration_seconds: float = 0.0) -> str | None:
    """Return a reason for known prompt echoes/repetition, otherwise ``None``."""
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip(" .,!?:;\t\r\n").casefold()
    if not cleaned:
        return None

    matched_terms = sum(1 for term in PROMPT_ECHO_TERMS if term in cleaned)
    if matched_terms >= 3:
        return "keyword_prompt_echo"

    normalized_context = re.sub(r"\s+", " ", str(context or "")).strip(" .,!?:;\t\r\n").casefold()
    if normalized_context and len(normalized_context) >= 16 and cleaned == normalized_context:
        return "context_prompt_echo"

    isolated_terms = {"move speed", "movespeed", "movement speed", "attack speed"}
    if cleaned in isolated_terms and duration_seconds < 3.0:
        return "isolated_prompt_term"

    words = re.findall(r"[a-z0-9]+|[\u0e00-\u0e7f]+", cleaned)
    if len(words) >= 8 and len(set(words)) / len(words) < 0.28:
        return "repetitive_asr_output"
    return None
