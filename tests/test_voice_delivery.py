import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from colab.voice_delivery import estimate_delivery_profile


def write_sample(root: Path, index: int, *, pitch: float, rate: float, style: str = "casual",
                 accepted: bool = True, score: float = 0.85) -> None:
    payload = {
        "durationSeconds": 3.0,
        "analysis": {
            "audio": {"durationSeconds": 3.0},
            "prosody": {
                "pitchMedianHz": pitch,
                "speakingRateWordsPerSecond": rate,
                "style": style,
            },
            "quality": {"acceptedForVoiceTraining": accepted, "score": score},
        },
    }
    (root / f"sample_{index}.json").write_text(json.dumps(payload), encoding="utf-8")


class VoiceDeliveryTests(unittest.TestCase):
    def test_uses_median_and_rejects_doubled_octave_and_excited_samples(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index, pitch in enumerate((118, 121, 124, 126, 129, 132)):
                write_sample(root, index, pitch=pitch, rate=4.0 + index * 0.1)
            write_sample(root, 7, pitch=235, rate=12)
            write_sample(root, 8, pitch=205, rate=6, style="excited")

            profile = estimate_delivery_profile(root)

            self.assertIsNotNone(profile)
            assert profile is not None
            self.assertEqual(125.0, profile["targetPitchHz"])
            self.assertEqual(4.25, profile["targetRateWordsPerSecond"])
            self.assertEqual(6, profile["pitchSampleCount"])

    def test_returns_none_when_there_is_not_enough_clean_evidence(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_sample(root, 1, pitch=125, rate=4.2, accepted=False)
            self.assertIsNone(estimate_delivery_profile(root))


if __name__ == "__main__":
    unittest.main()
