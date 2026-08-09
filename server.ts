import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { BotService } from "./src/bot/BotService";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

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
        console.log(`[Server Startup] Loaded saved COLAB_TTS_URL = ${savedUrl}`);
      }
    } catch (err) {}
  }

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/bot/status", (req, res) => {
    res.json({ status: botStatus, colabUrl: process.env.COLAB_TTS_URL || null });
  });

  app.post("/api/colab/url", (req, res) => {
    const { url } = req.body;
    if (url && typeof url === 'string') {
      const cleanUrl = url.trim().replace(/\/$/, '');
      process.env.COLAB_TTS_URL = cleanUrl;
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
    const colabUrl = process.env.COLAB_TTS_URL;
    if (!colabUrl) {
      return res.status(400).json({ error: "COLAB_TTS_URL is not configured yet. Paste your Cloudflare URL in the Dashboard first!" });
    }

    try {
      const fs = require('fs');
      const samplesBaseDir = path.join(process.cwd(), 'data', 'voice_samples');
      let totalSynced = 0;

      if (fs.existsSync(samplesBaseDir)) {
        const speakerDirs = fs.readdirSync(samplesBaseDir).filter((f: string) => {
          return fs.statSync(path.join(samplesBaseDir, f)).isDirectory();
        });

        for (const speakerFolder of speakerDirs) {
          const folderPath = path.join(samplesBaseDir, speakerFolder);
          const wavFiles = fs.readdirSync(folderPath).filter((f: string) => f.endsWith('.wav'));

          for (const wavFile of wavFiles) {
            const filePath = path.join(folderPath, wavFile);
            const wavBuffer = fs.readFileSync(filePath);
            
            try {
              const uploadRes = await fetch(`${colabUrl.replace(/\/$/, '')}/upload-sample`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  speaker: speakerFolder,
                  filename: wavFile,
                  audio_base64: wavBuffer.toString('base64')
                })
              });
              if (uploadRes.ok) totalSynced++;
            } catch (syncErr) {
              console.error(`Failed to sync ${wavFile} to Drive:`, syncErr);
            }
          }
        }
      }

      res.json({ success: true, syncedCount: totalSynced, colabUrl });
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
      const fs = require('fs');
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
      const fs = require('fs');
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
      const fs = require('fs');
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
    const colabUrl = process.env.COLAB_TTS_URL;
    
    if (!colabUrl) {
      return res.status(400).json({ error: "COLAB_TTS_URL is not set." });
    }

    try {
      console.log(`[TTS API Test] Forwarding text to Colab: "${text}"`);
      const colabRes = await fetch(`${colabUrl}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!colabRes.ok) {
        const errText = await colabRes.text();
        return res.status(colabRes.status).json({ error: `Colab error: ${errText}` });
      }

      const audioBuffer = await colabRes.arrayBuffer();
      res.setHeader("Content-Type", "audio/wav");
      res.send(Buffer.from(audioBuffer));
    } catch (err: any) {
      console.error("[TTS API Test] Error:", err);
      res.status(500).json({ error: err.message });
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
