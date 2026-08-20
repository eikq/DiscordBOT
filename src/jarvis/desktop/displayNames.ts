import fs from 'node:fs';
import path from 'node:path';
import { displayIntersectingBounds, pointInDisplay } from './geometry';
import type { DisplayBounds, DisplayInfo, DisplaySelector, OwnerDisplayName } from './types';

export function loadOwnerDisplayNames(workspaceRoot = process.cwd()): OwnerDisplayName[] {
  const file = path.join(workspaceRoot, 'config', 'jarvis', 'displays.json');
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { displays?: OwnerDisplayName[] };
    return Array.isArray(parsed.displays) ? parsed.displays.filter(item => item && typeof item.name === 'string') : [];
  } catch {
    return [];
  }
}

export function applyOwnerDisplayNames(displays: DisplayInfo[], names: OwnerDisplayName[]): DisplayInfo[] {
  return displays.map(display => {
    const named = names.find(item => (
      (item.id && normalizeId(item.id) === normalizeId(display.id))
      || aliasesOf(item).some(alias => alias === normalizeName(display.name) || alias === normalizeId(display.id))
    ));
    if (!named) return display;
    return {
      ...display,
      name: named.name,
      aliases: unique([...display.aliases, ...aliasesOf(named), named.name]),
      ownerNamed: true,
    };
  });
}

export function resolveDisplaySelector(
  displays: DisplayInfo[],
  selector: DisplaySelector,
  currentDisplayId?: string,
): { ok: true; display: DisplayInfo } | { ok: false; reasonCode: 'DISPLAY_NOT_FOUND'; message: string } {
  if (displays.length === 0) {
    return { ok: false, reasonCode: 'DISPLAY_NOT_FOUND', message: 'No displays are visible to Jarvis.' };
  }
  if (selector.id) {
    const hit = displays.find(item => normalizeId(item.id) === normalizeId(selector.id!));
    return hit
      ? { ok: true, display: hit }
      : { ok: false, reasonCode: 'DISPLAY_NOT_FOUND', message: `Display ${selector.id} was not found.` };
  }
  if (selector.index !== undefined) {
    const hit = displays[selector.index - 1];
    return hit
      ? { ok: true, display: hit }
      : { ok: false, reasonCode: 'DISPLAY_NOT_FOUND', message: `Monitor ${selector.index} was not found.` };
  }
  if (selector.name) {
    const needle = normalizeName(selector.name);
    const hit = displays.find(item => (
      normalizeName(item.name) === needle
      || item.aliases.some(alias => normalizeName(alias) === needle)
    ));
    return hit
      ? { ok: true, display: hit }
      : {
        ok: false,
        reasonCode: 'DISPLAY_NOT_FOUND',
        message: `No owner-named display matches “${selector.name}”. Name displays in config/jarvis/displays.json.`,
      };
  }
  if (selector.role === 'primary') {
    const hit = displays.find(item => item.primary) || displays[0];
    return { ok: true, display: hit };
  }
  if (selector.role === 'current') {
    const hit = displays.find(item => item.id === currentDisplayId);
    return hit
      ? { ok: true, display: hit }
      : {
        ok: false,
        reasonCode: 'DISPLAY_NOT_FOUND',
        message: 'Current Jarvis display is unknown. Name the target display.',
      };
  }
  if (selector.role === 'external') {
    const others = displays.filter(item => !item.primary);
    if (others.length === 1) return { ok: true, display: others[0] };
    return {
      ok: false,
      reasonCode: 'DISPLAY_NOT_FOUND',
      message: others.length === 0
        ? 'No external display is connected.'
        : 'More than one external display is connected. Name the target display.',
    };
  }
  if (selector.role === 'notebook') {
    const named = displays.find(item => item.ownerNamed && item.aliases.some(alias => /notebook|laptop|จอโน้ต/iu.test(alias)));
    if (named) return { ok: true, display: named };
    return {
      ok: false,
      reasonCode: 'DISPLAY_NOT_FOUND',
      message: 'Notebook display is not owner-named. Add it to config/jarvis/displays.json.',
    };
  }
  if (selector.role === 'main') {
    const named = displays.find(item => item.ownerNamed && item.aliases.some(alias => /main|จอหลัก/iu.test(alias)));
    if (named) return { ok: true, display: named };
    return {
      ok: false,
      reasonCode: 'DISPLAY_NOT_FOUND',
      message: 'Main display is not owner-named. Add it to config/jarvis/displays.json.',
    };
  }
  return { ok: false, reasonCode: 'DISPLAY_NOT_FOUND', message: 'Display selector was empty.' };
}

export function displayContaining(displays: DisplayInfo[], point: { x: number; y: number }): DisplayInfo | undefined {
  return displays.find(item => pointInDisplay(item, point));
}

export function displayForWindow(displays: DisplayInfo[], bounds: DisplayBounds): DisplayInfo | undefined {
  return displayIntersectingBounds(displays, bounds);
}

function aliasesOf(item: OwnerDisplayName): string[] {
  return [item.name, ...(item.aliases ?? [])].map(normalizeName);
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/\\+/g, '\\');
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(item => item.trim()).filter(Boolean))];
}
