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
    this.ownerAliases = aliasesFromEnv.split(",").map(a => a.trim().toLowerCase());
    this.localLlm = new LocalLlmProvider();
  }

  public async evaluate(state: GroupConversationState): Promise<SocialDecision> {
    const context = state.getContext(10);
    
    if (context.recentTranscripts.length === 0) {
      return this.getDefaultDecision();
    }

    const lastTranscript = context.recentTranscripts[context.recentTranscripts.length - 1] || "";
    const lowerLast = lastTranscript.toLowerCase();

    // 1. FAST DETERMINISTIC HYBRID RULES (High Confidence / Zero Cost)
    // Rule A: Was the owner directly addressed by alias?
    const directlyAddressed = this.ownerAliases.some(alias => lowerLast.includes(alias));
    
    // Rule B: Is it a direct question targeting the owner?
    const isDirectQuestion = directlyAddressed && (
      lowerLast.includes("ปะ") || lowerLast.includes("ป่ะ") || 
      lowerLast.includes("ไหม") || lowerLast.includes("ไม") || 
      lowerLast.includes("?" ) || lowerLast.includes("ว่าไง")
    );

    if (isDirectQuestion) {
      const decision: SocialDecision = {
        action: 'ANSWER',
        targetUserIds: context.participants,
        confidence: 0.95,
        directlyAddressed: true,
        responseExpected: 0.95,
        interruptAppropriate: false,
        desiredLength: 'very_short',
        tone: 'casual',
        reasonCode: 'DIRECT_QUESTION_TARGETED'
      };
      this.logDecision(decision);
      return decision;
    }

    // Rule C: Address by name without explicit question
    if (directlyAddressed) {
      const decision: SocialDecision = {
        action: 'SHORT_REACTION',
        targetUserIds: context.participants,
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

    if (llmDecision) {
      this.logDecision(llmDecision);
      return llmDecision;
    }

    // Default Silence Bias
    return this.getDefaultDecision('BANTER_IGNORE');
  }

  public recordBotSpoke() {
    this.lastSpeakTime = Date.now();
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
