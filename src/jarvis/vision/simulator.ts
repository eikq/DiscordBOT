import type { UIElement, VisualContext } from './types';

const FIXTURES: Record<string, VisualContext> = {
  error_dialog: context('Error Dialog', [
    el('dlg', 'dialog', 'Audio Settings failed', false),
    el('btn_ok', 'button', 'OK', false),
  ]),
  settings_panel: context('Settings', [
    el('audio', 'tab', 'Audio Settings', false),
    el('devices', 'tab', 'Device Manager', false),
  ]),
  login_form: context('Sign in', [
    el('user', 'textbox', 'Email', false),
    el('pass', 'textbox', 'Password', true),
    el('submit', 'button', 'Submit', false),
  ]),
};

function el(id: string, role: string, label: string, sensitive: boolean): UIElement {
  return {
    id,
    role,
    label,
    bounds: { x: 40, y: 40, width: 240, height: 36 },
    confidence: 0.92,
    sensitive,
  };
}

function context(windowTitle: string, elements: UIElement[]): VisualContext {
  return {
    windowTitle,
    application: 'simulation',
    elements,
    capturedAt: new Date(0).toISOString(),
    simulated: true,
  };
}

export class SimulatedScreenCapture implements ScreenCaptureLike {
  public async capture(fixtureId = 'settings_panel'): Promise<{ imageId: string; simulated: true }> {
    if (!FIXTURES[fixtureId]) throw Object.assign(new Error('Unknown vision fixture.'), { reasonCode: 'SIMULATION_ONLY' });
    return { imageId: fixtureId, simulated: true };
  }
}

export class SimulatedVisionAnalyzer {
  public async analyze(imageId: string): Promise<VisualContext> {
    const fixture = FIXTURES[imageId] ?? FIXTURES.settings_panel;
    return { ...fixture, elements: fixture.elements.map(item => ({ ...item })), simulated: true };
  }
}

type ScreenCaptureLike = {
  capture(fixtureId?: string): Promise<{ imageId: string; simulated: true }>;
};

export function listVisionFixtures(): string[] {
  return Object.keys(FIXTURES);
}
