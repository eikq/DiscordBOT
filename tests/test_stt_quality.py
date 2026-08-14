import sys
from pathlib import Path
import unittest

try:
    import numpy as np
except ModuleNotFoundError as error:  # npm test uses the lightweight system Python
    raise unittest.SkipTest("STT signal tests require the isolated .venv-stt runtime") from error


PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "python"))

from stt_quality import analyze_audio_quality, hallucination_reason


class SttQualityTests(unittest.TestCase):
    def test_silence_is_not_sent_to_asr(self):
        result = analyze_audio_quality(np.zeros(48_000, dtype=np.float32))
        self.assertEqual(result["classification"], "silence")
        self.assertFalse(result["energyPresent"])

    def test_broadband_noise_is_labeled_noise(self):
        generator = np.random.default_rng(1234)
        noise = generator.normal(0, 0.035, 48_000).astype(np.float32)
        result = analyze_audio_quality(noise)
        self.assertEqual(result["classification"], "noise")
        self.assertTrue(result["energyPresent"])

    def test_voiced_syllabic_signal_has_speech_evidence(self):
        sample_rate = 48_000
        time = np.arange(sample_rate, dtype=np.float32) / sample_rate
        envelope = np.where((time % 0.28) < 0.19, 1.0, 0.04).astype(np.float32)
        voice = (0.12 * envelope * (np.sin(2 * np.pi * 135 * time) + 0.35 * np.sin(2 * np.pi * 270 * time))).astype(np.float32)
        result = analyze_audio_quality(voice)
        self.assertEqual(result["classification"], "speech")
        self.assertGreater(result["voicedRatio"], 0.05)

    def test_prompt_echoes_and_isolated_move_speed_are_rejected(self):
        self.assertEqual(
            hallucination_reason(
                "Move speed, movespeed, movement speed, attack speed, cooldown, damage, item, build.",
                duration_seconds=1.2,
            ),
            "keyword_prompt_echo",
        )
        self.assertEqual(hallucination_reason("move speed", duration_seconds=0.8), "isolated_prompt_term")
        self.assertIsNone(hallucination_reason("เพิ่ม move speed แล้ววิ่งเข้าไป", duration_seconds=2.4))


if __name__ == "__main__":
    unittest.main()
