from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

try:
    import numpy as np
    import soundfile as sf
except ModuleNotFoundError:
    np = None
    sf = None


PROJECT_ROOT = Path(__file__).resolve().parent.parent
COLAB_ROOT = PROJECT_ROOT / "colab"
import sys

if str(COLAB_ROOT) not in sys.path:
    sys.path.insert(0, str(COLAB_ROOT))

from cloud_training_export import create_training_export, preview_training_export


@unittest.skipUnless(np is not None and sf is not None, "local RVC audio dependencies are not installed")
class CloudTrainingExportTests(unittest.TestCase):
    def test_export_cleans_copies_and_keeps_original_dataset_untouched(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            speaker_dir = root / "voice" / "speakers" / "1234567890"
            samples_dir = speaker_dir / "samples"
            transcripts_dir = root / "voice_samples" / "1234567890"
            model_dir = speaker_dir / "models" / "job_test"
            output_dir = root / "exports"
            samples_dir.mkdir(parents=True)
            transcripts_dir.mkdir(parents=True)
            model_dir.mkdir(parents=True)

            sample_rate = 16_000
            seconds = 65
            timeline = np.arange(sample_rate * seconds, dtype=np.float32) / sample_rate
            audio = (0.1 * np.sin(2 * np.pi * 180 * timeline) + 0.02).astype(np.float32)
            audio[: sample_rate // 2] = 0
            audio[-sample_rate // 2 :] = 0
            for index in range(2):
                stem = f"utterance_test_{index}"
                sf.write(samples_dir / f"{stem}.wav", np.column_stack([audio, audio]), sample_rate, subtype="PCM_16")
                (transcripts_dir / f"{stem}.txt").write_text("เธ—เธ”เธชเธญเธ hello", encoding="utf-8")
            original = samples_dir / "utterance_test_0.wav"
            original_digest = hashlib.sha256(original.read_bytes()).hexdigest()

            (model_dir / "best_model.pth").write_bytes(b"best-model")
            (model_dir / "latest_model.pth").write_bytes(b"latest-model")
            (model_dir / "model.pth").write_bytes(b"active-model")
            (model_dir / "model.index").write_bytes(b"index")
            current = {
                "modelPath": "models/job_test/model.pth",
                "bestModelPath": "models/job_test/best_model.pth",
                "latestModelPath": "models/job_test/latest_model.pth",
                "indexPath": "models/job_test/model.index",
            }
            (speaker_dir / "current.json").write_text(json.dumps(current), encoding="utf-8")
            (transcripts_dir / "utterances.json").write_text(json.dumps({
                "utterances": [{"id": "utterance_test_0"}, {"id": "utterance_test_1"}],
            }), encoding="utf-8")

            status = {
                "speakerId": "1234567890",
                "displayName": "Gam",
                "sampleCount": 2,
                "durationSeconds": 130.0,
                "modelReady": True,
                "job": {"status": "ready"},
            }
            options = {
                "trainingTarget": "vast_24gb",
                "trainingMode": "finetune",
                "modelSelection": "best",
                "epochs": 30,
                "includeDataset": True,
                "includeTranscripts": True,
                "includeBestModel": True,
                "includeLatestModel": True,
                "includeTrainingLogs": True,
                "includeTrainer": True,
                "cleanAudio": True,
                "excludeLowQuality": True,
            }
            preview = preview_training_export(speaker_dir, transcripts_dir, status, options)
            self.assertTrue(preview["ready"])

            archive_path, result = create_training_export(
                PROJECT_ROOT,
                speaker_dir,
                transcripts_dir,
                status,
                options,
                output_dir,
            )
            self.assertEqual(result["keptClips"], 2)
            self.assertEqual(result["excludedClips"], 0)
            self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), original_digest)
            with sf.SoundFile(original) as original_wav:
                self.assertEqual(original_wav.samplerate, sample_rate)

            extract_root = root / "extracted"
            with zipfile.ZipFile(archive_path) as archive:
                archive.extractall(extract_root)
            bundle_root = next(extract_root.iterdir())
            config = json.loads((bundle_root / "export_config.json").read_text(encoding="utf-8"))
            report = json.loads((bundle_root / "audio_quality_report.json").read_text(encoding="utf-8"))
            self.assertEqual(config["training"]["mode"], "finetune")
            self.assertEqual(config["training"]["trainingTarget"], "vast_24gb")
            self.assertEqual(config["training"]["startingModelPath"], "models/best_model.pth")
            self.assertEqual(config["training"]["batchStrategy"], "auto")
            self.assertEqual(config["training"]["batchSize"], 0)
            self.assertEqual(config["command"], "bash RUN_FINETUNE_BEST_30_EPOCHS.sh")
            self.assertEqual(config["dataset"]["sampleCount"], 2)
            self.assertTrue(report["cleaningWasNonDestructive"])
            self.assertTrue((bundle_root / "RUN_FINETUNE_BEST_30_EPOCHS.sh").is_file())
            self.assertIn("bash RUN_FINETUNE_BEST_30_EPOCHS.sh", (bundle_root / "START_HERE.txt").read_text(encoding="utf-8"))
            with sf.SoundFile(next((bundle_root / "dataset").glob("*.wav"))) as cleaned_wav:
                self.assertEqual(cleaned_wav.samplerate, 40_000)
                self.assertEqual(cleaned_wav.channels, 1)

    def test_finetune_preview_blocks_missing_selected_model(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            speaker_dir = root / "speaker"
            samples = speaker_dir / "samples"
            samples.mkdir(parents=True)
            sf.write(samples / "sample.wav", np.zeros(16_000 * 130, dtype=np.float32), 16_000)
            preview = preview_training_export(speaker_dir, root / "transcripts", {
                "speakerId": "1234567890",
                "sampleCount": 1,
                "durationSeconds": 130.0,
                "job": None,
            }, {
                "trainingMode": "finetune",
                "modelSelection": "best",
                "epochs": 30,
                "includeDataset": True,
                "includeTranscripts": False,
                "includeBestModel": True,
                "includeLatestModel": False,
                "includeTrainingLogs": False,
                "includeTrainer": True,
                "cleanAudio": True,
                "excludeLowQuality": True,
            })
            self.assertFalse(preview["ready"])
            self.assertTrue(any("Best model" in item for item in preview["blockers"]))

    def test_laptop_4050_export_generates_safe_windows_profile(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            speaker_dir = root / "speaker"
            samples_dir = speaker_dir / "samples"
            samples_dir.mkdir(parents=True)
            sample_rate = 16_000
            timeline = np.arange(sample_rate * 125, dtype=np.float32) / sample_rate
            sf.write(samples_dir / "laptop_sample.wav", 0.1 * np.sin(2 * np.pi * 190 * timeline), sample_rate)
            status = {
                "speakerId": "4050-test",
                "displayName": "Laptop Voice",
                "sampleCount": 1,
                "durationSeconds": 125.0,
                "modelReady": False,
                "job": None,
            }
            options = {
                "trainingTarget": "laptop_4050_6gb",
                "trainingMode": "fresh",
                "modelSelection": "best",
                "epochs": 100,
                "includeDataset": True,
                "includeTranscripts": False,
                "includeBestModel": False,
                "includeLatestModel": False,
                "includeTrainingLogs": False,
                "includeTrainer": True,
                "cleanAudio": False,
                "excludeLowQuality": False,
            }
            preview = preview_training_export(speaker_dir, root / "transcripts", status, options)
            self.assertTrue(preview["ready"])
            self.assertEqual(preview["commandScript"], "RUN_TRAIN_NEW_100_EPOCHS_LAPTOP_4050.ps1")
            self.assertIn("powershell", preview["command"].lower())

            archive_path, _ = create_training_export(
                PROJECT_ROOT,
                speaker_dir,
                root / "transcripts",
                status,
                options,
                root / "exports",
            )
            extract_root = root / "extracted_laptop"
            with zipfile.ZipFile(archive_path) as archive:
                archive.extractall(extract_root)
            bundle_root = next(extract_root.iterdir())
            config = json.loads((bundle_root / "export_config.json").read_text(encoding="utf-8"))
            training = config["training"]
            self.assertEqual(training["trainingTarget"], "laptop_4050_6gb")
            self.assertEqual(training["batchStrategy"], "fixed")
            self.assertEqual(training["batchSize"], 2)
            self.assertEqual(training["workers"], 2)
            self.assertEqual(training["cpuThreadLimit"], 6)
            self.assertTrue((bundle_root / "start_training.ps1").is_file())
            self.assertTrue((bundle_root / "README_LAPTOP.md").is_file())
            self.assertTrue((bundle_root / preview["commandScript"]).is_file())
            self.assertTrue((bundle_root / "scripts" / "bootstrap_training.py").is_file())
            self.assertTrue((bundle_root / "scripts" / "run_training.py").is_file())


if __name__ == "__main__":
    unittest.main()
