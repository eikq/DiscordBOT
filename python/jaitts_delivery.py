"""Pure delivery helpers for the local JaiTTS service.

Kept separate from the CUDA service so selection, seed, and pace behavior can
be tested without loading the speech model.
"""

from __future__ import annotations

import hashlib
import math
import re
import threading
import time
from typing import Any


STYLE_ALIASES = {
    "agreement": "casual",
    "acknowledgement": "casual",
    "answer": "casual",
    "curious": "question",
    "happy": "excited",
    "playful": "excited",
    "joke": "excited",
    "sad": "soft",
    "tired": "soft",
    "reluctant": "soft",
    "hesitant": "soft",
    "angry": "annoyed",
    "frustrated": "annoyed",
}

# Calibrated from held-out Gam recordings. FlowTTS speed is inversely related
# to rendered duration, so styles that were too short use a smaller multiplier.
STYLE_SPEED_MULTIPLIERS = {
    "casual": 0.93,
    "excited": 0.93,
    # Held-out tests showed that slowing these styles distorted pitch contours
    # more than it helped timing. Keep their model-native duration prediction.
    "question": 1.0,
    "soft": 1.0,
    "annoyed": 0.93,
}

SYNTHESIS_PRESETS = {
    # Local RTX 4060 evaluation: NFE 12 retained 0.00 measured ASR CER and
    # scored highest of the tested settings against the Gam WavLM centroid.
    "realtime": {"steps": 12, "cfgStrength": 2.0},
    "balanced": {"steps": 16, "cfgStrength": 1.5},
    "quality": {"steps": 32, "cfgStrength": 2.5},
}


class CancellationRegistry:
    """Small thread-safe TTL registry for stale voice-chat turns."""

    def __init__(self, ttl_seconds: float = 300.0) -> None:
        self.ttl_seconds = max(10.0, float(ttl_seconds))
        self._cancelled: dict[str, float] = {}
        self._lock = threading.Lock()

    def cancel(self, turn_id: Any) -> bool:
        normalized = str(turn_id or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", normalized):
            return False
        with self._lock:
            self._prune_locked()
            self._cancelled[normalized] = time.monotonic()
        return True

    def is_cancelled(self, turn_id: Any) -> bool:
        normalized = str(turn_id or "").strip()
        if not normalized:
            return False
        with self._lock:
            self._prune_locked()
            return normalized in self._cancelled

    def forget(self, turn_id: Any) -> None:
        with self._lock:
            self._cancelled.pop(str(turn_id or "").strip(), None)

    def _prune_locked(self) -> None:
        cutoff = time.monotonic() - self.ttl_seconds
        expired = [turn_id for turn_id, timestamp in self._cancelled.items() if timestamp < cutoff]
        for turn_id in expired:
            self._cancelled.pop(turn_id, None)


def synthesis_settings(
    preset: Any,
    default_steps: int,
    default_cfg_strength: float,
    requested_steps: Any = None,
    requested_cfg_strength: Any = None,
    allow_overrides: bool = False,
) -> dict[str, float | int | str]:
    """Resolve safe named presets; raw controls are evaluator-only."""
    normalized = str(preset or "default").strip().lower()
    if normalized in SYNTHESIS_PRESETS:
        selected = SYNTHESIS_PRESETS[normalized]
        steps = int(selected["steps"])
        cfg_strength = float(selected["cfgStrength"])
    else:
        normalized = "default"
        steps = int(default_steps)
        cfg_strength = float(default_cfg_strength)

    if allow_overrides and requested_steps is not None:
        try:
            steps = int(requested_steps)
        except (TypeError, ValueError):
            pass
    if allow_overrides and requested_cfg_strength is not None:
        try:
            cfg_strength = float(requested_cfg_strength)
        except (TypeError, ValueError):
            pass
    return {
        "preset": normalized,
        "steps": max(8, min(64, steps)),
        "cfgStrength": max(1.0, min(4.0, cfg_strength)),
    }


def normalize_style(value: Any) -> str:
    style = str(value or "casual").strip().lower()
    return STYLE_ALIASES.get(style, style or "casual")


def seed_from_variation(value: Any, style: Any = "") -> int:
    """Return a stable FlowTTS-compatible seed for one requested variation.

    Question and soft delivery are especially sensitive to FlowTTS noise. Keep
    those on the validated seed while broader casual/excited turns retain
    natural per-turn variation. A fixed seed prefix is available to the local
    authenticated evaluator, which lets new safe seeds be qualified later.
    """
    seed_text = str(value)
    if seed_text.startswith("fixed:"):
        try:
            return max(0, min(4_294_967_294, int(seed_text[6:])))
        except ValueError:
            pass
    if normalize_style(style) in {"question", "soft"}:
        return 42
    digest = hashlib.sha256(seed_text.encode("utf-8")).digest()
    # random.randrange in FlowTTS uses this same unsigned 32-bit range.
    return int.from_bytes(digest[:4], "big") % 4_294_967_295


def calibrated_speed(default_speed: float, style: Any, requested_pace: Any = 1.0) -> float:
    normalized = normalize_style(style)
    try:
        pace = float(requested_pace)
    except (TypeError, ValueError):
        pace = 1.0
    pace = max(0.85, min(1.15, pace))
    multiplier = STYLE_SPEED_MULTIPLIERS.get(normalized, STYLE_SPEED_MULTIPLIERS["casual"])
    return max(0.52, min(1.15, float(default_speed) * multiplier * pace))


def spoken_character_count(text: Any) -> int:
    # Ignore punctuation and whitespace because they do not represent phonemes.
    return max(1, len(re.sub(r"[^A-Za-z0-9\u0E00-\u0E7F]", "", str(text or ""))))


def choose_reference(
    references: list[dict[str, Any]],
    requested_style: Any,
    target_text: Any,
    variation_seed: Any,
) -> dict[str, Any]:
    """Choose a safe style match, then a similarly sized approved prompt.

    Seeds only break near-ties. They never make a casual request jump to an
    unrelated expressive prompt, and they never select an unapproved entry.
    """
    usable = [
        item for item in references
        if item.get("enabled", True) is not False
        and item.get("approvedForPilot", False) is True
        and str(item.get("text") or "").strip()
    ]
    if not usable:
        raise ValueError("no approved JaiTTS references are available")

    style = normalize_style(requested_style)
    matching = [item for item in usable if normalize_style(item.get("style")) == style]
    if not matching:
        matching = [item for item in usable if normalize_style(item.get("style")) == "casual"]
    if not matching:
        matching = usable

    target_length = spoken_character_count(target_text)

    def score(item: dict[str, Any]) -> float:
        reference_length = spoken_character_count(item.get("text"))
        length_difference = abs(math.log((reference_length + 4) / (target_length + 4)))
        try:
            priority = max(-2.0, min(2.0, float(item.get("selectionPriority", 0.0))))
        except (TypeError, ValueError):
            priority = 0.0
        delivery_penalty = 0.0
        if style == "question":
            try:
                tail = float(item.get("tailPitchDeltaSemitones"))
                if tail < 0:
                    delivery_penalty += min(0.45, abs(tail) * 0.1)
            except (TypeError, ValueError):
                pass
        elif style == "excited":
            try:
                span = float(item.get("pitchSpanSemitones"))
                if span < 6.0:
                    delivery_penalty += min(0.35, (6.0 - span) * 0.08)
            except (TypeError, ValueError):
                pass
        return length_difference + delivery_penalty - priority * 0.08

    ranked = sorted(matching, key=lambda item: (score(item), str(item.get("id") or "")))
    best_score = score(ranked[0])
    near_ties = [item for item in ranked if score(item) <= best_score + 0.12][:3]
    selector = seed_from_variation(f"reference|{variation_seed}")
    return near_ties[selector % len(near_ties)]
