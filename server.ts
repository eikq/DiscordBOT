import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { BotService } from "./src/bot/BotService";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

async function startServer() {
  const app = express();
  const parsedPort = Number(process.env.PORT || 3000);
  const PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 3000;
  const HOST = process.env.HOST || '127.0.0.1';

  // Initialize Discord Bot
  const botService = new BotService();
  let botStatus = "Disconnected";
  
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

  // Load persisted COLAB_TTS_URL if present
  const colabUrlFilePath = path.join(process.cwd(), 'data', 'colab_url.txt');
  if (fs.existsSync(colabUrlFilePath)) {
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
      colabUrl: process.env.COLAB_TTS_URL || null,
      colabAuthenticated: Boolean(process.env.COLAB_API_TOKEN),
      privacy: {
        recordRawAudio: process.env.RECORD_RAW_AUDIO === 'true',
        transcriptRetention: process.env.TRANSCRIPT_RETENTION !== 'false',
        memoryEnabled: process.env.MEMORY_ENABLED !== 'false'
      }
    });
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

  app.post("/api/voice-samples/sync-drive", async (req, res) => {
    const colabClient = botService.getColabVoiceClient();
    if (!colabClient.isConfigured()) {
      return res.status(400).json({ error: "The Colab URL and COLAB_API_TOKEN must both be configured." });
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
            await colabClient.uploadSample({
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
  });

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
        topic: "general"
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
    const ttsBaseUrl = process.env.COLAB_VOICE_URL || process.env.COLAB_TTS_URL || process.env.TTS_BASE_URL;
    
    if (!ttsBaseUrl) {
      return res.status(400).json({ error: "No TTS endpoint is configured (set TTS_BASE_URL or COLAB_TTS_URL)." });
    }

    try {
      console.log(`[TTS API Test] Forwarding text to configured endpoint: "${text}"`);
      const isColab = Boolean(process.env.COLAB_VOICE_URL || process.env.COLAB_TTS_URL);
      const token = process.env.COLAB_API_TOKEN?.trim();
      const speakerId = req.body.speakerId || process.env.OWNER_DISCORD_USER_ID;
      if (isColab && (!speakerId || !botService.getVoiceConsentManager().hasActiveConsentAnywhere(speakerId))) {
        return res.status(400).json({ error: 'Select an actively consented Discord user ID before testing cloned TTS.' });
      }
      const ttsRes = await fetch(`${ttsBaseUrl.replace(/\/$/, '')}${isColab ? '/v1/generate' : '/generate'}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(isColab && token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          text,
          speakerId: speakerId || 'default',
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
