import type { Message } from './session';
import type { Locale, WorldState } from './world';

/**
 * REST
 *   GET    /api/health                 -> { ok: true }
 *   GET    /api/settings               -> PublicSettings
 *   PUT    /api/settings               UpdateSettingsRequest -> PublicSettings
 *   GET    /api/settings/models?target=<ModelListTarget> -> ModelListResponse
 *                                      (asks the provider, using the saved settings and key)
 *   GET    /api/sessions               -> SessionSummary[]
 *   POST   /api/sessions               CreateSessionRequest -> Session
 *   GET    /api/sessions/:id           -> Session
 *   DELETE /api/sessions/:id           -> { ok: true }
 *   POST   /api/sessions/:id/turns     TurnRequest -> text/event-stream of TurnEvent
 *   GET    /api/images/:sessionId/:file -> the image bytes (the `url` of image messages)
 *
 * Failed requests answer with a non-2xx status and an ErrorResponse body.
 */

export interface ModelListResponse {
  /** Model ids the configured key can use, most relevant first. */
  models: string[];
}

export const ERROR_CODES = [
  'bad_request',
  'not_found',
  'turn_in_progress',
  /** The active provider has no API key or model yet. */
  'not_configured',
  'auth_failed',
  'rate_limited',
  'provider_error',
  /** The model declined to continue the scene. */
  'refused',
  'output_truncated',
  'empty_response',
  'aborted',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  code: ErrorCode;
  /** English detail for logs and as a fallback; the UI words errors by `code`. */
  message: string;
}

export interface ErrorResponse {
  error: ApiError;
}

export interface CreateSessionRequest {
  language: Locale;
  premise?: string;
  playerName?: string;
  playerConcept?: string;
}

/** `start` generates the opening scene of a new session; `action` plays a turn. */
export type TurnRequest = { kind: 'start' } | { kind: 'action'; text: string };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

/**
 * Events streamed while a turn is generated. Each SSE frame is
 * `event: <type>` + `data: <JSON of the whole TurnEvent>`.
 *
 * Narration streams as `narration_delta` frames sharing one `id`; a `message`
 * frame carrying a narration message with the same id replaces the streamed
 * text with the final one. `narration_discard` drops a partial narration.
 *
 * A `message` frame whose id is already in the log replaces that message. This
 * is how an illustration arrives: first as a `pending` image message, later
 * with the same id as `ready` or `failed`. A turn that paints does not send
 * `done` until its pictures have settled.
 *
 * An `action` turn starts with a `message` frame echoing the player's message
 * (text trimmed, `turn` = previous `world.turn` + 1).
 *
 * The stream always ends with exactly one `done` or `error`. On `error`,
 * `kept` says what became of the turn: false means it was undone and the
 * session is as it was before, so the same request can simply be sent again;
 * true means the story had already reached the player, so the turn stands as
 * far as it got and must not be re-sent. Either way, reload the session.
 */
export type TurnEvent =
  | { type: 'message'; message: Message }
  | { type: 'narration_delta'; id: string; text: string }
  | { type: 'narration_discard'; id: string }
  | { type: 'world'; world: WorldState }
  | { type: 'done'; turn: number; usage: TokenUsage }
  | { type: 'error'; error: ApiError; kept: boolean };
