# Digital Me training on an RTX 4050 laptop

This bundle is configured for an Intel Core i5-13500HX, RTX 4050 Laptop GPU
with 6 GB VRAM, and 16 GB system RAM.

1. Plug in the laptop and enable its normal/high-performance GPU mode.
2. Stop the Discord bot, local voice service, games, and other GPU-heavy apps.
3. Keep at least 20 GB free and make sure FFmpeg is on `PATH`.
4. Extract the ZIP. Do not run training from inside the ZIP preview.
5. Open PowerShell in the extracted folder.
6. Run the generated `RUN_*_LAPTOP_4050.ps1` command shown by the dashboard.
7. Keep the PowerShell window open. The safe profile starts at batch 2, retries
   at batch 1 if CUDA memory is exhausted, uses 2 data-loader workers, and limits
   auxiliary CPU math threads to 6.
8. When training finishes, use the generated `DOWNLOAD_ME_*.zip` result.

The launcher reuses `Documents\DiscordBOT\.venv-rvc` and its existing RVC
runtime when available. Otherwise the first run creates a private environment
inside this bundle and downloads the pinned dependencies and model assets.
