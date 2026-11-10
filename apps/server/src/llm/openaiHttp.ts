import { AppError } from '../errors';

/** Small helpers shared by everything that talks to an OpenAI-style HTTP API. */

export function endpointUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

export function requestHeaders(apiKey: string | null): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

/** fetch that reports cancellation and unreachable hosts as AppErrors. */
export async function send(url: string, init: RequestInit & { signal?: AbortSignal }): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (init.signal?.aborted) throw new AppError('aborted', 'The request was cancelled.', { cause: err });
    throw new AppError('provider_error', `Could not reach ${url}.`, { cause: err });
  }
}

// Error codes OpenAI uses when a request is turned down on content grounds.
const CONTENT_REFUSALS = new Set(['moderation_blocked', 'content_policy_violation']);

/** Turns a non-2xx response into the matching AppError. */
export async function failFromResponse(response: Response, url: string, hasKey: boolean): Promise<never> {
  const text = await response.text().catch(() => '');
  let code: unknown;
  try {
    code = (JSON.parse(text) as { error?: { code?: unknown } }).error?.code;
  } catch {
    // Not JSON; the raw text is all there is.
  }
  const message = `${response.status} from ${url}: ${text.slice(0, 500) || response.statusText}`;

  if (response.status === 401 || response.status === 403) {
    throw new AppError(hasKey ? 'auth_failed' : 'not_configured', message);
  }
  if (response.status === 429) throw new AppError('rate_limited', message);
  if (typeof code === 'string' && CONTENT_REFUSALS.has(code)) throw new AppError('refused', message);
  throw new AppError('provider_error', message);
}
