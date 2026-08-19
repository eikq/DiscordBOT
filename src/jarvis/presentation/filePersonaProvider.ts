import { BehaviorRetriever } from '../../bot/personality/BehaviorRetriever';
import {
  GAM_PERSONA_ID,
  JARVIS_PERSONA_ID,
  type BehaviorExample,
  type JarvisPersonaProfile,
  type PersonaProvider,
} from './types';

export type StandalonePersonaBindings = Partial<Record<string, string>>;

export class FileBehaviorPersonaProvider implements PersonaProvider {
  private readonly retriever: BehaviorRetriever;

  constructor(
    private readonly bindings: StandalonePersonaBindings = { [GAM_PERSONA_ID]: GAM_PERSONA_ID },
    examplesPath?: string,
  ) {
    this.retriever = new BehaviorRetriever(examplesPath);
  }

  public async get(profileId: string): Promise<JarvisPersonaProfile | null> {
    if (profileId === JARVIS_PERSONA_ID) {
      return { profileId, displayName: 'Jarvis', aliases: ['jarvis'] };
    }
    if (profileId === GAM_PERSONA_ID) {
      return { profileId, displayName: 'Gam', aliases: ['gam'] };
    }
    return null;
  }

  public async getBehaviorExamples(profileId: string, _query: string, limit = 3): Promise<BehaviorExample[]> {
    if (profileId === JARVIS_PERSONA_ID) return [];
    const scope = this.bindings[profileId];
    if (!scope) return [];
    const relevant = this.retriever.retrieveRelevant('ANSWER', limit, scope);
    return relevant.slice(0, limit).map(item => ({
      id: item.conversationId,
      ownerResponse: item.ownerResponse || '',
      prompt: item.context.map(turn => turn.text).join(' '),
    }));
  }
}
