export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  cosineSimilarity(vecA: number[], vecB: number[]): number;
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.EMBEDDING_BASE_URL || 'http://127.0.0.1:8767';
  }

  public async embed(texts: string[]): Promise<number[][]> {
    try {
      const response = await fetch(`${this.baseUrl}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts }),
        signal: AbortSignal.timeout(2000)
      });

      if (response.ok) {
        const json = await response.json();
        if (json.embeddings) return json.embeddings;
      }
    } catch (e) {
      // Local fallback: generate deterministic character-hash embedding vectors on CPU
    }

    return texts.map(t => this.generateFallbackVector(t));
  }

  public cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(vecA.length, vecB.length);
    for (let i = 0; i < len; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private generateFallbackVector(text: string, dim: number = 128): number[] {
    const vec = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      vec[i % dim] += (code % 31) / 31.0;
    }
    // Normalize
    const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0)) || 1;
    return vec.map(v => v / norm);
  }
}
