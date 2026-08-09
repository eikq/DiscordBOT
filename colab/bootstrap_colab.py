#!/usr/bin/env python3
"""Install the pinned RVC runtime and model assets in a Google Colab GPU session."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys


RVC_REPOSITORY = "https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI.git"
RVC_COMMIT = "81eed5e8f68b6bed1789f682fe78cdd324495afc"
RVC_ROOT = Path(os.environ.get("RVC_ROOT", "/content/Retrieval-based-Voice-Conversion-WebUI"))


def run(command: list[str], cwd: Path | None = None) -> None:
    print("+ " + " ".join(command), flush=True)
    subprocess.run(command, cwd=str(cwd) if cwd else None, check=True)


def install_python_dependencies() -> None:
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError(f"The pinned RVC revision requires Python 3.12; this runtime is {sys.version.split()[0]}.")
    run([sys.executable, "-m", "pip", "install", "--upgrade", "pip", "setuptools<81", "wheel"])
    run([
        sys.executable, "-m", "pip", "install",
        "torch==2.7.1+cu118", "torchaudio==2.7.1+cu118",
        "--index-url", "https://download.pytorch.org/whl/cu118",
        "--extra-index-url", "https://pypi.org/simple",
    ])
    requirements = [
        "av>=15.1.0,<16",
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
        "huggingface-hub>=0.27.0,<1",
    ]
    run([sys.executable, "-m", "pip", "install", "--index-url", "https://pypi.org/simple", *requirements])


def checkout_rvc() -> None:
    if not (RVC_ROOT / ".git").is_dir():
        run(["git", "clone", RVC_REPOSITORY, str(RVC_ROOT)])
    run(["git", "fetch", "origin", RVC_COMMIT, "--depth", "1"], RVC_ROOT)
    run(["git", "checkout", "--detach", RVC_COMMIT], RVC_ROOT)
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=RVC_ROOT, text=True).strip()
    if actual != RVC_COMMIT:
        raise RuntimeError(f"RVC checkout mismatch: expected {RVC_COMMIT}, got {actual}")


def download_models() -> None:
    run(["hf", "download", "lj1995/VoiceConversionWebUI", "--revision", "main", "--include", "hubert_base/*", "--local-dir", "assets"], RVC_ROOT)
    run(["hf", "download", "lj1995/VoiceConversionWebUI", "rmvpe.pt", "--revision", "main", "--local-dir", "assets/rmvpe"], RVC_ROOT)
    run([
        "hf", "download", "lj1995/VoiceConversionWebUI", "--revision", "main",
        "--include", "pretrained/*", "pretrained_v2/*", "--local-dir", "assets",
    ], RVC_ROOT)
    downloads = RVC_ROOT / ".model-downloads"
    downloads.mkdir(exist_ok=True)
    run(["hf", "download", "lj1995/VoiceConversionWebUI", "mute.zip", "--revision", "main", "--local-dir", str(downloads)], RVC_ROOT)
    mute_zip = downloads / "mute.zip"
    if not (RVC_ROOT / "logs" / "mute").is_dir():
        shutil.unpack_archive(mute_zip, RVC_ROOT / "logs")


def install_system_tools() -> None:
    run(["apt-get", "update"])
    run(["apt-get", "install", "-y", "ffmpeg"])
    cloudflared = Path("/usr/local/bin/cloudflared")
    if not cloudflared.is_file():
        run([
            "wget", "-q",
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
            "-O", str(cloudflared),
        ])
        cloudflared.chmod(0o755)


def verify() -> None:
    run([sys.executable, "-c", "import torch; assert torch.cuda.is_available(); print(torch.__version__, torch.cuda.get_device_name(0))"])
    required = [
        RVC_ROOT / "assets" / "hubert_base" / "pytorch_model.bin",
        RVC_ROOT / "assets" / "rmvpe" / "rmvpe.pt",
        RVC_ROOT / "assets" / "pretrained_v2" / "f0G40k.pth",
        RVC_ROOT / "assets" / "pretrained_v2" / "f0D40k.pth",
        RVC_ROOT / "logs" / "mute" / "0_gt_wavs" / "mute40k.wav",
    ]
    missing = [str(item) for item in required if not item.is_file()]
    if missing:
        raise RuntimeError("Bootstrap is incomplete; missing: " + ", ".join(missing))
    print(f"RVC {RVC_COMMIT} is ready at {RVC_ROOT}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-install", action="store_true", help="Only verify an existing installation")
    args = parser.parse_args()
    if not args.skip_install:
        install_system_tools()
        checkout_rvc()
        install_python_dependencies()
        download_models()
    verify()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
