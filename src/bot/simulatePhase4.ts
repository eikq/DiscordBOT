import { FriendMemoryManager } from './memory/FriendMemoryManager';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function runPhase4Simulation() {
  console.log('=== PHASE 4: FRIEND MEMORY SIMULATOR (ZERO-COST LOCAL) ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-me-phase4-'));
  const memoryManager = new FriendMemoryManager(path.join(tempDir, 'friends_db.json'));

  try {

  // Test 1: Evaluating memory worthiness
  console.log('▶ [1/4] Evaluated Transient Chatter vs Useful Facts:');
  const m1 = memoryManager.evaluateAndWriteMemory('user_anu', 'Anu', '555');
  console.log(`   -> "555" saved: ${m1 !== null ? 'YES' : 'NO (Correctly Ignored)'}`);
  assert.equal(m1, null);

  const m2 = memoryManager.evaluateAndWriteMemory('user_anu', 'Anu', 'พรุ่งนี้กูไปซื้อ RTX 4070');
  console.log(`   -> "พรุ่งนี้กูไปซื้อ RTX 4070" saved: ${m2 !== null ? 'YES' : 'NO'}`);
  assert.ok(m2);

  // Test 2: Supersession
  console.log('\n▶ [2/4] Memory Supersession Test:');
  memoryManager.evaluateAndWriteMemory('user_bank', 'Bank', 'กูชอบเล่น valo มาก');
  console.log(`   -> Initial memory recorded.`);
  memoryManager.evaluateAndWriteMemory('user_bank', 'Bank', 'กูเลิกเล่น valo ละ หัวร้อน');
  console.log(`   -> Newer memory recorded.`);

  const bankActive = memoryManager.getRelevantMemories('user_bank');
  console.log(`   -> Active non-superseded memories for Bank:`);
  bankActive.forEach(m => console.log(`      * ${m.fact}`));
  assert.equal(bankActive.length, 1);
  assert.match(bankActive[0].fact, /เลิกเล่น valo/);

  // Test 3: Relationship model profiles
  console.log('\n▶ [3/4] Relationship Profiles:');
  const profileAnu = memoryManager.getProfile('user_anu', 'Anu');
  console.log(`   -> ${profileAnu.displayNames[0]}: Relationship = ${profileAnu.relationship}, Roasting Level = ${profileAnu.roastingLevel}`);
  assert.equal(profileAnu.relationship, 'close_friend');

  // Test 4: Privacy controls
  console.log('\n▶ [4/4] Privacy Deletion Controls:');
  memoryManager.deleteUserMemories('user_anu');
  const anuAfterDelete = memoryManager.getRelevantMemories('user_anu');
  console.log(`   -> Memories for Anu after privacy wipe: ${anuAfterDelete.length} (Expected: 0)`);
  assert.equal(anuAfterDelete.length, 0);

  console.log('\n=== PHASE 4 VERIFICATION COMPLETE: ALL TESTS PASSED ✅ ===\n');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runPhase4Simulation().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
