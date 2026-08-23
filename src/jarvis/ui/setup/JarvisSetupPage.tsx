import { useEffect, useMemo, useState } from 'react';
import './setup.css';

type CheckItem = {
  id: string;
  ok: boolean;
  optional?: boolean;
  labelTh: string;
  labelEn: string;
  summaryTh: string;
  summaryEn: string;
};

type Lang = 'th' | 'en';

const copy = {
  th: {
    title: 'ยินดีต้อนรับ',
    lead: 'ตัวช่วยนี้จะตั้งค่า JARVIS ให้พร้อมใช้งาน คุณไม่จำเป็นต้องรู้เรื่อง server หรือ command line',
    start: 'เริ่มตั้งค่า',
    system: 'ตรวจสอบเครื่อง',
    model: 'โมเดล AI',
    services: 'บริการที่จะเปิด',
    review: 'ทบทวน',
    finish: 'บันทึกและเริ่ม JARVIS',
    endpoint: 'ฉันมีเซิร์ฟเวอร์ AI อยู่แล้ว',
    managed: 'ให้ JARVIS เปิด Local AI ให้',
    test: 'ทดสอบการเชื่อมต่อ',
    open: 'เปิด JARVIS',
  },
  en: {
    title: 'Welcome',
    lead: 'This helper will set JARVIS up. You do not need to know servers or the command line.',
    start: 'Start setup',
    system: 'System check',
    model: 'AI model',
    services: 'Services to start',
    review: 'Review',
    finish: 'Save and start JARVIS',
    endpoint: 'I already have an AI server',
    managed: 'Let JARVIS start Local AI',
    test: 'Test connection',
    open: 'Open JARVIS',
  },
};

export default function JarvisSetupPage() {
  const [lang, setLang] = useState<Lang>(() => (navigator.language || 'th').toLowerCase().startsWith('th') ? 'th' : 'en');
  const [step, setStep] = useState(0);
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [mode, setMode] = useState<'endpoint' | 'managed'>('endpoint');
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8086/v1');
  const [modelId, setModelId] = useState('local-model');
  const [apiKey, setApiKey] = useState('');
  const [llamaServerPath, setLlamaServerPath] = useState('');
  const [ggufPath, setGgufPath] = useState('');
  const [probe, setProbe] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = copy[lang];

  useEffect(() => {
    document.title = 'JARVIS Setup';
    void fetch('/api/jarvis/setup')
      .then(reply => reply.json() as Promise<{ completed?: boolean; setup?: { model?: { baseUrl?: string; modelId?: string; mode?: string } } }>)
      .then(payload => {
        if (payload.setup?.model?.baseUrl) setBaseUrl(payload.setup.model.baseUrl);
        if (payload.setup?.model?.modelId) setModelId(payload.setup.model.modelId);
        if (payload.setup?.model?.mode === 'managed') setMode('managed');
      })
      .catch(() => undefined);
  }, []);

  const labels = useMemo(() => lang === 'th'
    ? ['ยินดีต้อนรับ', 'ตรวจสอบเครื่อง', 'โมเดล AI', 'บริการ', 'ทบทวน']
    : ['Welcome', 'System check', 'AI model', 'Services', 'Review'], [lang]);

  const loadCheck = async () => {
    const reply = await fetch('/api/jarvis/setup/check');
    const payload = await reply.json() as { items?: CheckItem[] };
    setChecks(payload.items || []);
  };

  const testModel = async () => {
    setBusy(true);
    setProbe('');
    try {
      const reply = await fetch('/api/jarvis/setup/probe-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey: apiKey || undefined }),
      });
      const payload = await reply.json() as { ok?: boolean; modelIds?: string[]; errorTh?: string; errorEn?: string };
      setProbe(payload.ok
        ? (lang === 'th' ? `เชื่อมต่อสำเร็จ · ${payload.modelIds?.join(', ') || modelId}` : `Connected · ${payload.modelIds?.join(', ') || modelId}`)
        : (lang === 'th' ? payload.errorTh || 'เชื่อมต่อไม่ได้' : payload.errorEn || 'Could not connect'));
    } catch {
      setProbe(lang === 'th' ? 'เชื่อมต่อเซิร์ฟเวอร์โมเดลไม่ได้' : 'Could not reach the model server.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const reply = await fetch('/api/jarvis/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: lang,
          profile: 'standard',
          autoStart: true,
          closeBehavior: 'keep-model',
          managedServiceIds: mode === 'managed' ? ['jarvis-core', 'local-ai'] : ['jarvis-core'],
          apiKey: apiKey || undefined,
          model: {
            mode,
            baseUrl,
            modelId,
            llamaServerPath: llamaServerPath || undefined,
            ggufPath: ggufPath || undefined,
            port: 8086,
            contextSize: 4096,
          },
        }),
      });
      const payload = await reply.json() as { error?: string };
      if (!reply.ok) throw new Error(payload.error || reply.statusText);
      setStep(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="js">
      <header>
        <strong>JARVIS COMMUNITY</strong>
        <button type="button" onClick={() => setLang(lang === 'th' ? 'en' : 'th')}>{lang === 'th' ? 'English' : 'ไทย'}</button>
      </header>
      <ol className="js-steps">{labels.map((label, index) => <li key={label} data-on={index === step ? 'true' : 'false'}>{label}</li>)}</ol>
      {step === 0 ? (
        <section>
          <h1>{t.title}</h1>
          <p>{t.lead}</p>
          <button type="button" onClick={() => { void loadCheck().catch(() => undefined).finally(() => setStep(1)); }}>{t.start}</button>
        </section>
      ) : null}
      {step === 1 ? (
        <section>
          <h1>{t.system}</h1>
          <ul className="js-checks">
            {checks.map(item => (
              <li key={item.id} data-ok={item.ok ? 'true' : 'false'}>
                <strong>{lang === 'th' ? item.labelTh : item.labelEn}</strong>
                <span>{item.ok ? '✓' : item.optional ? '○' : '!'}</span>
                <p>{lang === 'th' ? item.summaryTh : item.summaryEn}</p>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setStep(2)}>ถัดไป / Next</button>
        </section>
      ) : null}
      {step === 2 ? (
        <section>
          <h1>{t.model}</h1>
          <p>{lang === 'th' ? 'โมเดล AI คือส่วนที่ใช้คิดและตอบคำถาม' : 'The AI model is the part that thinks and answers.'}</p>
          <label><input type="radio" checked={mode === 'endpoint'} onChange={() => setMode('endpoint')} /> {t.endpoint}</label>
          <label><input type="radio" checked={mode === 'managed'} onChange={() => setMode('managed')} /> {t.managed}</label>
          <label>URL<input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} /></label>
          <label>Model ID<input value={modelId} onChange={event => setModelId(event.target.value)} /></label>
          {mode === 'managed' ? (
            <>
              <label>llama-server path<input value={llamaServerPath} onChange={event => setLlamaServerPath(event.target.value)} /></label>
              <label>GGUF path<input value={ggufPath} onChange={event => setGgufPath(event.target.value)} /></label>
            </>
          ) : (
            <label>API key (optional)<input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" /></label>
          )}
          <button type="button" disabled={busy} onClick={() => { void testModel(); }}>{t.test}</button>
          {probe ? <p>{probe}</p> : null}
          <p>{lang === 'th' ? 'เชื่อมต่อได้เฉพาะเครื่องนี้ (127.0.0.1) เท่านั้น' : 'Connections are limited to this computer (127.0.0.1).'}</p>
          <button type="button" onClick={() => setStep(3)}>ถัดไป / Next</button>
        </section>
      ) : null}
      {step === 3 ? (
        <section>
          <h1>{t.services}</h1>
          <p>{lang === 'th' ? 'คุณไม่จำเป็นต้องเปิดทุก Service ตลอดเวลา' : 'You do not need every service running all the time.'}</p>
          <ul>
            <li>JARVIS Core — {lang === 'th' ? 'จำเป็น' : 'Required'}</li>
            <li>Local AI — {mode === 'managed' ? (lang === 'th' ? 'JARVIS จะเปิดให้' : 'JARVIS will start it') : (lang === 'th' ? 'ใช้เซิร์ฟเวอร์ที่มีอยู่' : 'Uses your existing server')}</li>
          </ul>
          <button type="button" onClick={() => setStep(4)}>ถัดไป / Next</button>
        </section>
      ) : null}
      {step === 4 ? (
        <section>
          <h1>{t.review}</h1>
          <p>Network: 127.0.0.1 only</p>
          <p>Data: {checks.find(item => item.id === 'data') ? (lang === 'th' ? checks.find(item => item.id === 'data')!.summaryTh : checks.find(item => item.id === 'data')!.summaryEn) : 'data/community/'}</p>
          <p>Model: {baseUrl}</p>
          {error ? <p className="js-error">{error}</p> : null}
          <button type="button" disabled={busy} onClick={() => { void save(); }}>{t.finish}</button>
        </section>
      ) : null}
      {step === 5 ? (
        <section>
          <h1>JARVIS READY</h1>
          <p>{lang === 'th' ? 'ตั้งค่าเสร็จแล้ว' : 'Setup is complete.'}</p>
          <a href="/jarvis">{t.open}</a>
        </section>
      ) : null}
    </main>
  );
}
