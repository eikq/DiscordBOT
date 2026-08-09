import { SocialDecision } from "./types";
import { GroupConversationState } from "./GroupConversationState";
import { LocalLlmProvider } from "../llm/LocalLlmProvider";

export class SocialBrain {
  private localLlm: LocalLlmProvider;
  private botName: string = "Digital Me";
  private ownerAliases: string[] = ["Spin", "สปิน", "digital me"];
  private lastSpeakTime: number = 0;
  private socialCooldownMs: number = 3000; // 3 seconds social cooldown

  constructor(botName: string = "Digital Me") {
    this.botName = botName;
    const aliasesFromEnv = process.env.OWNER_ALIASES || "Spin,สปิน";
    this.ownerAliases = Array.from(new Set([
      ...aliasesFromEnv.split(","),
      botName,
    ].map(alias => alias.trim().toLowerCase()).filter(Boolean)));
    this.localLlm = new LocalLlmProvider();
  }

  public async evaluate(state: GroupConversationState): Promise<SocialDecision> {
    const context = state.getContext(10);
    
    if (context.recentTranscripts.length === 0) {
      return this.getDefaultDecision();
    }

    const transcriptEvents = state.getRecentTranscriptEvents(10);
    const lastEvent = transcriptEvents[transcriptEvents.length - 1];
    const lowerLast = lastEvent.rawText.trim().toLowerCase();

    // 1. FAST DETERMINISTIC HYBRID RULES (High Confidence / Zero Cost)
    // Rule A: Was the owner directly addressed by alias?
    const directlyAddressed = this.containsOwnerAlias(lowerLast);
    
    // Rule B: Is it a direct question targeting the owner?
    const isDirectQuestion = directlyAddressed && this.looksLikeQuestion(lowerLast);
    const isFollowUpQuestion = !directlyAddressed &&
      this.looksLikeFollowUpQuestion(lowerLast) &&
      transcriptEvents.slice(0, -1).slice(-4).some(event =>
        event.discordUserId === lastEvent.discordUserId &&
        this.containsOwnerAlias(event.rawText.toLowerCase())
      );

    if (isDirectQuestion || isFollowUpQuestion) {
      const decision: SocialDecision = {
        action: 'ANSWER',
        targetUserIds: [lastEvent.discordUserId],
        confidence: isDirectQuestion ? 0.95 : 0.85,
        directlyAddressed: isDirectQuestion,
        responseExpected: isDirectQuestion ? 0.95 : 0.8,
        interruptAppropriate: false,
        desiredLength: 'very_short',
        tone: 'casual',
        reasonCode: isDirectQuestion ? 'DIRECT_QUESTION_TARGETED' : 'FOLLOW_UP_TO_OWNER'
      };
      this.logDecision(decision);
      return decision;
    }

    // Rule C: Address by name without explicit question
    if (directlyAddressed) {
      const decision: SocialDecision = {
        action: 'SHORT_REACTION',
        targetUserIds: [lastEvent.discordUserId],
        confidence: 0.85,
        directlyAddressed: true,
        responseExpected: 0.7,
        interruptAppropriate: false,
        desiredLength: 'very_short',
        tone: 'casual',
        reasonCode: 'NAME_MENTIONED'
      };
      this.logDecision(decision);
      return decision;
    }

    // Rule D: Silence Bias / Cooldown Protection - If not addressed and banter between others, default IGNORE
    if (Date.now() - this.lastSpeakTime < this.socialCooldownMs && !directlyAddressed) {
      return this.getDefaultDecision('SOCIAL_COOLDOWN');
    }

    // Silence is the safe default. Opt in before allowing an LLM to make the
    // bot join conversations where the owner was not addressed.
    if (process.env.ALLOW_UNPROMPTED_RESPONSES !== 'true') {
      return this.getDefaultDecision('BANTER_IGNORE');
    }

    // 2. LOCAL LLM STRUCTURED CLASSIFICATION
    const systemPrompt = `You are the social brain for a Discord voice bot named "${this.botName}" (behaving like owner "Spin").
Decide if the bot should speak.
Return JSON with keys: action ("IGNORE"|"LISTEN"|"SHORT_REACTION"|"ANSWER"|"JOKE"), targetUserIds (array), confidence (number), directlyAddressed (boolean), responseExpected (number), interruptAppropriate (boolean), desiredLength ("very_short"|"short"|"medium"), tone (string), reasonCode (string).`;

    const userPrompt = `Participants: ${context.participants.join(", ")}\nRecent Speech:\n${context.recentTranscripts.join("\n")}`;

    const llmDecision = await this.localLlm.generateStructured<SocialDecision>({
      systemPrompt,
      userPrompt,
      temperature: 0.1
    });

    const validatedDecision = this.validateDecision(llmDecision, lastEvent.discordUserId);
    if (validatedDecision) {
      this.logDecision(validatedDecision);
      return validatedDecision;
    }

    // Default Silence Bias
    return this.getDefaultDecision('BANTER_IGNORE');
  }

  public recordBotSpoke() {
    this.lastSpeakTime = Date.now();
  }

  private containsOwnerAlias(text: string): boolean {
    return this.ownerAliases.some(alias => text.includes(alias));
  }

  private looksLikeQuestion(text: string): boolean {
    return /[?？]|(?:ปะ|ป่ะ|ไหม|มั้ย|ไม|ว่าไง|เล่นไร|ทำไร|เอาไง)(?:\s|$)/i.test(text);
  }

  private looksLikeFollowUpQuestion(text: string): boolean {
    return this.looksLikeQuestion(text) || /(?:แล้ว|ละ|ล่ะ).*มึง|มึง.*(?:อะ|ล่ะ|ละ)$/.test(text);
  }

  private validateDecision(value: SocialDecision | null, fallbackTarget: string): SocialDecision | null {
    if (!value || !['IGNORE', 'LISTEN', 'SHORT_REACTION', 'ANSWER', 'JOKE'].includes(value.action)) {
      return null;
    }

    const desiredLength = ['very_short', 'short', 'medium'].includes(value.desiredLength)
      ? value.desiredLength
      : 'very_short';

    return {
      action: value.action,
      targetUserIds: Array.isArray(value.targetUserIds)
        ? value.targetUserIds.filter(id => typeof id === 'string').slice(0, 10)
        : [fallbackTarget],
      confidence: this.clampNumber(value.confidence, 0, 1, 0.5),
      directlyAddressed: value.directlyAddressed === true,
      responseExpected: this.clampNumber(value.responseExpected, 0, 1, 0),
      interruptAppropriate: value.interruptAppropriate === true,
      desiredLength,
      tone: typeof value.tone === 'string' ? value.tone.slice(0, 40) : 'neutral',
      reasonCode: typeof value.reasonCode === 'string' ? value.reasonCode.slice(0, 80) : 'LLM_CLASSIFICATION',
    };
  }

  private clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  }

  private getDefaultDecision(reason: string = 'DEFAULT_IGNORE'): SocialDecision {
    return {
      action: 'IGNORE',
      targetUserIds: [],
      confidence: 0.5,
      directlyAddressed: false,
      responseExpected: 0,
      interruptAppropriate: false,
      desiredLength: 'very_short',
      tone: 'neutral',
      reasonCode: reason
    };
  }

  private logDecision(decision: SocialDecision) {
    console.log(`\n=== SOCIAL BRAIN DECISION ===`);
    console.log(`Action: ${decision.action} | Reason: ${decision.reasonCode}`);
    console.log(`Target: ${decision.targetUserIds.join(', ') || 'None'} | Conf: ${decision.confidence}`);
    console.log(`=============================\n`);
  }
}
