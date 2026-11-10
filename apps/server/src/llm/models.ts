import Anthropic from '@anthropic-ai/sdk';
import type { ModelListTarget } from '@roleplay/shared';
import { AppError } from '../errors';
import type { ResolvedSettings } from '../store/settingsStore';
import { endpointUrl, failFromResponse, requestHeaders, send } from './openaiHttp';

/** Asks a provider which models the configured key can use, so nobody has to type ids from memory. */

interface OpenAIModelList {
  data?: { id: string; created?: number }[];
}

// An OpenAI-style /models list mixes every kind of model the account has.
const IMAGE_MODEL = /image|dall-e/i;
const NOT_A_CHAT_MODEL = /image|dall-e|embedding|tts|whisper|transcribe|moderation|audio|realtime|live|sora/i;

async function listOpenAIStyle(baseUrl: string, apiKey: string | null): Promise<{ id: string; created?: number }[]> {
  const url = endpointUrl(baseUrl, '/models');
  const response = await send(url, { headers: requestHeaders(apiKey), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return failFromResponse(response, url, apiKey !== null);
  const list = ((await response.json()) as OpenAIModelList).data ?? [];
  // Newest first; servers that give no dates keep their own order.
  return list.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
}

async function listAnthropic(settings: ResolvedSettings['anthropic']): Promise<string[]> {
  const client = new Anthropic({
    ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
    ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
  });
  const hasKey = settings.apiKeySource !== 'none';
  try {
    const ids: string[] = [];
    for await (const model of client.models.list({ limit: 100 })) ids.push(model.id);
    return ids;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new AppError(hasKey ? 'auth_failed' : 'not_configured', err.message, { cause: err });
    }
    if (err instanceof Anthropic.RateLimitError) throw new AppError('rate_limited', err.message, { cause: err });
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError(hasKey ? 'provider_error' : 'not_configured', message, { cause: err });
  }
}

export async function listModels(target: ModelListTarget, settings: ResolvedSettings): Promise<string[]> {
  switch (target) {
    case 'anthropic':
      return listAnthropic(settings.anthropic);
    case 'openai-compatible': {
      const { baseUrl, apiKey } = settings.openaiCompatible;
      const models = await listOpenAIStyle(baseUrl, apiKey);
      return models.map((m) => m.id).filter((id) => !NOT_A_CHAT_MODEL.test(id));
    }
    case 'image': {
      const { baseUrl, apiKey } = settings.image;
      const models = await listOpenAIStyle(baseUrl, apiKey);
      return models.map((m) => m.id).filter((id) => IMAGE_MODEL.test(id));
    }
  }
}
