#!/usr/bin/env python3
"""Run an isolated JaiTTS-F5TTS voice-cloning pilot with one reference clip."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time

import soundfile as sf
import torch
from huggingface_hub import hf_hub_download


PROJECT_ROOT = Path(__file__).resolve().parent.parent
THONBURIAN_ROOT = PROJECT_ROOT / ".runtime" / "thonburian-tts"
HF_HOME = PROJECT_ROOT / ".runtime" / "huggingface"


def read_reference_text(metadata_path: Path) -> str:
    payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    transcript = payload.get("transcript", {})
    text = transcript.get("text", "") if isinstance(transcript, dict) else str(transcript)
    text = str(text).strip()
    if not text:
        raise ValueError(f"Reference transcript is empty: {metadata_path}")
    return text


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--text", help="Text to synthesize; defaults to the reference transcript.")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=32)
    parser.add_argument("--speed", type=float, default=1.0)
    args = parser.parse_args()

    if not THONBURIAN_ROOT.is_dir():
        raise FileNotFoundError("ThonburianTTS runtime is missing; run the JaiTTS setup first.")
    sys.path.insert(0, str(THONBURIAN_ROOT))
    os.environ.setdefault("HF_HOME", str(HF_HOME))

    from flowtts.inference import AudioConfig, FlowTTSPipeline, ModelConfig

    checkpoint = hf_hub_download("JTS-AI/JaiTTS-F5TTS", "model.pt")
    vocabulary = hf_hub_download("JTS-AI/JaiTTS-F5TTS", "vocab.txt")
    reference_text = read_reference_text(args.metadata)
    generated_text = str(args.text or reference_text).strip()

    if not torch.cuda.is_available():
        raise RuntimeError("JaiTTS pilot requires CUDA on this computer.")
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    load_started = time.perf_counter()
    model_config = ModelConfig(
        language="th",
        model_type="F5",
        checkpoint=checkpoint,
        vocab_file=vocabulary,
        ode_method="euler",
        use_ema=True,
        vocoder="vocos",
        device="cuda",
        seed=42,
    )
    audio_config = AudioConfig(
        silence_threshold=-45,
        max_audio_length=20_000,
        cfg_strength=2.5,
        nfe_step=max(8, min(64, args.steps)),
        target_rms=0.1,
        cross_fade_duration=0.15,
        speed=max(0.75, min(1.25, args.speed)),
        min_silence_len=500,
        keep_silence=200,
        seek_step=10,
    )
    pipeline = FlowTTSPipeline(
        model_config=model_config,
        audio_config=audio_config,
        temp_dir=str(PROJECT_ROOT / ".runtime" / "jaitts-temp"),
    )
    load_seconds = time.perf_counter() - load_started

    args.output.parent.mkdir(parents=True, exist_ok=True)
    generation_started = time.perf_counter()
    pipeline(
        text=generated_text,
        ref_voice=str(args.reference.resolve()),
        ref_text=reference_text,
        output_file=str(args.output.resolve()),
        speed=audio_config.speed,
        check_duration=False,
    )
    generation_seconds = time.perf_counter() - generation_started
    output_info = sf.info(args.output)
    peak_vram_gb = torch.cuda.max_memory_allocated() / 1024 ** 3
    report = {
        "engine": "JTS-AI/JaiTTS-F5TTS",
        "reference": str(args.reference.resolve()),
        "referenceText": reference_text,
        "generatedText": generated_text,
        "output": str(args.output.resolve()),
        "steps": audio_config.nfe_step,
        "speed": audio_config.speed,
        "loadSeconds": round(load_seconds, 3),
        "generationSeconds": round(generation_seconds, 3),
        "outputDurationSeconds": round(output_info.duration, 3),
        "realTimeFactor": round(generation_seconds / max(output_info.duration, 0.001), 3),
        "peakAllocatedVramGb": round(peak_vram_gb, 3),
    }
    args.output.with_suffix(".json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
