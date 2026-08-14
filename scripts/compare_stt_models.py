#!/usr/bin/env python3
"""Compare a Qwen3-ASR checkpoint against saved Discord WAV utterances."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from qwen_asr import Qwen3ASRModel


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", nargs="+", type=Path)
    parser.add_argument("--model", default="Qwen/Qwen3-ASR-1.7B")
    parser.add_argument("--device", choices=("cpu", "cuda:0"), default="cpu")
    parser.add_argument("--language", default="Thai")
    parser.add_argument(
        "--context",
        default=(
            "Thai and English Discord gaming conversation. Common terms: Discord, "
            "Valorant, Minecraft, Roblox, movement speed, attack speed, min speed, "
            "กู, มึง, พี่, เล่น, เกม."
        ),
    )
    args = parser.parse_args()

    missing = [str(path) for path in args.audio if not path.is_file()]
    if missing:
        raise FileNotFoundError("Missing audio: " + ", ".join(missing))

    dtype = torch.bfloat16 if args.device.startswith("cuda") else torch.float32
    print(f"Loading {args.model} on {args.device}...", flush=True)
    model = Qwen3ASRModel.from_pretrained(
        args.model,
        dtype=dtype,
        device_map=args.device,
        max_inference_batch_size=1,
        max_new_tokens=256,
    )
    print("MODEL_READY", flush=True)
    for audio_path in args.audio:
        result = model.transcribe(
            audio=str(audio_path.resolve()),
            context=args.context,
            language=args.language,
        )[0]
        print(json.dumps({
            "file": str(audio_path),
            "language": getattr(result, "language", None),
            "text": str(getattr(result, "text", "")).strip(),
        # ASCII escapes keep Thai readable after log capture on Windows terminals
        # that otherwise reinterpret native-process output using a legacy code page.
        }, ensure_ascii=True), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
