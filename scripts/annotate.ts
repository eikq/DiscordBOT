import readline from 'readline';
import fs from 'fs';
import path from 'path';

interface AnnotationRecord {
  conversationId: string;
  context: { speaker: string; text: string }[];
  ownerAction: string;
  ownerResponse: string | null;
  responseDelayMs: number;
  relationship: string;
  directlyAddressed: boolean;
  topic: string;
}

const dataPath = path.join(process.cwd(), 'data', 'behavior', 'examples.json');

export async function runAnnotationTool() {
  console.log('=== DIGITAL ME OWNER BEHAVIOR ANNOTATION TOOL ===\n');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query: string): Promise<string> => {
    return new Promise((resolve) => rl.question(query, resolve));
  };

  const speaker = await question('Enter Friend Speaker Name (e.g. Anu): ');
  const text = await question('Enter Friend Speech Text (e.g. มึงเข้า valo ปะ): ');
  
  console.log('\nWould you respond here?');
  console.log('[1] IGNORE (Stay Silent)');
  console.log('[2] SHORT_REACTION (e.g. เออ, ห้ะ)');
  console.log('[3] ANSWER (e.g. ไม่อะ, ขก)');
  console.log('[4] JOKE / ROAST');
  
  const choice = await question('Select Choice (1-4): ');
  let ownerAction = 'IGNORE';
  let ownerResponse: string | null = null;

  if (choice === '2') {
    ownerAction = 'SHORT_REACTION';
    ownerResponse = await question('What would you say out loud? ');
  } else if (choice === '3') {
    ownerAction = 'ANSWER';
    ownerResponse = await question('What would you say out loud? ');
  } else if (choice === '4') {
    ownerAction = 'JOKE';
    ownerResponse = await question('What would you say out loud? ');
  }

  const record: AnnotationRecord = {
    conversationId: `user_ann_${Date.now()}`,
    context: [{ speaker: speaker || 'Friend', text: text || '...' }],
    ownerAction,
    ownerResponse,
    responseDelayMs: 800,
    relationship: 'close_friend',
    directlyAddressed: text.includes('Spin') || text.includes('มึง'),
    topic: 'gaming'
  };

  let existing: AnnotationRecord[] = [];
  if (fs.existsSync(dataPath)) {
    existing = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  }
  existing.push(record);
  fs.writeFileSync(dataPath, JSON.stringify(existing, null, 2));

  console.log('\n✅ Successfully annotated and saved record!');
  rl.close();
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('annotate')) {
  runAnnotationTool().catch(console.error);
}
