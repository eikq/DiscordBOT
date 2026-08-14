"""Replay fixed voice-evaluation clips through the local STT endpoint."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import urllib.request

import librosa
import numpy as np

from generate_voice_eval_sources import TEST_SENTENCES


def normalized(value: str) -> str:
    return re.sub(r"[^0-9a-zก-๙]+", "", value.casefold())


def edit_distance(left: str, right: str) -> int:
    previous = list(range(len(right) + 1))
    for left_index, left_char in enumerate(left, start=1):
        current = [left_index]
        for right_index, right_char in enumerate(right, start=1):
            current.append(min(
                current[-1] + 1,
                previous[right_index] + 1,
                previous[right_index - 1] + (left_char != right_char),
            ))
        previous = current
    return previous[-1]


def pcm_48k_stereo(path: Path) -> bytes:
    mono, _sample_rate = librosa.load(str(path), sr=48_000, mono=True)
    stereo = np.repeat(np.clip(mono, -1, 1)[:, None], 2, axis=1)
    return np.rint(stereo * 32767).astype("<i2", copy=False).tobytes()


def transcribe(url: str, path: Path) -> dict:
    request = urllib.request.Request(
        url.rstrip("/") + "/transcribe",
        data=pcm_48k_stereo(path),
        headers={"Content-Type": "application/octet-stream"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--stt-url", default="http://127.0.0.1:8765")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    results = []
    for kind in ("thai", "mixed", "english"):
        expected = TEST_SENTENCES[kind]
        paths = [
            args.directory / f"source_{kind}.mp3",
            *sorted(args.directory.glob(f"gam_epoch*_{kind}.wav")),
        ]
        for path in paths:
            if not path.is_file():
                continue
            response = transcribe(args.stt_url, path)
            actual = str(response.get("text") or "")
            expected_norm = normalized(expected)
            actual_norm = normalized(actual)
            distance = edit_distance(expected_norm, actual_norm)
            results.append({
                "kind": kind,
                "path": str(path.resolve()),
                "expected": expected,
                "transcript": actual,
                "characterErrorRate": round(distance / max(len(expected_norm), 1), 5),
                "model": response.get("model"),
                "language": response.get("language"),
            })

    rendered = json.dumps(results, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
