import type { ResolvedSettings } from '../store/settingsStore';
import { AnthropicProvider } from './anthropic';
import { MockProvider } from './mock';
import { OpenAICompatProvider } from './openaiCompat';
import { OpenAIResponsesProvider } from './openaiResponses';
import type { LLMProvider } from './types';

/** OpenAI's own API, as opposed to another server speaking its wire format. */
export function isOpenAIItself(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

export function createProvider(settings: ResolvedSettings): LLMProvider {
  switch (settings.activeProvider) {
    case 'anthropic': {
      const { apiKey, apiKeySource, baseUrl, model, effort } = settings.anthropic;
      return new AnthropicProvider({ apiKey, hasKey: apiKeySource !== 'none', baseUrl, model, effort });
    }
    case 'openai-compatible': {
      const { apiKey, baseUrl, model } = settings.openaiCompatible;
      // OpenAI itself is driven through its Responses API; every other server
      // gets Chat Completions, the format they all share.
      return isOpenAIItself(baseUrl)
        ? new OpenAIResponsesProvider({ apiKey, baseUrl, model })
        : new OpenAICompatProvider({ apiKey, baseUrl, model });
    }
    case 'mock':
      return new MockProvider();
  }
}
