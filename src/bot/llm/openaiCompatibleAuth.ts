/**
 * Bearer auth for the local OpenAI-compatible llama.cpp server.
 * Never log, persist, or return the raw key.
 */

export function resolveLocalQwenApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [
    env.JARVIS_LLM_API_KEY,
    env.LOCAL_QWEN_API_KEY,
    env.JARVIS_QWEN_API_KEY,
    env.LLM_API_KEY,
  ];
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function openaiCompatibleHeaders(apiKey = resolveLocalQwenApiKey()): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

export function describeAuthPresence(apiKey = resolveLocalQwenApiKey()): 'present' | 'absent' {
  return apiKey ? 'present' : 'absent';
}
