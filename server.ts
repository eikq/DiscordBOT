import express from "express";
import path from "path";
import fs from "fs";
import http, { IncomingHttpHeaders } from "http";
import https from "https";
import { createServer as createViteServer } from "vite";
import { BotService } from "./src/bot/BotService";
import dotenv from "dotenv";
import { getVoiceBackend, getVoiceServiceApiToken, getVoiceServiceBaseUrl } from "./src/bot/voice/VoiceServiceConfig";
import { PersonaProfileManager } from "./src/bot/personality/PersonaProfileManager";
import { VoiceServiceClient, VoiceTrainingExportOptions } from "./src/bot/voice/VoiceServiceClient";
import { ResearchAssistant } from "./src/bot/research/ResearchAssistant";
import { createJarvisLabRuntime } from "./src/jarvis/standalone/labRuntime";
import { probeStandaloneStt } from "./src/jarvis/audio/sttAvailability";
import { applyJarvisInteractiveProfile } from "./src/jarvis/standalone/runtimeProfile";
import { MemoryGraphAdapter, emptyMemoryGraph, type MemoryGraphSnapshot } from "./src/jarvis/memory/graphAdapter";
import { nightAgentSnapshot, systemHealthSnapshot } from "./src/jarvis/standalone/labSystem";
import { assertLocalMutationRequest, enforceLoopbackBindHost } from "./src/jarvis/standalone/localMutationGuard";
import { isGatedCapabilityId } from "./src/jarvis/capabilities/actions/constants";
import { sharedJarvisEventBus } from "./src/jarvis/security/eventBus";

dotenv.config({ quiet: true });
if (process.env.JARVIS_STANDALONE === '1') {
  const profile = applyJarvisInteractiveProfile();
  console.log(`[Jarvis] runtime profile=${profile.id} keep_alive=${profile.keepAlive} ctx=${profile.contextTokens} timeoutMs=${profile.timeoutMs} gpu_layers=${profile.gpuLayers}`);
}

type VoiceConversionJob = {
  id: string;
  mode: 'speech' | 'vocal' | 'song';
  status: 'processing' | 'complete' | 'failed';
  startedAt: number;
  finishedAt?: number;
  sourceDurationSeconds: number;
  estimatedTotalMs: number;
  error?: string;
};

type BufferedHttpResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
};

const firstHeader = (headers: IncomingHttpHeaders, name: string) => {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

const postBufferedAudio = (
  urlValue: string,
  headers: Record<string, string>,
  body: Buffer,
  timeoutMs: number,
): Promise<BufferedHttpResponse> => new Promise((resolve, reject) => {
  const url = new URL(urlValue);
  const transport = url.protocol === 'https:' ? https : http;
  const request = transport.request(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Length': String(body.length),
      Connection: 'close',
    },
  }, response => {
    const chunks: Buffer[] = [];
    let received = 0;
    const maxResponseBytes = Number(process.env.MAX_VOICE_CONVERSION_RESPONSE_BYTES || 200 * 1024 * 1024);
    response.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buffer.length;
      if (received > maxResponseBytes) {
        response.destroy(new Error('Converted audio exceeds the response size limit.'));
        return;
      }
      chunks.push(buffer);
    });
    response.once('end', () => resolve({
      status: response.statusCode || 500,
      headers: response.headers,
      body: Buffer.concat(chunks),
    }));
    response.once('error', reject);
    response.once('aborted', () => reject(new Error('Voice service closed the conversion response early.')));
  });
  request.setTimeout(timeoutMs, () => {
    request.destroy(new Error(`Voice conversion exceeded the ${Math.ceil(timeoutMs / 60_000)} minute timeout.`));
  });
  request.once('error', reject);
  request.end(body);
});

async function startServer() {
  const app = express();
  const parsedPort = Number(process.env.PORT || 3000);
  const PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 3000;
  const HOST = enforceLoopbackBindHost(process.env.HOST || '127.0.0.1', process.env.JARVIS_STANDALONE === '1');
  if (process.env.JARVIS_STANDALONE === '1' && process.env.HOST && process.env.HOST !== HOST) {
    console.warn(`[Server] JARVIS_STANDALONE refuses non-loopback HOST=${process.env.HOST}; binding ${HOST}.`);
  }

  const rejectIfMutationBlocked = (req: express.Request, res: express.Response): boolean => {
    const guarded = assertLocalMutationRequest({
      method: req.method,
      host: typeof req.headers.host === 'string' ? req.headers.host : undefined,
      origin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
      referer: typeof req.headers.referer === 'string' ? req.headers.referer : undefined,
      secFetchSite: typeof req.headers['sec-fetch-site'] === 'string' ? req.headers['sec-fetch-site'] : undefined,
      contentType: typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : undefined,
      contentLength: Number(req.headers['content-length']),
      url: req.originalUrl || req.url,
    }, { bindHost: HOST, port: PORT });
    if (guarded.ok === false) {
      res.status(guarded.status).json({ error: guarded.error, reasonCode: guarded.reasonCode });
      return true;
    }
    try {
      if (Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') > 16_384) {
        res.status(413).json({ error: 'Request body is too large.', reasonCode: 'BODY_TOO_LARGE' });
        return true;
      }
    } catch {
      res.status(400).json({ error: 'Malformed action payload.', reasonCode: 'MALFORMED_BODY' });
      return true;
    }
    return false;
  };

  const parseLabCapabilityCalls = (raw: unknown): { ok: true; calls?: Array<{ id: string; input: Record<string, unknown> }> } | { ok: false } => {
    if (raw === undefined) return { ok: true };
    if (!Array.isArray(raw)) return { ok: false };
    const calls: Array<{ id: string; input: Record<string, unknown> }> = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false };
      const record = item as { id?: unknown; input?: unknown };
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      if (!id || !isGatedCapabilityId(id)) return { ok: false };
      if (record.input !== undefined && (typeof record.input !== 'object' || Array.isArray(record.input))) {
        return { ok: false };
      }
      calls.push({ id, input: (record.input as Record<string, unknown> | undefined) ?? {} });
    }
    return { ok: true, calls: calls.length ? calls : undefined };
  };

  // Initialize Discord Bot
  const researchAssistant = new ResearchAssistant();
  const botService = new BotService({ researchAssistant });
  const personaProfiles = new PersonaProfileManager();
  const voiceServiceClient = new VoiceServiceClient();
  let activeResearchRequest: ReturnType<ResearchAssistant['ask']> | null = null;
  let botStatus = "Disconnected";
  let dashboardControlRefresh: Promise<unknown> | null = null;
  let dashboardControlCache: { value: unknown; expiresAt: number } | null = null;
  const voiceConversionJobs = new Map<string, VoiceConversionJob>();
  const conversionRealtimeFactors: Record<'speech' | 'vocal' | 'song', number> = {
    speech: Math.max(0.2, Math.min(8, Number(process.env.VOICE_CONVERSION_SPEECH_RTF || 0.7))),
    vocal: Math.max(0.2, Math.min(8, Number(process.env.VOICE_CONVERSION_VOCAL_RTF || 0.8))),
    song: Math.max(0.2, Math.min(12, Number(process.env.VOICE_CONVERSION_SONG_RTF || 1.6))),
  };

  const retainVoiceConversionJob = (jobId: string) => {
    const timer = setTimeout(() => voiceConversionJobs.delete(jobId), 10 * 60_000);
    timer.unref();
  };

  const failVoiceConversionJob = (jobId: string, error: string) => {
    const job = voiceConversionJobs.get(jobId);
    if (!job) return;
    job.status = 'failed';
    job.error = error;
    job.finishedAt = Date.now();
    retainVoiceConversionJob(jobId);
  };
  
  if (process.env.JARVIS_STANDALONE === '1') {
    botStatus = "Standalone Jarvis; Discord client not started.";
    console.log('[Server] JARVIS_STANDALONE=1; Discord client not started.');
  } else if (process.env.DISCORD_TOKEN) {
    botService.start(process.env.DISCORD_TOKEN).then(() => {
        botStatus = "Connected";
    }).catch(err => {
        console.error("Failed to start bot:", err);
        if (err.message.includes('disallowed intents')) {
            botStatus = "Error: Please enable 'Message Content Intent' in the Discord Developer Portal.";
        } else {
            botStatus = `Error: ${err.message}`;
        }
    });
  } else {
    botStatus = "Missing DISCORD_TOKEN in environment.";
  }

  // API routes
  app.use(express.json({ limit: "100kb" }));

  // A saved tunnel URL is loaded only when the legacy Colab backend is explicitly selected.
  const colabUrlFilePath = path.join(process.cwd(), 'data', 'colab_url.txt');
  if (getVoiceBackend() === 'colab' && fs.existsSync(colabUrlFilePath)) {
    try {
      const savedUrl = fs.readFileSync(colabUrlFilePath, 'utf-8').trim();
      if (savedUrl) {
        process.env.COLAB_TTS_URL = savedUrl;
        process.env.COLAB_VOICE_URL = savedUrl;
        console.log(`[Server Startup] Loaded saved COLAB_TTS_URL = ${savedUrl}`);
      }
    } catch (err) {}
  }

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get('/api/intelligence/status', async (_req, res) => {
    try {
      res.json(await researchAssistant.getStatus());
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/intelligence/ask', async (req, res) => {
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Research requests are restricted to the local dashboard.' });
    }
    if (activeResearchRequest) {
      return res.status(409).json({ error: 'The local research core is already answering another request.' });
    }
    const query = typeof req.body?.query === 'string' ? req.body.query : '';
    activeResearchRequest = researchAssistant.ask(query);
    try {
      return res.json({ success: true, ...(await activeResearchRequest) });
    } catch (error) {
      return res.status(502).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      activeResearchRequest = null;
    }
  });

  app.get("/api/bot/status", (req, res) => {
    res.json({
      status: botStatus,
      voiceBackend: getVoiceBackend(),
      voiceServiceUrl: getVoiceServiceBaseUrl() || null,
      voiceServiceAuthenticated: Boolean(getVoiceServiceApiToken()),
      colabUrl: getVoiceServiceBaseUrl() || null,
      colabAuthenticated: Boolean(getVoiceServiceApiToken()),
      privacy: {
        recordRawAudio: process.env.RECORD_RAW_AUDIO === 'true',
        transcriptRetention: process.env.TRANSCRIPT_RETENTION !== 'false',
        memoryEnabled: process.env.MEMORY_ENABLED !== 'false'
      }
    });
  });

  app.get("/api/control", async (req, res) => {
    try {
      const now = Date.now();
      if (dashboardControlCache && dashboardControlCache.expiresAt > now) {
        return res.json(dashboardControlCache.value);
      }
      if (!dashboardControlRefresh) {
        dashboardControlRefresh = botService.getDashboardControlState()
          .then(value => {
            dashboardControlCache = { value, expiresAt: Date.now() + 2_000 };
            return value;
          })
          .finally(() => { dashboardControlRefresh = null; });
      }
      return res.json(await dashboardControlRefresh);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/control", async (req, res) => {
    try {
      const result = await botService.executeDashboardCommand(req.body);
      dashboardControlCache = null;
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/voice-export/preview", async (req, res) => {
    try {
      const userId = String(req.body.userId || '').trim();
      const preview = await voiceServiceClient.previewTrainingExport(userId, req.body as VoiceTrainingExportOptions);
      res.json({ success: true, ...preview });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/voice-export", async (req, res) => {
    try {
      const userId = String(req.body.userId || '').trim();
      const exported = await voiceServiceClient.createTrainingExport(userId, req.body as VoiceTrainingExportOptions);
      res.setHeader('Content-Type', exported.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${exported.filename.replace(/["\r\n]/g, '')}"`);
      for (const header of ['x-digital-me-kept-clips', 'x-digital-me-excluded-clips', 'x-digital-me-sha256']) {
        const value = exported.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      res.send(exported.buffer);
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/brain", (req, res) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      res.json(botService.getSocialMemory(query));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/brain/action", (req, res) => {
    try {
      if (req.body.action === 'export') {
        return res.json({ success: true, vaultPath: botService.exportSocialMemoryVault() });
      }
      res.status(400).json({ error: 'Unsupported brain action.' });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/colab/url", (req, res) => {
    const { url } = req.body;
    if (url && typeof url === 'string') {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url.trim());
        if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
          throw new Error('Unsupported URL');
        }
      } catch {
        return res.status(400).json({ error: "URL must be a valid http(s) address without embedded credentials." });
      }
      const cleanUrl = parsedUrl.toString().replace(/\/$/, '');
      process.env.VOICE_BACKEND = 'colab';
      process.env.COLAB_TTS_URL = cleanUrl;
      process.env.COLAB_VOICE_URL = cleanUrl;
      try {
        const dataDir = path.join(process.cwd(), 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(colabUrlFilePath, cleanUrl, 'utf-8');
      } catch (err) {}
      console.log(`[Colab URL Update] Saved COLAB_TTS_URL = ${cleanUrl}`);
      return res.json({ success: true, colabUrl: cleanUrl });
    }
    res.status(400).json({ error: "Invalid URL provided." });
  });

  const syncVoiceSamples = async (_req: express.Request, res: express.Response) => {
    const voiceClient = botService.getVoiceServiceClient();
    if (!voiceClient.isConfigured()) {
      return res.status(400).json({ error: "The local voice service and VOICE_API_TOKEN must both be configured." });
    }

    try {
      const samplesBaseDir = path.join(process.cwd(), 'data', 'voice_samples');
      const catalogPath = path.join(samplesBaseDir, 'catalog.json');
      let totalSynced = 0;

      if (fs.existsSync(catalogPath)) {
        const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as Array<{
          userId?: string;
          speaker?: string;
          file?: string;
        }>;
        const seen = new Set<string>();
        for (const sample of Array.isArray(catalog) ? catalog : []) {
          if (!sample.userId || !sample.file || seen.has(sample.file)) continue;
          if (!botService.getVoiceConsentManager().hasActiveConsentAnywhere(sample.userId)) continue;
          const filePath = path.resolve(process.cwd(), sample.file.replace(/^\/+/, '').replace(/\//g, path.sep));
          if (!filePath.startsWith(path.resolve(samplesBaseDir) + path.sep) || !fs.existsSync(filePath)) continue;
          seen.add(sample.file);
          try {
            await voiceClient.uploadSample({
              guildId: 'manual-sync',
              userId: sample.userId,
              displayName: sample.speaker || sample.userId,
              filename: path.basename(filePath),
              wavBuffer: fs.readFileSync(filePath),
            });
            totalSynced++;
          } catch (syncError) {
            console.error(`Failed to sync ${filePath}:`, syncError);
          }
        }
      }

      res.json({ success: true, syncedCount: totalSynced });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
  app.post("/api/voice-samples/sync-service", syncVoiceSamples);
  app.post("/api/voice-samples/sync-drive", syncVoiceSamples);

  app.post("/api/bot/start", async (req, res) => {
    const token = req.body.token || process.env.DISCORD_TOKEN;
    if (!token) {
      return res.status(400).json({ error: "No Discord token provided." });
    }
    botStatus = "Connecting...";
    try {
      await botService.start(token);
      botStatus = "Connected";
      res.json({ success: true, status: botStatus });
    } catch (err: any) {
      console.error("Failed to start bot:", err);
      if (err.message?.includes('disallowed intents')) {
        botStatus = "Error: Please enable 'Message Content Intent' in Discord Developer Portal.";
      } else {
        botStatus = `Error: ${err.message}`;
      }
      res.status(500).json({ error: botStatus });
    }
  });

  app.get("/api/behavior", (req, res) => {
    try {
      const dataPath = path.join(process.cwd(), 'data', 'behavior', 'examples.json');
      if (fs.existsSync(dataPath)) {
        const examples = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        return res.json({ examples });
      }
      res.json({ examples: [] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/personas", (req, res) => {
    res.json({
      profiles: personaProfiles.list(),
      defaultPersonaUserId: process.env.DEFAULT_SPEAKER_ID?.trim() || null,
    });
  });

  app.post("/api/personas", (req, res) => {
    try {
      const { userId, displayName, aliases, description } = req.body;
      if (typeof userId !== 'string' || typeof displayName !== 'string') {
        return res.status(400).json({ error: 'Discord user ID and persona name are required.' });
      }
      const aliasList = Array.isArray(aliases)
        ? aliases.filter(alias => typeof alias === 'string')
        : String(aliases || '').split(',');
      const profile = personaProfiles.save(userId.trim(), displayName, aliasList, String(description || ''));
      res.json({ success: true, profile });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/transcripts", (req, res) => {
    try {
      const timeline = botService.getTimeline();
      const events = timeline.getRecentEvents(50);
      res.json({ events });
    } catch (err: any) {
      res.status(500).json({ error: err.message, events: [] });
    }
  });

  app.get("/api/voice-samples", (req, res) => {
    try {
      const catalogPath = path.join(process.cwd(), 'data', 'voice_samples', 'catalog.json');
      if (fs.existsSync(catalogPath)) {
        const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
        return res.json({ samples: catalog });
      }
      res.json({ samples: [] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/behavior", (req, res) => {
    try {
      const dataPath = path.join(process.cwd(), 'data', 'behavior', 'examples.json');
      const dirPath = path.dirname(dataPath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      const { speaker, text, ownerAction, ownerResponse } = req.body;
      const requestedPersonaId = typeof req.body.personaUserId === 'string' ? req.body.personaUserId.trim() : '';
      const personaUserId = /^\d{5,30}$/.test(requestedPersonaId)
        ? requestedPersonaId
        : process.env.DEFAULT_SPEAKER_ID?.trim();

      if (!speaker || !text) {
        return res.status(400).json({ error: "Speaker and text are required." });
      }

      const record = {
        conversationId: `user_ann_${Date.now()}`,
        context: [{ speaker, text }],
        ownerAction: ownerAction || "ANSWER",
        ownerResponse: ownerAction === "IGNORE" ? null : (ownerResponse || "เออ"),
        responseDelayMs: 800,
        relationship: "close_friend",
        directlyAddressed: text.includes("มึง") || text.includes(speaker),
        topic: "general",
        ...(personaUserId ? { personaUserId } : {})
      };

      let existing = [];
      if (fs.existsSync(dataPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        } catch { existing = []; }
      }
      existing.unshift(record);
      fs.writeFileSync(dataPath, JSON.stringify(existing, null, 2));

      res.json({ success: true, record, totalCount: existing.length });
    } catch (err: any) {
      console.error("[API Behavior Error]", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tts/test", async (req, res) => {
    const text = req.body.text || "สวัสดีครับ ทดสอบเสียงพูดจาก Google Colab";
    const ttsBaseUrl = getVoiceServiceBaseUrl();
    
    if (!ttsBaseUrl) {
      return res.status(400).json({ error: "No local voice-service endpoint is configured." });
    }

    try {
      console.log(`[TTS API Test] Forwarding text to configured endpoint: "${text}"`);
      const token = getVoiceServiceApiToken();
      const speakerId = req.body.speakerId || process.env.OWNER_DISCORD_USER_ID;
      if (!speakerId || !botService.getVoiceConsentManager().hasActiveConsentAnywhere(speakerId)) {
        return res.status(400).json({ error: 'Select an actively consented Discord user ID before testing cloned TTS.' });
      }
      const ttsRes = await fetch(`${ttsBaseUrl.replace(/\/$/, '')}/v1/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          text,
          speakerId: speakerId || 'default',
          modelSelection: req.body.modelSelection === 'latest' ? 'latest' : req.body.modelSelection === 'best' ? 'best' : undefined,
          modelVersionId: typeof req.body.modelVersionId === 'string' && /^job_\d+_[a-f0-9]{8}$/.test(req.body.modelVersionId)
            ? req.body.modelVersionId
            : undefined,
          variationSeed: typeof req.body.variationSeed === 'string' ? req.body.variationSeed.slice(0, 120) : undefined,
        }),
        signal: AbortSignal.timeout(Number(process.env.TTS_TIMEOUT_MS || 60000))
      });

      if (!ttsRes.ok) {
        const errText = await ttsRes.text();
        return res.status(ttsRes.status).json({ error: `TTS endpoint error: ${errText}` });
      }

      const audioBuffer = await ttsRes.arrayBuffer();
      res.setHeader("Content-Type", ttsRes.headers.get('content-type') || "application/octet-stream");
      res.send(Buffer.from(audioBuffer));
    } catch (err: any) {
      console.error("[TTS API Test] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post(
    "/api/voice/convert",
    express.raw({ type: () => true, limit: process.env.MAX_VOICE_CONVERSION_BYTES || "100mb" }),
    async (req, res) => {
      const voiceBaseUrl = getVoiceServiceBaseUrl();
      const token = getVoiceServiceApiToken();
      if (!voiceBaseUrl || !token) {
        return res.status(503).json({ error: "The local voice changer is not configured." });
      }
      const speakerId = String(req.query.speakerId || '').trim();
      if (!/^\d{5,30}$/.test(speakerId)) {
        return res.status(400).json({ error: "Choose a Discord member with a trained voice model." });
      }
      if (!botService.getVoiceConsentManager().hasActiveConsentAnywhere(speakerId)) {
        return res.status(400).json({ error: "The selected voice does not have active consent." });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: "Choose or record an audio file first." });
      }

      const modelSelection = req.query.modelSelection === 'latest' ? 'latest' : 'best';
      const requestedModelVersion = String(req.query.modelVersionId || '').trim();
      if (requestedModelVersion && !/^job_\d+_[a-f0-9]{8}$/.test(requestedModelVersion)) {
        return res.status(400).json({ error: 'Invalid voice model version.' });
      }
      const mode = req.query.mode === 'song' ? 'song' : req.query.mode === 'vocal' ? 'vocal' : 'speech';
      const output = req.query.output === 'discord' ? 'discord' : req.query.output === 'both' ? 'both' : 'browser';
      const requestedShift = Number(req.query.f0Shift || 0);
      const f0Shift = Number.isInteger(requestedShift) && requestedShift >= -12 && requestedShift <= 12
        ? requestedShift
        : 0;
      const requestedVocalBoost = Number(req.query.vocalBoostDb ?? process.env.SONG_VOCAL_BOOST_DB ?? 3);
      const vocalBoostDb = Number.isFinite(requestedVocalBoost)
        ? Math.max(-6, Math.min(12, requestedVocalBoost))
        : 3;
      const extension = String(req.headers['x-audio-extension'] || '').toLowerCase();
      const safeExtension = /^\.(wav|mp3|flac|m4a|aac|ogg|opus|webm)$/.test(extension) ? extension : '';
      const contentType = typeof req.headers['content-type'] === 'string'
        ? req.headers['content-type'].split(';', 1)[0]
        : 'application/octet-stream';
      const requestedJobId = String(req.query.jobId || '').trim();
      if (requestedJobId && !/^[A-Za-z0-9_-]{8,80}$/.test(requestedJobId)) {
        return res.status(400).json({ error: 'Invalid voice conversion job ID.' });
      }
      const jobId = requestedJobId || '';
      const declaredDuration = Number(req.headers['x-source-duration-seconds'] || 0);
      const sourceDurationSeconds = Number.isFinite(declaredDuration) && declaredDuration > 0 && declaredDuration <= 600
        ? declaredDuration
        : 0;
      if (jobId) {
        const estimatedFactor = conversionRealtimeFactors[mode];
        const estimatedTotalMs = sourceDurationSeconds > 0
          ? Math.max(8_000, sourceDurationSeconds * estimatedFactor * 1_000 + (mode === 'song' ? 12_000 : 6_000))
          : 30_000;
        voiceConversionJobs.set(jobId, {
          id: jobId,
          mode,
          status: 'processing',
          startedAt: Date.now(),
          sourceDurationSeconds,
          estimatedTotalMs,
        });
      }
      const query = new URLSearchParams({
        speakerId,
        modelSelection,
        ...(requestedModelVersion ? { modelVersionId: requestedModelVersion } : {}),
        mode,
        f0Shift: String(f0Shift),
        vocalBoostDb: String(vocalBoostDb),
      });

      try {
        const timeoutMs = Math.max(60_000, Number(process.env.VOICE_CONVERT_TIMEOUT_MS || 60 * 60_000));
        const convertedResponse = await postBufferedAudio(
          `${voiceBaseUrl.replace(/\/$/, '')}/v1/convert?${query}`,
          {
            Authorization: `Bearer ${token}`,
            'Content-Type': contentType,
            ...(safeExtension ? { 'X-Audio-Extension': safeExtension } : {}),
          },
          req.body,
          timeoutMs,
        );
        if (convertedResponse.status < 200 || convertedResponse.status >= 300) {
          const errorText = convertedResponse.body.toString('utf8');
          let detail = errorText;
          try {
            detail = JSON.parse(errorText)?.detail || errorText;
          } catch {}
          if (jobId) failVoiceConversionJob(jobId, detail || `Voice conversion failed with HTTP ${convertedResponse.status}.`);
          return res.status(convertedResponse.status).json({ error: detail || `Voice conversion failed with HTTP ${convertedResponse.status}.` });
        }
        for (const header of [
          'x-voice-speaker-id',
          'x-voice-model-selection',
          'x-voice-model-version',
          'x-voice-conversion-mode',
          'x-voice-source-duration',
          'x-voice-f0-shift',
          'x-voice-processing-ms',
          'x-voice-processing-pipeline',
          'x-voice-separator',
          'x-voice-separator-device',
          'x-voice-vocal-gain-db',
          'x-voice-vocal-boost-db',
          'x-voice-limiter',
          'x-voice-singing-profile',
        ]) {
          const value = firstHeader(convertedResponse.headers, header);
          if (value) res.setHeader(header, value);
        }
        const convertedAudio = convertedResponse.body;
        const exactDuration = Number(firstHeader(convertedResponse.headers, 'x-voice-source-duration') || sourceDurationSeconds || 0);
        const processingMs = Number(firstHeader(convertedResponse.headers, 'x-voice-processing-ms') || 0);
        if (exactDuration > 0 && processingMs > 0) {
          const observedFactor = Math.max(0.2, Math.min(12, processingMs / (exactDuration * 1_000)));
          conversionRealtimeFactors[mode] = conversionRealtimeFactors[mode] * 0.7 + observedFactor * 0.3;
        }
        if (output === 'discord' || output === 'both') {
          const guildId = String(req.query.guildId || '').trim();
          const voiceChannelId = String(req.query.voiceChannelId || '').trim();
          const queuePosition = botService.queueDashboardAudio(guildId, voiceChannelId, convertedAudio);
          res.setHeader('X-Voice-Discord-Queued', String(queuePosition));
        }
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Disposition', `attachment; filename="voice-change-${speakerId}-${Date.now()}.wav"`);
        if (jobId) {
          const job = voiceConversionJobs.get(jobId);
          if (job) {
            job.status = 'complete';
            job.finishedAt = Date.now();
            job.sourceDurationSeconds = exactDuration || job.sourceDurationSeconds;
            retainVoiceConversionJob(jobId);
          }
        }
        return res.send(convertedAudio);
      } catch (error) {
        console.error('[Voice Changer] Error:', error);
        if (jobId) failVoiceConversionJob(jobId, error instanceof Error ? error.message : String(error));
        return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  app.get('/api/voice/convert/progress/:jobId', (req, res) => {
    const jobId = String(req.params.jobId || '').trim();
    const job = voiceConversionJobs.get(jobId);
    if (!job) return res.status(404).json({ error: 'Voice conversion job not found yet.' });

    const now = Date.now();
    const elapsedMs = Math.max(0, (job.finishedAt || now) - job.startedAt);
    const rawProgress = job.estimatedTotalMs > 0 ? (elapsedMs / job.estimatedTotalMs) * 100 : 0;
    const progress = job.status === 'complete'
      ? 100
      : job.status === 'failed'
        ? Math.min(99, Math.max(1, rawProgress))
        : Math.min(97, Math.max(2, rawProgress));
    const remainingMs = job.status === 'processing'
      ? Math.max(0, job.estimatedTotalMs - elapsedMs)
      : 0;

    return res.json({
      id: job.id,
      status: job.status,
      progress: Math.round(progress * 10) / 10,
      elapsedSeconds: Math.round(elapsedMs / 100) / 10,
      estimatedRemainingSeconds: remainingMs > 0 ? Math.ceil(remainingMs / 1_000) : null,
      estimatedTotalSeconds: Math.round(job.estimatedTotalMs / 100) / 10,
      sourceDurationSeconds: Math.round(job.sourceDurationSeconds * 10) / 10,
      estimated: job.status === 'processing',
      error: job.error || null,
    });
  });

  app.get('/api/colab/notebook', (req, res) => {
    const notebookPath = path.join(process.cwd(), 'colab', 'DigitalMe_RVC_Colab.ipynb');
    if (!fs.existsSync(notebookPath)) {
      return res.status(404).json({ error: 'Colab notebook is not present in this checkout.' });
    }
    return res.download(notebookPath);
  });

  const jarvisLab = createJarvisLabRuntime({
    attachDefaultMemory: true,
    attachDefaultCapabilities: true,
    attachDefaultSkills: true,
    attachDefaultPresentation: true,
    attachDefaultSpeech: true,
    probeStt: probeStandaloneStt,
  });
  app.get('/api/jarvis/status', async (_req, res) => {
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      res.json(await jarvisLab.status());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.post('/api/jarvis/presentation', async (req, res) => {
    if (rejectIfMutationBlocked(req, res)) return;
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      const sessionId = typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
        ? req.body.sessionId.trim()
        : 'jarvis-lab';
      if (typeof req.body?.personaProfileId === 'string') {
        jarvisLab.selectPersona(sessionId, req.body.personaProfileId);
      }
      if (typeof req.body?.voiceProfileId === 'string') {
        jarvisLab.selectVoice(sessionId, req.body.voiceProfileId);
      }
      return res.json(await jarvisLab.presentationStatus(sessionId));
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.post('/api/jarvis/ask', async (req, res) => {
    if (rejectIfMutationBlocked(req, res)) return;
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      const parsedCalls = parseLabCapabilityCalls(req.body?.capabilityCalls);
      if (!parsedCalls.ok) return res.status(400).json({ error: 'Malformed action payload.', reasonCode: 'MALFORMED_BODY' });
      const text = typeof req.body?.text === 'string' ? req.body.text : '';
      const personaProfileId = typeof req.body?.personaProfileId === 'string' ? req.body.personaProfileId : undefined;
      const voiceProfileId = typeof req.body?.voiceProfileId === 'string' ? req.body.voiceProfileId : undefined;
      const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
      const oneTurn = Boolean(req.body?.oneTurn);
      const capabilities = Array.isArray(req.body?.capabilities)
        ? req.body.capabilities.filter((id: unknown) => typeof id === 'string')
        : [];
      const speak = Boolean(req.body?.speak);
      const actionSource = req.body?.actionSource === 'voice' || req.body?.actionSource === 'ui'
        ? req.body.actionSource
        : 'text';
      return res.json(await jarvisLab.ask({
        text,
        personaProfileId,
        voiceProfileId,
        sessionId,
        oneTurn,
        capabilities,
        capabilityCalls: parsedCalls.calls,
        speak,
        actionSource,
      }));
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.post('/api/jarvis/ask-stream', async (req, res) => {
    if (rejectIfMutationBlocked(req, res)) return;
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      const parsedCalls = parseLabCapabilityCalls(req.body?.capabilityCalls);
      if (!parsedCalls.ok) return res.status(400).json({ error: 'Malformed action payload.', reasonCode: 'MALFORMED_BODY' });
      const text = typeof req.body?.text === 'string' ? req.body.text : '';
      const personaProfileId = typeof req.body?.personaProfileId === 'string' ? req.body.personaProfileId : undefined;
      const voiceProfileId = typeof req.body?.voiceProfileId === 'string' ? req.body.voiceProfileId : undefined;
      const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
      const oneTurn = Boolean(req.body?.oneTurn);
      const capabilities = Array.isArray(req.body?.capabilities)
        ? req.body.capabilities.filter((id: unknown) => typeof id === 'string')
        : [];
      const speak = Boolean(req.body?.speak);
      const actionSource = req.body?.actionSource === 'voice' || req.body?.actionSource === 'ui'
        ? req.body.actionSource
        : 'text';
      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Cache-Control', 'no-cache');
      await jarvisLab.askStream({
        text,
        personaProfileId,
        voiceProfileId,
        sessionId,
        oneTurn,
        capabilities,
        capabilityCalls: parsedCalls.calls,
        speak,
        actionSource,
      }, event => {
        res.write(`${JSON.stringify(event)}\n`);
      });
      res.end();
    } catch (error) {
      if (res.headersSent) {
        res.write(`${JSON.stringify({ type: 'error', error: error instanceof Error ? error.message : String(error) })}\n`);
        return res.end();
      }
      return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.post('/api/jarvis/actions/confirm', async (req, res) => {
    if (rejectIfMutationBlocked(req, res)) return;
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      const proposalId = typeof req.body?.proposalId === 'string' ? req.body.proposalId : '';
      const token = typeof req.body?.token === 'string' ? req.body.token : '';
      if (!proposalId || !token) return res.status(400).json({ error: 'proposalId and token are required.' });
      const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
      const speak = Boolean(req.body?.speak);
      const actionSource = req.body?.actionSource === 'voice' ? 'voice' : 'ui';
      return res.json(await jarvisLab.confirmAction({ proposalId, token, sessionId, speak, actionSource }));
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.post('/api/jarvis/actions/deny', async (req, res) => {
    if (rejectIfMutationBlocked(req, res)) return;
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      const proposalId = typeof req.body?.proposalId === 'string' ? req.body.proposalId : '';
      if (!proposalId) return res.status(400).json({ error: 'proposalId is required.' });
      const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
      const speak = Boolean(req.body?.speak);
      const actionSource = req.body?.actionSource === 'voice' ? 'voice' : 'ui';
      return res.json(await jarvisLab.denyAction({ proposalId, sessionId, speak, actionSource }));
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.post('/api/jarvis/speak/cancel', async (req, res) => {
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      const turnId = typeof req.body?.turnId === 'string' ? req.body.turnId : '';
      if (!turnId) return res.status(400).json({ error: 'turnId is required.' });
      await jarvisLab.cancelSpeech(turnId);
      return res.json({ cancelled: true, turnId });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  let labGraphAdapter: MemoryGraphAdapter | null | undefined;
  let labGraphCache: { at: number; snapshot: MemoryGraphSnapshot } | null = null;
  const labGraph = (): MemoryGraphAdapter | null => {
    if (labGraphAdapter !== undefined) return labGraphAdapter;
    try {
      labGraphAdapter = new MemoryGraphAdapter();
    } catch (error) {
      console.warn(`[JarvisLab] Memory graph not attached: ${error instanceof Error ? error.message : error}`);
      labGraphAdapter = null;
    }
    return labGraphAdapter;
  };
  app.get('/api/jarvis/memory/graph', (_req, res) => {
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      const adapter = labGraph();
      if (!adapter) return res.json(emptyMemoryGraph('Memory store is not attached.'));
      if (labGraphCache && Date.now() - labGraphCache.at < 15_000) {
        return res.json(labGraphCache.snapshot);
      }
      const snapshot = adapter.snapshot();
      labGraphCache = { at: Date.now(), snapshot };
      return res.json(snapshot);
    } catch (error) {
      return res.json(emptyMemoryGraph(error instanceof Error ? error.message : String(error)));
    }
  });
  app.get('/api/jarvis/memory/node', (req, res) => {
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      const adapter = labGraph();
      const id = String(req.query.id || '').trim();
      if (!adapter) return res.json({ found: false, id, relations: [], reason: 'Memory store is not attached.' });
      return res.json(adapter.nodeDetail(id));
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.get('/api/jarvis/system', async (_req, res) => {
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      res.json(await systemHealthSnapshot());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.get('/api/jarvis/night', (_req, res) => {
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      res.json(nightAgentSnapshot());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.get('/api/jarvis/events', (req, res) => {
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    if (req.query.stream === '1') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const unsubscribe = sharedJarvisEventBus().subscribe(event => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
      req.on('close', unsubscribe);
      return;
    }
    try {
      return res.json({ events: jarvisLab.recentOperations() });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.get('/api/jarvis/security', async (_req, res) => {
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      return res.json(await jarvisLab.securitySnapshot());
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.get('/api/jarvis/private-research', async (_req, res) => {
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      return res.json(await jarvisLab.privateResearchSnapshot());
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.get('/api/jarvis/research', (_req, res) => {
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      return res.json(jarvisLab.researchSnapshot());
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.get('/api/jarvis/workspace', (req, res) => {
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    if (req.query.path || req.query.file || req.query.root) {
      return res.status(400).json({ error: 'Raw filesystem paths are not allowed.', reasonCode: 'FORBIDDEN_ARGUMENT' });
    }
    try {
      return res.json(jarvisLab.workspaceSnapshot());
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.post('/api/jarvis/workspace/refresh', (req, res) => {
    if (rejectIfMutationBlocked(req, res)) return;
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    if (req.body?.path || req.query.path) {
      return res.status(400).json({ error: 'Raw filesystem paths are not allowed.', reasonCode: 'FORBIDDEN_ARGUMENT' });
    }
    try {
      const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : 'jarvis-project';
      return res.json(jarvisLab.refreshWorkspace(workspaceId));
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.get('/api/jarvis/reminders', (_req, res) => {
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      return res.json(jarvisLab.reminderSnapshot());
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.post('/api/jarvis/reminders/ack', async (req, res) => {
    if (rejectIfMutationBlocked(req, res)) return;
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      const reminderId = typeof req.body?.reminderId === 'string' ? req.body.reminderId : '';
      const occurrenceAt = typeof req.body?.occurrenceAt === 'string' ? req.body.occurrenceAt : '';
      const action = req.body?.action === 'complete' || req.body?.action === 'snooze' ? req.body.action : 'dismiss';
      const minutes = typeof req.body?.minutes === 'number' ? req.body.minutes : undefined;
      if (!reminderId || !occurrenceAt) {
        return res.status(400).json({ error: 'reminderId and occurrenceAt are required.', reasonCode: 'INVALID_ARGUMENT' });
      }
      return res.json(await jarvisLab.ackReminder({ reminderId, occurrenceAt, action, minutes }));
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.post('/api/jarvis/transcribe', express.raw({ type: '*/*', limit: '8mb' }), async (req, res) => {
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      return res.status(403).json({ error: 'Jarvis lab requests are restricted to the local dashboard.' });
    }
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
      if (body.length < 2) return res.status(400).json({ error: 'Microphone audio was empty.' });
      const sampleRate = Number(req.headers['x-jarvis-sample-rate'] || 48_000);
      const channels = Number(req.headers['x-jarvis-channels'] || 2);
      const turnId = typeof req.headers['x-jarvis-turn-id'] === 'string' ? req.headers['x-jarvis-turn-id'] : undefined;
      const captureDurationMs = Number(req.headers['x-jarvis-capture-ms']);
      const voicedMs = Number(req.headers['x-jarvis-voiced-ms']);
      const result = await jarvisLab.transcribe({
        pcm: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
        sampleRate: Number.isFinite(sampleRate) ? sampleRate : 48_000,
        channels: Number.isFinite(channels) ? channels : 2,
        turnId,
        ...(Number.isFinite(captureDurationMs) && captureDurationMs > 0 ? { captureDurationMs } : {}),
        ...(Number.isFinite(voicedMs) && voicedMs > 0 ? { voicedMs } : {}),
      });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });

}

startServer().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
