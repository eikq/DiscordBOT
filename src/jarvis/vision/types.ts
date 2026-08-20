export type VisionAction = 'see' | 'click' | 'type' | 'submit';

export type UIElement = {
  id: string;
  role: string;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  confidence: number;
  sensitive: boolean;
};

export type VisualContext = {
  windowTitle: string;
  application?: string;
  elements: UIElement[];
  capturedAt: string;
  simulated: boolean;
};

export type SensitiveRegion = {
  id: string;
  reason: 'password' | 'token' | 'personal' | 'unknown';
  elementId: string;
};

export type ScreenCaptureProvider = {
  capture(): Promise<{ imageId: string; simulated: boolean }>;
};

export type VisionAnalyzer = {
  analyze(imageId: string): Promise<VisualContext>;
};

export type VisionPermissionState = 'denied' | 'granted' | 'unknown';

export type VisionProviderHealth = {
  capture: 'SIMULATION' | 'REAL' | 'UNAVAILABLE' | 'BLOCKED';
  analyzer: 'SIMULATION' | 'REAL' | 'UNAVAILABLE' | 'BLOCKED';
  permission: VisionPermissionState;
  seeImpliesClick: false;
};

export function defaultVisionHealth(): VisionProviderHealth {
  return {
    capture: 'SIMULATION',
    analyzer: 'SIMULATION',
    permission: 'unknown',
    seeImpliesClick: false,
  };
}
