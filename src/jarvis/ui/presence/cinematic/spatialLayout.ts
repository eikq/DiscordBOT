import type { PresenceResearchNode, ResearchSourceVisual } from './researchPresentation';

export type SpatialNodePose = {
  id: string;
  x: number;
  y: number;
  z: number;
  size: number;
  brightness: number;
  stream: boolean;
  fade: number;
};

export type PlanSpatialNode = {
  id: string;
  index: string;
  title: string;
  state: 'done' | 'active' | 'pending' | 'failed' | 'blocked' | 'cancelled' | 'waiting';
  x: number;
  y: number;
  z: number;
};

function hash01(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return hash / 0xffffffff;
}

export function sourceDistance(visual: ResearchSourceVisual, trust: PresenceResearchNode['trust']): number {
  if (visual === 'FAILED') return 4.55;
  if (visual === 'UNTRUSTED') return 4.25;
  if (visual === 'DISCOVERED' || visual === 'FETCHING') return 4.35;
  if (visual === 'CONFLICTING') return 4.05;
  if (trust === 'verified' || visual === 'VERIFIED') return 3.35;
  if (visual === 'EVIDENCE_FOUND') return 3.55;
  return 3.85;
}

export function sourceSize(visual: ResearchSourceVisual, trust: PresenceResearchNode['trust']): number {
  if (trust === 'verified' || visual === 'VERIFIED') return 0.13;
  if (visual === 'CONFLICTING' || visual === 'EVIDENCE_FOUND') return 0.11;
  if (visual === 'FAILED') return 0.07;
  return 0.09;
}

export function sourceBrightness(visual: ResearchSourceVisual, trust: PresenceResearchNode['trust']): number {
  if (visual === 'FAILED') return 0.28;
  if (visual === 'UNTRUSTED') return 0.42;
  if (trust === 'verified' || visual === 'VERIFIED') return 1;
  if (visual === 'CONFLICTING') return 0.86;
  if (visual === 'EVIDENCE_FOUND') return 0.78;
  if (visual === 'FETCHING' || visual === 'READING') return 0.7;
  return 0.55;
}

export function sourceStreamsEnergy(visual: ResearchSourceVisual): boolean {
  return visual === 'EVIDENCE_FOUND' || visual === 'VERIFIED' || visual === 'CONFLICTING' || visual === 'READING';
}

export function sourceSpatial(node: PresenceResearchNode, index: number, total: number): SpatialNodePose {
  const radius = sourceDistance(node.visual, node.trust);
  const angle = (index / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
  const lift = (hash01(node.id) - 0.5) * 1.15;
  return {
    id: node.id,
    x: Math.cos(angle) * radius,
    y: lift,
    z: Math.sin(angle) * radius,
    size: sourceSize(node.visual, node.trust),
    brightness: sourceBrightness(node.visual, node.trust),
    stream: sourceStreamsEnergy(node.visual),
    fade: node.visual === 'FAILED' ? 0.34 : 1,
  };
}

export function layoutPlanSteps(steps: Array<Pick<PlanSpatialNode, 'id' | 'index' | 'title' | 'state'>>): PlanSpatialNode[] {
  const visible = steps.slice(0, 8);
  return visible.map((step, index) => {
    const row = Math.floor(index / 2);
    const col = index % 2 === 0 ? -1 : 1;
    const pair = index === 0;
    return {
      ...step,
      x: pair ? 0 : col * 1.15,
      y: 1.85 - row * 0.72,
      z: -3.15,
    };
  });
}

export function applicationNodePose(label: string): SpatialNodePose {
  return {
    id: `app:${label}`,
    x: 3.9,
    y: 0.15,
    z: 0.4,
    size: 0.14,
    brightness: 0.95,
    stream: true,
    fade: 1,
  };
}

export function monitorNodePose(label: string): SpatialNodePose {
  return {
    id: `monitor:${label}`,
    x: -3.6,
    y: 0.35,
    z: 0.55,
    size: 0.16,
    brightness: 0.9,
    stream: true,
    fade: 1,
  };
}
