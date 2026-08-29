export const MEDIA_CREATE_VIDEO = 'media.createVideo';
export const MEDIA_STATUS = 'media.status';
export const MEDIA_CANCEL = 'media.cancel';
export const MEDIA_GET_OUTPUT = 'media.getOutput';

export const MEDIA_CAPABILITY_IDS = [
  MEDIA_CREATE_VIDEO,
  MEDIA_STATUS,
  MEDIA_CANCEL,
  MEDIA_GET_OUTPUT,
] as const;

export const MEDIA_PROJECT_ID_PATTERN = /^media_[a-z0-9]{8,32}$/u;
export const MEDIA_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
export const MEDIA_MAX_STORYLINE_CHARS = 12_000;
export const MEDIA_MAX_STYLE_CHARS = 800;

export function isMediaCapabilityId(id: string): boolean {
  return (MEDIA_CAPABILITY_IDS as readonly string[]).includes(id);
}

export function isMediaReadCapability(id: string): boolean {
  return id === MEDIA_STATUS;
}
