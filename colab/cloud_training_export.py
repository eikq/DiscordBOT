#!/usr/bin/env python3
"""Create a non-destructive, self-contained RVC training bundle."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import tempfile
from typing import Any
import wave
import zipfile


EXPORT_SCHEMA_VERSION = 2
MIN_TRAINING_SECONDS = 120.0
RECOMMENDED_TRAINING_SECONDS = 900.0
TARGET_TRAINING_SECONDS = 1800.0
SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9_-]+")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as reader:
        sample_rate = reader.getframerate()
        return reader.getnframes() / sample_rate if sample_rate else 0.0


def normalize_export_options(payload: dict[str, Any]) -> dict[str, Any]:
    mode = str(payload.get("trainingMode") or "fresh").strip().lower()
    model_selection = str(payload.get("modelSelection") or "best").strip().lower()
    training_target = str(payload.get("trainingTarget") or "vast_24gb").strip().lower()
    if mode not in ("fresh", "finetune"):
        raise ValueError("trainingMode must be fresh or finetune")
    if model_selection not in ("best", "latest"):
        raise ValueError("modelSelection must be best or latest")
    if training_target not in ("vast_24gb", "laptop_4050_6gb"):
        raise ValueError("trainingTarget must be vast_24gb or laptop_4050_6gb")
    try:
        epochs = int(payload.get("epochs", 100))
    except (TypeError, ValueError) as error:
        raise ValueError("epochs must be a whole number between 1 and 1200") from error
    if isinstance(payload.get("epochs"), bool) or not 1 <= epochs <= 1200:
        raise ValueError("epochs must be a whole number between 1 and 1200")

    def enabled(name: str, default: bool) -> bool:
        value = payload.get(name, default)
        if not isinstance(value, bool):
            raise ValueError(f"{name} must be true or false")
        return value

    return {
        "trainingMode": mode,
        "modelSelection": model_selection,
        "trainingTarget": training_target,
        "epochs": epochs,
        "includeDataset": enabled("includeDataset", True),
        "includeTranscripts": enabled("includeTranscripts", True),
        "includeBestModel": enabled("includeBestModel", True),
        "includeLatestModel": enabled("includeLatestModel", True),
        "includeTrainingLogs": enabled("includeTrainingLogs", True),
        "includeTrainer": enabled("includeTrainer", True),
        "cleanAudio": enabled("cleanAudio", True),
        "excludeLowQuality": enabled("excludeLowQuality", True),
    }


def command_script_name(options: dict[str, Any]) -> str:
    epochs = int(options["epochs"])
    suffix = "_LAPTOP_4050.ps1" if options["trainingTarget"] == "laptop_4050_6gb" else ".sh"
    if options["trainingMode"] == "finetune":
        selection = str(options["modelSelection"]).upper()
        return f"RUN_FINETUNE_{selection}_{epochs}_EPOCHS{suffix}"
    return f"RUN_TRAIN_NEW_{epochs}_EPOCHS{suffix}"


def command_for(options: dict[str, Any]) -> str:
    script = command_script_name(options)
    if options["trainingTarget"] == "laptop_4050_6gb":
        return f'powershell -NoProfile -ExecutionPolicy Bypass -File ".\\{script}"'
    return f"bash {script}"


def _resolve_current_file(speaker_dir: Path, current: dict[str, Any], key: str) -> Path | None:
    value = current.get(key)
    if not isinstance(value, str) or not value.strip():
        return None
    relative = Path(value)
    root = speaker_dir.resolve()
    candidate = (root / relative).resolve()
    if relative.is_absolute() or not candidate.is_relative_to(root) or not candidate.is_file():
        return None
    return candidate


def preview_training_export(
    speaker_dir: Path,
    transcript_dir: Path,
    status: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any]:
    options = normalize_export_options(payload)
    current_path = speaker_dir / "current.json"
    try:
        current = json.loads(current_path.read_text(encoding="utf-8")) if current_path.is_file() else {}
    except Exception:
        current = {}
    best_model = _resolve_current_file(speaker_dir, current, "bestModelPath")
    latest_model = _resolve_current_file(speaker_dir, current, "latestModelPath")
    samples = sorted((speaker_dir / "samples").glob("*.wav"))
    transcripts = sum(1 for sample in samples if (transcript_dir / f"{sample.stem}.txt").is_file())
    duration = float(status.get("durationSeconds", 0.0))
    active_job = status.get("job") or {}

    blockers: list[str] = []
    warnings: list[str] = []
    recommendations: list[str] = []
    if not options["includeDataset"]:
        blockers.append("Dataset audio must be included for a trainable package.")
    elif not samples:
        blockers.append("No WAV recordings are available for this person.")
    elif duration < MIN_TRAINING_SECONDS:
        blockers.append(f"Only {duration:.1f}s of audio is available; collect at least {MIN_TRAINING_SECONDS:.0f}s before training.")
    elif duration < RECOMMENDED_TRAINING_SECONDS:
        warnings.append(f"The dataset has {duration / 60:.1f} minutes. Aim for 15-30 minutes of isolated speech for a stronger likeness.")
    elif duration < TARGET_TRAINING_SECONDS:
        recommendations.append("The dataset is trainable; continuing toward 30 minutes may improve coverage of natural tone and emotion.")
    else:
        recommendations.append("The dataset duration is in the recommended 15-30+ minute range.")

    if not options["includeTrainer"]:
        blockers.append("Include the setup and trainer files to use the guided training workflow.")
    if active_job.get("status") in ("queued", "training"):
        blockers.append("Wait for the current local training job to finish before exporting stable checkpoints.")
    if options["trainingMode"] == "finetune":
        if options["modelSelection"] == "best" and (not options["includeBestModel"] or best_model is None):
            blockers.append("Fine-tuning from Best requires the available Best model to be included.")
        if options["modelSelection"] == "latest" and (not options["includeLatestModel"] or latest_model is None):
            blockers.append("Fine-tuning from Latest requires the available Latest model to be included.")
        if options["epochs"] > 60:
            warnings.append("For a first fine-tune, 25-40 epochs is safer than a long 60+ epoch run.")
    elif options["epochs"] < 50:
        warnings.append("Fresh RVC training usually needs more than 50 epochs; 100 is a practical first comparison run.")

    if not options["cleanAudio"]:
        warnings.append("Audio cleanup is off. Background rumble, uneven volume, and long silence will remain in the cloud dataset.")
    else:
        recommendations.append("Safe cleanup will affect exported copies only; your original recordings stay unchanged.")
    if not options["excludeLowQuality"]:
        warnings.append("Basic quality filtering is off, so clipped, nearly silent, or unusably short clips may be exported.")
    if options["includeTranscripts"] and transcripts < len(samples):
        warnings.append(f"Only {transcripts} of {len(samples)} active clips have matching transcript text. RVC can still train without text.")
    if options["includeTranscripts"]:
        recommendations.append("Transcripts are useful for review and future intelligence training, but RVC voice training itself uses the audio.")
    recommendations.extend([
        "Listen to several random clips and remove recordings containing another speaker, music, game audio, echo, or severe distortion.",
        "Do not include the Discord token, .env file, or voice-service API token in a training package.",
    ])
    if options["trainingTarget"] == "laptop_4050_6gb":
        warnings.append("Laptop training will use most of the RTX 4050 while each batch is running. Keep the laptop plugged in and well cooled.")
        recommendations.extend([
            "The RTX 4050 6 GB profile uses batch 2, falls back to batch 1 on CUDA memory pressure, and limits data loading to 2 workers for 16 GB RAM.",
            "Stop the Discord bot voice/STT services and close GPU-heavy games before starting laptop training.",
            "Keep at least 20 GB of free disk space for the isolated Python environment, RVC assets, checkpoints, and results.",
        ])
    else:
        recommendations.extend([
            "Use one on-demand 24 GB GPU; the export auto-tunes RTX 3090/4090 batch size and falls back safely on CUDA memory pressure.",
            "Download the result archive before destroying the Vast.ai instance.",
        ])

    return {
        "ready": not blockers,
        "blockers": blockers,
        "warnings": warnings,
        "recommendations": recommendations,
        "summary": {
            "speakerId": status.get("speakerId"),
            "displayName": status.get("displayName"),
            "sampleCount": len(samples),
            "durationSeconds": round(duration, 3),
            "transcriptCount": transcripts,
            "bestModelAvailable": best_model is not None,
            "latestModelAvailable": latest_model is not None,
        },
        "options": options,
        "commandScript": command_script_name(options),
        "command": command_for(options),
    }


def _audio_metrics(audio: Any, sample_rate: int) -> dict[str, float]:
    import numpy as np

    values = np.asarray(audio, dtype=np.float32)
    duration = values.size / sample_rate if sample_rate else 0.0
    rms = float(np.sqrt(np.mean(np.square(values, dtype=np.float64)) + 1e-12)) if values.size else 0.0
    peak = float(np.max(np.abs(values))) if values.size else 0.0
    clipped = float(np.mean(np.abs(values) >= 0.999)) * 100 if values.size else 0.0
    frame_size = max(1, int(sample_rate * 0.025))
    hop = max(1, int(sample_rate * 0.010))
    frame_rms: list[float] = []
    for start in range(0, max(1, values.size - frame_size + 1), hop):
        frame = values[start : start + frame_size]
        if frame.size:
            frame_rms.append(float(np.sqrt(np.mean(np.square(frame, dtype=np.float64)) + 1e-12)))
    floor = float(np.percentile(frame_rms, 20)) if frame_rms else 0.0
    threshold = max(10 ** (-42 / 20), min(floor * 2.0, max(rms * 0.35, 10 ** (-42 / 20))))
    audible_frames = sum(1 for value in frame_rms if value >= threshold)
    speech_seconds = min(duration, audible_frames * hop / sample_rate)
    return {
        "durationSeconds": round(duration, 4),
        "speechSeconds": round(speech_seconds, 4),
        "speechRatio": round(speech_seconds / duration if duration else 0.0, 5),
        "rmsDbfs": round(20 * math.log10(max(rms, 1e-12)), 3),
        "peak": round(peak, 6),
        "clippedPercent": round(clipped, 5),
    }


def _quality_reasons(metrics: dict[str, float]) -> list[str]:
    reasons: list[str] = []
    if metrics["durationSeconds"] < 0.8:
        reasons.append("too_short")
    if metrics["speechSeconds"] < 0.5:
        reasons.append("too_little_audible_speech")
    if metrics["rmsDbfs"] < -45.0:
        reasons.append("too_quiet")
    if metrics["clippedPercent"] > 1.0:
        reasons.append("severely_clipped")
    return reasons


def clean_audio_copy(source: Path, destination: Path) -> tuple[dict[str, float], dict[str, float]]:
    """Apply conservative cleanup intended to preserve speaker identity and prosody."""
    import numpy as np
    from scipy import signal
    import soundfile as sf

    audio, sample_rate = sf.read(source, always_2d=True, dtype="float32")
    mono = np.nan_to_num(audio.mean(axis=1), copy=False)
    before = _audio_metrics(mono, int(sample_rate))
    target_rate = 40_000
    if int(sample_rate) != target_rate:
        divisor = math.gcd(int(sample_rate), target_rate)
        mono = signal.resample_poly(mono, target_rate // divisor, int(sample_rate) // divisor).astype(np.float32)
        sample_rate = target_rate

    if mono.size > 32:
        mono = mono - float(np.mean(mono))
        sos = signal.butter(3, 65.0, btype="highpass", fs=int(sample_rate), output="sos")
        try:
            mono = signal.sosfiltfilt(sos, mono).astype(np.float32)
        except ValueError:
            mono = signal.sosfilt(sos, mono).astype(np.float32)

    frame_size = max(1, int(sample_rate * 0.025))
    hop = max(1, int(sample_rate * 0.010))
    frame_rms: list[float] = []
    starts = list(range(0, max(1, mono.size - frame_size + 1), hop))
    for start in starts:
        frame = mono[start : start + frame_size]
        frame_rms.append(float(np.sqrt(np.mean(np.square(frame, dtype=np.float64)) + 1e-12)))
    floor = float(np.percentile(frame_rms, 20)) if frame_rms else 0.0
    overall_rms = float(np.sqrt(np.mean(np.square(mono, dtype=np.float64)) + 1e-12)) if mono.size else 0.0
    threshold = max(10 ** (-42 / 20), min(floor * 2.0, max(overall_rms * 0.35, 10 ** (-42 / 20))))
    active = [index for index, value in enumerate(frame_rms) if value >= threshold]
    if active:
        padding = int(sample_rate * 0.15)
        first = max(0, starts[active[0]] - padding)
        last = min(mono.size, starts[active[-1]] + frame_size + padding)
        mono = mono[first:last]

    rms = float(np.sqrt(np.mean(np.square(mono, dtype=np.float64)) + 1e-12)) if mono.size else 0.0
    target_rms = 10 ** (-20 / 20)
    gain = min(4.0, max(0.25, target_rms / max(rms, 1e-12)))
    mono = mono * gain
    peak = float(np.max(np.abs(mono))) if mono.size else 0.0
    if peak > 0.97:
        mono = mono * (0.97 / peak)
    fade = min(int(sample_rate * 0.01), mono.size // 2)
    if fade:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        mono[:fade] *= ramp
        mono[-fade:] *= ramp[::-1]

    destination.parent.mkdir(parents=True, exist_ok=True)
    sf.write(destination, mono, int(sample_rate), subtype="PCM_16")
    return before, _audio_metrics(mono, int(sample_rate))


def inspect_audio_file(source: Path) -> dict[str, float]:
    import numpy as np
    import soundfile as sf

    audio, sample_rate = sf.read(source, always_2d=True, dtype="float32")
    mono = np.nan_to_num(audio.mean(axis=1), copy=False)
    return _audio_metrics(mono, int(sample_rate))


def _write_filtered_transcripts(transcript_dir: Path, kept_stems: set[str], output: Path) -> int:
    destination = output / "transcripts"
    destination.mkdir(parents=True, exist_ok=True)
    rows: list[tuple[str, str]] = []
    for stem in sorted(kept_stems):
        source = transcript_dir / f"{stem}.txt"
        if source.is_file():
            text = source.read_text(encoding="utf-8", errors="replace").strip()
            shutil.copy2(source, destination / source.name)
            rows.append((f"dataset/{stem}.wav", text.replace("\t", " ").replace("\n", " ")))
    with (destination / "transcripts.tsv").open("w", encoding="utf-8", newline="") as stream:
        stream.write("audio_file\ttranscript\n")
        for filename, text in rows:
            stream.write(f"{filename}\t{text}\n")

    dataset_file = transcript_dir / "utterances.json"
    if dataset_file.is_file():
        try:
            payload = json.loads(dataset_file.read_text(encoding="utf-8"))
            utterances = payload.get("utterances", []) if isinstance(payload, dict) else []
            payload["utterances"] = [item for item in utterances if str(item.get("id", "")) in kept_stems]
            (destination / "utterances.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        except Exception:
            shutil.copy2(dataset_file, destination / "utterances_unfiltered.json")
    return len(rows)


def create_training_export(
    project_root: Path,
    speaker_dir: Path,
    transcript_dir: Path,
    status: dict[str, Any],
    payload: dict[str, Any],
    output_dir: Path,
) -> tuple[Path, dict[str, Any]]:
    preview = preview_training_export(speaker_dir, transcript_dir, status, payload)
    if not preview["ready"]:
        raise ValueError(" ".join(preview["blockers"]))
    options = preview["options"]
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    display_name = str(status.get("displayName") or status.get("speakerId") or "speaker")
    safe_name = SAFE_NAME_RE.sub("-", display_name).strip("-")[:40] or "speaker"
    plan_name = (
        f"finetune-{options['modelSelection']}-e{options['epochs']}"
        if options["trainingMode"] == "finetune"
        else f"train-new-e{options['epochs']}"
    )
    target_name = "laptop-4050" if options["trainingTarget"] == "laptop_4050_6gb" else "vast"
    bundle_name = f"digital-me-{safe_name}-{plan_name}-{target_name}-{timestamp}"
    output_dir.mkdir(parents=True, exist_ok=True)

    current_path = speaker_dir / "current.json"
    current = json.loads(current_path.read_text(encoding="utf-8")) if current_path.is_file() else {}
    with tempfile.TemporaryDirectory(prefix="digital-me-export-") as temporary:
        bundle_root = Path(temporary) / bundle_name
        bundle_root.mkdir()
        quality_rows: list[dict[str, Any]] = []
        kept_stems: set[str] = set()
        kept_duration = 0.0
        excluded_duration = 0.0

        if options["includeDataset"]:
            dataset_output = bundle_root / "dataset"
            dataset_output.mkdir()
            for source in sorted((speaker_dir / "samples").glob("*.wav")):
                destination = dataset_output / source.name
                row: dict[str, Any] = {"filename": source.name, "sourceSha256": _sha256(source)}
                try:
                    if options["cleanAudio"]:
                        before, after = clean_audio_copy(source, destination)
                    else:
                        before = inspect_audio_file(source)
                        shutil.copy2(source, destination)
                        after = before
                    row["before"] = before
                    row["after"] = after
                    reasons = _quality_reasons(before) if options["excludeLowQuality"] else []
                    if reasons:
                        destination.unlink(missing_ok=True)
                        row["status"] = "excluded"
                        row["reasons"] = reasons
                        excluded_duration += float(before.get("durationSeconds", 0.0))
                    else:
                        row["status"] = "kept"
                        row["exportSha256"] = _sha256(destination)
                        kept_stems.add(source.stem)
                        kept_duration += float(after.get("durationSeconds", 0.0))
                except Exception as error:
                    destination.unlink(missing_ok=True)
                    row["status"] = "excluded"
                    row["reasons"] = ["invalid_audio"]
                    row["error"] = str(error)[:300]
                quality_rows.append(row)
            if kept_duration < MIN_TRAINING_SECONDS:
                raise ValueError(
                    f"Quality filtering kept only {kept_duration:.1f}s. Collect or restore more clean speech before exporting."
                )

        transcript_count = 0
        if options["includeTranscripts"]:
            transcript_count = _write_filtered_transcripts(transcript_dir, kept_stems, bundle_root)

        models_output = bundle_root / "models"
        copied_models: dict[str, str] = {}
        for selection, enabled_key, current_key in (
            ("best", "includeBestModel", "bestModelPath"),
            ("latest", "includeLatestModel", "latestModelPath"),
        ):
            if not options[enabled_key]:
                continue
            source = _resolve_current_file(speaker_dir, current, current_key)
            if source:
                models_output.mkdir(exist_ok=True)
                destination = models_output / f"{selection}_model.pth"
                shutil.copy2(source, destination)
                copied_models[selection] = destination.relative_to(bundle_root).as_posix()
        index_source = _resolve_current_file(speaker_dir, current, "indexPath")
        if index_source and copied_models:
            models_output.mkdir(exist_ok=True)
            shutil.copy2(index_source, models_output / "model.index")

        if options["includeTrainingLogs"] and current:
            model_source = _resolve_current_file(speaker_dir, current, "modelPath")
            job_dir = model_source.parent if model_source else None
            logs_output = bundle_root / "previous_training"
            if job_dir and job_dir.is_dir():
                for name in ("training.log", "epoch_training.log", "checkpoint_metrics.json"):
                    source = job_dir / name
                    if source.is_file():
                        logs_output.mkdir(exist_ok=True)
                        shutil.copy2(source, logs_output / name)
            logs_output.mkdir(exist_ok=True)
            shutil.copy2(current_path, bundle_root / "previous_training" / "current.json")

        if options["includeTrainer"]:
            scripts_output = bundle_root / "scripts"
            scripts_output.mkdir()
            bootstrap_source = (
                project_root / "colab" / "bootstrap_local.py"
                if options["trainingTarget"] == "laptop_4050_6gb"
                else project_root / "colab" / "bootstrap_colab.py"
            )
            for source, name in (
                (bootstrap_source, "bootstrap_training.py"),
                (project_root / "colab" / "rvc_train_runner.py", "rvc_train_runner.py"),
                (project_root / "cloud" / "vast" / "run_vast_training.py", "run_training.py"),
            ):
                if not source.is_file():
                    raise RuntimeError(f"Cloud trainer file is missing: {source}")
                shutil.copy2(source, scripts_output / name)
            if options["trainingTarget"] == "laptop_4050_6gb":
                shutil.copy2(project_root / "cloud" / "local" / "start_training.ps1", bundle_root / "start_training.ps1")
                shutil.copy2(project_root / "cloud" / "local" / "README.md", bundle_root / "README_LAPTOP.md")
            else:
                shutil.copy2(project_root / "cloud" / "vast" / "start_training.sh", bundle_root / "start_training.sh")
                shutil.copy2(project_root / "cloud" / "vast" / "README.md", bundle_root / "README_VAST.md")

        starting_model = copied_models.get(options["modelSelection"]) if options["trainingMode"] == "finetune" else None
        selected_command_script = command_script_name(options)
        is_laptop = options["trainingTarget"] == "laptop_4050_6gb"
        config = {
            "schemaVersion": EXPORT_SCHEMA_VERSION,
            "createdAt": timestamp,
            "speaker": {"speakerId": status.get("speakerId"), "displayName": display_name},
            "training": {
                "mode": options["trainingMode"],
                "modelSelection": options["modelSelection"] if options["trainingMode"] == "finetune" else None,
                "startingModelPath": starting_model,
                "epochs": options["epochs"],
                "trainingTarget": options["trainingTarget"],
                "batchStrategy": "fixed" if is_laptop else "auto",
                "batchSize": 2 if is_laptop else 0,
                "workers": 2 if is_laptop else 0,
                "cpuThreadLimit": 6 if is_laptop else 0,
                "preferredGpu": "RTX 4050 Laptop with 6 GB VRAM" if is_laptop else "RTX 3090 or RTX 4090 with 24 GB VRAM",
                "systemRamGiB": 16 if is_laptop else None,
                "learningRateScale": 0.25 if options["trainingMode"] == "finetune" else 1.0,
            },
            "dataset": {
                "path": "dataset",
                "sampleCount": len(kept_stems),
                "durationSeconds": round(kept_duration, 3),
                "transcriptCount": transcript_count,
                "cleanAudio": options["cleanAudio"],
                "excludeLowQuality": options["excludeLowQuality"],
            },
            "includedModels": copied_models,
            "commandScript": selected_command_script,
            "command": command_for(options),
            "privacy": {
                "containsConsentedVoiceRecordings": True,
                "containsSecrets": False,
                "deleteRemoteCopyAfterDownloadingResults": True,
            },
        }
        (bundle_root / "export_config.json").write_text(
            json.dumps(config, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        mode_label = "Fine-tune existing model" if options["trainingMode"] == "finetune" else "Train a new model from zero"
        model_label = options["modelSelection"].title() if options["trainingMode"] == "finetune" else "Generic RVC v2 base"
        if is_laptop:
            command_script = (
                "$ErrorActionPreference = 'Stop'\n"
                "Set-StrictMode -Version Latest\n"
                f"Write-Host 'Digital Me plan: {mode_label}'\n"
                f"Write-Host 'Starting model: {model_label}'\n"
                f"Write-Host 'Epochs: {options['epochs']}'\n"
                "Write-Host 'Hardware: RTX 4050 Laptop 6 GB / 16 GB system RAM'\n"
                "& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start_training.ps1')\n"
                "exit $LASTEXITCODE\n"
            )
        else:
            command_script = (
                "#!/usr/bin/env bash\n"
                "set -euo pipefail\n"
                f"echo \"Digital Me plan: {mode_label}\"\n"
                f"echo \"Starting model: {model_label}\"\n"
                f"echo \"Epochs: {options['epochs']}\"\n"
                "echo \"The selected plan is stored in export_config.json.\"\n"
                "exec bash start_training.sh\n"
            )
        (bundle_root / selected_command_script).write_text(command_script, encoding="utf-8", newline="\n")
        target_label = "WINDOWS RTX 4050 LAPTOP" if is_laptop else "VAST.AI"
        start_here = (
            f"DIGITAL ME - START HERE ON {target_label}\n"
            "====================================\n\n"
            f"Training action: {mode_label}\n"
            f"Starting model: {model_label}\n"
            f"Epochs: {options['epochs']}\n\n"
            "After extracting this ZIP, open a terminal in this folder.\n"
            "Run this exact command:\n\n"
            f"    {command_for(options)}\n\n"
            + (
                "Keep this PowerShell window open until training finishes. The laptop profile uses batch 2, falls back to 1, and uses 2 data workers.\n"
                "When finished, the result is DOWNLOAD_ME_*.zip in this folder.\n"
                if is_laptop else
                "Run it inside tmux if you want to close the browser without stopping training:\n\n"
                "    tmux new -s digitalme\n"
                f"    bash {selected_command_script}\n\n"
                "Detach with Ctrl+B then D. Reconnect with: tmux attach -t digitalme\n"
                "When finished, download DOWNLOAD_ME_*.zip before destroying the instance.\n"
            )
        )
        (bundle_root / "START_HERE.txt").write_text(start_here, encoding="utf-8", newline="\n")
        report = {
            "schemaVersion": EXPORT_SCHEMA_VERSION,
            "cleaningWasNonDestructive": True,
            "keptClips": len(kept_stems),
            "keptDurationSeconds": round(kept_duration, 3),
            "excludedClips": sum(1 for row in quality_rows if row.get("status") == "excluded"),
            "excludedDurationSeconds": round(excluded_duration, 3),
            "clips": quality_rows,
        }
        (bundle_root / "audio_quality_report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        archive_path = output_dir / f"{bundle_name}.zip"
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for file in sorted(bundle_root.rglob("*")):
                if file.is_file():
                    archive.write(file, file.relative_to(bundle_root.parent))

    result = {
        "filename": archive_path.name,
        "sizeBytes": archive_path.stat().st_size,
        "sha256": _sha256(archive_path),
        "keptClips": report["keptClips"],
        "keptDurationSeconds": report["keptDurationSeconds"],
        "excludedClips": report["excludedClips"],
    }
    return archive_path, result
