import fs from 'fs';
import path from 'path';

export interface FineTuneEntry {
  instruction: string;
  input: string;
  output: string;
}

export function validateAndPrepareDataset() {
  console.log('=== DIGITAL ME FINE-TUNING DATASET VALIDATOR & EXPORTER ===\n');

  const sourcePath = path.join(process.cwd(), 'data', 'behavior', 'examples.json');
  if (!fs.existsSync(sourcePath)) {
    console.log('No behavior examples found at data/behavior/examples.json');
    return;
  }

  const examples = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
  const dataset: FineTuneEntry[] = [];

  let skippedCorrupt = 0;

  for (const ex of examples) {
    if (!ex.context || ex.context.length === 0) {
      skippedCorrupt++;
      continue;
    }

    const contextStr = ex.context.map((c: any) => `${c.speaker}: ${c.text}`).join('\n');
    const instruction = 'You are the digital twin of "Spin". Given conversation context, generate the exact spoken response or remain silent.';

    let output = ex.ownerResponse || '[NO_RESPONSE]';

    dataset.push({
      instruction,
      input: contextStr,
      output
    });
  }

  // Conversation-level train/test split (80/20) to prevent leakage
  const splitIdx = Math.floor(dataset.length * 0.8);
  const trainData = dataset.slice(0, splitIdx);
  const testData = dataset.slice(splitIdx);

  const outDir = path.join(process.cwd(), 'data', 'fine_tuning');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, 'train.json'), JSON.stringify(trainData, null, 2));
  fs.writeFileSync(path.join(outDir, 'test.json'), JSON.stringify(testData, null, 2));

  console.log(`✅ Validated ${examples.length} entries (Skipped corrupt: ${skippedCorrupt})`);
  console.log(`   -> Train Set: ${trainData.length} records saved to data/fine_tuning/train.json`);
  console.log(`   -> Test Set:  ${testData.length} records saved to data/fine_tuning/test.json\n`);
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('validate_dataset')) {
  validateAndPrepareDataset();
}
