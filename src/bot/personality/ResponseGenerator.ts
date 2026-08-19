import { SocialDecision } from "../brain/types";
import { GroupConversationState } from "../brain/GroupConversationState";
import { BehaviorRetriever } from "./BehaviorRetriever";
import { StyleProfile, DEFAULT_STYLE_PROFILE } from "./StyleProfile";
import { LocalLlmProvider } from "../llm/LocalLlmProvider";
import { PersonaProfile } from "./PersonaProfileManager";
import { looksLikeConversationalQuestion } from "../brain/QuestionDetector";

export class ResponseGenerator {
  private localLlm: LocalLlmProvider;
  private retriever: BehaviorRetriever;
  private styleProfile: StyleProfile;
  private shortReactionCursor = 0;
  private recentShortReactions: string[] = [];
  private dailyAnswerCursor = 0;
  private recentDailyAnswers: string[] = [];

  constructor(options: { localLlm?: LocalLlmProvider; retriever?: BehaviorRetriever } = {}) {
    this.localLlm = options.localLlm || new LocalLlmProvider();
    this.retriever = options.retriever || new BehaviorRetriever();
    this.styleProfile = DEFAULT_STYLE_PROFILE;
  }

  public async generate(
    decision: SocialDecision,
    state: GroupConversationState,
    persona?: PersonaProfile | null,
    memoryContext = '',
  ): Promise<string | null> {
    if (decision.action === 'IGNORE') {
      return null;
    }

    const context = state.getContext(10);
    const transcriptEvents = state.getRecentTranscriptEvents(10);
    const lastText = transcriptEvents[transcriptEvents.length - 1]?.rawText || '';
    const questionDetected = looksLikeConversationalQuestion(lastText);
    // Defence in depth: even if an upstream classifier calls a spoken question
    // SHORT_REACTION, never answer it with an unrelated filler such as "จริงดิ".
    const responseAction = questionDetected && decision.action === 'SHORT_REACTION'
      ? 'ANSWER'
      : decision.action;
    const responseLength = questionDetected && decision.desiredLength === 'very_short'
      ? 'short'
      : decision.desiredLength;
    const learnedMatch = this.retriever.retrieveBestTextMatch(lastText, responseAction, 0.5, persona?.userId);
    if (learnedMatch?.ownerResponse) {
      return learnedMatch.ownerResponse;
    }

    // Common spoken status questions need an immediate content-bearing answer.
    // A learned persona example above still takes priority when one exists.
    if (questionDetected) {
      const dailyAnswer = this.createDailyQuestionAnswer(lastText);
      if (dailyAnswer) return dailyAnswer;
    }

    // Fast deterministic matching when no learned owner example is close enough.
    const lower = lastText.toLowerCase();

    // These are legacy owner rules. A selected cloned user gets their own
    // profile-specific examples instead of inheriting somebody else's habits.
    if (!persona) {
      if (lower.includes("valo")) {
        return "ไม่อะ ขก.";
      }
      if (lower.includes("minecraft") || lower.includes("มายคราฟ")) {
        return "เอาดิ";
      }
      if (lower.includes("กินไร") || lower.includes("เลือกดิ")) {
        return "อะไรก็ได้";
      }
    }
    if (/(?:กี่โมง|ตอนไหน|เมื่อไหร่)/u.test(lower)) {
      return "ยังไม่รู้ เดี๋ยวบอก";
    }
    if (/(?:เล่นเกมอะไรดี|เล่นไรดี)/u.test(lower)) {
      return "เล่นไรก็ได้";
    }
    if (/(?:คืนนี้|วันนี้).*(?:เข้าเกม|เล่นเกม|เล่น).*(?:ปะ|ไหม|มั้ย)/u.test(lower)) {
      return "ยังไม่รู้ เดี๋ยวบอก";
    }

    // A human does not spend several seconds composing a one-word acknowledgement.
    // Learned persona reactions above still win; this is only the instant fallback.
    if (responseAction === 'SHORT_REACTION') {
      return this.createShortReaction(lastText);
    }

    // Local LLM text generation
    const personaName = persona?.displayName || 'Spin';
    const aliases = persona?.aliases?.length ? persona.aliases.join(', ') : 'Spin, สปิน';
    const personaDescription = persona?.description
      ? `ลักษณะของคุณ: ${persona.description}`
      : 'พูดแบบเพื่อนสนิทอย่างเป็นธรรมชาติ';
    const learnedExamples = this.retriever
      .retrieveRelevant(responseAction, 3, persona?.userId)
      .filter(example => example.ownerResponse)
      .map(example => `เพื่อนพูด "${example.context.at(-1)?.text || ''}" คุณตอบ "${example.ownerResponse}"`)
      .join('\n');
    const examplesInstruction = learnedExamples
      ? `ตัวอย่างคำตอบจริงของ ${personaName}:\n${learnedExamples}`
      : '';
    const configuredWordLimit = Number(process.env.VOICE_REPLY_MAX_WORDS || 22);
    const voiceWordLimit = Number.isFinite(configuredWordLimit)
      ? Math.min(40, Math.max(8, Math.round(configuredWordLimit)))
      : 22;

    const systemPrompt = `คุณคือ ${personaName} กำลังคุยในห้องเสียง Discord กับเพื่อนสนิท
ถ้าเพื่อนเรียกชื่อเหล่านี้ เขากำลังเรียกคุณ: ${aliases}
${personaDescription}
${memoryContext ? `สิ่งที่จำได้จากบทสนทนาจริง (ใช้เฉพาะเมื่อเกี่ยวข้อง ห้ามแต่งเพิ่ม):\n${memoryContext}` : ''}
ตอบประโยคล่าสุดเหมือนมนุษย์คุยกับเพื่อนจริง ๆ ใช้จังหวะภาษาไทยธรรมชาติ ปกติ 1 ประโยค และยาวได้ไม่เกิน ${voiceWordLimit} คำเมื่อจำเป็น ใช้คำอังกฤษเฉพาะศัพท์เกมหรือชื่อเฉพาะ
ไม่ต้องยัดมุกหรือคำหยาบทุกครั้ง ให้ปรับตามอารมณ์และบริบทก่อนหน้า และอย่าพูดซ้ำรูปประโยคเดิมติดกัน
ถ้าประโยคล่าสุดเป็นคำถาม ต้องตอบสิ่งที่ถูกถามโดยตรง ห้ามตอบเพียงคำอุทานลอยๆ เช่น "จริงดิ" "เอาดิ" "เอาดี" "ห้ะ" หรือ "อ๋อ"
คำถามสถานะทั่วไปอย่าง "กินข้าวยัง" ให้ตอบเป็นตัวเองแบบเพื่อนจริงๆ แล้วถามกลับสั้นๆ ได้
ถ้าจะถามกลับ ต้องตอบคำถามเดิมก่อนเสมอ เช่น "ยังเลย มึงอะ" ไม่ใช่ถามคำถามใหม่อย่างเดียว
สไตล์: ${this.styleProfile.averageResponseLength} ใช้ภาษาพูดกันเองได้ เช่น กู มึง เออ ขก ไม่เอาอะ เอาดิ
ถ้าบทสนทนาไม่มีข้อมูลแน่ชัด ห้ามแต่งเวลา ชื่อ หรือข้อเท็จจริง ให้ตอบแบบไม่แน่ใจตามธรรมชาติ
ห้ามพูดเหมือนผู้ช่วย ห้ามอธิบาย ห้ามทักทายแบบทางการ ห้ามใช้ markdown ห้ามบอกว่าเป็นบอท
${examplesInstruction}
ตัวอย่าง: "คืนนี้เข้าเกมปะ" ตอบ "ยังไม่รู้ เดี๋ยวบอก"; "เล่นเกมอะไรดี" ตอบ "เล่นไรก็ได้"; "มึงเข้า valo ปะ" ตอบ "ไม่อะ ขก."
ส่งมาเฉพาะคำตอบสั้นๆ ที่จะพูดออกเสียงเท่านั้น`;

    const userPrompt = `บทสนทนาล่าสุด:\n${context.recentTranscripts.join("\n")}\nประโยคล่าสุดที่ต้องตอบ: "${lastText}"\nประเภทคำตอบ: ${responseAction}\nความยาว: ${responseLength}\nคำถามที่ต้องตอบโดยตรง: ${questionDetected ? 'ใช่ - ต้องให้คำตอบก่อนถามกลับ' : 'ไม่ใช่'}\nน้ำเสียง: ${decision.tone}`;

    const text = await this.localLlm.generateText({
      systemPrompt,
      userPrompt,
      temperature: 0.52,
      maxTokens: responseAction === 'ANSWER' ? 72 : 24
    });

    if (text) {
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>/giu, '')
        .replace(/```[\s\S]*?```/gu, '')
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/^[\s"'`*_]+|[\s"'`*_]+$/gu, '')
        .split(/\r?\n/gu)
        .find(line => line.trim().length > 0)
        ?.trim()
        .slice(0, this.voiceReplyCharacterLimit());
      if (cleaned && this.isNaturalThaiReply(cleaned) && (!questionDetected || this.answersQuestionDirectly(lastText, cleaned))) {
        return cleaned;
      }
      if (cleaned) {
        console.warn(`[ResponseGenerator] Rejected non-answer or unnatural LLM reply: ${JSON.stringify(cleaned)}`);
      }
    }

    // A failed/offline LLM must still answer the subject of a question instead
    // of falling back to an unrelated acknowledgement.
    if (questionDetected || responseAction === 'ANSWER') {
      return this.createQuestionFallback(lastText);
    }

    // Default authentic fallback for non-question turns.
    return "ไม่อะ";
  }

  private isNaturalThaiReply(text: string): boolean {
    if (!/[\u0E00-\u0E7F]/u.test(text)) return false;
    if (/(?:ขอโทษ|ไม่สามารถ|ในฐานะ|ผู้ช่วย|ยินดีให้บริการ|สามารถช่วย|ไม่เข้าใจคำถาม|ฉันเป็นบอท)/u.test(text)) {
      return false;
    }

    const visibleCharacters = [...text].filter(character => /[\p{L}\p{N}]/u.test(character));
    const thaiCharacters = visibleCharacters.filter(character => /[\u0E00-\u0E7F]/u.test(character));
    return visibleCharacters.length === 0 || thaiCharacters.length / visibleCharacters.length >= 0.35;
  }

  private voiceReplyCharacterLimit(): number {
    const configured = Number(process.env.VOICE_REPLY_MAX_CHARS || 240);
    return Number.isFinite(configured) ? Math.min(400, Math.max(120, Math.round(configured))) : 240;
  }

  /**
   * Produces an immediate acknowledgement without paying for another LLM turn.
   * The bank is selected from the current utterance, then rotated so the bot
   * does not sound stuck on one filler word during a voice conversation.
   */
  private createShortReaction(text: string): string {
    const normalized = text.toLowerCase().trim();
    let candidates: string[];

    if (/(?:ฮัลโหล|หวัดดี|สวัสดี|ดีครับ|ดีค่ะ)/u.test(normalized)) {
      candidates = ['ว่าไง', 'ฮัลโหล', 'ไง'];
    } else if (/(?:555+|ฮ่า+|ขำ|อย่างฮา|ตลก)/u.test(normalized)) {
      candidates = ['จริง', 'อย่างฮา', 'กูว่าแล้ว'];
    } else if (/(?:โอ้|โห|เชี่ย|เหี้ย|อะไรวะ|จริงดิ)/u.test(normalized)) {
      candidates = ['โห', 'เชี่ย', 'อ้าว'];
    } else if (/(?:กาก|ตาย|แพ้|โดน|ไม่ไหว|พลาด|หัวร้อน)/u.test(normalized)) {
      candidates = ['เอ้า', 'โห', 'ไม่ไหวละ'];
    } else if (/(?:จริง|ใช่|ถูกแล้ว|เห็นด้วย)/u.test(normalized)) {
      candidates = ['จริง', 'ใช่ปะ', 'กูว่าแล้ว'];
    } else if (/[?？]|(?:ไหม|มั้ย|เหรอ|หรอ|อะไร|ทำไม|ยังไง)\s*$/u.test(normalized)) {
      candidates = ['ห้ะ', 'อะไรนะ', 'งั้นเหรอ'];
    } else {
      candidates = ['อ๋อ', 'จริงดิ', 'ห้ะ', 'อ้าว', 'โห', 'เอาดิ', 'งั้นเหรอ', 'กูว่าแล้ว'];
    }

    const startIndex = this.shortReactionCursor++ % candidates.length;
    const reaction = candidates.find((candidate, offset) =>
      offset >= startIndex && !this.recentShortReactions.includes(candidate),
    ) || candidates.find(candidate => !this.recentShortReactions.includes(candidate)) || candidates[startIndex];

    this.recentShortReactions.push(reaction);
    this.recentShortReactions = this.recentShortReactions.slice(-3);
    return reaction;
  }

  private createQuestionFallback(text: string): string {
    const normalized = text.toLowerCase().trim();
    if (/(?:กินข้าว|กินอะไร|กินไร).*(?:ยัง|ไหม|มั้ย|ปะ|ป่ะ)/u.test(normalized)) {
      return 'ยังเลย มึงอะ';
    }
    if (/(?:ทำอะไรอยู่|ทำไรอยู่|ทำอะไร|ทำไร)/u.test(normalized)) {
      return 'ไม่ได้ทำไร มึงอะ';
    }
    if (/(?:เล่น|เข้าเกม).*(?:ไหม|มั้ย|ปะ|ป่ะ|ยัง)/u.test(normalized)) {
      return 'เอาดิ เล่นไร';
    }
    if (/(?:เป็นไง|ว่าไง)/u.test(normalized)) {
      return 'ก็โอเค มึงอะ';
    }
    return 'ไม่รู้ว่ะ มึงว่าไง';
  }

  private createDailyQuestionAnswer(text: string): string | null {
    const normalized = text.toLowerCase().trim();
    let candidates: string[] | null = null;

    if (/(?:กินข้าว|กินอะไร|กินไร).*(?:ยัง|ไหม|มั้ย|ปะ|ป่ะ)/u.test(normalized)) {
      candidates = ['ยังเลย มึงอะ', 'ยังไม่ได้กินเลย', 'ยังอะ มึงกินยัง'];
    } else if (/(?:นอน|หลับ).*(?:ยัง|ไหม|มั้ย)/u.test(normalized)) {
      candidates = ['ยังอะ', 'ยังไม่นอน', 'ยังอยู่ มึงอะ'];
    } else if (/(?:ง่วง|ง่วงนอน).*(?:ไหม|มั้ย|ปะ|ป่ะ)/u.test(normalized)) {
      candidates = ['ง่วงดิ จะหลับละ', 'ง่วงอยู่', 'โคตรง่วงอะ'];
    } else if (/(?:ทำอะไรอยู่|ทำไรอยู่|ทำอะไร|ทำไร)/u.test(normalized)) {
      candidates = ['ไม่ได้ทำไร มึงอะ', 'นั่งเล่นอยู่', 'ว่างอยู่ มึงอะ'];
    } else if (/(?:เล่น|เข้าเกม).*(?:ไหม|มั้ย|ปะ|ป่ะ|ยัง)/u.test(normalized)) {
      candidates = ['เอาดิ เล่นไร', 'เล่นดิ เข้าเกมไร', 'ได้ มึงเข้าเลย'];
    }

    if (!candidates) return null;
    const startIndex = this.dailyAnswerCursor++ % candidates.length;
    const answer = candidates.find((candidate, offset) =>
      offset >= startIndex && !this.recentDailyAnswers.includes(candidate),
    ) || candidates.find(candidate => !this.recentDailyAnswers.includes(candidate)) || candidates[startIndex];
    this.recentDailyAnswers.push(answer);
    this.recentDailyAnswers = this.recentDailyAnswers.slice(-2);
    return answer;
  }

  private answersQuestionDirectly(question: string, reply: string): boolean {
    const normalizedQuestion = question.toLowerCase().trim();
    const normalizedReply = reply.toLowerCase().trim();
    if (/^(?:จริงดิ|เอาดิ|เอาดี|ห้ะ|อ๋อ|โห|อ้าว|งั้นเหรอ)[.!? ]*$/u.test(normalizedReply)) {
      return false;
    }

    if (/(?:กินข้าว|กินอะไร|กินไร)/u.test(normalizedQuestion)) {
      return /(?:ยัง|กินแล้ว|แล้ว|ไม่ได้กิน|เพิ่งกิน|กำลังกิน|ไม่หิว)/u.test(normalizedReply);
    }
    if (/(?:เล่น|เข้าเกม).*(?:ไหม|มั้ย|ปะ|ป่ะ|ยัง)/u.test(normalizedQuestion)) {
      return /(?:เอา|เล่น|ได้|ไม่|เดี๋ยว|เข้า)/u.test(normalizedReply);
    }

    // Asking back is fine only after a leading answer clause.
    if (looksLikeConversationalQuestion(normalizedReply)) {
      return /^(?:เอา|ได้|ไม่|ยัง|แล้ว|อยู่|กำลัง|ว่าง|ง่วง|รู้|น่าจะ|โอเค|ก็)/u.test(normalizedReply);
    }
    return normalizedReply.length >= 2;
  }
}
