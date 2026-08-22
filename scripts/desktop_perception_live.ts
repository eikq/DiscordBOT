/**
 * Owner-machine live evidence for desktop perception.
 * Does not invent verification. Prints handler + observed window/display facts.
 */
import { WindowsDesktopPerception, enumerateWindowsDisplays } from '../src/jarvis/desktop/windowsDisplayHost';
import { fingerprintDisplay, serializeDisplayFingerprint } from '../src/jarvis/desktop/displayIdentity';
import { verifyPlacement } from '../src/jarvis/desktop/perception';

const origin = process.env.JARVIS_LIVE_ORIGIN || 'http://127.0.0.1:3010';
let sessionId = process.env.JARVIS_LIVE_SESSION || 'live-desk-perception-2026-08-22';
const perception = new WindowsDesktopPerception();

type AskBody = {
  intent?: { kind?: string; capabilityId?: string };
  presented?: { text?: string };
  result?: {
    suggestedContent?: string;
    actionResults?: Array<{
      status?: string;
      summary?: string;
      errorCode?: string;
      capabilityId?: string;
      structured?: Record<string, unknown>;
    }>;
  };
  pendingConfirmation?: { capabilityId?: string; proposalId?: string; token?: string };
};

async function ask(text: string): Promise<AskBody> {
  const response = await fetch(`${origin}/api/jarvis/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      text,
      sessionId,
      speak: false,
      actionSource: 'text',
      personaProfileId: 'jarvis',
      voiceProfileId: 'jarvis',
    }),
  });
  return await response.json() as AskBody;
}

async function confirm(pending: NonNullable<AskBody['pendingConfirmation']>): Promise<AskBody> {
  const response = await fetch(`${origin}/api/jarvis/actions/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      proposalId: pending.proposalId,
      token: pending.token,
      sessionId,
      speak: false,
      actionSource: 'ui',
    }),
  });
  return await response.json() as AskBody;
}

function summarizeAsk(label: string, body: AskBody) {
  const action = body.result?.actionResults?.[0];
  const structured = action?.structured || {};
  return {
    label,
    handlerKind: body.intent?.kind ?? null,
    capability: body.intent?.capabilityId ?? action?.capabilityId ?? null,
    spoken: String(body.presented?.text || body.result?.suggestedContent || '').slice(0, 280),
    pending: body.pendingConfirmation?.capabilityId ?? null,
    HANDLER_COMPLETE: action?.status === 'completed',
    WINDOW_VERIFIED: structured.windowVerified === true,
    RESOURCE_VERIFIED: structured.resourceUrlVerified === true,
    DISPLAY_VERIFIED: structured.displayVerified === true || structured.placement === 'placed' || structured.focusVerified === true,
    windowHandle: structured.windowHandle ?? null,
    managedWindowId: structured.managedWindowId ?? null,
    dedicatedWindow: structured.dedicatedWindow ?? null,
    reasonCode: structured.reasonCode ?? action?.errorCode ?? null,
    actionStatus: action?.status ?? null,
    actionSummary: action?.summary ?? null,
  };
}

async function snapshotWindows(label: string) {
  const snap = await perception.snapshot();
  return {
    label,
    cachedHost: snap.cachedHost,
    readOnly: snap.readOnly,
    displays: snap.displays.map(display => ({
      id: display.id,
      primary: display.primary,
      bounds: { x: display.x, y: display.y, width: display.width, height: display.height },
      fingerprint: serializeDisplayFingerprint(fingerprintDisplay(display)),
      devicePath: display.devicePath ?? null,
    })),
    foreground: snap.foreground
      ? { handle: snap.foreground.windowHandle, title: snap.foreground.title, process: snap.foreground.processName }
      : null,
    browserWindows: snap.windows
      .filter(item => /chrome|msedge|cursor/i.test(item.processName || '') || /roblox|youtube|discordbot|jarvis/i.test(item.title || ''))
      .map(item => ({
        handle: item.windowHandle,
        process: item.processName,
        title: item.title,
        bounds: item.bounds,
        displayFingerprint: item.displayFingerprint,
        overlapRatio: item.overlapRatio,
        foreground: item.foreground === true,
      })),
  };
}

async function runTurn(label: string, text: string) {
  const pre = await snapshotWindows(`${label}:pre`);
  let body = await ask(text);
  const rows = [summarizeAsk(label, body)];
  if (body.pendingConfirmation?.proposalId && body.pendingConfirmation.token) {
    body = await confirm(body.pendingConfirmation);
    rows.push(summarizeAsk(`${label}:confirm`, body));
  }
  const post = await snapshotWindows(`${label}:post`);
  return { text, rows, pre, post };
}

async function main() {
  const mode = process.argv[2] || 'all';
  if (mode === 'see' || mode === 'all') {
    const displays = await enumerateWindowsDisplays();
    console.log(JSON.stringify({
      A_displays: displays.map(display => ({
        id: display.id,
        primary: display.primary,
        bounds: { x: display.x, y: display.y, width: display.width, height: display.height },
        fingerprint: serializeDisplayFingerprint(fingerprintDisplay(display)),
        devicePath: display.devicePath ?? null,
      })),
      host: await snapshotWindows('see'),
    }, null, 2));
    if (mode === 'see') return;
  }

  if (mode === 'hi') {
    sessionId = `${sessionId}-hi`;
    const out: unknown[] = [];
    out.push(await runTurn('H_research', 'Research the latest Qwen documentation.'));
    out.push(await runTurn('H_official', 'Which source is official?'));
    const openSource = await runTurn('H_open_source', 'Open that source.');
    out.push(openSource);
    const openSpoken = String(openSource.rows[openSource.rows.length - 1]?.spoken || '');
    if (/AMBIGUOUS_SOURCE|more than one|Which one/i.test(openSpoken)) {
      out.push(await runTurn('H_open_qwencloud', 'Open the QwenCloud source.'));
    }
    out.push(await runTurn('I_project', "We're working on the Jarvis project."));
    out.push(await runTurn('I_cursor', 'Open the project in Cursor.'));
    console.log(JSON.stringify({
      origin,
      sessionId,
      evidence: out.map(item => {
        const turn = item as Awaited<ReturnType<typeof runTurn>>;
        const last = turn.rows[turn.rows.length - 1];
        const handle = typeof last?.windowHandle === 'string' ? last.windowHandle : undefined;
        const observed = handle
          ? turn.post.browserWindows.find(window => window.handle === handle)
          : undefined;
        return {
          text: turn.text,
          handler: last,
          observedWindow: observed ?? null,
          newBrowserHandles: turn.post.browserWindows
            .filter(window => !turn.pre.browserWindows.some(prior => prior.handle === window.handle))
            .map(window => ({ handle: window.handle, title: window.title, process: window.process })),
        };
      }),
    }, null, 2));
    return;
  }

  if (mode === 'place') {
    sessionId = `${sessionId}-place`;
    const sequence = [
      ['C_open_roblox', 'Open Roblox on notebook monitor.'],
      ['D_move_right', 'Move it to the right monitor.'],
      ['E_bring_back', 'Bring it back.'],
      ['F_youtube_there', 'Open YouTube there too.'],
      ['G_focus_roblox', 'Focus Roblox.'],
    ] as const;
    const out: unknown[] = [];
    for (const [label, text] of sequence) {
      out.push(await runTurn(label, text));
    }
    console.log(JSON.stringify({ origin, sessionId: `${sessionId}-place`, evidence: out.map(item => {
      const turn = item as Awaited<ReturnType<typeof runTurn>>;
      const last = turn.rows[turn.rows.length - 1];
      const handle = typeof last?.windowHandle === 'string' ? last.windowHandle : undefined;
      const observed = handle
        ? turn.post.browserWindows.find(window => window.handle === handle)
        : undefined;
      return {
        text: turn.text,
        handler: last,
        observedWindow: observed ?? null,
        ownerChromeUntouched: turn.pre.browserWindows
          .filter(window => /chrome|msedge/i.test(window.process || ''))
          .map(window => {
            const after = turn.post.browserWindows.find(item => item.handle === window.handle);
            return {
              handle: window.handle,
              preTitle: window.title,
              sameBounds: Boolean(after && JSON.stringify(after.bounds) === JSON.stringify(window.bounds)),
              afterTitle: after?.title ?? null,
            };
          }),
        newBrowserHandles: turn.post.browserWindows
          .filter(window => !turn.pre.browserWindows.some(prior => prior.handle === window.handle))
          .map(window => ({ handle: window.handle, title: window.title, process: window.process })),
      };
    }) }, null, 2));
    return;
  }

  const sequence = [
    ['B_notebook_alias', 'What do you remember about my monitors?'],
    ['C_open_roblox', 'Open Roblox on notebook monitor.'],
    ['D_move_right', 'Move it to the right monitor.'],
    ['E_bring_back', 'Bring it back.'],
    ['F_youtube_there', 'Open YouTube there too.'],
    ['G_focus_roblox', 'Focus Roblox.'],
    ['H_research', 'Research the latest Qwen documentation.'],
  ] as const;

  const out: unknown[] = [];
  for (const [label, text] of sequence) {
    out.push(await runTurn(label, text));
  }
  out.push(await runTurn('H_official', 'Which source is official?'));
  const openSource = await runTurn('H_open_source', 'Open that source.');
  out.push(openSource);
  const openSpoken = String(openSource.rows[openSource.rows.length - 1]?.spoken || '');
  if (/AMBIGUOUS_SOURCE|more than one|Which one/i.test(openSpoken)) {
    out.push(await runTurn('H_open_qwencloud', 'Open the QwenCloud source.'));
  }
  out.push(await runTurn('I_project', "We're working on the Jarvis project."));
  out.push(await runTurn('I_cursor', 'Open the project in Cursor.'));

  const displays = await enumerateWindowsDisplays();
  const evidence = out.map(item => {
    const turn = item as Awaited<ReturnType<typeof runTurn>>;
    const last = turn.rows[turn.rows.length - 1];
    const handle = typeof last?.windowHandle === 'string' ? last.windowHandle : undefined;
    const observed = handle
      ? turn.post.browserWindows.find(window => window.handle === handle)
      : undefined;
    const target = displays.find(display => last?.DISPLAY_VERIFIED && observed?.displayFingerprint?.includes(display.devicePath || '___never'));
    return {
      text: turn.text,
      handler: last,
      observedWindow: observed ?? null,
      observedPlacement: observed && target
        ? verifyPlacement({ bounds: observed.bounds }, target)
        : null,
      newBrowserHandles: turn.post.browserWindows
        .filter(window => !turn.pre.browserWindows.some(prior => prior.handle === window.handle))
        .map(window => ({ handle: window.handle, title: window.title, process: window.process })),
    };
  });
  console.log(JSON.stringify({ origin, sessionId, evidence }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
