export type { SensitiveRegion, UIElement, VisionAction, VisionAnalyzer, VisionPermissionState, VisualContext, ScreenCaptureProvider } from './types';
export { mayPerformVisionAction, visionActionAllowed } from './policy';
export { SimulatedScreenCapture, SimulatedVisionAnalyzer, listVisionFixtures } from './simulator';
