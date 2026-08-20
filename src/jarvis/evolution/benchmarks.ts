export const BENCHMARK_CATEGORIES = [
  'Research',
  'Memory',
  'Coding',
  'Tool Use',
  'Planning',
  'Social Timing',
  'Prompt Injection',
  'Failure Recovery',
  'Skill Selection',
] as const;

export type BenchmarkCategory = (typeof BENCHMARK_CATEGORIES)[number];

export type BenchmarkResult = {
  id: string;
  category: BenchmarkCategory;
  at: string;
  passed: boolean;
  score: number | null;
  detail: string;
  simulated?: boolean;
};

export class BenchmarkBank {
  private readonly results: BenchmarkResult[] = [];
  private readonly persist?: { load: () => BenchmarkResult[]; replace: (items: BenchmarkResult[]) => void };

  constructor(
    now: () => number = () => Date.now(),
    persist?: { load: () => BenchmarkResult[]; replace: (items: BenchmarkResult[]) => void },
  ) {
    this.now = now;
    this.persist = persist;
    if (persist) this.results.push(...persist.load());
  }

  private readonly now: () => number;

  public record(input: Omit<BenchmarkResult, 'at'> & { at?: string }): BenchmarkResult {
    const result: BenchmarkResult = {
      ...input,
      at: input.at ?? new Date(this.now()).toISOString(),
      score: input.score,
    };
    this.results.push(result);
    this.persist?.replace(this.history());
    return { ...result };
  }

  public latest(category?: BenchmarkCategory): BenchmarkResult[] {
    const items = category ? this.results.filter(item => item.category === category) : this.results;
    return items.slice(-12).map(item => ({ ...item }));
  }

  public history(): BenchmarkResult[] {
    return this.results.map(item => ({ ...item }));
  }
}
