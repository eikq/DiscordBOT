"""Safely publish an already-saved RVC inference checkpoint.

Use this after intentionally stopping a longer training run at a known-good
checkpoint. The voice service must be stopped while this script updates state.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import time


SPEAKER_RE = re.compile(r"^\d{5,30}$")


def atomic_json(path: Path, payload: dict) -> None:
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--speaker-id", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--epoch", type=int)
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--best-checkpoint", type=Path)
    parser.add_argument("--latest-checkpoint", type=Path)
    parser.add_argument("--best-epoch", type=int)
    parser.add_argument("--latest-epoch", type=int)
    parser.add_argument("--best-score", type=float)
    parser.add_argument("--selection-metric", default="mean_generator_training_loss")
    parser.add_argument("--active-selection", choices=("best", "latest"), default="best")
    parser.add_argument("--checkpoint-metrics", type=Path)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--rvc-root", type=Path, required=True)
    parser.add_argument("--training-log", type=Path)
    parser.add_argument("--epoch-training-log", type=Path)
    args = parser.parse_args()

    if not SPEAKER_RE.fullmatch(args.speaker_id):
        raise ValueError("speaker ID must be numeric")
    best_epoch = args.best_epoch or args.epoch
    latest_epoch = args.latest_epoch or args.epoch
    if not best_epoch or best_epoch < 1 or not latest_epoch or latest_epoch < 1:
        raise ValueError("best and latest epochs must be positive")

    best_checkpoint_value = args.best_checkpoint or args.checkpoint
    if best_checkpoint_value is None:
        raise ValueError("a best checkpoint is required")
    best_checkpoint = best_checkpoint_value.resolve(strict=True)
    latest_checkpoint = (args.latest_checkpoint or best_checkpoint_value).resolve(strict=True)
    index = args.index.resolve(strict=True)
    data_root = args.data_root.resolve(strict=True)
    rvc_root = args.rvc_root.resolve(strict=True)
    state_path = data_root / "service_state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    job = state.get("jobs", {}).get(args.job_id)
    if not isinstance(job, dict) or str(job.get("speakerId")) != args.speaker_id:
        raise ValueError("job does not belong to the requested speaker")

    speaker_dir = data_root / "speakers" / args.speaker_id
    published = speaker_dir / "models" / args.job_id
    published.mkdir(parents=True, exist_ok=True)
    model_output = published / "model.pth"
    best_model_output = published / "best_model.pth"
    latest_model_output = published / "latest_model.pth"
    index_output = published / "model.index"
    shutil.copy2(best_checkpoint, best_model_output)
    shutil.copy2(latest_checkpoint, latest_model_output)
    active_checkpoint = latest_model_output if args.active_selection == "latest" else best_model_output
    shutil.copy2(active_checkpoint, model_output)
    shutil.copy2(index, index_output)
    if args.training_log and args.training_log.is_file():
        shutil.copy2(args.training_log, published / "training.log")
    if args.epoch_training_log and args.epoch_training_log.is_file():
        shutil.copy2(args.epoch_training_log, published / "epoch_training.log")
    if args.checkpoint_metrics and args.checkpoint_metrics.is_file():
        shutil.copy2(args.checkpoint_metrics, published / "checkpoint_metrics.json")

    local_model = rvc_root / "assets" / "weights" / f"dm_{args.speaker_id}.pth"
    local_index = rvc_root / "assets" / "indices" / f"dm_{args.speaker_id}.index"
    local_model.parent.mkdir(parents=True, exist_ok=True)
    local_index.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(model_output, local_model)
    shutil.copy2(index_output, local_index)

    now = int(time.time() * 1000)
    current = {
        "speakerId": args.speaker_id,
        "jobId": args.job_id,
        "modelPath": str(model_output.relative_to(speaker_dir)),
        "indexPath": str(index_output.relative_to(speaker_dir)),
        "trainedDurationSeconds": float(job.get("durationSeconds", 0)),
        "publishedAt": now,
        "rvcEpochs": latest_epoch,
        "publishedEpoch": latest_epoch if args.active_selection == "latest" else best_epoch,
        "activeModelSelection": args.active_selection,
        "bestModelPath": str(best_model_output.relative_to(speaker_dir)),
        "latestModelPath": str(latest_model_output.relative_to(speaker_dir)),
        "bestEpoch": best_epoch,
        "bestScore": args.best_score,
        "latestEpoch": latest_epoch,
        "selectionMetric": args.selection_metric,
        "trainingMode": job.get("trainingMode", "fresh"),
        "requestedEpochs": int(job.get("epochs", latest_epoch)),
    }
    atomic_json(speaker_dir / "current.json", current)

    job.update(
        status="ready",
        message=f"Recovered best epoch {best_epoch} and latest epoch {latest_epoch}; retrieval index built and model published.",
        finishedAt=now,
        publishedEpoch=best_epoch,
        bestEpoch=best_epoch,
        latestEpoch=latest_epoch,
        bestScore=args.best_score,
    )
    state.setdefault("speakers", {}).setdefault(args.speaker_id, {})["currentJobId"] = args.job_id
    atomic_json(state_path, state)

    print(json.dumps({
        "model": str(model_output),
        "modelSha256": sha256(model_output),
        "bestModel": str(best_model_output),
        "bestModelSha256": sha256(best_model_output),
        "latestModel": str(latest_model_output),
        "latestModelSha256": sha256(latest_model_output),
        "index": str(index_output),
        "indexSha256": sha256(index_output),
        "bestEpoch": best_epoch,
        "latestEpoch": latest_epoch,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
