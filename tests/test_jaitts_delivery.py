import sys
from pathlib import Path
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from jaitts_delivery import (
    CancellationRegistry,
    calibrated_speed,
    choose_reference,
    normalize_style,
    seed_from_variation,
    synthesis_settings,
)


def reference(reference_id: str, style: str, text: str, **extra):
    return {
        "id": reference_id,
        "style": style,
        "text": text,
        "enabled": True,
        "approvedForPilot": True,
        **extra,
    }


class JaiTtsDeliveryTests(unittest.TestCase):
    def test_named_synthesis_presets_and_bounded_evaluator_overrides(self):
        self.assertEqual(
            synthesis_settings("realtime", 32, 2.5),
            {"preset": "realtime", "steps": 12, "cfgStrength": 2.0},
        )
        self.assertEqual(
            synthesis_settings("unknown", 28, 2.4, 4, 8.0, allow_overrides=False),
            {"preset": "default", "steps": 28, "cfgStrength": 2.4},
        )
        self.assertEqual(
            synthesis_settings("quality", 32, 2.5, 2, 9.0, allow_overrides=True),
            {"preset": "quality", "steps": 8, "cfgStrength": 4.0},
        )

    def test_cancel_registry_rejects_invalid_ids_and_tracks_valid_turns(self):
        registry = CancellationRegistry()
        self.assertFalse(registry.cancel("bad/id"))
        self.assertTrue(registry.cancel("turn_123_abc"))
        self.assertTrue(registry.is_cancelled("turn_123_abc"))
        registry.forget("turn_123_abc")
        self.assertFalse(registry.is_cancelled("turn_123_abc"))

    def test_variation_seed_is_stable_but_not_constant(self):
        self.assertEqual(seed_from_variation("turn-one"), seed_from_variation("turn-one"))
        self.assertNotEqual(seed_from_variation("turn-one"), seed_from_variation("turn-two"))
        self.assertGreaterEqual(seed_from_variation("turn-one"), 0)
        self.assertLess(seed_from_variation("turn-one"), 4_294_967_295)
        self.assertEqual(seed_from_variation("turn-one", "question"), 42)
        self.assertEqual(seed_from_variation("turn-two", "soft"), 42)
        self.assertEqual(seed_from_variation("fixed:43", "question"), 43)

    def test_style_speed_calibration_keeps_sensitive_styles_native(self):
        casual = calibrated_speed(0.75, "casual")
        question = calibrated_speed(0.75, "question")
        soft = calibrated_speed(0.75, "soft")
        self.assertAlmostEqual(casual, 0.6975)
        self.assertAlmostEqual(question, 0.75)
        self.assertAlmostEqual(soft, 0.75)
        self.assertGreater(question, casual)
        self.assertEqual(normalize_style("curious"), "question")
        self.assertEqual(normalize_style("tired"), "soft")

    def test_reference_selection_stays_in_style_and_matches_length(self):
        references = [
            reference("casual", "casual", "วันนี้เล่นเกมกัน"),
            reference("question-short", "question", "ไปไหม", tailPitchDeltaSemitones=2.0),
            reference("question-long", "question", "วันนี้ตอนเย็นจะไปเล่นเกมด้วยกันไหม", tailPitchDeltaSemitones=2.0),
        ]
        selected = choose_reference(references, "question", "คืนนี้ว่างไหม", "seed-a")
        self.assertEqual(selected["id"], "question-short")

    def test_reference_selection_penalizes_falling_question_tail(self):
        references = [
            reference("falling", "question", "กินข้าวกันหรือยัง", tailPitchDeltaSemitones=-3.0),
            reference("rising", "question", "กินข้าวกันหรือยัง", tailPitchDeltaSemitones=2.5),
        ]
        selected = choose_reference(references, "question", "กินข้าวกันหรือยัง", "seed-b")
        self.assertEqual(selected["id"], "rising")

    def test_unapproved_reference_is_never_selected(self):
        references = [
            reference("approved", "casual", "พร้อมแล้ว"),
            {"id": "unsafe", "style": "casual", "text": "พร้อมแล้ว", "enabled": True},
        ]
        self.assertEqual(choose_reference(references, "casual", "พร้อมแล้ว", "seed")["id"], "approved")


if __name__ == "__main__":
    unittest.main()
