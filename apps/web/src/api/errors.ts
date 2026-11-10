import { ERROR_CODES, type ErrorCode, type ErrorResponse } from '@roleplay/shared';

/** Failures the browser detects on its own; the server never sends these codes. */
export const CLIENT_ERROR_CODES = ['network', 'interrupted', 'bad_response'] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];
export type KnownErrorCode = ErrorCode | ClientErrorCode;

/**
 * An error ready to show. `code` is a plain string because a newer server may
 * send codes this client does not know yet; those fall back to `message`.
 */
export interface UiError {
  code: string;
  message: string;
}

const KNOWN_CODES = new Set<string>([...ERROR_CODES, ...CLIENT_ERROR_CODES]);

export function isKnownErrorCode(code: string): code is KnownErrorCode {
  return KNOWN_CODES.has(code);
}

export class RequestError extends Error {
  readonly info: UiError;
  readonly status: number | undefined;

  constructor(info: UiError, status?: number) {
    super(info.message);
    this.name = 'RequestError';
    this.info = info;
    this.status = status;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function isErrorResponse(body: unknown): body is ErrorResponse {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false;
  const error: unknown = body.error;
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string';
}

/** Builds the error for a non-2xx response, which should carry an ErrorResponse body. */
export async function errorFromResponse(res: Response): Promise<RequestError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON; handled below.
  }
  if (isErrorResponse(body)) {
    const message = typeof body.error.message === 'string' ? body.error.message : '';
    return new RequestError({ code: body.error.code, message }, res.status);
  }
  // Vite's dev proxy answers with a bare 5xx when the API server is not running.
  const unreachable = body === null && res.status >= 500 && res.status <= 504;
  return new RequestError(
    { code: unreachable ? 'network' : 'bad_response', message: `HTTP ${res.status} ${res.statusText}`.trim() },
    res.status,
  );
}

/** fetch() itself rejects (with a TypeError) when the server cannot be reached. */
export function networkError(err: unknown): RequestError {
  return new RequestError({ code: 'network', message: err instanceof Error ? err.message : String(err) });
}

export function toUiError(err: unknown): UiError {
  if (err instanceof RequestError) return err.info;
  return { code: 'internal', message: err instanceof Error ? err.message : String(err) };
}
