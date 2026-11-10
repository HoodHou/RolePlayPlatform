import type { TurnEvent, TurnRequest } from '@roleplay/shared';
import { api } from './client';
import { errorFromResponse, isAbortError, networkError, RequestError } from './errors';
import { readEventStream } from './sse';

function parseTurnEvent(data: string): TurnEvent | null {
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string') {
      return value as TurnEvent;
    }
  } catch {
    // A malformed frame is skipped rather than failing the whole turn.
  }
  return null;
}

/**
 * Plays one turn: POSTs the request and feeds every TurnEvent to `onEvent`
 * until the closing `done` or `error` frame. Throws a RequestError for a
 * non-2xx answer or a stream that ends without a closing frame, and an
 * AbortError when `signal` fires.
 */
export async function streamTurn(
  sessionId: string,
  request: TurnRequest,
  signal: AbortSignal,
  onEvent: (event: TurnEvent) => void,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(api.turnsPath(sessionId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw networkError(err);
  }
  if (!res.ok) throw await errorFromResponse(res);
  if (!res.body) throw new RequestError({ code: 'bad_response', message: 'Turn response has no body' }, res.status);

  let closed = false;
  try {
    await readEventStream(res.body, (frame) => {
      const event = parseTurnEvent(frame.data);
      if (!event) return false;
      onEvent(event);
      closed = event.type === 'done' || event.type === 'error';
      return closed;
    });
  } catch (err) {
    if (isAbortError(err) || signal.aborted) throw err;
    if (!closed) throw new RequestError({ code: 'interrupted', message: err instanceof Error ? err.message : String(err) });
  }
  if (!closed) {
    throw new RequestError({ code: 'interrupted', message: 'The event stream ended before the turn finished.' });
  }
}
