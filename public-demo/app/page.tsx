"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type PipelineState = "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "done";

interface BrowserRecognitionResultEvent {
  results?: ArrayLike<{ 0?: { transcript?: string } }>;
}

interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: BrowserRecognitionResultEvent) => void) | null;
  start(): void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

const examples = [
  "แก้ม กินข้าวหรือยัง คืนนี้เล่นเกมไหม",
  "เมื่อกี้แพ้อีกแล้ว โคตรเหนื่อยเลย",
  "Gam, what should we play tonight?",
];

const pipeline = [
  ["01", "LISTEN", "รับเสียงหรือข้อความโดยไม่เก็บข้อมูลส่วนตัว"],
  ["02", "UNDERSTAND", "แยกภาษาไทย–อังกฤษและตรวจคำถามจริง"],
  ["03", "REMEMBER", "เรียกใช้ความจำที่เกี่ยวข้องเท่านั้น"],
  ["04", "RESPOND", "ตอบตรงคำถามด้วยบุคลิกที่เลือก"],
  ["05", "SPEAK", "ส่งจังหวะและอารมณ์ไปยังระบบเสียง"],
] as const;

function createReply(input: string) {
  const text = input.toLocaleLowerCase("th");
  if (/กินข้าว|กินไร|กินอะไร/u.test(text)) {
    return { reply: "ยังเลย กำลังจะหาอะไรกินอยู่ มึงกินยัง", intent: "daily_status_question", memory: "รูปแบบการคุย: กันเอง · ถามกลับสั้นๆ" };
  }
  if (/เล่น.*(?:เกม|อะไร|ไร)|เกม.*(?:อะไร|ไร)|what should we play/u.test(text)) {
    return { reply: "คืนนี้เล่น Valorant กันปะ กูว่างหลังสองทุ่ม", intent: "game_planning", memory: "กิจกรรมที่เกี่ยวข้อง: Valorant · เล่นกับกลุ่มเพื่อน" };
  }
  if (/แพ้|เหนื่อย|ไม่ไหว|tired|lost/u.test(text)) {
    return { reply: "พักก่อนก็ได้ เดี๋ยวค่อยเอาคืนตาหน้า", intent: "emotional_support", memory: "โทนที่เหมาะสม: soft · ไม่ตอบเป็นคำอุทานลอยๆ" };
  }
  if (/[?？]|(?:ไหม|มั้ย|หรือยัง|ยัง|อะไร|ไหน|ไง)$/u.test(text.trim())) {
    return { reply: "เออ ได้อยู่ เดี๋ยวกูเช็กก่อนแล้วบอกอีกที", intent: "direct_question", memory: "กติกาคำตอบ: ตอบเนื้อหาก่อนถามกลับ" };
  }
  return { reply: "ได้ยินนะ เล่าต่อดิ เมื่อกี้เกิดอะไรขึ้น", intent: "conversation_follow_up", memory: "โหมดสนทนา: รับฟังและต่อบท ไม่แทรกทุกประโยค" };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function Home() {
  const [input, setInput] = useState(examples[0]);
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [intent, setIntent] = useState("waiting_for_input");
  const [memory, setMemory] = useState("ยังไม่มีข้อมูลที่ต้องเรียกใช้");
  const [state, setState] = useState<PipelineState>("idle");
  const [notice, setNotice] = useState("Public demo mode · ไม่มีการอัปโหลดหรือบันทึกเสียง");
  const [voiceMode, setVoiceMode] = useState<"speech" | "singing">("speech");
  const sequenceRef = useRef(0);

  const activeStep = useMemo(() => ({ idle: 0, listening: 1, transcribing: 2, thinking: 4, speaking: 5, done: 5 }[state]), [state]);

  const speak = (text: string) => {
    if (!("speechSynthesis" in window)) {
      setNotice("Browser นี้ไม่รองรับเสียงสาธิต แต่ขั้นตอน AI ทำงานครบแล้ว");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith("th")) || null;
    utterance.lang = "th-TH";
    utterance.rate = voiceMode === "singing" ? 0.82 : 0.94;
    utterance.pitch = voiceMode === "singing" ? 1.08 : 1;
    window.speechSynthesis.speak(utterance);
  };

  const runDemo = async (source = input) => {
    const clean = source.trim();
    if (!clean || state === "transcribing" || state === "thinking" || state === "speaking") return;
    const sequence = ++sequenceRef.current;
    setReply("");
    setTranscript("");
    setState("transcribing");
    setNotice("กำลังแยกภาษาและตรวจคุณภาพข้อความ…");
    await wait(520);
    if (sequence !== sequenceRef.current) return;
    setTranscript(clean);
    setState("thinking");
    setNotice("AI Brain กำลังเลือกความจำและรูปแบบคำตอบ…");
    await wait(680);
    if (sequence !== sequenceRef.current) return;
    const result = createReply(clean);
    setIntent(result.intent);
    setMemory(result.memory);
    setReply(result.reply);
    setState("speaking");
    setNotice("กำลังส่ง prosody ไปยังเสียงสาธิตใน Browser…");
    await wait(430);
    if (sequence !== sequenceRef.current) return;
    speak(result.reply);
    setState("done");
    setNotice("เสร็จแล้ว · เสียงโคลนจริงถูกปิดใน Public Demo เพื่อคุ้มครองเจ้าของเสียง");
  };

  const startMic = () => {
    const browserWindow = window as unknown as {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    const Recognition = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setNotice("Browser นี้ไม่มี Speech Recognition — พิมพ์ข้อความแล้วกด Run AI แทนได้");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "th-TH";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setState("listening");
      setNotice("กำลังฟังจากไมค์ · เสียงไม่ถูกส่งไปเก็บที่เซิร์ฟเวอร์");
    };
    recognition.onerror = () => {
      setState("idle");
      setNotice("เปิดไมค์ไม่สำเร็จ — อนุญาตไมค์หรือใช้ช่องพิมพ์แทนได้");
    };
    recognition.onresult = (event: BrowserRecognitionResultEvent) => {
      const heard = String(event.results?.[0]?.[0]?.transcript || "").trim();
      if (!heard) return;
      setInput(heard);
      void runDemo(heard);
    };
    recognition.start();
  };

  useEffect(() => () => {
    sequenceRef.current += 1;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  return (
    <main>
      <nav className="nav shell" aria-label="Main navigation">
        <a className="brand" href="#top" aria-label="Digital Me home"><span className="brand-mark">DM</span><span>DIGITAL ME</span></a>
        <div className="nav-links">
          <a href="#demo">ทดลอง</a>
          <a href="#system">ระบบ</a>
          <a href="#safety">ความปลอดภัย</a>
          <a className="source-link" href="https://github.com/eikq/DiscordBOT" target="_blank" rel="noreferrer">SOURCE ↗</a>
        </div>
      </nav>

      <section id="top" className="hero shell">
        <div className="hero-copy">
          <p className="eyebrow"><span /> AI CODE HACKATHON 2026</p>
          <h1>เสียงที่จำได้<br /><em>ตัวตนที่คุยรู้เรื่อง</em></h1>
          <p className="lead">AI Discord Companion สำหรับภาษาไทย ที่ฟังบริบท จดจำความสัมพันธ์ ตอบตรงคำถาม และส่งอารมณ์ไปยังเสียงสังเคราะห์—โดยเจ้าของเสียงควบคุมข้อมูลได้</p>
          <div className="hero-actions">
            <a className="primary-action" href="#demo">ลอง Public Demo <span>↓</span></a>
            <a className="text-action" href="#system">ดูระบบเบื้องหลัง</a>
          </div>
          <div className="hero-proof" aria-label="Project capabilities">
            <div><strong>TH + EN</strong><span>mixed-language STT</span></div>
            <div><strong>5 STAGES</strong><span>voice intelligence loop</span></div>
            <div><strong>LOCAL-FIRST</strong><span>private model training</span></div>
          </div>
        </div>
        <div className="hero-signal" aria-hidden="true">
          <div className="signal-orbit orbit-one" />
          <div className="signal-orbit orbit-two" />
          <div className="signal-core"><span>VOICE</span><strong>AI</strong><small>CONSENT SAFE</small></div>
          <div className="wave wave-a" />
          <div className="wave wave-b" />
          <div className="signal-label label-stt">STT / TH-EN</div>
          <div className="signal-label label-memory">SOCIAL MEMORY</div>
          <div className="signal-label label-voice">PROSODY + RVC</div>
        </div>
      </section>

      <section id="demo" className="demo-section">
        <div className="shell">
          <div className="section-heading">
            <p className="eyebrow"><span /> PUBLIC SANDBOX</p>
            <h2>ลองสมองของ Digital Me</h2>
            <p>ทดลองได้จริงโดยไม่แตะ dataset ส่วนตัว เสียงโคลน หรือ Discord token</p>
          </div>

          <div className="demo-console">
            <div className="console-topbar">
              <div className="status-line"><i className={state === "idle" ? "idle-dot" : "live-dot"} /> {state === "idle" ? "READY" : state.toUpperCase()}</div>
              <div className="mode-switch" aria-label="Voice model simulation">
                <button className={voiceMode === "speech" ? "selected" : ""} onClick={() => setVoiceMode("speech")}>Demo Voice</button>
                <button className={voiceMode === "singing" ? "selected" : ""} onClick={() => setVoiceMode("singing")}>Singing Style</button>
              </div>
            </div>

            <div className="console-body">
              <div className="input-column">
                <label htmlFor="demo-input">คุณจะพูดอะไรกับ Digital Me?</label>
                <textarea id="demo-input" value={input} onChange={(event) => setInput(event.target.value)} maxLength={220} />
                <div className="example-row">
                  {examples.map((example, index) => <button key={example} onClick={() => setInput(example)}>0{index + 1}</button>)}
                  <span>เลือกประโยคตัวอย่าง</span>
                </div>
                <div className="input-actions">
                  <button className="mic-action" onClick={startMic} aria-label="Use microphone">● ใช้ไมค์</button>
                  <button className="run-action" onClick={() => void runDemo()} disabled={!input.trim() || ["transcribing", "thinking", "speaking"].includes(state)}>RUN AI →</button>
                </div>
                <p className="privacy-note">🔒 ประมวลผลใน Browser · ไม่บันทึกเสียง · ไม่ส่งข้อมูลฝึกโมเดล</p>
              </div>

              <div className="result-column" aria-live="polite">
                <div className="result-block">
                  <span>TRANSCRIPT</span>
                  <p>{transcript || "รอข้อความหรือเสียงจากคุณ…"}</p>
                </div>
                <div className="result-meta">
                  <div><span>INTENT</span><strong>{intent}</strong></div>
                  <div><span>MEMORY SIGNAL</span><strong>{memory}</strong></div>
                </div>
                <div className="reply-block">
                  <span>DIGITAL ME SAYS</span>
                  <p>{reply || "คำตอบที่มีเนื้อหาจะปรากฏตรงนี้ ไม่ใช่แค่ “เออ” หรือ “จริงดิ”"}</p>
                  <button onClick={() => reply && speak(reply)} disabled={!reply}>▶ ฟังอีกครั้ง</button>
                </div>
                <div className="notice-line">{notice}</div>
              </div>
            </div>

            <div className="pipeline-strip" aria-label="AI processing stages">
              {pipeline.map(([number, title, description], index) => (
                <div key={title} className={activeStep >= index + 1 ? "active" : ""}>
                  <span>{number}</span><strong>{title}</strong><small>{description}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="system" className="system-section shell">
        <div className="system-intro">
          <p className="eyebrow"><span /> ONE CONTINUOUS LOOP</p>
          <h2>ไม่ได้เลียนเสียงอย่างเดียว<br />แต่เรียนรู้ว่าเมื่อไรควรพูด</h2>
        </div>
        <div className="system-copy">
          <p>Digital Me แยก “เสียง” ออกจาก “ตัวตน” เพื่อพัฒนาแต่ละส่วนอย่างตรวจสอบได้: ความแม่นของข้อความ ความเหมาะสมของคำตอบ ความทรงจำที่อ้างอิง และคุณภาพเสียงปลายทาง</p>
          <div className="architecture-line"><span>DISCORD VC</span><i>→</i><span>TH/EN STT</span><i>→</i><span>SOCIAL BRAIN</span><i>→</i><span>JaiTTS + RVC</span></div>
        </div>
      </section>

      <section className="capability-band">
        <div className="shell capability-grid">
          <article><b>01</b><h3>ฟังเฉพาะเป้าหมาย</h3><p>แยกเสียงผู้ใช้ที่กำลังเรียนรู้ พร้อมเก็บบริบทของกลุ่มโดยไม่เอาเสียงคนอื่นไปฝึกโมเดล</p></article>
          <article><b>02</b><h3>จำอย่างมีหลักฐาน</h3><p>ผูกชื่อเล่น เกม กิจกรรม และความสัมพันธ์กับประโยคต้นทาง แทนการเดาหรือแต่งเรื่องเพิ่ม</p></article>
          <article><b>03</b><h3>พูดด้วยบริบท</h3><p>เลือกคำตอบ ความยาว จังหวะ และอารมณ์จากสถานการณ์ ไม่ใช้เสียงหรือคำอุทานซ้ำทุกครั้ง</p></article>
        </div>
      </section>

      <section id="safety" className="safety-section shell">
        <div className="safety-mark">CONSENT<br />FIRST</div>
        <div>
          <p className="eyebrow"><span /> SAFETY BY DESIGN</p>
          <h2>เสียงเป็นข้อมูลชีวมิติ<br />เจ้าของเสียงต้องควบคุมได้</h2>
          <p>Public Demo นี้ตั้งใจไม่เผยแพร่เสียงดิบ โมเดลส่วนตัว ความจำของเพื่อน หรือเครื่องมือฝึกเสียง ระบบจริงใช้การแจ้งเตือนในช่องสนทนาและแยกข้อมูลตามผู้ใช้</p>
          <ul>
            <li>ไม่มี token หรือ secret อยู่ในหน้าเว็บ</li>
            <li>ไม่มี dataset และ model weights ใน public deployment</li>
            <li>เสียง Browser ในหน้านี้เป็น safety voice ไม่ใช่เสียงโคลนของบุคคลจริง</li>
          </ul>
        </div>
      </section>

      <section className="final-cta">
        <div className="shell">
          <p>AI CODE HACKATHON · FREE THEME</p>
          <h2>ทำให้ AI ในห้อง Discord<br />ฟังเป็น จำได้ และพูดเหมือนอยู่ในวงสนทนาจริง</h2>
          <div><a className="primary-action" href="#demo">ทดลองอีกครั้ง ↑</a><a className="text-action" href="https://github.com/eikq/DiscordBOT" target="_blank" rel="noreferrer">ดู Source Code ↗</a></div>
        </div>
      </section>

      <footer className="shell"><span>DIGITAL ME / 2026</span><span>BUILT WITH AI-ASSISTED DEVELOPMENT</span><span>THAILAND</span></footer>
    </main>
  );
}
