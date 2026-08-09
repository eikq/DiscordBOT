import readline from 'readline';
import fs from 'fs';
import path from 'path';

export async function runOwnerRatingTool() {
  console.log('=== DIGITAL ME OWNER SESSION RATING TOOL ===\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query: string): Promise<string> => {
    return new Promise((resolve) => rl.question(query, resolve));
  };

  const responseText = await question('Enter AI Twin Response to Evaluate: ');
  const ownerWouldSay = await question('Would you have said this? (yes/no): ');
  const wordingRating = await question('Rate wording similarity (1-5): ');
  const timingRating = await question('Rate timing (1: too early, 3: good, 5: too late): ');

  const ratingRecord = {
    timestamp: Date.now(),
    responseText,
    ownerWouldSay: ownerWouldSay.toLowerCase().startsWith('y'),
    wordingRating: parseInt(wordingRating, 10) || 3,
    timingRating: parseInt(timingRating, 10) || 3,
    cost: '$0.00'
  };

  const evalPath = path.join(process.cwd(), 'data', 'evaluations', 'owner_ratings.json');
  const dir = path.dirname(evalPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let existing: any[] = [];
  if (fs.existsSync(evalPath)) {
    existing = JSON.parse(fs.readFileSync(evalPath, 'utf-8'));
  }
  existing.push(ratingRecord);
  fs.writeFileSync(evalPath, JSON.stringify(existing, null, 2));

  console.log('\n✅ Rating recorded successfully! Saved to data/evaluations/owner_ratings.json');
  rl.close();
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('evaluate_owner')) {
  runOwnerRatingTool().catch(console.error);
}
