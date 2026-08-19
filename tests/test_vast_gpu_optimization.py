from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parent.parent
CLOUD_ROOT = PROJECT_ROOT / "cloud" / "vast"
COLAB_ROOT = PROJECT_ROOT / "colab"
for path in (CLOUD_ROOT, COLAB_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from run_vast_training import auto_batch_size_for_gpu, fallback_batch_sizes
from rvc_train_runner import CUDA_PERFORMANCE_PATCH_MARKER, enable_cuda_performance_tuning


class VastGpuOptimizationTests(unittest.TestCase):
    def test_24_gib_gpu_uses_aggressive_3090_batch_with_fallbacks(self) -> None:
        self.assertEqual(auto_batch_size_for_gpu(24.0), 20)
        self.assertEqual(fallback_batch_sizes(20), [20, 16, 12, 8, 6, 4, 2])

    def test_laptop_batch_two_can_fall_back_to_one(self) -> None:
        self.assertEqual(fallback_batch_sizes(2), [2, 1])

    def test_cuda_performance_patch_is_safe_and_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            train_script = Path(temporary) / "train.py"
            train_script.write_text(
                "import os\n"
                "import torch\n"
                "torch.backends.cudnn.benchmark = False\n"
                "train_loader = DataLoader(\n"
                "        train_dataset,\n"
                "        num_workers=4,\n"
                ")\n",
                encoding="utf-8",
            )
            self.assertTrue(enable_cuda_performance_tuning(train_script))
            self.assertFalse(enable_cuda_performance_tuning(train_script))
            patched = train_script.read_text(encoding="utf-8")
            self.assertIn(CUDA_PERFORMANCE_PATCH_MARKER, patched)
            self.assertIn("allow_tf32 = True", patched)
            self.assertIn("DIGITAL_ME_DATALOADER_WORKERS", patched)


if __name__ == "__main__":
    unittest.main()
