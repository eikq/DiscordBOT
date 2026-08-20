export type { SensitiveRegion, UIElement, VisionAction, VisionAnalyzer, VisionPermissionState, VisionProviderHealth, VisualContext, ScreenCaptureProvider } from './types';
export { defaultVisionHealth } from './types';
export { mayPerformVisionAction, visionActionAllowed } from './policy';
export { SimulatedScreenCapture, SimulatedVisionAnalyzer, listVisionFixtures } from './simulator';
