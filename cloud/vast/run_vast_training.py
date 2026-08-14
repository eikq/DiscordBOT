#!/usr/bin/env python3
"""Run a Digital Me export bundle with a selected GPU hardware profile."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import zipfile


OOM_MARKERS = (
    "cuda out of memory",
    "torch.outofmemoryerror",
    "cublas_status_alloc_failed",
    "cuda error: out of memory",
)


def auto_batch_size_for_gpu(total_memory_gib: float) -> int:
    """Choose an aggressive single-GPU RVC batch with OOM fallback available."""
    if total_memory_gib >= 44:
        return 32
    if total_memory_gib >= 30:
        return 24
    if total_memory_gib >= 22:
        return 20
    if total_memory_gib >= 15:
        return 12
    if total_memory_gib >= 11:
        return 8
    if total_memory_gib >= 7:
        return 6
    return 2


def fallback_batch_sizes(initial: int) -> list[int]:
    candidates = [initial, 16, 12, 8, 6, 4, 2]
    if initial <= 2:
        candidates.append(1)
    return list(dict.fromkeys(value for value in candidates if 1 <= value <= initial))


def detect_training_profile(training: dict[str, object]) -> dict[str, object]:
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("GPU training requires an NVIDIA CUDA GPU, but PyTorch cannot see one.")
    properties = torch.cuda.get_device_properties(0)
    memory_gib = float(properties.total_memory) / (1024 ** 3)
    target = str(training.get("trainingTarget") or "vast_24gb").lower()
    strategy = str(training.get("batchStrategy") or "fixed").lower()
    configured_batch = int(training.get("batchSize") or 0)
    if target == "laptop_4050_6gb":
        batch_size = 1 if memory_gib < 5.5 else min(2, configured_batch or 2)
        strategy = "fixed-with-oom-fallback"
    elif strategy == "auto" or configured_batch < 1:
        batch_size = auto_batch_size_for_gpu(memory_gib)
    else:
        batch_size = configured_batch
    workers = int(training.get("workers") or 0)
    if target == "laptop_4050_6gb":
        workers = min(2, workers or 2)
    elif workers < 1:
        workers = min(8, max(2, (os.cpu_count() or 4) // 2))
    return {
        "trainingTarget": target,
        "gpuName": str(properties.name),
        "gpuMemoryGiB": round(memory_gib, 2),
        "batchStrategy": strategy,
        "initialBatchSize": batch_size,
        "workers": workers,
        "mixedPrecision": True,
        "tf32": True,
        "cudnnBenchmark": True,
    }


def main() -> int:
    bundle_root = Path(__file__).resolve().parent.parent
    config_path = bundle_root / "export_config.json"
    if not config_path.is_file():
        raise RuntimeError(f"Missing export config: {config_path}")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    training = config["training"]
    target = str(training.get("trainingTarget") or "vast_24gb").lower()
    dataset = bundle_root / config["dataset"]["path"]
    if not any(dataset.glob("*.wav")):
        raise RuntimeError("The exported dataset folder contains no WAV files.")

    speaker_id = str(config["speaker"]["speakerId"])
    run_id = f"vast_{int(time.time())}"
    output_root = bundle_root / "outputs" / run_id
    work_root = bundle_root / ".work" / run_id
    output_root.mkdir(parents=True, exist_ok=False)
    work_root.mkdir(parents=True, exist_ok=False)
    result_json = work_root / "result.json"
    rvc_root = Path(os.environ.get("RVC_ROOT", bundle_root / ".runtime" / "Retrieval-based-Voice-Conversion-WebUI")).resolve()
    profile = detect_training_profile(training)
    cpu_thread_limit = int(training.get("cpuThreadLimit") or 0)
    profile["attempts"] = []
    batch_sizes = fallback_batch_sizes(int(profile["initialBatchSize"]))
    extra_arguments: list[str] = []
    if training["mode"] == "finetune":
        base_model_value = training.get("startingModelPath")
        if not base_model_value:
            raise RuntimeError("Fine-tune export is missing its selected starting model.")
        base_model = (bundle_root / base_model_value).resolve()
        if not base_model.is_file() or not base_model.is_relative_to(bundle_root.resolve()):
            raise RuntimeError("Fine-tune starting model is missing or unsafe.")
        extra_arguments.extend([
            "--base-model", str(base_model),
            "--base-model-selection", str(training.get("modelSelection") or "best"),
        ])

    print(
        f"[Digital Me] GPU profile: {profile['gpuName']} ({profile['gpuMemoryGiB']} GiB), "
        f"starting batch {profile['initialBatchSize']} with automatic CUDA OOM fallback.",
        flush=True,
    )
    success = False
    with (output_root / "vast_training.log").open("w", encoding="utf-8") as log:
        for attempt, batch_size in enumerate(batch_sizes, start=1):
            experiment = f"voice_{speaker_id}_{run_id}_b{batch_size}_a{attempt}"
            command = [
                sys.executable,
                str(bundle_root / "scripts" / "rvc_train_runner.py"),
                "--rvc-root", str(rvc_root),
                "--dataset", str(dataset),
                "--experiment", experiment,
                "--epochs", str(int(training["epochs"])),
                "--batch-size", str(batch_size),
                "--workers", str(int(profile["workers"])),
                "--training-mode", str(training["mode"]),
                "--learning-rate-scale", str(float(training.get("learningRateScale", 1.0))),
                "--result-json", str(result_json),
                *extra_arguments,
            ]
            result_json.unlink(missing_ok=True)
            heading = f"[Digital Me] Training attempt {attempt}: batch size {batch_size}."
            print(heading, flush=True)
            print("[Digital Me] " + " ".join(command), flush=True)
            log.write(heading + "\n")
            recent_output: list[str] = []
            process = subprocess.Popen(
                command,
                cwd=str(bundle_root),
                env={
                    **os.environ,
                    "RVC_ROOT": str(rvc_root),
                    "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
                    "CUDA_MODULE_LOADING": "LAZY",
                    "DIGITAL_ME_DATALOADER_WORKERS": str(int(profile["workers"])),
                    "DIGITAL_ME_CUDA_PERFORMANCE": "1",
                    **({
                        "OMP_NUM_THREADS": str(cpu_thread_limit),
                        "MKL_NUM_THREADS": str(cpu_thread_limit),
                    } if target == "laptop_4050_6gb" and cpu_thread_limit > 0 else {}),
                },
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            assert process.stdout is not None
            for line in process.stdout:
                print(line.rstrip(), flush=True)
                log.write(line)
                log.flush()
                recent_output.append(line.lower())
                if len(recent_output) > 300:
                    del recent_output[:100]
            code = process.wait()
            output_tail = "".join(recent_output)
            out_of_memory = any(marker in output_tail for marker in OOM_MARKERS)
            profile["attempts"].append({
                "attempt": attempt,
                "batchSize": batch_size,
                "exitCode": code,
                "cudaOutOfMemory": out_of_memory,
            })
            if code == 0:
                profile["selectedBatchSize"] = batch_size
                success = True
                break
            if not out_of_memory or attempt == len(batch_sizes):
                (output_root / "gpu_training_profile.json").write_text(
                    json.dumps(profile, indent=2) + "\n", encoding="utf-8"
                )
                raise RuntimeError(
                    f"RVC training failed with exit code {code}. See {output_root / 'vast_training.log'}"
                )
            print(
                f"[Digital Me] CUDA ran out of memory at batch {batch_size}; retrying with a smaller batch.",
                flush=True,
            )
    if not success:
        raise RuntimeError("RVC training exhausted every automatic batch-size attempt.")

    result = json.loads(result_json.read_text(encoding="utf-8"))
    result["gpuTrainingProfile"] = profile
    artifacts = {
        "best_model.pth": result.get("bestModelPath", result["modelPath"]),
        "latest_model.pth": result.get("latestModelPath", result["modelPath"]),
        "model.index": result["indexPath"],
    }
    for name, source_value in artifacts.items():
        source = Path(source_value)
        if not source.is_file():
            raise RuntimeError(f"Training completed but expected artifact is missing: {source}")
        shutil.copy2(source, output_root / name)
    metrics = Path(result.get("checkpointMetricsPath", ""))
    if metrics.is_file():
        shutil.copy2(metrics, output_root / "checkpoint_metrics.json")
    (output_root / "gpu_training_profile.json").write_text(
        json.dumps(profile, indent=2) + "\n", encoding="utf-8"
    )
    (output_root / "result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")

    archive_path = bundle_root / f"DOWNLOAD_ME_{speaker_id}_{run_id}.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in sorted(output_root.rglob("*")):
            if file.is_file():
                archive.write(file, file.relative_to(output_root.parent))
    print(f"[Digital Me] Training finished. Download: {archive_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
