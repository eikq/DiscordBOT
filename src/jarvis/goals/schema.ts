import type { JsonSchema } from '../capabilities/types';

export type SchemaValidation = { ok: true } | { ok: false; issues: string[] };

const AUTHORITY_KEYS = /^(?:authorization|cookie|credentials?|password|secret|token|api[_-]?key|permission|permissions|grant|confirmed|confirmation|confirmationtoken|proposalid|risk|privilege|admin|sudo|shell|command|argv|executable|pid|headers?|method|body|path)$/iu;

export function validateAgainstJsonSchema(value: unknown, schema: JsonSchema): SchemaValidation {
  const issues: string[] = [];
  validateNode(value, schema, '$', issues);
  return issues.length ? { ok: false, issues } : { ok: true };
}

export function validateAdapterAuthorityBoundary(value: unknown): SchemaValidation {
  const issues: string[] = [];
  inspectAuthority(value, '$', issues, new Set());
  return issues.length ? { ok: false, issues } : { ok: true };
}

function validateNode(value: unknown, schema: JsonSchema, path: string, issues: string[]): void {
  if (Array.isArray(schema.anyOf)) {
    const valid = schema.anyOf.some(candidate => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
      return validateAgainstJsonSchema(value, candidate as JsonSchema).ok;
    });
    if (!valid) issues.push(`${path} does not match an allowed schema alternative.`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(item => Object.is(item, value))) {
    issues.push(`${path} is not an allowed value.`);
    return;
  }
  if ('const' in schema && !Object.is(schema.const, value)) {
    issues.push(`${path} does not match the required value.`);
    return;
  }
  const type = typeof schema.type === 'string' ? schema.type : undefined;
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      issues.push(`${path} must be an object.`);
      return;
    }
    const record = value as Record<string, unknown>;
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [];
    for (const key of required) {
      if (!(key in record) || record[key] === undefined || record[key] === '') issues.push(`${path}.${key} is required.`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) issues.push(`${path}.${key} is not allowed.`);
      }
    }
    for (const [key, item] of Object.entries(record)) {
      const child = properties[key];
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        validateNode(item, child as JsonSchema, `${path}.${key}`, issues);
      }
    }
    return;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) {
      issues.push(`${path} must be an array.`);
      return;
    }
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) issues.push(`${path} has too few items.`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) issues.push(`${path} has too many items.`);
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
      value.forEach((item, index) => validateNode(item, schema.items as JsonSchema, `${path}[${index}]`, issues));
    }
    return;
  }
  if (type === 'string') {
    if (typeof value !== 'string') {
      issues.push(`${path} must be a string.`);
      return;
    }
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) issues.push(`${path} is too short.`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) issues.push(`${path} is too long.`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) issues.push(`${path} has an invalid format.`);
    return;
  }
  if (type === 'boolean' && typeof value !== 'boolean') issues.push(`${path} must be a boolean.`);
  if ((type === 'number' || type === 'integer') && typeof value !== 'number') {
    issues.push(`${path} must be a number.`);
    return;
  }
  if (type === 'integer' && typeof value === 'number' && !Number.isInteger(value)) issues.push(`${path} must be an integer.`);
  if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum) issues.push(`${path} is below the minimum.`);
  if (typeof value === 'number' && typeof schema.maximum === 'number' && value > schema.maximum) issues.push(`${path} exceeds the maximum.`);
}

function inspectAuthority(value: unknown, path: string, issues: string[], seen: Set<object>): void {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value as object)) {
    issues.push(`${path} contains a cycle.`);
    return;
  }
  seen.add(value as object);
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectAuthority(item, `${path}[${index}]`, issues, seen));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (AUTHORITY_KEYS.test(key.replaceAll('-', '').replaceAll('_', ''))) {
      issues.push(`${path}.${key} would create authority or sensitive material.`);
    }
    if (typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') {
      issues.push(`${path}.${key} is not a JSON-safe input.`);
    } else inspectAuthority(item, `${path}.${key}`, issues, seen);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
