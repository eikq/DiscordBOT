#!/usr/bin/env python3
"""Generate current cloned speech for stored utterances and compare each pair."""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
import statistics
import urllib.error
import urllib.request
from typing import Any

from compare_voice_prosody import analyze, compare


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SERVICE_URL = "http://127.0.0.1:8766"


def _mean(values: list[float]) -> float | None:
    finite = [value for value in values if math.isfinite(value)]
    return round(statistics.fmean(finite), 4) if finite else None


def load_utterance_index(speaker_id: str) -> dict[str, dict[str, Any]]:
    utterances: dict[str, dict[str, Any]] = {}
    for path in sorted((PROJECT_ROOT / "data" / "learning_sessions").glob("*.json")):
        try:
            session = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        target_id = str(session.get("targetUserId") or session.get("target", {}).get("userId") or "")
        if target_id and target_id != speaker_id:
            continue
        for item in session.get("utterances", []):
            if isinstance(item, dict) and item.get("id"):
                utterances[str(item["id"])] = {**item, "sessionFile": str(path.resolve())}
    return utterances


def resolve_audio(speaker_id: str, utterance_id: str) -> Path:
    candidates = (
        PROJECT_ROOT / "data" / "local_voice" / "speakers" / speaker_id / "samples" / f"{utterance_id}.wav",
        PROJECT_ROOT / "data" / "voice_samples" / speaker_id / f"{utterance_id}.wav",
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"Stored audio is missing for {utterance_id}")


def generate(
    service_url: str,
    token: str,
    speaker_id: str,
    text: str,
    style: str,
    model_selection: str,
    output: Path,
) -> dict[str, str]:
    speech_act = "question" if style == "question" else ""
    payload = {
        "speakerId": speaker_id,
        "text": text,
        "tone": style,
        "emotion": style,
        "speechAct": speech_act,
        "modelSelection": model_selection,
        "variation": 0.35,
        "variationSeed": f"paired-eval-{output.stem}",
    }
    request = urllib.request.Request(
        f"{service_url.rstrip('/')}/v1/generate",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            audio = response.read()
            headers = {key.lower(): value for key, value in response.headers.items() if key.lower().startswith("x-voice-")}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Voice service returned HTTP {error.code}: {detail}") from error
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(audio)
    return headers


def aggregate(rows: list[dict[str, Any]]) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[row["style"]].append(row)

    def metrics(items: list[dict[str, Any]]) -> dict[str, Any]:
        comparisons = [item["comparison"] for item in items]
        return {
            "pairCount": len(items),
            "meanDurationRatio": _mean([float(item["durationRatio"]) for item in comparisons if item.get("durationRatio") is not None]),
            "meanAbsoluteMedianPitchDeltaSemitones": _mean([abs(float(item["medianPitchDeltaSemitones"])) for item in comparisons if item.get("medianPitchDeltaSemitones") is not None]),
            "meanAbsolutePitchSpanDifferenceSemitones": _mean([abs(float(item["pitchSpanDifferenceSemitones"])) for item in comparisons if item.get("pitchSpanDifferenceSemitones") is not None]),
            "meanAbsoluteTailPitchDifferenceSemitones": _mean([abs(float(item["tailPitchDeltaDifferenceSemitones"])) for item in comparisons if item.get("tailPitchDeltaDifferenceSemitones") is not None]),
            "meanPitchContourCorrelation": _mean([float(item["normalizedPitchContourCorrelation"]) for item in comparisons if item.get("normalizedPitchContourCorrelation") is not None]),
            "meanAbsolutePauseCountDifference": _mean([abs(float(item["pauseCountDifference"])) for item in comparisons]),
        }

    return {
        "overall": metrics(rows),
        "byStyle": {style: metrics(items) for style, items in sorted(groups.items())},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--speaker-id", required=True)
    parser.add_argument("--sample-id", action="append", required=True)
    parser.add_argument("--model-selection", choices=("best", "latest"), default="best")
    parser.add_argument("--service-url", default=DEFAULT_SERVICE_URL)
    parser.add_argument("--token-file", type=Path, default=PROJECT_ROOT / ".runtime" / "voice_api_token")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    token = args.token_file.read_text(encoding="utf-8").strip()
    utterances = load_utterance_index(args.speaker_id)
    rows: list[dict[str, Any]] = []
    for index, utterance_id in enumerate(args.sample_id, start=1):
        utterance = utterances.get(utterance_id)
        if utterance is None:
            raise KeyError(f"Utterance {utterance_id} was not found in learning sessions")
        text = str(utterance.get("transcript") or "").strip()
        if not text:
            raise ValueError(f"Utterance {utterance_id} has no transcript")
        style = str(utterance.get("style") or "casual").lower()
        original = resolve_audio(args.speaker_id, utterance_id)
        generated = args.output_dir / f"{index:02d}_{style}_{utterance_id}_current-{args.model_selection}.wav"
        print(f"[{index}/{len(args.sample_id)}] {style}: {utterance_id}", flush=True)
        headers = generate(args.service_url, token, args.speaker_id, text, style, args.model_selection, generated)
        original_metrics, original_contour = analyze(original)
        generated_metrics, generated_contour = analyze(generated)
        comparison = compare(original_metrics, generated_metrics, original_contour, generated_contour)
        rows.append({
            "utteranceId": utterance_id,
            "style": style,
            "text": text,
            "storedTranscriptConfidence": utterance.get("transcriptConfidence"),
            "storedQualityScore": utterance.get("qualityScore"),
            "original": original_metrics,
            "generated": generated_metrics,
            "comparison": comparison,
            "responseHeaders": headers,
        })

    report = {
        "speakerId": args.speaker_id,
        "modelSelection": args.model_selection,
        "warning": "Stored ASR transcripts may contain errors; timing/prosody comparisons remain valid, but text-conditioned synthesis quality depends on corrected transcripts.",
        "aggregate": aggregate(rows),
        "pairs": rows,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.output_dir / "paired_prosody_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["aggregate"], ensure_ascii=False, indent=2), flush=True)
    print(f"Report: {report_path.resolve()}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
