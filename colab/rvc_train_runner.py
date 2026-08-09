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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rvc-root", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--experiment", required=True)
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--save-every", type=int, default=25)
    parser.add_argument("--result-json", required=True)
    return parser.parse_args()


def run(command: list[str], cwd: Path) -> None:
    printable = " ".join(command)
    print(f"[rvc-train] $ {printable}", flush=True)
    process = subprocess.Popen(
        command,
        cwd=str(cwd),
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


def prepare_filelist(rvc_root: Path, experiment: str) -> None:
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
    shutil.copy2(config_source, exp_dir / "config.json")
    print(f"[rvc-train] Prepared {len(records)} training records.", flush=True)


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

    exp_dir = rvc_root / "logs" / args.experiment
    if exp_dir.exists():
        raise FileExistsError(f"Experiment directory already exists: {exp_dir}")
    exp_dir.mkdir(parents=True)
    python = sys.executable

    run(
        [python, "train/preprocess.py", str(dataset), "40000", str(args.workers), str(exp_dir), "False", "3.7"],
        rvc_root,
    )
    run(
        [python, "train/dataset/extract_f0.py", "cuda", "1", "0", "0", str(exp_dir), "true"],
        rvc_root,
    )
    run(
        [python, "train/dataset/extract_hubert_feature.py", "cuda:0", "1", "0", "0", str(exp_dir), "v2", "true"],
        rvc_root,
    )
    prepare_filelist(rvc_root, args.experiment)

    run(
        [
            python,
            "train/train.py",
            "-e", args.experiment,
            "-sr", "40k",
            "-f0", "1",
            "-bs", str(args.batch_size),
            "-g", "0",
            "-te", str(args.epochs),
            "-se", str(args.save_every),
            "-pg", "assets/pretrained_v2/f0G40k.pth",
            "-pd", "assets/pretrained_v2/f0D40k.pth",
            "-l", "1",
            "-c", "0",
            "-sw", "1",
            "-v", "v2",
        ],
        rvc_root,
    )

    model_path = rvc_root / "assets" / "weights" / f"{args.experiment}.pth"
    if not model_path.is_file():
        raise FileNotFoundError(f"RVC did not produce the expected inference model: {model_path}")

    run(
        [python, "train/train_index.py", args.experiment, "v2", "assets/indices", str(args.workers), "single"],
        rvc_root,
    )
    index_path = newest(list(exp_dir.glob("added_*.index")) + list((rvc_root / "assets" / "indices").glob(f"{args.experiment}_*added_*.index")))
    if index_path is None:
        raise FileNotFoundError("RVC index training completed without an added index file.")

    result = {
        "experiment": args.experiment,
        "modelPath": str(model_path.resolve()),
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
