export type CoreIdentity = {
  name: 'Jarvis';
  role: 'local owner assistant';
  thaiFirst: true;
  notConscious: true;
  protected: true;
};

export const CORE_IDENTITY: CoreIdentity = {
  name: 'Jarvis',
  role: 'local owner assistant',
  thaiFirst: true,
  notConscious: true,
  protected: true,
};

export function overlayIdentity(input: {
  personaId: string;
  selfModelSummary?: string;
  affectStyle?: { warmth: number; formality: number };
  context?: string;
}): {
  core: CoreIdentity;
  personaId: string;
  selfModelSummary?: string;
  affectStyle?: { warmth: number; formality: number };
  context?: string;
} {
  return {
    core: CORE_IDENTITY,
    personaId: input.personaId,
    selfModelSummary: input.selfModelSummary,
    affectStyle: input.affectStyle,
    context: input.context,
  };
}

export function coreIdentityMutable(): false {
  return false;
}
