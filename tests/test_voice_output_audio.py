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

from voice_output_audio import (
    configured_question_tail_lift,
    has_rising_thai_question_ending,
    polish_generated_wav,
    shape_rising_question_tail,
    should_use_jaitts,
)


class VoiceOutputAudioTests(unittest.TestCase):
    def test_question_tail_post_shift_is_disabled_and_safely_bounded(self) -> None:
        self.assertEqual(configured_question_tail_lift(None), 0.0)
        self.assertEqual(configured_question_tail_lift("not-a-number"), 0.0)
        self.assertEqual(configured_question_tail_lift(-2), 0.0)
        self.assertEqual(configured_question_tail_lift(0.65), 0.65)
        self.assertEqual(configured_question_tail_lift(3), 1.0)

    def test_only_rising_thai_question_particles_get_tail_shaping(self) -> None:
        self.assertTrue(has_rising_thai_question_ending("กินข้าวกันรึยัง?"))
        self.assertTrue(has_rising_thai_question_ending("ไปด้วยกันไหม"))
        self.assertFalse(has_rising_thai_question_ending("จริงเหรอ?"))
        self.assertFalse(has_rising_thai_question_ending("วันนี้เล่นเกมกัน"))

    def test_rising_question_tail_keeps_duration(self) -> None:
        sample_rate = 16_000
        duration_seconds = 1.4
        samples = array("h", [
            round(7_000 * math.sin(2 * math.pi * 120 * index / sample_rate))
            for index in range(round(sample_rate * duration_seconds))
        ])
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "question.wav"
            with wave.open(str(path), "wb") as writer:
                writer.setnchannels(1)
                writer.setsampwidth(2)
                writer.setframerate(sample_rate)
                writer.writeframes(samples.tobytes())
            result = shape_rising_question_tail(path, "กินข้าวหรือยัง?")
            with wave.open(str(path), "rb") as reader:
                duration = reader.getnframes() / reader.getframerate()
            self.assertEqual(result["changed"], 1)
            self.assertEqual(result["tailLiftSemitones"], 3.0)
            self.assertAlmostEqual(duration, duration_seconds, delta=0.03)

    def test_short_reactions_use_the_stable_edge_source(self) -> None:
        self.assertFalse(should_use_jaitts("ห้ะ"))
        self.assertFalse(should_use_jaitts("จริงดิ!"))
        self.assertTrue(should_use_jaitts("วันนี้เล่นเกมอะไรกันดี"))

    def test_polish_trims_edges_compresses_long_gap_and_adds_tail(self) -> None:
        sample_rate = 10_000
        silence = lambda milliseconds: [0] * round(sample_rate * milliseconds / 1000)
        tone = lambda milliseconds: [5000, -5000] * (round(sample_rate * milliseconds / 1000) // 2)
        raw = array("h", silence(400) + tone(300) + silence(1500) + tone(300))
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "voice.wav"
            with wave.open(str(path), "wb") as writer:
                writer.setnchannels(1)
                writer.setsampwidth(2)
                writer.setframerate(sample_rate)
                writer.writeframes(raw.tobytes())
            result = polish_generated_wav(path)
            with wave.open(str(path), "rb") as reader:
                duration = reader.getnframes() / reader.getframerate()
            self.assertEqual(result["compressedPauses"], 1)
            self.assertAlmostEqual(duration, 1.70, delta=0.04)
            self.assertEqual(result["leadingMs"], 80)
            self.assertEqual(result["trailingMs"], 320)

    def test_polish_preserves_a_natural_700ms_pause(self) -> None:
        sample_rate = 10_000
        silence = lambda milliseconds: [0] * round(sample_rate * milliseconds / 1000)
        tone = lambda milliseconds: [5000, -5000] * (round(sample_rate * milliseconds / 1000) // 2)
        raw = array("h", tone(300) + silence(700) + tone(300))
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "natural-pause.wav"
            with wave.open(str(path), "wb") as writer:
                writer.setnchannels(1)
                writer.setsampwidth(2)
                writer.setframerate(sample_rate)
                writer.writeframes(raw.tobytes())
            result = polish_generated_wav(path)
            self.assertEqual(result["compressedPauses"], 0)


if __name__ == "__main__":
    unittest.main()
