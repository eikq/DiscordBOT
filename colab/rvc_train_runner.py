#!/usr/bin/env python3
"""Run the pinned upstream RVC v2 single-speaker CLI training pipeline."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time


EPOCH_EXPORT_PATCH_MARKER = "# DIGITAL_ME_ROLLING_EPOCH_WEIGHTS"
EPOCH_SCORE_INIT_PATCH_MARKER = "# DIGITAL_ME_EPOCH_SCORE_INIT"
EPOCH_SCORE_ACCUMULATE_PATCH_MARKER = "# DIGITAL_ME_EPOCH_SCORE_ACCUMULATE"
EPOCH_SCORE_WRITE_PATCH_MARKER = "# DIGITAL_ME_EPOCH_SCORE_WRITE"
CUDA_PERFORMANCE_PATCH_MARKER = "# DIGITAL_ME_CUDA_PERFORMANCE_PATCH"
SELECTION_METRIC = "mean_generator_training_loss"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rvc-root", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--experiment", required=True)
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--save-every", type=int, default=25)
    parser.add_argument("--training-mode", choices=("fresh", "finetune"), default="fresh")
    parser.add_argument("--base-model")
    parser.add_argument("--base-model-selection", choices=("best", "latest"))
    parser.add_argument("--learning-rate-scale", type=float, default=1.0)
    parser.add_argument("--stop-request-file")
    parser.add_argument("--result-json", required=True)
    return parser.parse_args()


def run(command: list[str], cwd: Path, extra_environment: dict[str, str] | None = None) -> None:
    printable = " ".join(command)
    print(f"[rvc-train] $ {printable}", flush=True)
    environment = os.environ.copy()
    existing_python_path = environment.get("PYTHONPATH", "")
    environment["PYTHONPATH"] = str(cwd) + (os.pathsep + existing_python_path if existing_python_path else "")
    if extra_environment:
        environment.update(extra_environment)
    process = subprocess.Popen(
        command,
        cwd=str(cwd),
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert process.stdout is not None
    for line in process.stdout:
        print(line.rstrip(), flush=True)
    code = process.wait()
    if code != 0:
        raise RuntimeError(f"RVC command failed with exit code {code}: {printable}")


def terminate_process_tree(process: subprocess.Popen[str]) -> None:
    """Stop the trainer and all of its launcher children after an epoch checkpoint."""
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


def run_training(
    command: list[str],
    cwd: Path,
    tracker: "EpochCheckpointTracker",
    stop_request_file: Path | None,
    extra_environment: dict[str, str] | None = None,
) -> tuple[bool, int | None]:
    """Run RVC and honor a stop request only after its requested epoch is published."""
    printable = " ".join(command)
    print(f"[rvc-train] $ {printable}", flush=True)
    environment = os.environ.copy()
    existing_python_path = environment.get("PYTHONPATH", "")
    environment["PYTHONPATH"] = str(cwd) + (os.pathsep + existing_python_path if existing_python_path else "")
    if extra_environment:
        environment.update(extra_environment)
    process = subprocess.Popen(
        command,
        cwd=str(cwd),
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    stopped = threading.Event()
    stop_epoch: list[int | None] = [None]
    monitor_done = threading.Event()

    def monitor_stop_request() -> None:
        while not monitor_done.wait(0.5):
            if stop_request_file is None or not stop_request_file.is_file():
                continue
            try:
                request = json.loads(stop_request_file.read_text(encoding="utf-8"))
                after_epoch = max(1, int(request.get("afterEpoch", 1)))
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                continue
            latest_epoch = tracker.latest_epoch
            if latest_epoch is None or latest_epoch < after_epoch:
                continue
            stop_epoch[0] = latest_epoch
            stopped.set()
            print(f"[rvc-train] Stop requested; epoch {latest_epoch} is safely checkpointed.", flush=True)
            terminate_process_tree(process)
            return

    monitor = threading.Thread(target=monitor_stop_request, daemon=True, name="rvc-stop-after-epoch")
    monitor.start()
    assert process.stdout is not None
    try:
        for line in process.stdout:
            print(line.rstrip(), flush=True)
        code = process.wait()
    finally:
        monitor_done.set()
        monitor.join(timeout=5)
    if code != 0 and not stopped.is_set():
        raise RuntimeError(f"RVC command failed with exit code {code}: {printable}")
    return stopped.is_set(), stop_epoch[0]


def atomic_json(path: Path, payload: dict[str, object]) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def enable_epoch_weight_exports(train_script: Path) -> bool:
    """Patch the pinned RVC trainer for low-overhead epoch model selection.

    Full optimizer checkpoints continue using RVC's normal save interval. This
    avoids writing the 1+ GB G/D pair after every epoch while still allowing the
    small inference model to roll forward each epoch. Generator loss is summed
    in memory and one compact score record is written after the epoch.
    """
    source = train_script.read_text(encoding="utf-8")
    changed = False

    if EPOCH_SCORE_INIT_PATCH_MARKER not in source:
        function_start = source.find("def train_and_evaluate(")
        global_line = source.find("    global global_step\n", function_start)
        if function_start < 0 or global_line < 0:
            raise RuntimeError("Pinned RVC train.py training function was not found; refusing an unsafe patch.")
        insertion_point = global_line + len("    global global_step\n")
        injection = (
            f"    {EPOCH_SCORE_INIT_PATCH_MARKER}\n"
            "    digital_me_epoch_score_total = 0.0\n"
            "    digital_me_epoch_score_count = 0\n"
        )
        source = source[:insertion_point] + injection + source[insertion_point:]
        changed = True

    if EPOCH_SCORE_ACCUMULATE_PATCH_MARKER not in source:
        loss_line = "                loss_gen_all = loss_gen + loss_fm + loss_mel + loss_kl\n"
        loss_point = source.find(loss_line)
        if loss_point < 0:
            raise RuntimeError("Pinned RVC train.py generator-loss line was not found; refusing an unsafe patch.")
        insertion_point = loss_point + len(loss_line)
        injection = (
            f"                {EPOCH_SCORE_ACCUMULATE_PATCH_MARKER}\n"
            "                digital_me_epoch_score_total += float(loss_gen_all.detach().item())\n"
            "                digital_me_epoch_score_count += 1\n"
        )
        source = source[:insertion_point] + injection + source[insertion_point:]
        changed = True

    checkpoint_start = source.find("    if epoch % hps.save_every_epoch == 0 and rank == 0:")
    if checkpoint_start < 0:
        raise RuntimeError("Pinned RVC train.py checkpoint block was not found; refusing an unsafe patch.")

    if EPOCH_SCORE_WRITE_PATCH_MARKER not in source:
        injection = (
            f"    {EPOCH_SCORE_WRITE_PATCH_MARKER}\n"
            "    if rank == 0 and digital_me_epoch_score_count > 0:\n"
            "        digital_me_epoch_score = digital_me_epoch_score_total / digital_me_epoch_score_count\n"
            "        digital_me_score_path = os.path.join(hps.model_dir, 'digital_me_epoch_scores.jsonl')\n"
            "        with open(digital_me_score_path, 'a', encoding='utf-8') as digital_me_score_log:\n"
            "            digital_me_score_log.write(\n"
            "                f'{epoch}\\t{digital_me_epoch_score:.12f}\\t{digital_me_epoch_score_count}\\n'\n"
            "            )\n\n"
        )
        source = source[:checkpoint_start] + injection + source[checkpoint_start:]
        checkpoint_start += len(injection)
        changed = True

    if EPOCH_EXPORT_PATCH_MARKER not in source:
        insertion_point = source.find("\n    if rank == 0:\n        logger.info(i18n(", checkpoint_start)
        if insertion_point < 0:
            raise RuntimeError("Pinned RVC train.py epoch-completion block was not found; refusing an unsafe patch.")
        injection = f'''\n    {EPOCH_EXPORT_PATCH_MARKER}\n    if (\n        epoch % hps.save_every_epoch != 0\n        and rank == 0\n        and hps.save_every_weights == "1"\n        and os.environ.get("DIGITAL_ME_ROLLING_EPOCH_WEIGHTS") == "1"\n    ):\n        if hasattr(net_g, "module"):\n            digital_me_ckpt = net_g.module.state_dict()\n        else:\n            digital_me_ckpt = net_g.state_dict()\n        savee(\n            digital_me_ckpt,\n            hps.sample_rate,\n            hps.if_f0,\n            hps.name + "_e%s_s%s" % (epoch, global_step),\n            epoch,\n            hps.version,\n            hps,\n        )\n'''
        source = source[:insertion_point] + injection + source[insertion_point:]
        changed = True

    if not changed:
        return False
    temporary = train_script.with_name(f".{train_script.name}.digital-me.tmp")
    temporary.write_text(source, encoding="utf-8")
    os.replace(temporary, train_script)
    return True


def enable_cuda_performance_tuning(train_script: Path) -> bool:
    """Patch the pinned trainer with opt-in Ampere/Ada throughput settings."""
    source = train_script.read_text(encoding="utf-8")
    if CUDA_PERFORMANCE_PATCH_MARKER in source:
        return False
    benchmark_line = "torch.backends.cudnn.benchmark = False\n"
    if benchmark_line not in source:
        raise RuntimeError("Pinned RVC cuDNN configuration was not found; refusing an unsafe performance patch.")
    performance_block = (
        f"{CUDA_PERFORMANCE_PATCH_MARKER}\n"
        "if os.environ.get('DIGITAL_ME_CUDA_PERFORMANCE') == '1':\n"
        "    torch.backends.cudnn.benchmark = True\n"
        "    torch.backends.cuda.matmul.allow_tf32 = True\n"
        "    torch.backends.cudnn.allow_tf32 = True\n"
        "    torch.set_float32_matmul_precision('high')\n"
    )
    source = source.replace(benchmark_line, benchmark_line + performance_block, 1)
    worker_line = "        num_workers=4,\n"
    if worker_line not in source:
        raise RuntimeError("Pinned RVC DataLoader worker setting was not found; refusing an unsafe performance patch.")
    source = source.replace(
        worker_line,
        "        num_workers=int(os.environ.get('DIGITAL_ME_DATALOADER_WORKERS', '4')),\n",
        1,
    )
    temporary = train_script.with_name(f".{train_script.name}.digital-me-performance.tmp")
    temporary.write_text(source, encoding="utf-8")
    os.replace(temporary, train_script)
    return True


class EpochCheckpointTracker:
    def __init__(self, experiment_dir: Path, weights_root: Path, experiment: str) -> None:
        self.experiment_dir = experiment_dir
        self.weights_root = weights_root
        # Upstream RVC's compact-checkpoint writer assumes this directory
        # already exists. Fresh cloud bundles do not contain empty folders, so
        # create it before the trainer can attempt its first epoch export.
        self.weights_root.mkdir(parents=True, exist_ok=True)
        self.experiment = experiment
        self.score_path = experiment_dir / "digital_me_epoch_scores.jsonl"
        self.latest_path = weights_root / f"{experiment}_latest.pth"
        self.best_path = weights_root / f"{experiment}_best.pth"
        self.metrics_path = experiment_dir / "checkpoint_metrics.json"
        self.position = 0
        self.epoch_scores: dict[int, float] = {}
        self.epoch_counts: dict[int, int] = {}
        self.pending_epochs: set[int] = set()
        self.processed_epochs: set[int] = set()
        self.history: list[dict[str, object]] = []
        self.best_epoch: int | None = None
        self.best_score: float | None = None
        self.latest_epoch: int | None = None
        self.error: Exception | None = None
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        self.thread = threading.Thread(target=self._watch, daemon=True, name="rvc-checkpoint-selector")
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=15)
        try:
            self.poll_once()
        except Exception as error:
            if self.error is None:
                self.error = error
        if self.pending_epochs.issubset(self.processed_epochs):
            self.error = None

    def _watch(self) -> None:
        try:
            while not self.stop_event.wait(0.75):
                self.poll_once()
        except Exception as error:
            self.error = error

    def poll_once(self) -> None:
        if not self.score_path.is_file():
            return
        with self.score_path.open("r", encoding="utf-8", errors="replace") as handle:
            handle.seek(self.position)
            while True:
                line = handle.readline()
                if not line:
                    break
                parts = line.strip().split("\t")
                if len(parts) != 3:
                    continue
                epoch, score, count = int(parts[0]), float(parts[1]), int(parts[2])
                self.epoch_scores[epoch] = score
                self.epoch_counts[epoch] = count
                self.pending_epochs.add(epoch)
            self.position = handle.tell()
        self._publish_ready_epochs()

    def _publish_ready_epochs(self) -> None:
        for epoch in sorted(self.pending_epochs):
            if epoch in self.processed_epochs:
                continue
            count = self.epoch_counts.get(epoch, 0)
            snapshots = list(self.weights_root.glob(f"{self.experiment}_e{epoch}_s*.pth"))
            if count < 1 or not snapshots:
                continue
            snapshot = max(snapshots, key=lambda item: item.stat().st_mtime_ns)
            score = self.epoch_scores[epoch]
            improved = self.best_score is None or score < self.best_score
            try:
                self._atomic_copy_checkpoint(snapshot, self.latest_path)
                if improved:
                    self._atomic_copy_checkpoint(snapshot, self.best_path)
            except PermissionError:
                # On Windows torch.save can hold the snapshot briefly after the
                # epoch score appears. Leave it pending and try again next poll.
                continue
            if improved:
                self.best_score = score
                self.best_epoch = epoch
            self.latest_epoch = epoch
            self.history.append({"epoch": epoch, "score": score, "samples": count, "best": improved})
            self.processed_epochs.add(epoch)
            self._write_metrics()
            self._remove_snapshot(snapshot)
            label = "best + latest" if improved else "latest"
            print(f"[rvc-train] Epoch {epoch}: saved {label} ({SELECTION_METRIC}={score:.6f}).", flush=True)

    @staticmethod
    def _atomic_copy_checkpoint(source: Path, destination: Path) -> None:
        last_error: OSError | None = None
        for attempt in range(20):
            temporary = destination.with_name(f".{destination.name}.{os.getpid()}.{threading.get_ident()}.tmp")
            try:
                before = source.stat()
                shutil.copy2(source, temporary)
                after = source.stat()
                copied = temporary.stat()
                if before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns or copied.st_size != after.st_size:
                    raise PermissionError(f"Checkpoint changed while it was copied: {source}")
                os.replace(temporary, destination)
                return
            except OSError as error:
                last_error = error
                temporary.unlink(missing_ok=True)
                if attempt < 19:
                    time.sleep(0.25)
        raise PermissionError(f"Checkpoint remained locked: {source}") from last_error

    @staticmethod
    def _remove_snapshot(snapshot: Path) -> None:
        for attempt in range(8):
            try:
                snapshot.unlink(missing_ok=True)
                return
            except PermissionError:
                if attempt < 7:
                    time.sleep(0.25)

    def _write_metrics(self) -> None:
        atomic_json(self.metrics_path, self.selection())

    def selection(self) -> dict[str, object]:
        return {
            "metric": SELECTION_METRIC,
            "lowerIsBetter": True,
            "bestEpoch": self.best_epoch,
            "bestScore": self.best_score,
            "latestEpoch": self.latest_epoch,
            "history": self.history,
        }


def prepare_filelist(rvc_root: Path, experiment: str, learning_rate_scale: float = 1.0) -> None:
    exp_dir = rvc_root / "logs" / experiment
    gt_wavs = exp_dir / "0_gt_wavs"
    features = exp_dir / "3_feature768"
    f0 = exp_dir / "2a_f0"
    f0_nsf = exp_dir / "2b-f0nsf"

    names = (
        {item.stem for item in gt_wavs.glob("*.wav")}
        & {item.stem for item in features.glob("*.npy")}
        & {item.name.removesuffix(".wav.npy") for item in f0.glob("*.wav.npy")}
        & {item.name.removesuffix(".wav.npy") for item in f0_nsf.glob("*.wav.npy")}
    )
    if not names:
        raise RuntimeError("Preprocessing produced no matching WAV, HuBERT, and F0 records.")

    def p(value: Path) -> str:
        return value.resolve().as_posix()

    records = [
        "|".join(
            [
                p(gt_wavs / f"{name}.wav"),
                p(features / f"{name}.npy"),
                p(f0 / f"{name}.wav.npy"),
                p(f0_nsf / f"{name}.wav.npy"),
                "0",
            ]
        )
        for name in sorted(names)
    ]

    mute = rvc_root / "logs" / "mute"
    mute_record = [
        mute / "0_gt_wavs" / "mute40k.wav",
        mute / "3_feature768" / "mute.npy",
        mute / "2a_f0" / "mute.wav.npy",
        mute / "2b-f0nsf" / "mute.wav.npy",
    ]
    if all(item.is_file() for item in mute_record):
        records.extend(["|".join([*(p(item) for item in mute_record), "0"])] * 2)

    (exp_dir / "filelist.txt").write_text("\n".join(records), encoding="utf-8")
    config_source = rvc_root / "configs" / "v1" / "40k.json"
    if not config_source.is_file():
        raise FileNotFoundError(f"RVC config is missing: {config_source}")
    config = json.loads(config_source.read_text(encoding="utf-8"))
    base_learning_rate = float(config["train"]["learning_rate"])
    config["train"]["learning_rate"] = base_learning_rate * learning_rate_scale
    atomic_json(exp_dir / "config.json", config)
    print(
        f"[rvc-train] Prepared {len(records)} training records "
        f"(learning rate {config['train']['learning_rate']:.8f}).",
        flush=True,
    )


def prepare_finetune_generator(base_pretrained: Path, selected_model: Path, destination: Path) -> dict[str, int]:
    """Merge a compact RVC inference model into a full generator checkpoint.

    Exported best/latest models intentionally omit training-only generator keys
    such as enc_q. The generic pretrained generator supplies those missing keys,
    while every compatible selected voice weight replaces its generic value.
    The result is a complete generator warm start accepted by the pinned trainer.
    """
    import torch

    def load_checkpoint(path: Path) -> dict[str, object]:
        try:
            payload = torch.load(path, map_location="cpu", weights_only=True)
        except TypeError:
            payload = torch.load(path, map_location="cpu")
        if not isinstance(payload, dict):
            raise ValueError(f"Checkpoint is not a dictionary: {path}")
        return payload

    base_payload = load_checkpoint(base_pretrained)
    selected_payload = load_checkpoint(selected_model)
    base_state = base_payload.get("model")
    selected_state = selected_payload.get("weight", selected_payload.get("model"))
    if not isinstance(base_state, dict) or not isinstance(selected_state, dict):
        raise ValueError("Fine-tune checkpoints are missing generator weights.")

    selected_version = str(selected_payload.get("version", "v2"))
    selected_rate = str(selected_payload.get("sr", "40k"))
    selected_f0 = int(selected_payload.get("f0", 1))
    if selected_version != "v2" or selected_rate != "40k" or selected_f0 != 1:
        raise ValueError("Fine-tuning requires an RVC v2 40k F0 model.")

    merged = dict(base_state)
    matched = 0
    mismatched = 0
    for key, value in selected_state.items():
        base_value = merged.get(key)
        if base_value is not None and hasattr(value, "shape") and value.shape == base_value.shape:
            merged[key] = value
            matched += 1
        else:
            mismatched += 1
    if matched < 100:
        raise ValueError(f"Selected model is incompatible: only {matched} generator tensors matched.")

    destination.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model": merged}, destination)
    print(
        f"[rvc-train] Fine-tune warm start prepared from {selected_model.name}: "
        f"{matched} tensors loaded, {mismatched} incompatible tensors skipped.",
        flush=True,
    )
    return {"matched": matched, "mismatched": mismatched}


def newest(paths: list[Path]) -> Path | None:
    existing = [item for item in paths if item.is_file()]
    return max(existing, key=lambda item: item.stat().st_mtime) if existing else None


def main() -> int:
    args = parse_args()
    if not args.experiment.replace("_", "").isalnum():
        raise ValueError("Experiment names may contain only letters, numbers, and underscores.")
    if not 1 <= args.epochs <= 1200:
        raise ValueError("epochs must be between 1 and 1200")
    if not 1 <= args.batch_size <= 64:
        raise ValueError("batch-size must be between 1 and 64")
    if not 0.01 <= args.learning_rate_scale <= 1.0:
        raise ValueError("learning-rate-scale must be between 0.01 and 1.0")
    if args.training_mode == "finetune" and not args.base_model:
        raise ValueError("Fine-tune mode requires --base-model")
    if args.training_mode == "fresh" and args.base_model:
        raise ValueError("Fresh mode cannot use --base-model")

    rvc_root = Path(args.rvc_root).resolve()
    dataset = Path(args.dataset).resolve()
    result_path = Path(args.result_json).resolve()
    if not dataset.is_dir() or not any(dataset.glob("*.wav")):
        raise FileNotFoundError(f"No WAV files found in dataset: {dataset}")
    required = [
        rvc_root / "train" / "preprocess.py",
        rvc_root / "train" / "dataset" / "extract_f0.py",
        rvc_root / "train" / "dataset" / "extract_hubert_feature.py",
        rvc_root / "train" / "train.py",
        rvc_root / "train" / "train_index.py",
        rvc_root / "assets" / "pretrained_v2" / "f0G40k.pth",
        rvc_root / "assets" / "pretrained_v2" / "f0D40k.pth",
    ]
    missing = [str(item) for item in required if not item.exists()]
    if missing:
        raise FileNotFoundError("RVC installation is incomplete: " + ", ".join(missing))
    enable_epoch_weight_exports(rvc_root / "train" / "train.py")
    enable_cuda_performance_tuning(rvc_root / "train" / "train.py")

    exp_dir = rvc_root / "logs" / args.experiment
    if exp_dir.exists():
        raise FileExistsError(f"Experiment directory already exists: {exp_dir}")
    exp_dir.mkdir(parents=True)
    python = sys.executable

    run(
        [python, "-m", "train.preprocess", str(dataset), "40000", str(args.workers), str(exp_dir), "False", "3.7"],
        rvc_root,
    )
    run(
        [python, "-m", "train.dataset.extract_f0", "cuda", "1", "0", "0", str(exp_dir), "true"],
        rvc_root,
    )
    run(
        [python, "-m", "train.dataset.extract_hubert_feature", "cuda:0", "1", "0", "0", str(exp_dir), "v2", "true"],
        rvc_root,
    )
    prepare_filelist(rvc_root, args.experiment, args.learning_rate_scale)

    generator_pretrain = rvc_root / "assets" / "pretrained_v2" / "f0G40k.pth"
    if args.training_mode == "finetune":
        selected_model = Path(args.base_model).resolve()
        if not selected_model.is_file():
            raise FileNotFoundError(f"Selected fine-tune model was not found: {selected_model}")
        generator_pretrain = exp_dir / "digital_me_finetune_G.pth"
        prepare_finetune_generator(
            rvc_root / "assets" / "pretrained_v2" / "f0G40k.pth",
            selected_model,
            generator_pretrain,
        )

    weights_root = rvc_root / "assets" / "weights"
    indices_root = rvc_root / "assets" / "indices"
    indices_root.mkdir(parents=True, exist_ok=True)
    tracker = EpochCheckpointTracker(exp_dir, weights_root, args.experiment)
    tracker.start()
    stopped_early = False
    stopped_epoch: int | None = None
    try:
        stopped_early, stopped_epoch = run_training(
            [
            python,
            "-m", "train.train",
            "-e", args.experiment,
            "-sr", "40k",
            "-f0", "1",
            "-bs", str(args.batch_size),
            "-g", "0",
            "-te", str(args.epochs),
            "-se", str(args.save_every),
            "-pg", str(generator_pretrain),
            "-pd", "assets/pretrained_v2/f0D40k.pth",
            "-l", "1",
            "-c", "0",
            "-sw", "1",
            "-v", "v2",
            ],
            rvc_root,
            tracker,
            Path(args.stop_request_file).resolve() if args.stop_request_file else None,
            {"DIGITAL_ME_ROLLING_EPOCH_WEIGHTS": "1"},
        )
    finally:
        tracker.stop()
    if tracker.error:
        raise RuntimeError(f"Checkpoint selector failed: {tracker.error}") from tracker.error
    if not tracker.best_path.is_file() or not tracker.latest_path.is_file():
        raise FileNotFoundError(f"RVC did not produce rolling best/latest models for experiment {args.experiment}")
    selection = tracker.selection()

    run(
        [python, "-m", "train.train_index", args.experiment, "v2", "assets/indices", str(args.workers), "single"],
        rvc_root,
    )
    index_path = newest(list(exp_dir.glob("added_*.index")) + list((rvc_root / "assets" / "indices").glob(f"{args.experiment}_*added_*.index")))
    if index_path is None:
        raise FileNotFoundError("RVC index training completed without an added index file.")

    result = {
        "experiment": args.experiment,
        "modelPath": str(tracker.best_path.resolve()),
        "bestModelPath": str(tracker.best_path.resolve()),
        "latestModelPath": str(tracker.latest_path.resolve()),
        "checkpointMetricsPath": str(tracker.metrics_path.resolve()),
        "bestEpoch": selection["bestEpoch"],
        "bestScore": selection["bestScore"],
        "latestEpoch": selection["latestEpoch"],
        "selectionMetric": selection["metric"],
        "trainingMode": args.training_mode,
        "baseModelSelection": args.base_model_selection,
        "epochs": selection["latestEpoch"],
        "requestedEpochs": args.epochs,
        "stoppedEarly": stopped_early,
        "stoppedEpoch": stopped_epoch,
        "batchSize": args.batch_size,
        "workers": args.workers,
        "learningRateScale": args.learning_rate_scale,
        "indexPath": str(index_path.resolve()),
        "logDirectory": str(exp_dir.resolve()),
    }
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as error:
        print(f"[rvc-train] ERROR: {error}", file=sys.stderr, flush=True)
        raise
