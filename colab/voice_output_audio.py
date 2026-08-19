"""Final-output smoothing helpers for short TTS and Discord/Opus playback."""

from __future__ import annotations

from array import array
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import wave


def should_use_jaitts(text: str, minimum_characters: int = 9) -> bool:
    """JaiTTS duration prediction is unstable for very short Thai reactions."""
    spoken = re.sub(r"[\s.,!?…:;\"'`()\[\]{}\-–—_/\\]+", "", str(text or ""))
    return len(spoken) >= minimum_characters


def has_rising_thai_question_ending(text: str) -> bool:
    """Return true only for Thai particles that normally need a held/rising tail."""
    normalized = re.sub(r"\s+", "", str(text or ""))
    return bool(re.search(r"(?:ไหม|มั้ย|หรือยัง|รึยัง|ยัง|ใช่ปะ|ปะ)[?？]?$", normalized))


def configured_question_tail_lift(value: str | float | None = None) -> float:
    """Return a conservative opt-in post-RVC question-tail lift.

    JaiTTS already generates a pitch contour from its reference. Applying a
    second, large pitch shift after RVC caused an audible step at the end of
    Thai questions. Keep this disabled by default and cap any evaluator opt-in
    to one semitone.
    """
    raw = os.environ.get("VOICE_QUESTION_TAIL_LIFT_SEMITONES", "0") if value is None else value
    try:
        parsed = float(raw)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(parsed):
        return 0.0
    return max(0.0, min(1.0, parsed))


def shape_rising_question_tail(
    path: Path,
    text: str,
    *,
    lift_semitones: float = 3.0,
    tail_ms: int = 560,
    crossfade_ms: int = 100,
) -> dict[str, float | int]:
    """Gently lift only the final rising-question particle using Rubber Band.

    The head overlaps the shifted tail before crossfading, so duration and the
    speaker's delivery before the final particle remain unchanged.
    """
    if not has_rising_thai_question_ending(text):
        return {"changed": 0, "tailLiftSemitones": 0.0}
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return {"changed": 0, "tailLiftSemitones": 0.0}
    try:
        with wave.open(str(path), "rb") as reader:
            channels = reader.getnchannels()
            sample_width = reader.getsampwidth()
            sample_rate = reader.getframerate()
            compression = reader.getcomptype()
            frames = reader.getnframes()
            raw = reader.readframes(frames)
        if compression != "NONE" or sample_width != 2 or frames < sample_rate // 2:
            return {"changed": 0, "tailLiftSemitones": 0.0}
        samples = array("h")
        samples.frombytes(raw)
        if sys.byteorder != "little":
            samples.byteswap()
        analysis_frames = max(1, round(sample_rate * 0.01))
        frame_rms: list[float] = []
        for frame_start in range(0, frames, analysis_frames):
            sample_start = frame_start * channels
            sample_end = min(frames, frame_start + analysis_frames) * channels
            window = samples[sample_start:sample_end]
            frame_rms.append(math.sqrt(sum(int(value) ** 2 for value in window) / max(1, len(window))))
        peak_rms = max(frame_rms, default=0.0)
        threshold = max(32768.0 * 10 ** (-45 / 20), peak_rms * 10 ** (-30 / 20))
        active = [index for index, value in enumerate(frame_rms) if value >= threshold]
        if not active:
            return {"changed": 0, "tailLiftSemitones": 0.0}
        duration = frames / sample_rate
        active_end = min(duration, (active[-1] + 1) * 0.01)
        tail_start = max(0.05, active_end - max(250, tail_ms) / 1000)
        crossfade = min(max(0.04, crossfade_ms / 1000), max(0.04, (duration - tail_start) / 3))
        head_end = min(duration, tail_start + crossfade)
        if head_end >= duration - 0.02:
            return {"changed": 0, "tailLiftSemitones": 0.0}
        pitch_ratio = 2 ** (float(lift_semitones) / 12)
        filter_graph = (
            f"[0:a]atrim=0:{head_end:.6f},asetpts=PTS-STARTPTS[head];"
            f"[0:a]atrim=start={tail_start:.6f},asetpts=PTS-STARTPTS,"
            f"rubberband=pitch={pitch_ratio:.8f}[tail];"
            f"[head][tail]acrossfade=d={crossfade:.6f}:c1=tri:c2=tri[out]"
        )
        with tempfile.NamedTemporaryFile(suffix=".wav", dir=path.parent, delete=False) as temporary:
            temporary_path = Path(temporary.name)
        try:
            subprocess.run(
                [
                    ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
                    "-filter_complex", filter_graph, "-map", "[out]", "-c:a", "pcm_s16le",
                    str(temporary_path),
                ],
                check=True,
                capture_output=True,
                timeout=20,
            )
            os.replace(temporary_path, path)
        finally:
            temporary_path.unlink(missing_ok=True)
        return {
            "changed": 1,
            "tailLiftSemitones": round(float(lift_semitones), 3),
            "tailStartSeconds": round(tail_start, 3),
            "crossfadeMs": round(crossfade * 1000),
        }
    except (OSError, subprocess.SubprocessError, wave.Error, ValueError):
        return {"changed": 0, "tailLiftSemitones": 0.0}


def polish_generated_wav(
    path: Path,
    *,
    silence_dbfs: float = -55.0,
    leading_ms: int = 80,
    trailing_ms: int = 320,
    compress_pause_over_ms: int = 1200,
    compressed_pause_ms: int = 700,
) -> dict[str, float | int]:
    """Trim only excessive silence while preserving breath, phrase timing, and the Opus tail."""
    with wave.open(str(path), "rb") as reader:
        channels = reader.getnchannels()
        sample_width = reader.getsampwidth()
        sample_rate = reader.getframerate()
        compression = reader.getcomptype()
        frames = reader.getnframes()
        raw = reader.readframes(frames)
    if compression != "NONE" or sample_width != 2 or channels < 1 or sample_rate < 8_000:
        return {"changed": 0, "compressedPauses": 0}

    samples = array("h")
    samples.frombytes(raw)
    if sys.byteorder != "little":
        samples.byteswap()
    pcm_frames = len(samples) // channels
    if pcm_frames < 1:
        return {"changed": 0, "compressedPauses": 0}

    analysis_ms = 10
    analysis_frames = max(1, round(sample_rate * analysis_ms / 1000))
    threshold = 32768.0 * 10 ** (silence_dbfs / 20.0)
    active: list[bool] = []
    for frame_start in range(0, pcm_frames, analysis_frames):
        sample_start = frame_start * channels
        sample_end = min(pcm_frames, frame_start + analysis_frames) * channels
        window = samples[sample_start:sample_end]
        rms = math.sqrt(sum(int(value) * int(value) for value in window) / max(1, len(window)))
        active.append(rms >= threshold)
    active_indices = [index for index, value in enumerate(active) if value]
    if not active_indices:
        return {"changed": 0, "compressedPauses": 0}

    first_active = active_indices[0]
    last_active = active_indices[-1]
    leading_units = max(0, round(leading_ms / analysis_ms))
    trailing_units = max(0, round(trailing_ms / analysis_ms))
    start_unit = max(0, first_active - leading_units)
    end_unit = min(len(active), last_active + 1 + trailing_units)

    long_pause_units = max(1, round(compress_pause_over_ms / analysis_ms))
    kept_pause_units = max(1, round(compressed_pause_ms / analysis_ms))
    removals: list[tuple[int, int]] = []
    run_start: int | None = None
    for unit in range(first_active, last_active + 2):
        is_silent = unit <= last_active and not active[unit]
        if is_silent and run_start is None:
            run_start = unit
        elif not is_silent and run_start is not None:
            run_end = unit
            if run_end - run_start >= long_pause_units:
                keep_before = kept_pause_units // 2
                keep_after = kept_pause_units - keep_before
                removal_start = run_start + keep_before
                removal_end = run_end - keep_after
                if removal_end > removal_start:
                    removals.append((removal_start, removal_end))
            run_start = None

    def unit_to_sample(unit: int) -> int:
        return min(pcm_frames, unit * analysis_frames) * channels

    polished = array("h")
    cursor = unit_to_sample(start_unit)
    for removal_start, removal_end in removals:
        polished.extend(samples[cursor:unit_to_sample(removal_start)])
        cursor = unit_to_sample(removal_end)
    polished.extend(samples[cursor:unit_to_sample(end_unit)])

    existing_leading_units = first_active - start_unit
    if existing_leading_units < leading_units:
        missing_frames = (leading_units - existing_leading_units) * analysis_frames
        polished = array("h", [0]) * (missing_frames * channels) + polished
    existing_trailing_units = end_unit - (last_active + 1)
    if existing_trailing_units < trailing_units:
        missing_frames = (trailing_units - existing_trailing_units) * analysis_frames
        polished.extend([0] * (missing_frames * channels))

    if sys.byteorder != "little":
        polished.byteswap()
    with wave.open(str(path), "wb") as writer:
        writer.setnchannels(channels)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.setcomptype("NONE", "not compressed")
        writer.writeframes(polished.tobytes())

    original_duration = pcm_frames / sample_rate
    polished_duration = (len(polished) // channels) / sample_rate
    return {
        "changed": 1,
        "compressedPauses": len(removals),
        "originalDurationSeconds": round(original_duration, 3),
        "polishedDurationSeconds": round(polished_duration, 3),
        "leadingMs": leading_ms,
        "trailingMs": trailing_ms,
    }
