"""High-quality singing conversion helpers: isolate vocals, convert, then remix safely."""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from typing import Any

import numpy as np
import soundfile as sf


def _ffmpeg() -> str:
    executable = shutil.which("ffmpeg")
    if not executable:
        raise RuntimeError("FFmpeg is required for song conversion")
    return executable


def demucs_available() -> bool:
    try:
        import demucs  # noqa: F401
        return True
    except ImportError:
        return False


def demucs_command(
    source: Path,
    output_root: Path,
    *,
    device: str,
    model: str,
) -> list[str]:
    return [
        sys.executable,
        "-m",
        "demucs.separate",
        "--two-stems",
        "vocals",
        "-n",
        model,
        "--device",
        device,
        "--segment",
        "7",
        "--overlap",
        "0.25",
        "--shifts",
        "1",
        "-j",
        "1",
        "-o",
        str(output_root),
        str(source),
    ]


def separate_vocals(
    source: Path,
    output_root: Path,
    *,
    preferred_device: str = "cuda",
    model: str = "htdemucs",
    timeout_seconds: float = 1_800,
) -> tuple[Path, Path, dict[str, Any]]:
    """Separate vocals and accompaniment, with a CPU retry after a CUDA failure."""
    if not demucs_available():
        raise RuntimeError(
            "Song mode requires Demucs. Run npm run voice:setup to install the vocal separator."
        )
    output_root.mkdir(parents=True, exist_ok=True)
    attempts = [preferred_device]
    if preferred_device == "cuda":
        attempts.append("cpu")
    errors: list[str] = []
    for device in attempts:
        started = __import__("time").perf_counter()
        command = demucs_command(source, output_root, device=device, model=model)
        try:
            result = subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_seconds,
            )
            stem_root = output_root / model / source.stem
            vocals = stem_root / "vocals.wav"
            accompaniment = stem_root / "no_vocals.wav"
            if not vocals.is_file() or not accompaniment.is_file():
                raise RuntimeError("Demucs completed without producing both song stems")
            return vocals, accompaniment, {
                "separator": "demucs",
                "model": model,
                "device": device,
                "seconds": round(__import__("time").perf_counter() - started, 3),
                "logTail": (result.stdout + result.stderr)[-600:],
            }
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, RuntimeError) as error:
            output = ""
            if isinstance(error, subprocess.CalledProcessError):
                output = f"{error.stdout or ''}\n{error.stderr or ''}"
            errors.append(f"{device}: {str(error)} {output[-600:]}")
    raise RuntimeError("Vocal separation failed; " + " | ".join(errors))


def prepare_vocal_for_rvc(vocals: Path, destination: Path) -> None:
    """Create a clean mono PCM input without normalizing away singing dynamics."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            _ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(vocals),
            "-af", "highpass=f=55,lowpass=f=16000,aresample=44100:async=1:first_pts=0",
            "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", str(destination),
        ],
        check=True,
        capture_output=True,
        timeout=300,
    )


def split_audio_for_rvc(
    source: Path,
    output_root: Path,
    *,
    chunk_seconds: float = 28.0,
    overlap_seconds: float = 0.8,
) -> list[dict[str, Any]]:
    """Split long mono audio into overlapping PCM chunks for bounded-memory RVC."""
    if chunk_seconds < 5 or not 0.1 <= overlap_seconds < chunk_seconds / 2:
        raise ValueError("RVC chunk and overlap durations are invalid")
    audio, sample_rate = sf.read(str(source), dtype="float32", always_2d=True)
    mono = audio.mean(axis=1)
    if mono.size < 1:
        raise ValueError("RVC input is empty")
    chunk_frames = max(1, round(chunk_seconds * sample_rate))
    overlap_frames = max(1, round(overlap_seconds * sample_rate))
    step_frames = chunk_frames - overlap_frames
    output_root.mkdir(parents=True, exist_ok=True)
    chunks: list[dict[str, Any]] = []
    start = 0
    while start < mono.size:
        end = min(mono.size, start + chunk_frames)
        path = output_root / f"chunk-{len(chunks):04d}.wav"
        sf.write(str(path), mono[start:end], sample_rate, format="WAV", subtype="PCM_16")
        chunks.append({
            "path": path,
            "startSeconds": start / sample_rate,
            "endSeconds": end / sample_rate,
            "overlapSeconds": overlap_seconds,
        })
        if end >= mono.size:
            break
        start += step_frames
    return chunks


def merge_converted_chunks(
    chunks: list[dict[str, Any]],
    converted_paths: list[Path],
    destination: Path,
    *,
    duration_seconds: float,
) -> dict[str, float | int]:
    """Sample-align RVC chunks and crossfade overlaps without shortening the source."""
    if not chunks or len(chunks) != len(converted_paths):
        raise ValueError("Converted chunk list does not match the RVC input chunks")
    first_audio, output_rate = sf.read(str(converted_paths[0]), dtype="float32", always_2d=True)
    total_frames = max(1, round(duration_seconds * output_rate))
    mixed = np.zeros(total_frames, dtype=np.float32)
    weight_sum = np.zeros(total_frames, dtype=np.float32)
    for index, (chunk, converted_path) in enumerate(zip(chunks, converted_paths)):
        if index == 0:
            audio = first_audio.mean(axis=1)
            sample_rate = output_rate
        else:
            loaded, sample_rate = sf.read(str(converted_path), dtype="float32", always_2d=True)
            audio = loaded.mean(axis=1)
        if sample_rate != output_rate:
            positions = np.linspace(0.0, 1.0, len(audio), endpoint=False)
            desired = max(1, round(len(audio) * output_rate / sample_rate))
            audio = np.interp(
                np.linspace(0.0, 1.0, desired, endpoint=False),
                positions,
                audio,
            ).astype(np.float32)
        start_frame = round(float(chunk["startSeconds"]) * output_rate)
        expected_frames = max(1, round((float(chunk["endSeconds"]) - float(chunk["startSeconds"])) * output_rate))
        if len(audio) < expected_frames:
            audio = np.pad(audio, (0, expected_frames - len(audio)))
        else:
            audio = audio[:expected_frames]
        end_frame = min(total_frames, start_frame + expected_frames)
        audio = audio[: end_frame - start_frame]
        weights = np.ones(len(audio), dtype=np.float32)
        if index > 0:
            previous_end = float(chunks[index - 1]["endSeconds"])
            fade_in = min(len(weights), max(0, round((previous_end - float(chunk["startSeconds"])) * output_rate)))
            if fade_in > 0:
                weights[:fade_in] *= np.linspace(0.0, 1.0, fade_in, dtype=np.float32)
        if index + 1 < len(chunks):
            next_start = float(chunks[index + 1]["startSeconds"])
            fade_out = min(len(weights), max(0, round((float(chunk["endSeconds"]) - next_start) * output_rate)))
            if fade_out > 0:
                weights[-fade_out:] *= np.linspace(1.0, 0.0, fade_out, dtype=np.float32)
        mixed[start_frame:end_frame] += audio * weights
        weight_sum[start_frame:end_frame] += weights
    mixed /= np.maximum(weight_sum, 1e-6)
    destination.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(destination), np.clip(mixed, -1.0, 1.0), output_rate, format="WAV", subtype="PCM_16")
    return {
        "chunks": len(chunks),
        "overlapSeconds": round(float(chunks[0]["overlapSeconds"]), 3),
        "outputSampleRate": output_rate,
    }


def audio_mean_dbfs(path: Path) -> float:
    result = subprocess.run(
        [_ffmpeg(), "-hide_banner", "-nostats", "-i", str(path), "-af", "volumedetect", "-f", "null", "NUL" if os.name == "nt" else "/dev/null"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=300,
    )
    match = re.search(r"mean_volume:\s*(-?[0-9.]+)\s*dB", result.stderr)
    if not match:
        raise RuntimeError(f"Could not measure vocal loudness: {result.stderr[-400:]}")
    return float(match.group(1))


def probe_duration(path: Path) -> float:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise RuntimeError("FFprobe is required for song conversion")
    result = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )
    duration = float(json.loads(result.stdout)["format"]["duration"])
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("Song duration is invalid")
    return duration


def remix_song(
    accompaniment: Path,
    original_vocals: Path,
    converted_vocals: Path,
    destination: Path,
    *,
    duration_seconds: float,
    vocal_boost_db: float = 0.0,
) -> dict[str, float]:
    """Match vocal loudness, restore stereo backing, and limit only true peaks."""
    original_dbfs = audio_mean_dbfs(original_vocals)
    converted_dbfs = audio_mean_dbfs(converted_vocals)
    requested_boost_db = max(-6.0, min(12.0, float(vocal_boost_db)))
    matched_gain_db = original_dbfs - converted_dbfs
    gain_db = max(-12.0, min(15.0, matched_gain_db + requested_boost_db))
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Demucs stems sum back to the source. RVC vocals are mono, so center them
    # while preserving the stereo accompaniment. Do not blend the original dry
    # singer back in: that would leak the source identity into the target clone.
    filter_graph = (
        "[0:a]aresample=44100:async=1:first_pts=0[inst];"
        f"[1:a]aresample=44100:async=1:first_pts=0,volume={gain_db:.3f}dB,"
        "pan=stereo|c0=0.707*c0|c1=0.707*c0[wet];"
        "[inst][wet]amix=inputs=2:weights='1 1':normalize=0:duration=longest,"
        f"atrim=duration={duration_seconds:.6f},"
        "alimiter=limit=0.94:attack=5:release=80:level=0[out]"
    )
    subprocess.run(
        [
            _ffmpeg(), "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(accompaniment), "-i", str(converted_vocals),
            "-filter_complex", filter_graph, "-map", "[out]", "-ar", "44100", "-ac", "2",
            "-c:a", "pcm_s16le", str(destination),
        ],
        check=True,
        capture_output=True,
        timeout=max(300, round(duration_seconds * 4)),
    )
    return {
        "originalVocalDbfs": round(original_dbfs, 3),
        "convertedVocalDbfs": round(converted_dbfs, 3),
        "matchedVocalGainDb": round(matched_gain_db, 3),
        "vocalBoostDb": round(requested_boost_db, 3),
        "vocalGainDb": round(gain_db, 3),
        "limiterPeak": 0.94,
    }


def finalize_isolated_vocal(
    original_vocal: Path,
    converted_vocal: Path,
    destination: Path,
    *,
    duration_seconds: float,
) -> dict[str, float]:
    """Restore the original singing dynamics and prevent hard digital clipping."""
    original_dbfs = audio_mean_dbfs(original_vocal)
    converted_dbfs = audio_mean_dbfs(converted_vocal)
    gain_db = max(-9.0, min(9.0, original_dbfs - converted_dbfs))
    destination.parent.mkdir(parents=True, exist_ok=True)
    audio_filter = (
        f"volume={gain_db:.3f}dB,"
        "highpass=f=45,lowpass=f=17500,"
        f"apad=whole_dur={duration_seconds:.6f},atrim=duration={duration_seconds:.6f},"
        "alimiter=limit=0.94:attack=5:release=80:level=0"
    )
    subprocess.run(
        [
            _ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(converted_vocal),
            "-af", audio_filter, "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", str(destination),
        ],
        check=True,
        capture_output=True,
        timeout=max(300, round(duration_seconds * 4)),
    )
    return {
        "originalVocalDbfs": round(original_dbfs, 3),
        "convertedVocalDbfs": round(converted_dbfs, 3),
        "vocalGainDb": round(gain_db, 3),
        "limiterPeak": 0.94,
    }
