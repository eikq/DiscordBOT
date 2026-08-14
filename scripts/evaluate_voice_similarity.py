"""Compare generated speech with clean reference recordings using WavLM x-vectors.

This is an evaluation helper, not part of the live Discord path. It reports
speaker similarity together with basic audio-health measurements so a high
embedding score cannot hide clipping or near-silent output.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import torch
import torchaudio
from transformers import AutoFeatureExtractor, WavLMForXVector


SAMPLE_RATE = 16_000


def load_mono(path: Path) -> torch.Tensor:
    audio, sample_rate = torchaudio.load(str(path))
    audio = audio.mean(dim=0)
    if sample_rate != SAMPLE_RATE:
        audio = torchaudio.functional.resample(audio, sample_rate, SAMPLE_RATE)
    return audio.float()


def audio_metrics(audio: torch.Tensor) -> dict[str, float]:
    if audio.numel() == 0:
        raise ValueError("audio is empty")
    peak = float(audio.abs().max())
    rms = float(torch.sqrt(torch.mean(audio.square()) + 1e-12))
    return {
        "durationSeconds": round(audio.numel() / SAMPLE_RATE, 3),
        "peak": round(peak, 6),
        "rmsDbfs": round(20 * math.log10(max(rms, 1e-12)), 3),
        "clippedPercent": round(float((audio.abs() >= 0.999).float().mean()) * 100, 5),
        "nearSilentPercent": round(float((audio.abs() < 0.002).float().mean()) * 100, 3),
    }


def cosine(left: torch.Tensor, right: torch.Tensor) -> float:
    return float(torch.nn.functional.cosine_similarity(left, right, dim=0))


def embed(
    audio: torch.Tensor,
    feature_extractor: AutoFeatureExtractor,
    model: WavLMForXVector,
    device: torch.device,
) -> torch.Tensor:
    # Long Discord utterances are center-cropped to keep evaluation predictable.
    max_samples = SAMPLE_RATE * 12
    if audio.numel() > max_samples:
        offset = (audio.numel() - max_samples) // 2
        audio = audio[offset : offset + max_samples]
    inputs = feature_extractor(
        audio.numpy(),
        sampling_rate=SAMPLE_RATE,
        return_tensors="pt",
        padding=True,
    )
    inputs = {name: value.to(device) for name, value in inputs.items()}
    with torch.inference_mode():
        vector = model(**inputs).embeddings[0]
    return torch.nn.functional.normalize(vector.float().cpu(), dim=0)


def select_references(reference_dir: Path, maximum: int) -> list[tuple[Path, torch.Tensor, dict[str, float]]]:
    candidates: list[tuple[Path, torch.Tensor, dict[str, float]]] = []
    for path in sorted(reference_dir.glob("*.wav")):
        try:
            audio = load_mono(path)
            metrics = audio_metrics(audio)
        except Exception:
            continue
        if not 2.5 <= metrics["durationSeconds"] <= 12.0:
            continue
        if metrics["rmsDbfs"] < -42 or metrics["clippedPercent"] > 0.1:
            continue
        candidates.append((path, audio, metrics))
    # Prefer longer, information-rich utterances while sampling across the session.
    candidates.sort(key=lambda item: item[2]["durationSeconds"], reverse=True)
    if len(candidates) <= maximum:
        return candidates
    stride = len(candidates) / maximum
    return [candidates[min(int(index * stride), len(candidates) - 1)] for index in range(maximum)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-dir", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, action="append", required=True)
    parser.add_argument("--reference-count", type=int, default=12)
    parser.add_argument("--model", default="microsoft/wavlm-base-plus-sv")
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    device = torch.device(args.device if args.device == "cpu" or torch.cuda.is_available() else "cpu")
    references = select_references(args.reference_dir, args.reference_count)
    if len(references) < 3:
        raise RuntimeError(f"Need at least 3 clean reference WAVs; found {len(references)}")

    extractor = AutoFeatureExtractor.from_pretrained(args.model)
    model = WavLMForXVector.from_pretrained(args.model).to(device).eval()
    reference_vectors = [embed(audio, extractor, model, device) for _, audio, _ in references]
    centroid = torch.nn.functional.normalize(torch.stack(reference_vectors).mean(dim=0), dim=0)

    reference_similarities: list[float] = []
    for index, vector in enumerate(reference_vectors):
        others = reference_vectors[:index] + reference_vectors[index + 1 :]
        other_centroid = torch.nn.functional.normalize(torch.stack(others).mean(dim=0), dim=0)
        reference_similarities.append(cosine(vector, other_centroid))

    candidates = []
    for path in args.candidate:
        audio = load_mono(path)
        candidates.append(
            {
                "path": str(path.resolve()),
                "similarityToGamCentroid": round(cosine(embed(audio, extractor, model, device), centroid), 5),
                "audio": audio_metrics(audio),
            }
        )

    result = {
        "embeddingModel": args.model,
        "device": str(device),
        "referenceCount": len(references),
        "references": [str(path.resolve()) for path, _, _ in references],
        "referenceLeaveOneOut": {
            "minimum": round(min(reference_similarities), 5),
            "mean": round(sum(reference_similarities) / len(reference_similarities), 5),
            "maximum": round(max(reference_similarities), 5),
        },
        "candidates": candidates,
    }
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
