import { AppError } from '../errors';
import { resolveRole, type ResolvedSettings } from '../store/settingsStore';
import { AnthropicProvider, type AnthropicEffort } from './anthropic';
import { MockProvider } from './mock';
import { OpenAICompatProvider } from './openaiCompat';
import { OpenAIResponsesProvider } from './openaiResponses';
import type { LLMProvider } from './types';

/**
 * Says plainly that a key is missing, instead of leaving it to whatever the
 * provider answers to an unsigned request (Google, for one, says "not found").
 */
export function requireKey(name: string, apiKey: string | null): void {
  if (!apiKey) throw new AppError('not_configured', `No API key is set for ${name}.`);
}

/**
 * The model that does one job in the game: `gameMaster` tells the story and
 * keeps the world, `actor` speaks for a character. Each has its own
 * connection, model and thinking effort in the settings.
 */
export function createProvider(settings: ResolvedSettings, role: 'gameMaster' | 'actor'): LLMProvider {
  const { provider, model, effort } = resolveRole(settings, role);
  const { maxOutputTokens, temperature } = settings.generation;

  switch (provider) {
    case 'mock':
      return new MockProvider();
    case 'anthropic': {
      const { apiKey, apiKeySource, baseUrl } = settings.connections.anthropic;
      return new AnthropicProvider({
        apiKey,
        hasKey: apiKeySource !== 'none',
        baseUrl,
        model,
        // resolveSettings only lets through the levels Claude has.
        effort: effort as AnthropicEffort | null,
        maxOutputTokens,
      });
    }
    case 'openai': {
      // OpenAI's own API is driven through Responses: it is where its current
      // models combine reasoning with tools.
      const { apiKey, baseUrl } = settings.connections.openai;
      requireKey('OpenAI', apiKey);
      return new OpenAIResponsesProvider({ apiKey, baseUrl, model, effort, maxOutputTokens });
    }
    case 'gemini':
    case 'custom': {
      // Gemini is reached through Google's OpenAI-compatible endpoint, so it and
      // every custom endpoint share the Chat Completions format. A custom
      // endpoint may be a local server that needs no key; Google always does.
      const { apiKey, baseUrl } = settings.connections[provider];
      if (provider === 'gemini') requireKey('Google Gemini', apiKey);
      return new OpenAICompatProvider({ kind: provider, apiKey, baseUrl, model, effort, temperature, maxOutputTokens });
    }
  }
}
