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
const IMAGE_MODEL = /image|dall-e|imagen|seedream|banana|imagine/i;
const NOT_A_CHAT_MODEL =
  /image|dall-e|imagen|seedream|banana|imagine|embedding|tts|whisper|transcribe|moderation|audio|realtime|live|sora|veo|video|seedance|3d|rerank/i;

async function listOpenAIStyle(baseUrl: string, apiKey: string | null): Promise<string[]> {
  if (!baseUrl) throw new AppError('not_configured', 'This connection has no base URL yet.');
  const url = endpointUrl(baseUrl, '/models');
  const response = await send(url, { headers: requestHeaders(apiKey), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return failFromResponse(response, url, apiKey !== null);
  const list = ((await response.json()) as OpenAIModelList).data ?? [];
  return (
    list
      // Newest first; servers that give no dates keep their own order.
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
      // Google lists its models as "models/<id>"; requests take the bare id.
      .map((model) => model.id.replace(/^models\//, ''))
  );
}

async function listAnthropic(connection: ResolvedSettings['connections']['anthropic']): Promise<string[]> {
  const client = new Anthropic({
    ...(connection.apiKey ? { apiKey: connection.apiKey } : {}),
    ...(connection.baseUrl ? { baseURL: connection.baseUrl } : {}),
  });
  const hasKey = connection.apiKeySource !== 'none';
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
  if (target === 'anthropic') return listAnthropic(settings.connections.anthropic);
  if (target === 'image') {
    const { baseUrl, apiKey } = settings.image;
    return (await listOpenAIStyle(baseUrl, apiKey)).filter((id) => IMAGE_MODEL.test(id));
  }
  const { baseUrl, apiKey } = settings.connections[target];
  // Only a custom endpoint may be keyless (a local server).
  if (target !== 'custom' && !apiKey) {
    throw new AppError('not_configured', `No API key is set for the ${target} connection.`);
  }
  return (await listOpenAIStyle(baseUrl, apiKey)).filter((id) => !NOT_A_CHAT_MODEL.test(id));
}
