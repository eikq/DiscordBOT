import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import { isCommunityEdition, jarvisDataRoot } from '../edition';
import { writeCommunityEnvFile } from './setup/envWriter';
import { probeOpenAiCompatibleEndpoint } from './setup/modelProbe';
import { readCommunitySetup, setupIsComplete, writeCommunitySetup } from './setup/store';
import { runCommunitySystemCheck } from './setup/systemCheck';
import {
  listCommunityServices,
  recordCoreOwnership,
  restartCommunityService,
  startCommunityService,
  stopCommunityService,
} from './runtime/serviceManager';

export function communityNeedsSetup(): boolean {
  return isCommunityEdition() && !setupIsComplete(readCommunitySetup());
}

export function registerCommunityRuntimeRoutes(
  app: Express,
  rejectIfMutationBlocked: (req: Request, res: Response) => boolean,
): void {
  if (!isCommunityEdition()) return;
  recordCoreOwnership();

  app.get(['/jarvis', '/jarvis/'], (_req, res, next) => {
    if (!communityNeedsSetup()) return next();
    res.redirect(302, '/setup');
  });

  app.get('/api/jarvis/setup', (_req, res) => {
    const setup = readCommunitySetup();
    res.json({ completed: setupIsComplete(setup), setup: publicSetup(setup) });
  });

  app.get('/api/jarvis/setup/check', (_req, res) => {
    res.json(runCommunitySystemCheck());
  });

  app.post('/api/jarvis/setup/probe-model', async (req, res) => {
    if (rejectIfMutationBlocked(req, res)) return;
    const baseUrl = typeof req.body?.baseUrl === 'string' ? req.body.baseUrl : '';
    const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey : undefined;
    res.json(await probeOpenAiCompatibleEndpoint({ baseUrl, apiKey }));
  });

  app.post('/api/jarvis/setup/install-deps', async (req, res) => {
    if (rejectIfMutationBlocked(req, res)) return;
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: 'Confirmation is required.', errorTh: 'ต้องยืนยันก่อนติดตั้งส่วนประกอบ' });
    }
    try {
      res.json(await runNpmCi(process.cwd()));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/jarvis/setup', (req, res) => {
    if (rejectIfMutationBlocked(req, res)) return;
    try {
      const body = req.body || {};
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      const saved = writeCommunitySetup({
        completed: true,
        language: body.language === 'en' ? 'en' : 'th',
        profile: body.profile === 'minimal' || body.profile === 'custom' ? body.profile : 'standard',
        autoStart: body.autoStart !== false,
        closeBehavior: body.closeBehavior === 'stop-owned-model' ? 'stop-owned-model' : 'keep-model',
        managedServiceIds: Array.isArray(body.managedServiceIds) ? body.managedServiceIds : ['jarvis-core'],
        model: {
          mode: body.model?.mode === 'managed' ? 'managed' : 'endpoint',
          baseUrl: String(body.model?.baseUrl || ''),
          modelId: String(body.model?.modelId || 'local-model'),
          hasApiKey: Boolean(apiKey) || Boolean(body.model?.hasApiKey),
          llamaServerPath: typeof body.model?.llamaServerPath === 'string' ? body.model.llamaServerPath : undefined,
          ggufPath: typeof body.model?.ggufPath === 'string' ? body.model.ggufPath : undefined,
          contextSize: Number(body.model?.contextSize),
          port: Number(body.model?.port),
          alias: typeof body.model?.alias === 'string' ? body.model.alias : undefined,
        },
      });
      writeCommunityEnvFile({
        JARVIS_LLM_BASE_URL: saved.model.baseUrl,
        JARVIS_LLM_MODEL: saved.model.modelId,
        JARVIS_LLM_API_KEY: apiKey || undefined,
      });
      process.env.JARVIS_LLM_BASE_URL = saved.model.baseUrl;
      process.env.JARVIS_LLM_MODEL = saved.model.modelId;
      if (apiKey) process.env.JARVIS_LLM_API_KEY = apiKey;
      res.json({ completed: true, setup: publicSetup(saved) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/jarvis/services', async (_req, res) => {
    res.json({ dataRoot: jarvisDataRoot(), services: await listCommunityServices() });
  });

  app.post('/api/jarvis/services/:id/:action', async (req, res) => {
    if (rejectIfMutationBlocked(req, res)) return;
    const action = req.params.action;
    if (action !== 'start' && action !== 'stop' && action !== 'restart') {
      return res.status(404).json({ error: 'Unknown service action.' });
    }
    try {
      const service = action === 'start'
        ? await startCommunityService(req.params.id)
        : action === 'stop'
          ? await stopCommunityService(req.params.id)
          : await restartCommunityService(req.params.id);
      res.json({ service });
    } catch (error) {
      const code = (error as { code?: string }).code;
      res.status(code === 'UNKNOWN_SERVICE' ? 404 : 400).json({
        error: error instanceof Error ? error.message : String(error),
        code,
      });
    }
  });
}

function publicSetup(setup: ReturnType<typeof readCommunitySetup>) {
  return { ...setup, model: { ...setup.model } };
}

function runNpmCi(cwd: string): Promise<{ ok: boolean; log: string }> {
  const npmCli = path.join(cwd, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const command = fs.existsSync(npmCli) ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = fs.existsSync(npmCli) ? [npmCli, 'ci'] : ['ci'];
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd,
      timeout: 10 * 60 * 1000,
      windowsHide: true,
      env: { ...process.env },
      maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const log = `${stdout || ''}\n${stderr || ''}`.slice(-4000);
      if (error) reject(new Error(log.trim() || error.message));
      else resolve({ ok: true, log });
    });
  });
}
