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

dotenv.config({ quiet: true });

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
  const HOST = process.env.HOST || '127.0.0.1';

  // Initialize Discord Bot
  const botService = new BotService();
  const personaProfiles = new PersonaProfileManager();
  const voiceServiceClient = new VoiceServiceClient();
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
  
  if (process.env.DISCORD_TOKEN) {
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
  app.use(express.json());

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
