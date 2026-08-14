from __future__ import annotations

from array import array
import math
from pathlib import Path
import sys
import tempfile
import unittest
import wave


PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "colab"))

try:
    from song_conversion import (
        demucs_command,
        finalize_isolated_vocal,
        merge_converted_chunks,
        remix_song,
        split_audio_for_rvc,
    )
    SONG_DEPENDENCIES_AVAILABLE = True
except ModuleNotFoundError:
    SONG_DEPENDENCIES_AVAILABLE = False


def write_sine(path: Path, *, channels: int, amplitude: int, frequency: float, seconds: float = 1.0) -> None:
    sample_rate = 44_100
    frames = round(sample_rate * seconds)
    samples = array("h")
    for index in range(frames):
        value = round(amplitude * math.sin(2 * math.pi * frequency * index / sample_rate))
        samples.extend([value] * channels)
    with wave.open(str(path), "wb") as writer:
        writer.setnchannels(channels)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(samples.tobytes())


@unittest.skipUnless(SONG_DEPENDENCIES_AVAILABLE, "song conversion dependencies are installed in .venv-rvc")
class SongConversionTests(unittest.TestCase):
    def test_demucs_command_uses_two_stems_and_one_worker(self) -> None:
        command = demucs_command(Path("song.mp3"), Path("stems"), device="cuda", model="htdemucs")
        self.assertIn("--two-stems", command)
        self.assertIn("vocals", command)
        self.assertIn("cuda", command)
        self.assertEqual(command[command.index("-j") + 1], "1")

    def test_isolated_vocal_is_duration_matched_and_peak_limited(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root / "original.wav"
            converted = root / "converted.wav"
            output = root / "output.wav"
            write_sine(original, channels=1, amplitude=8_000, frequency=220)
            write_sine(converted, channels=1, amplitude=30_000, frequency=180, seconds=0.8)
            metrics = finalize_isolated_vocal(original, converted, output, duration_seconds=1.0)
            with wave.open(str(output), "rb") as reader:
                samples = array("h", reader.readframes(reader.getnframes()))
                self.assertEqual(reader.getnchannels(), 1)
                self.assertAlmostEqual(reader.getnframes() / reader.getframerate(), 1.0, delta=0.01)
            self.assertLessEqual(max(abs(value) for value in samples), 31_000)
            self.assertLess(metrics["vocalGainDb"], 0)

    def test_song_remix_preserves_stereo_and_limits_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            accompaniment = root / "accompaniment.wav"
            original = root / "original-vocal.wav"
            converted = root / "converted-vocal.wav"
            output = root / "remix.wav"
            write_sine(accompaniment, channels=2, amplitude=7_000, frequency=110)
            write_sine(original, channels=1, amplitude=8_000, frequency=220)
            write_sine(converted, channels=1, amplitude=28_000, frequency=180)
            metrics = remix_song(
                accompaniment,
                original,
                converted,
                output,
                duration_seconds=1.0,
                vocal_boost_db=3.0,
            )
            with wave.open(str(output), "rb") as reader:
                samples = array("h", reader.readframes(reader.getnframes()))
                self.assertEqual(reader.getnchannels(), 2)
                self.assertAlmostEqual(reader.getnframes() / reader.getframerate(), 1.0, delta=0.01)
            self.assertLessEqual(max(abs(value) for value in samples), 31_000)
            self.assertEqual(metrics["vocalBoostDb"], 3.0)
            self.assertAlmostEqual(
                metrics["vocalGainDb"],
                metrics["matchedVocalGainDb"] + 3.0,
                delta=0.01,
            )

    def test_long_audio_chunks_crossfade_back_to_exact_duration(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "long.wav"
            output = root / "joined.wav"
            write_sine(source, channels=1, amplitude=8_000, frequency=220, seconds=11.0)
            chunks = split_audio_for_rvc(source, root / "chunks", chunk_seconds=5.0, overlap_seconds=0.5)
            converted = [Path(chunk["path"]) for chunk in chunks]
            metrics = merge_converted_chunks(chunks, converted, output, duration_seconds=11.0)
            with wave.open(str(output), "rb") as reader:
                self.assertAlmostEqual(reader.getnframes() / reader.getframerate(), 11.0, delta=0.01)
                samples = array("h", reader.readframes(reader.getnframes()))
            self.assertGreater(metrics["chunks"], 1)
            # A crossfade seam must not introduce a full-scale discontinuity/click.
            self.assertLess(max(abs(samples[index] - samples[index - 1]) for index in range(1, len(samples))), 3_000)


if __name__ == "__main__":
    unittest.main()
