"""Small, deterministic prosody planner for Thai/English Edge TTS source speech."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import random
import re


@dataclass(frozen=True)
class EdgeProsody:
    text: str
    style: str
    rate: str
    pitch: str
    volume: str
    speech_act: str
    variation_seed: str


def _read_number(value: str, suffix: str, fallback: int) -> int:
    match = re.fullmatch(rf"\s*([+-]?\d+)\s*{re.escape(suffix)}\s*", str(value or ""), re.IGNORECASE)
    return int(match.group(1)) if match else fallback


def _format_number(value: int, suffix: str) -> str:
    return f"{value:+d}{suffix}"


def _clamp(value: int, minimum: int, maximum: int) -> int:
    return min(maximum, max(minimum, value))


def _prepare_spoken_text(text: str, style: str) -> str:
    spoken = re.sub(r"\s+", " ", text).strip()
    spoken = re.sub(r"\.{3,}", "…", spoken)
    spoken = re.sub(r"\s*[/|]\s*", ", ", spoken)
    # A short pause after Thai conversational fillers sounds less like a screen reader.
    spoken = re.sub(
        r"^(เออ|อืม|อือ|โห|เฮ้ย|ห้ะ|ฮะ|ว่าไง|เดี๋ยว)(?![,，.!?…])\s*",
        r"\1, ",
        spoken,
        flags=re.IGNORECASE,
    )
    if style == "question" and not re.search(r"[?？]$", spoken):
        spoken = f"{spoken}?"
    elif style == "excited" and not re.search(r"[!！]$", spoken):
        spoken = f"{spoken}!"
    return spoken


def plan_edge_prosody(
    text: str,
    requested_tone: str = "",
    requested_action: str = "",
    speech_act: str = "",
    emotion: str = "",
    context: str = "",
    intensity: float = 0.45,
    pace: float = 1.0,
    energy: float = 0.5,
    variation: float = 0.35,
    variation_seed: str | int = "",
    base_rate: str = "-2%",
    base_pitch: str = "+0Hz",
    base_volume: str = "+0%",
) -> EdgeProsody:
    """Plan contextual expression plus bounded per-turn human variation."""
    lowered = text.lower().strip()
    context_lowered = context.lower().strip()
    tone = (emotion or requested_tone).lower().strip()
    action = requested_action.lower().strip()
    act = speech_act.lower().strip()
    if not act:
        if action == "answer":
            act = "answer"
        elif action == "ask" or re.search(r"[?？]$", lowered):
            act = "question"
        elif action in {"short_reaction", "joke"}:
            act = "acknowledgement"
        else:
            act = "statement"

    intensity = max(0.0, min(1.0, float(intensity)))
    pace = max(0.85, min(1.15, float(pace)))
    energy = max(0.0, min(1.0, float(energy)))
    variation = max(0.0, min(1.0, float(variation)))
    if variation_seed == "":
        variation_seed = hashlib.sha256(f"{lowered}|{tone}|{act}".encode("utf-8")).hexdigest()[:16]
    seed_text = str(variation_seed)
    randomizer = random.Random(seed_text)

    excited = bool(re.search(r"[!！]|555+|ฮ่า|เย่|โห|เฮ้ย|จริงดิ|let'?s go", lowered)) or tone in {
        "excited", "playful", "joke", "happy",
    }
    sad = bool(re.search(r"เศร้า|เสียใจ|เหนื่อย|ไม่ไหว|ท้อ|sad|sorry", lowered)) or tone in {
        "sad", "soft", "tired",
    }
    annoyed = bool(re.search(r"โกรธ|หงุดหงิด|แม่ง|เชี่ย|ชิบหาย|wtf", lowered)) or tone in {
        "angry", "annoyed", "frustrated",
    }
    question = bool(re.search(r"[?？]|(?:ไหม|มั้ย|ปะ|เหรอ|หรอ|อะไร|ไหน|ไง|ยัง)\s*$", lowered)) or tone in {
        "question", "curious",
    } or act == "question"
    reluctant = (
        act in {"reluctant", "hesitant"}
        or tone in {"reluctant", "hesitant"}
        or (
            lowered in {"เออ", "อือ", "อืม"}
            and bool(re.search(r"บอกแล้ว|ทำหาย|ผิด|ใช่ปะ|ใช่ไหม", context_lowered))
        )
    )
    agreement = act in {"agreement", "acknowledgement", "answer"} and lowered in {
        "เออ", "อือ", "อืม", "ใช่", "โอเค", "ได้", "จริง",
    }

    if reluctant:
        style, rate_delta, pitch_delta, volume_delta = "reluctant", -7, -5, -2
    elif excited:
        style, rate_delta, pitch_delta, volume_delta = "excited", 6, 6, 3
    elif sad:
        style, rate_delta, pitch_delta, volume_delta = "soft", -8, -6, -3
    elif annoyed:
        style, rate_delta, pitch_delta, volume_delta = "annoyed", 2, -3, 2
    elif question:
        style, rate_delta, pitch_delta, volume_delta = "question", 1, 6, 0
    elif agreement:
        style, rate_delta, pitch_delta, volume_delta = "agreement", 2, -1, -1
    else:
        style = "casual"
        rate_delta = 0
        pitch_delta = 0
        volume_delta = 0

    # Context determines the base style; the seed only adds small natural
    # differences so repeated words do not render as the same waveform.
    expression_scale = 0.65 + intensity * 0.7
    rate_delta = round(rate_delta * expression_scale + (pace - 1.0) * 100)
    pitch_delta = round(pitch_delta * expression_scale)
    volume_delta = round(volume_delta * expression_scale + (energy - 0.5) * 6)
    rate_delta += round(randomizer.uniform(-3.5, 3.5) * variation)
    pitch_delta += round(randomizer.uniform(-5.0, 5.0) * variation)
    volume_delta += round(randomizer.uniform(-2.0, 2.0) * variation)

    rate = _clamp(_read_number(base_rate, "%", -2) + rate_delta, -18, 12)
    pitch = _clamp(_read_number(base_pitch, "Hz", 0) + pitch_delta, -12, 12)
    volume = _clamp(_read_number(base_volume, "%", 0) + volume_delta, -10, 8)
    return EdgeProsody(
        text=_prepare_spoken_text(text, style),
        style=style,
        rate=_format_number(rate, "%"),
        pitch=_format_number(pitch, "Hz"),
        volume=_format_number(volume, "%"),
        speech_act=act,
        variation_seed=seed_text,
    )
