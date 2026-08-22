export const MODEL_HEALTH_STATUSES = [
  'MODEL_READY',
  'MODEL_OFFLINE',
  'MODEL_UNREACHABLE',
  'MODEL_NOT_FOUND',
  'AUTH_FAILED',
] as const;

export type ModelHealthStatus = (typeof MODEL_HEALTH_STATUSES)[number];

export function modelHealthFromHttp(status: number): ModelHealthStatus | undefined {
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status === 404) return 'MODEL_NOT_FOUND';
  return undefined;
}

export function ownerMessageForModelHealth(status: ModelHealthStatus): string {
  if (status === 'MODEL_READY') return '';
  if (status === 'AUTH_FAILED') return 'Qwen local ยังไม่พร้อม ผมยังไม่ได้เริ่มงานนี้ (auth failed)';
  if (status === 'MODEL_NOT_FOUND') return 'Qwen local ยังไม่พร้อม ผมยังไม่ได้เริ่มงานนี้ (model not found)';
  if (status === 'MODEL_UNREACHABLE') return 'Qwen local ยังไม่พร้อม ผมยังไม่ได้เริ่มงานนี้';
  return 'Qwen local ยังไม่พร้อม ผมยังไม่ได้เริ่มงานนี้';
}
