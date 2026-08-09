import fs from 'fs';
import path from 'path';

export interface FriendProfile {
  discordUserId: string;
  displayNames: string[];
  relationship: 'close_friend' | 'friend' | 'acquaintance';
  formalityLevel: number; // 0.0 = very informal/slang, 1.0 = formal
  roastingLevel: number;  // 0.0 = no roasting, 1.0 = high roasting
  memories: FriendMemory[];
}

export interface FriendMemory {
  id: string;
  category: 'SHORT_TERM' | 'EPISODIC' | 'SEMANTIC' | 'RELATIONSHIP';
  fact: string;
  confidence: number;
  createdAt: number;
  supersededBy?: string;
  expiresAt?: number;
}

export class FriendMemoryManager {
  private dbPath: string;
  private profiles: Map<string, FriendProfile> = new Map();

  constructor() {
    this.dbPath = path.join(process.cwd(), 'data', 'memory', 'friends_db.json');
    this.ensureStorageDirectory();
    this.loadProfiles();
  }

  private ensureStorageDirectory() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private loadProfiles() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        const data: FriendProfile[] = JSON.parse(raw);
        data.forEach(p => this.profiles.set(p.discordUserId, p));
      }
    } catch (e) {
      console.error('[FriendMemoryManager] Error loading memory database:', e);
    }
  }

  public saveProfiles() {
    try {
      const data = Array.from(this.profiles.values());
      fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[FriendMemoryManager] Error saving memory database:', e);
    }
  }

  public getProfile(userId: string, defaultName: string = 'Friend'): FriendProfile {
    if (!this.profiles.has(userId)) {
      const newProfile: FriendProfile = {
        discordUserId: userId,
        displayNames: [defaultName],
        relationship: 'close_friend',
        formalityLevel: 0.0,
        roastingLevel: 0.8,
        memories: []
      };
      this.profiles.set(userId, newProfile);
      this.saveProfiles();
    }
    return this.profiles.get(userId)!;
  }

  public evaluateAndWriteMemory(userId: string, speakerName: string, text: string): FriendMemory | null {
    const lower = text.toLowerCase();
    const profile = this.getProfile(userId, speakerName);

    // Filter out transient chatter (555, brb, etc)
    if (lower.includes('555') || lower === 'brb' || lower === 'เออ' || lower.length < 4) {
      return null;
    }

    let memoryText: string | null = null;
    let category: FriendMemory['category'] = 'SEMANTIC';
    let expiresAt: number | undefined;

    // Detect temporal facts (วันนี้, พรุ่งนี้)
    if (lower.includes('พรุ่งนี้')) {
      memoryText = `${speakerName} มีแผนสำหรับพรุ่งนี้: ${text}`;
      category = 'EPISODIC';
      expiresAt = Date.now() + 86400000 * 2; // Expires in 2 days
    } else if (lower.includes('เลิกเล่น') || lower.includes('ไม่เล่นแล้ว')) {
      // Memory supersession handling (e.g. "กูเลิกเล่น valo ละ")
      memoryText = `${speakerName} เลิกเล่นเกม ${text}`;
      this.supersedePreviousMemories(userId, 'เล่นเกม');
    } else if (lower.includes('ชอบ') || lower.includes('ซื้อ')) {
      memoryText = `${speakerName}: ${text}`;
      category = 'SEMANTIC';
    }

    if (!memoryText) return null;

    const memory: FriendMemory = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      category,
      fact: memoryText,
      confidence: 0.9,
      createdAt: Date.now(),
      expiresAt
    };

    profile.memories.push(memory);
    this.saveProfiles();
    console.log(`[FriendMemoryManager] Saved memory for ${speakerName}: "${memoryText}"`);
    return memory;
  }

  private supersedePreviousMemories(userId: string, topicKeyword: string) {
    const profile = this.profiles.get(userId);
    if (!profile) return;

    profile.memories.forEach(mem => {
      if (mem.fact.includes(topicKeyword) && !mem.supersededBy) {
        mem.supersededBy = 'superseded_by_newer_fact';
      }
    });
    this.saveProfiles();
  }

  public getRelevantMemories(userId: string, limit: number = 3): FriendMemory[] {
    const profile = this.profiles.get(userId);
    if (!profile) return [];

    const now = Date.now();
    return profile.memories
      .filter(m => !m.supersededBy && (!m.expiresAt || m.expiresAt > now))
      .slice(-limit);
  }

  // Owner Privacy Deletion Controls
  public deleteUserMemories(userId: string) {
    const profile = this.profiles.get(userId);
    if (profile) {
      profile.memories = [];
      this.saveProfiles();
      console.log(`[FriendMemoryManager] Deleted all memories for user ${userId}`);
    }
  }

  public clearAllMemories() {
    this.profiles.clear();
    this.saveProfiles();
    console.log(`[FriendMemoryManager] Cleared entire memory database`);
  }
}
