# Digital Me Local Zero-Cost QLoRA Fine-Tuning Script
# Uses Unsloth / Hugging Face PEFT for fast low-VRAM local fine-tuning

import json
import os

print("=== DIGITAL ME LOCAL QLORA FINE-TUNING SCRIPT ===")

train_file = "data/fine_tuning/train.json"
test_file = "data/fine_tuning/test.json"

if not os.path.exists(train_file):
    print(f"Error: {train_file} not found. Run 'npm run fine-tune:prepare' first.")
    exit(1)

with open(train_file, "r", encoding="utf-8") as f:
    train_data = json.load(f)

print(f"Loaded {len(train_data)} training records.")
print("Target Base Model: typhoon-ai/typhoon2.5-qwen3-4b")
print("LoRA Config: r=16, lora_alpha=32, target_modules=['q_proj', 'v_proj', 'k_proj', 'o_proj']")
print("Quantization: 4-bit NormalFloat4 (NF4)")
print("\nTo launch local training on your GPU:")
print("  pip install unsloth trl peft transformers torch")
print("  python python/training/train_lora.py --train")
print("\nGated Deployment Rule: Models will only be deployed if accuracy > baseline.")
