import fs from 'fs';
import path from 'path';
import { LocalEmbeddingProvider } from '../embeddings/LocalEmbeddingProvider';

export interface BehaviorExample {
  conversationId: string;
  context: { speaker: string; text: string }[];
  ownerAction: string;
  ownerResponse: string | null;
  responseDelayMs: number;
  relationship: string;
  directlyAddressed: boolean;
  topic: string;
}

export class BehaviorRetriever {
  private examples: BehaviorExample[] = [];
  private embeddingProvider: LocalEmbeddingProvider;

  constructor() {
    this.embeddingProvider = new LocalEmbeddingProvider();
    this.loadExamples();
  }

  private loadExamples() {
    try {
      const dataPath = path.join(process.cwd(), 'data', 'behavior', 'examples.json');
      if (fs.existsSync(dataPath)) {
        const data = fs.readFileSync(dataPath, 'utf-8');
        this.examples = JSON.parse(data);
      }
    } catch (error) {
      console.error("Failed to load behavior examples:", error);
    }
  }

  public retrieveRelevant(action: string, limit: number = 3): BehaviorExample[] {
    const relevant = this.examples.filter(e => e.ownerAction === action);
    if (relevant.length === 0) return this.examples.slice(0, limit);
    return relevant.slice(0, limit);
  }

  public async retrieveSemantic(query: string, limit: number = 3): Promise<BehaviorExample[]> {
    const queryEmbeddings = await this.embeddingProvider.embed([query]);
    const qVec = queryEmbeddings[0] || [];

    const scored = await Promise.all(
      this.examples.map(async (ex) => {
        const contextStr = ex.context.map(c => `${c.speaker}: ${c.text}`).join(" ");
        const exEmbeddings = await this.embeddingProvider.embed([contextStr]);
        const score = this.embeddingProvider.cosineSimilarity(qVec, exEmbeddings[0] || []);
        return { ex, score };
      })
    );

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.ex);
  }
}
