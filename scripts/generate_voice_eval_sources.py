"""Generate the fixed Edge-TTS source set used for local voice-model checks."""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

import edge_tts


TEST_SENTENCES = {
    "thai": "สวัสดีแกม วันนี้เล่นเกมอะไรกันดี เพิ่มมูฟสปีดแล้ววิ่งเร็วขึ้นเยอะเลย",
    "mixed": "เดี๋ยวรอคูลดาวน์ก่อน แล้วค่อยเพิ่ม move speed วิ่งเข้าไปพร้อมกัน",
    "english": "Hey everyone, are you ready? Let's play one more game tonight.",
}


async def generate(output_dir: Path, voice: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    await asyncio.gather(
        *(
            edge_tts.Communicate(text, voice).save(str(output_dir / f"source_{name}.mp3"))
            for name, text in TEST_SENTENCES.items()
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--voice", default="th-TH-NiwatNeural")
    args = parser.parse_args()
    asyncio.run(generate(args.output_dir, args.voice))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
