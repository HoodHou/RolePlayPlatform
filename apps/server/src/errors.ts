import type { ApiError, ErrorCode } from '@roleplay/shared';

const HTTP_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  turn_in_progress: 409,
  not_configured: 400,
  auth_failed: 401,
  rate_limited: 429,
  provider_error: 502,
  refused: 422,
  output_truncated: 502,
  empty_response: 502,
  aborted: 499,
  internal: 500,
};

/** An error the client is meant to see, identified by a code it can localize. */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }

  toApiError(): ApiError {
    return { code: this.code, message: this.message };
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new AppError('internal', message, { cause: err });
}
