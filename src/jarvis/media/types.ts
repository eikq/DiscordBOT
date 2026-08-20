export const MEDIA_STAGES = [
  'TOPIC',
  'RESEARCH',
  'SCRIPT',
  'STORYBOARD',
  'ASSETS',
  'VOICE',
  'SUBTITLES',
  'MUSIC',
  'RENDER',
  'VALIDATE',
  'DELIVER',
] as const;

export type MediaStageId = (typeof MEDIA_STAGES)[number];

export type MediaProductionProvider = {
  id: string;
  kind: 'native_optional' | 'simulated';
  installed: boolean;
};

export const MONEY_PRINTER_TURBO: MediaProductionProvider = {
  id: 'moneyprinterturbo',
  kind: 'native_optional',
  installed: false,
};
