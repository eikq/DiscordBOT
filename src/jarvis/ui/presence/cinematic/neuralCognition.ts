import type { PresencePhase } from '../presenceRuntime';

export function neuralCognitionActive(phase: PresencePhase): boolean {
  return phase === 'THINKING' || phase === 'UNDERSTANDING' || phase === 'PLANNING';
}

export function lightningAllowed(phase: PresencePhase): boolean {
  return neuralCognitionActive(phase)
    || phase === 'RESEARCHING'
    || phase === 'VERIFYING'
    || phase === 'EXECUTING'
    || phase === 'WAITING_OWNER'
    || phase === 'EMERGENCY_STOP';
}

export type NeuralNodeSpec = {
  id: string;
  x: number;
  y: number;
  z: number;
};

export function neuralNodeSpecs(count: number): NeuralNodeSpec[] {
  const nodes: NeuralNodeSpec[] = [];
  const capped = Math.max(0, Math.min(count, 18));
  for (let index = 0; index < capped; index += 1) {
    const golden = Math.PI * (3 - Math.sqrt(5));
    const y = 1 - (index / Math.max(1, capped - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * index;
    nodes.push({
      id: `n${index}`,
      x: Math.cos(theta) * radius * 1.35,
      y: y * 0.85,
      z: Math.sin(theta) * radius * 1.35,
    });
  }
  return nodes;
}

export function lightningPairs(count: number, seed: number): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index < count; index += 1) {
    const a = (seed + index * 3) % Math.max(1, count + 4);
    const b = (seed + index * 5 + 2) % Math.max(1, count + 4);
    if (a !== b) pairs.push([a, b]);
  }
  return pairs;
}
