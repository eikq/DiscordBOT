import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest import mock

from colab.rvc_train_runner import (
    EPOCH_EXPORT_PATCH_MARKER,
    EpochCheckpointTracker,
    enable_epoch_weight_exports,
    prepare_finetune_generator,
    run_training,
)


def epoch_score(epoch: int, score: float, batches: int = 10) -> str:
    return f"{epoch}\t{score:.12f}\t{batches}\n"


class RvcCheckpointTrackerTests(unittest.TestCase):
    def test_training_stop_waits_for_requested_checkpoint(self) -> None:
        class FakeTracker:
            latest_epoch = 4

        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            stop_request = root / "stop_after_epoch.json"
            stop_request.write_text(json.dumps({"afterEpoch": 4}), encoding="utf-8")
            with mock.patch(
                "colab.rvc_train_runner.terminate_process_tree",
                side_effect=lambda process: process.terminate(),
            ):
                stopped, epoch = run_training(
                    [sys.executable, "-c", "import time; print('training'); time.sleep(30)"],
                    root,
                    FakeTracker(),  # type: ignore[arg-type]
                    stop_request,
                )

            self.assertTrue(stopped)
            self.assertEqual(4, epoch)

    def test_tracker_creates_missing_cloud_weights_directory(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            experiment_dir = root / "logs" / "voice_test"
            experiment_dir.mkdir(parents=True)
            weights_root = root / "assets" / "weights"

            tracker = EpochCheckpointTracker(experiment_dir, weights_root, "voice_test")

            self.assertTrue(weights_root.is_dir())
            self.assertEqual(weights_root / "voice_test_latest.pth", tracker.latest_path)

    def test_finetune_generator_merges_selected_voice_into_full_base(self) -> None:
        class FakeTensor:
            def __init__(self, marker: str) -> None:
                self.marker = marker
                self.shape = (2, 2)

        class FakeTorch:
            def __init__(self, base_path: Path, selected_path: Path) -> None:
                self.base_path = base_path
                self.selected_path = selected_path
                self.saved = None

            def load(self, path: Path, **_kwargs):
                if Path(path) == self.base_path:
                    state = {f"layer.{index}": FakeTensor("base") for index in range(110)}
                    state["enc_q.training_only"] = FakeTensor("base-training")
                    return {"model": state}
                if Path(path) == self.selected_path:
                    return {
                        "weight": {f"layer.{index}": FakeTensor("gam") for index in range(110)},
                        "version": "v2",
                        "sr": "40k",
                        "f0": 1,
                    }
                raise AssertionError(f"Unexpected load path: {path}")

            def save(self, payload, path: Path) -> None:
                self.saved = payload
                Path(path).write_bytes(b"merged")

        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            base_path = root / "base.pth"
            selected_path = root / "best_model.pth"
            destination = root / "merged.pth"
            base_path.write_bytes(b"base")
            selected_path.write_bytes(b"selected")
            fake_torch = FakeTorch(base_path, selected_path)
            with mock.patch.dict("sys.modules", {"torch": fake_torch}):
                result = prepare_finetune_generator(base_path, selected_path, destination)

            self.assertEqual(110, result["matched"])
            self.assertEqual(0, result["mismatched"])
            self.assertEqual("gam", fake_torch.saved["model"]["layer.0"].marker)
            self.assertEqual("base-training", fake_torch.saved["model"]["enc_q.training_only"].marker)
            self.assertTrue(destination.is_file())

    def test_epoch_export_patch_is_guarded_and_idempotent(self) -> None:
        source = '''import os\n\nglobal_step = 0\n\ndef train_and_evaluate(epoch, hps, rank, net_g, loss_gen, loss_fm, loss_mel, loss_kl):\n    global global_step\n    if True:\n                loss_gen_all = loss_gen + loss_fm + loss_mel + loss_kl\n    if epoch % hps.save_every_epoch == 0 and rank == 0:\n        pass\n\n    if rank == 0:\n        logger.info(i18n("done"))\n'''
        with TemporaryDirectory() as temporary:
            train_script = Path(temporary) / "train.py"
            train_script.write_text(source, encoding="utf-8")
            self.assertTrue(enable_epoch_weight_exports(train_script))
            patched = train_script.read_text(encoding="utf-8")
            self.assertIn(EPOCH_EXPORT_PATCH_MARKER, patched)
            self.assertIn("DIGITAL_ME_ROLLING_EPOCH_WEIGHTS", patched)
            self.assertIn("DIGITAL_ME_EPOCH_SCORE_INIT", patched)
            self.assertIn("digital_me_epoch_scores.jsonl", patched)
            compile(patched, str(train_script), "exec")
            self.assertFalse(enable_epoch_weight_exports(train_script))
            self.assertEqual(patched, train_script.read_text(encoding="utf-8"))

    def test_tracker_keeps_only_rolling_latest_and_lowest_loss_best(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            experiment_dir = root / "logs" / "voice_test"
            weights_root = root / "weights"
            experiment_dir.mkdir(parents=True)
            weights_root.mkdir()
            score_path = experiment_dir / "digital_me_epoch_scores.jsonl"
            tracker = EpochCheckpointTracker(experiment_dir, weights_root, "voice_test")

            score_path.write_text(epoch_score(1, 10), encoding="utf-8")
            (weights_root / "voice_test_e1_s10.pth").write_bytes(b"epoch-one")
            tracker.poll_once()
            self.assertEqual(b"epoch-one", tracker.latest_path.read_bytes())
            self.assertEqual(b"epoch-one", tracker.best_path.read_bytes())

            with score_path.open("a", encoding="utf-8") as log:
                log.write(epoch_score(2, 16))
            (weights_root / "voice_test_e2_s20.pth").write_bytes(b"epoch-two")
            tracker.poll_once()
            self.assertEqual(b"epoch-two", tracker.latest_path.read_bytes())
            self.assertEqual(b"epoch-one", tracker.best_path.read_bytes())

            with score_path.open("a", encoding="utf-8") as log:
                log.write(epoch_score(3, 4))
            (weights_root / "voice_test_e3_s30.pth").write_bytes(b"epoch-three")
            tracker.poll_once()
            self.assertEqual(b"epoch-three", tracker.latest_path.read_bytes())
            self.assertEqual(b"epoch-three", tracker.best_path.read_bytes())
            selection = json.loads(tracker.metrics_path.read_text(encoding="utf-8"))
            self.assertEqual(3, selection["latestEpoch"])
            self.assertEqual(3, selection["bestEpoch"])
            self.assertEqual(3, len(selection["history"]))
            self.assertEqual([], list(weights_root.glob("voice_test_e*_s*.pth")))


if __name__ == "__main__":
    unittest.main()
