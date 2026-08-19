# Digital Me training on Vast.ai

This archive contains consented voice recordings. Keep the instance private, do not add Discord or API tokens, and delete the remote files after downloading the result.

## Recommended instance

- One RTX 3090 24 GB or RTX 4090 24 GB
- On-demand rental for the first run
- Verified host with high reliability
- PyTorch or Ubuntu 24.04 template with Python 3.12, SSH, and Jupyter
- 60-80 GB disk selected before creating the instance

The runner detects GPU VRAM automatically. A 24 GB RTX 3090/4090 starts with
an aggressive batch size of 20, enables mixed precision, TF32, cuDNN
benchmarking, pinned-data workers, and the expandable CUDA allocator. If CUDA
runs out of memory, it retries safely with batch 16, 12, 8, and smaller values.
Low VRAM usage alone is not an error: RVC is a relatively small model, so GPU
utilization and epoch time matter more than filling every gigabyte.

## Upload and run

1. Upload this ZIP through the Vast.ai Jupyter file browser.
2. Open a terminal in the upload directory and extract it: `unzip digital-me-*.zip`.
3. Enter the extracted folder: `cd digital-me-*`.
4. Start a persistent terminal: `tmux new -s digitalme`.
5. Open `START_HERE.txt`. It shows the selected action, model, epochs, and the exact generated command.
6. Run the generated command, for example `bash RUN_FINETUNE_BEST_30_EPOCHS.sh` or `bash RUN_TRAIN_NEW_100_EPOCHS.sh`.
7. Detach without stopping training with `Ctrl+B`, then `D`. Reconnect later with `tmux attach -t digitalme`.
8. When training finishes, download the `DOWNLOAD_ME_*.zip` file from Jupyter.
9. Verify the downloaded ZIP, then destroy the Vast.ai instance so storage billing stops.

The first setup downloads the pinned RVC runtime and model assets, so it can take much longer than later training output. Do not close the instance while setup or training is running.
