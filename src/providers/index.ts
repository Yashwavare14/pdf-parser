import type { LLMProvider } from './types.js';
import { createGeminiProvider } from './geminiProvider.js';
import { createOpenAIProvider } from './openaiProvider.js';

export function getLLMProvider(name?: string): LLMProvider {
  const provider = (name || process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  if (provider === 'gemini') return createGeminiProvider();
  if (provider === 'openai') return createOpenAIProvider();
  throw new Error(`Unsupported LLM provider: ${provider}`);
}

export function getVisionFallbackProvider(name?: string): LLMProvider {
  return getLLMProvider(name || process.env.VISION_FALLBACK_PROVIDER || 'gemini');
}
