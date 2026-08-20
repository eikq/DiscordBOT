import type { VisualContext } from '../vision/types';
import { visionOutputIsAuthoritative } from './authority';
import type { ObjectRef, VisionInterpretation } from './types';

export type RawVisionModelOutput = {
  description?: string;
  objects?: Array<{ id?: string; label?: string; confidence?: number }>;
};

/**
 * Image-model output is untrusted data. It cannot authorize SEE→CLICK or any action.
 */
export function interpretVisionModel(
  raw: RawVisionModelOutput,
  simulated = true,
): VisionInterpretation {
  const objects: ObjectRef[] = (raw.objects ?? []).map((item, index) => ({
    id: item.id || `obj-${index}`,
    label: String(item.label || 'unknown'),
    confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
  }));
  return {
    objects,
    description: String(raw.description || '').slice(0, 400),
    modelOutputTrust: 'untrusted',
    authoritative: false,
    simulated,
  };
}

export function interpretVisualContext(context: VisualContext): VisionInterpretation {
  return interpretVisionModel({
    description: context.windowTitle,
    objects: context.elements.map(item => ({
      id: item.id,
      label: item.label,
      confidence: item.confidence,
    })),
  }, context.simulated);
}

export function visionMayAuthorizeAction(_action: 'see' | 'click' | 'type' | 'submit' | 'control'): false {
  void _action;
  return visionOutputIsAuthoritative();
}
