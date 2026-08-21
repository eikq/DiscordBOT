export { DestructiveActionCircuitBreaker, DEFAULT_CIRCUIT_BREAKER_THRESHOLDS } from './circuitBreaker';
export { FailureContainment } from './failureContainment';
export { rollbackForResult, verificationForResult } from './lifecycle';
export type {
  ActionEffect,
  ActionEffectKind,
  ActionEffectTemplate,
  ActionPreflight,
  ActionPrivilege,
  CapabilityRollbackSpec,
  CapabilityVerificationSpec,
  CircuitBreakerDecision,
  CircuitBreakerThresholds,
  OperationalRiskLevel,
  RollbackContract,
  RollbackState,
  VerificationRecord,
  VerificationState,
} from './types';
