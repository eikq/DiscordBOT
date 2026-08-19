export {
  JARVIS_SERVICE_CATALOG,
  JARVIS_SERVICE_IDS,
  SERVICE_ALIASES,
  isJarvisServiceId,
  serviceRecord,
} from './catalog';
export type {
  JarvisServiceCategory,
  JarvisServiceHealth,
  JarvisServiceId,
  JarvisServiceLifecycle,
  JarvisServiceRecord,
} from './catalog';
export { JarvisServiceController } from './controller';
export type { ServiceAdapter, ServiceOpResult, ServiceSnapshot } from './controller';
export { createDefaultServiceAdapters } from './defaultAdapters';
export { clearServiceHealthCache, probeService, probeServiceFresh, serviceBaseUrl } from './health';

import { JarvisServiceController } from './controller';
import { createDefaultServiceAdapters } from './defaultAdapters';

let shared: JarvisServiceController | undefined;

export function createJarvisServiceController(
  adapters = createDefaultServiceAdapters(),
): JarvisServiceController {
  return new JarvisServiceController(adapters);
}

export function sharedJarvisServiceController(): JarvisServiceController {
  shared ??= createJarvisServiceController();
  return shared;
}

export function resetSharedJarvisServiceController(): void {
  shared = undefined;
}
