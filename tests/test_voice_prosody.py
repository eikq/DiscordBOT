import sys
from pathlib import Path
import unittest


PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "colab"))

from voice_prosody import plan_edge_prosody


class VoiceProsodyTests(unittest.TestCase):
    def test_thai_question_gets_question_timing_and_lift(self):
        plan = plan_edge_prosody("คืนนี้เล่นเกมไหม")
        self.assertEqual(plan.style, "question")
        self.assertTrue(plan.text.endswith("?"))
        self.assertGreater(int(plan.pitch.removesuffix("Hz")), 0)

    def test_soft_and_excited_lines_use_different_expression(self):
        soft = plan_edge_prosody("วันนี้เหนื่อย ไม่ไหวแล้ว")
        excited = plan_edge_prosody("โห ชนะแล้ว!")
        self.assertEqual(soft.style, "soft")
        self.assertEqual(excited.style, "excited")
        self.assertLess(int(soft.rate.removesuffix("%")), int(excited.rate.removesuffix("%")))
        self.assertLess(int(soft.pitch.removesuffix("Hz")), int(excited.pitch.removesuffix("Hz")))

    def test_explicit_seed_is_stable_and_adds_filler_pause(self):
        first = plan_edge_prosody("เออ เล่นดิ", variation_seed="turn-a")
        second = plan_edge_prosody("เออ เล่นดิ", variation_seed="turn-a")
        self.assertEqual(first, second)
        self.assertEqual(first.style, "casual")
        self.assertTrue(first.text.startswith("เออ, "))

    def test_same_words_get_bounded_per_turn_variation(self):
        plans = {
            (
                plan_edge_prosody(
                    "เออ",
                    speech_act="acknowledgement",
                    context="งั้นเล่นเกมกันไหม",
                    variation=0.7,
                    variation_seed=f"turn-{index}",
                ).rate,
                plan_edge_prosody(
                    "เออ",
                    speech_act="acknowledgement",
                    context="งั้นเล่นเกมกันไหม",
                    variation=0.7,
                    variation_seed=f"turn-{index}",
                ).pitch,
            )
            for index in range(8)
        }
        self.assertGreater(len(plans), 2)


if __name__ == "__main__":
    unittest.main()
