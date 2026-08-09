import { SocialDecision } from "../brain/types";
import { GroupConversationState } from "../brain/GroupConversationState";
import { BehaviorRetriever } from "./BehaviorRetriever";
import { StyleProfile, DEFAULT_STYLE_PROFILE } from "./StyleProfile";
import { LocalLlmProvider } from "../llm/LocalLlmProvider";

export class ResponseGenerator {
  private localLlm: LocalLlmProvider;
  private retriever: BehaviorRetriever;
  private styleProfile: StyleProfile;

  constructor() {
    this.localLlm = new LocalLlmProvider();
    this.retriever = new BehaviorRetriever();
    this.styleProfile = DEFAULT_STYLE_PROFILE;
  }

  public async generate(decision: SocialDecision, state: GroupConversationState): Promise<string | null> {
    if (decision.action === 'IGNORE') {
      return null;
    }

    const context = state.getContext(10);
    const examples = this.retriever.retrieveRelevant(decision.action);
    
    // Fast deterministic matching based on examples
    const lastLine = context.recentTranscripts[context.recentTranscripts.length - 1] || "";
    const lower = lastLine.toLowerCase();

    if (lower.includes("valo")) {
      return "ไม่อะ ขก.";
    }
    if (lower.includes("minecraft") || lower.includes("มายคราฟ")) {
      return "เอาดิ";
    }
    if (lower.includes("กินไร") || lower.includes("เลือกดิ")) {
      return "อะไรก็ได้";
    }

    // Local LLM text generation
    const systemPrompt = `You are generating spoken Thai response for a Discord bot twin of its owner ("Spin").
Style: ${this.styleProfile.averageResponseLength}. Casual Thai slang (กู, มึง, เออ, ขก, ไม่เอาอะ, เอาดิ).
NO assistant polite words (ครับ, ยินดี). Output ONLY the exact Thai words to speak out loud.`;

    const userPrompt = `Context:\n${context.recentTranscripts.join("\n")}\nAction: ${decision.action}\nDesired Length: ${decision.desiredLength}`;

    const text = await this.localLlm.generateText({
      systemPrompt,
      userPrompt,
      temperature: 0.6,
      maxTokens: 25
    });

    if (text) {
      let cleaned = text.trim().replace(/^["']|["']$/g, '');
      if (cleaned) return cleaned;
    }

    // Default authentic fallback
    if (decision.action === 'SHORT_REACTION') return "เออ";
    return "ไม่อะ";
  }
}
