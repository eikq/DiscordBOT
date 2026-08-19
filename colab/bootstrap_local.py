#!/usr/bin/env python3
"""Install and verify the pinned RVC runtime for the local Windows GPU service."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys


PROJECT_ROOT = Path(__file__).resolve().parent.parent
RVC_REPOSITORY = "https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI.git"
RVC_COMMIT = "81eed5e8f68b6bed1789f682fe78cdd324495afc"
RVC_ROOT = Path(os.environ.get(
    "RVC_ROOT",
    str(PROJECT_ROOT / ".runtime" / "Retrieval-based-Voice-Conversion-WebUI"),
)).resolve()


def run(command: list[str], cwd: Path | None = None) -> None:
    print("+ " + " ".join(command), flush=True)
    subprocess.run(command, cwd=str(cwd) if cwd else None, check=True)


def require_supported_python() -> None:
    if sys.version_info[:2] != (3, 12) or sys.maxsize <= 2**32:
        raise RuntimeError(
            f"Local RVC requires 64-bit Python 3.12; this interpreter is {sys.version.split()[0]}. "
            "Run npm run voice:setup so the correct isolated environment is used."
        )


def checkout_rvc() -> None:
    RVC_ROOT.parent.mkdir(parents=True, exist_ok=True)
    if not (RVC_ROOT / ".git").is_dir():
        run(["git", "clone", "--filter=blob:none", "--no-checkout", RVC_REPOSITORY, str(RVC_ROOT)])
    run(["git", "fetch", "origin", RVC_COMMIT, "--depth", "1"], RVC_ROOT)
    run(["git", "checkout", "--detach", RVC_COMMIT], RVC_ROOT)
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=RVC_ROOT, text=True).strip()
    if actual != RVC_COMMIT:
        raise RuntimeError(f"RVC checkout mismatch: expected {RVC_COMMIT}, got {actual}")


def install_python_dependencies() -> None:
    run([sys.executable, "-m", "pip", "install", "--upgrade", "pip", "setuptools<81", "wheel"])
    run([
        sys.executable, "-m", "pip", "install",
        "torch==2.7.1+cu118", "torchaudio==2.7.1+cu118",
        "--index-url", "https://download.pytorch.org/whl/cu118",
        "--extra-index-url", "https://pypi.org/simple",
    ])
    requirements = [
        "av>=15.1.0,<16",
        "einops>=0.8.0,<1",
        "faiss-cpu>=1.13.0,<2",
        "ffmpeg-python>=0.2.0,<1",
        "librosa>=0.10.2,<0.11",
        "matplotlib>=3.8.2,<4",
        "numpy>=1.26.4,<2",
        "praat-parselmouth>=0.4.5,<1",
        "PyYAML>=6.0.1",
        "scikit-learn>=1.6.0,<2",
        "scipy>=1.13.1,<2",
        "soundfile>=0.13.0,<1",
        "tensorboard>=2.19.0",
        "torchfcpe>=0.0.4,<0.1",
        "tqdm>=4.67.0,<5",
        "transformers>=4.49.0,<4.50",
        "fastapi>=0.88.0,<0.100",
        "pydantic>=1.10.13,<2",
        "uvicorn>=0.20.0,<0.23",
        "edge-tts>=7.0.0,<8",
        "demucs==4.0.1",
        "huggingface-hub>=0.27.0,<1",
    ]
    run([sys.executable, "-m", "pip", "install", "--index-url", "https://pypi.org/simple", *requirements])


def download_models() -> None:
    from huggingface_hub import hf_hub_download, snapshot_download

    snapshot_download(
        repo_id="lj1995/VoiceConversionWebUI",
        revision="main",
        allow_patterns=["hubert_base/*", "pretrained/*", "pretrained_v2/*"],
        local_dir=str(RVC_ROOT / "assets"),
    )
    hf_hub_download(
        repo_id="lj1995/VoiceConversionWebUI",
        filename="rmvpe.pt",
        revision="main",
        local_dir=str(RVC_ROOT / "assets" / "rmvpe"),
    )
    downloads = RVC_ROOT / ".model-downloads"
    downloads.mkdir(exist_ok=True)
    mute_zip = Path(hf_hub_download(
        repo_id="lj1995/VoiceConversionWebUI",
        filename="mute.zip",
        revision="main",
        local_dir=str(downloads),
    ))
    if not (RVC_ROOT / "logs" / "mute").is_dir():
        shutil.unpack_archive(mute_zip, RVC_ROOT / "logs")


def verify() -> None:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("FFmpeg is not on PATH. Install FFmpeg before starting the local voice service.")
    run([
        sys.executable,
        "-c",
        "import torch; assert torch.cuda.is_available(); "
        "print('torch', torch.__version__, 'cuda', torch.version.cuda, torch.cuda.get_device_name(0))",
    ])
    required = [
        RVC_ROOT / "infer" / "vc" / "modules.py",
        RVC_ROOT / "assets" / "hubert_base" / "pytorch_model.bin",
        RVC_ROOT / "assets" / "rmvpe" / "rmvpe.pt",
        RVC_ROOT / "assets" / "pretrained_v2" / "f0G40k.pth",
        RVC_ROOT / "assets" / "pretrained_v2" / "f0D40k.pth",
        RVC_ROOT / "logs" / "mute" / "0_gt_wavs" / "mute40k.wav",
    ]
    missing = [str(item) for item in required if not item.is_file()]
    if missing:
        raise RuntimeError("Local RVC setup is incomplete; missing: " + ", ".join(missing))
    print(f"Local RVC {RVC_COMMIT} is ready at {RVC_ROOT}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-install", action="store_true", help="Only verify an existing installation")
    args = parser.parse_args()
    require_supported_python()
    checkout_rvc()
    if not args.skip_install:
        install_python_dependencies()
        download_models()
    verify()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
