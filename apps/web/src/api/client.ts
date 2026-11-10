import type {
  CreateSessionRequest,
  ModelListResponse,
  ModelListTarget,
  ModuleLibraryResponse,
  PublicSettings,
  Session,
  SessionSummary,
  UpdateSessionRequest,
  UpdateSettingsRequest,
} from '@roleplay/shared';
import { errorFromResponse, isAbortError, networkError, RequestError } from './errors';

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }

  let res: Response;
  try {
    res = await fetch(path, { method: init.method ?? 'GET', headers, body });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw networkError(err);
  }
  if (!res.ok) throw await errorFromResponse(res);

  try {
    return (await res.json()) as T;
  } catch {
    throw new RequestError({ code: 'bad_response', message: `Expected JSON from ${path}` }, res.status);
  }
}

const sessionPath = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;

export const api = {
  getSettings: () => request<PublicSettings>('/api/settings'),
  updateSettings: (update: UpdateSettingsRequest) =>
    request<PublicSettings>('/api/settings', { method: 'PUT', body: update }),
  /** Asks the provider which models the *saved* settings and key can use. */
  listModels: (target: ModelListTarget) =>
    request<ModelListResponse>(`/api/settings/models?target=${encodeURIComponent(target)}`),
  /** Every module there is; subscribing is a settings update (`subscribedModules`). */
  getModules: () => request<ModuleLibraryResponse>('/api/modules'),

  listSessions: () => request<SessionSummary[]>('/api/sessions'),
  createSession: (create: CreateSessionRequest) =>
    request<Session>('/api/sessions', { method: 'POST', body: create }),
  getSession: (id: string) => request<Session>(sessionPath(id)),
  /** Refused with `turn_in_progress` while a turn is being generated. */
  updateSession: (id: string, update: UpdateSessionRequest) =>
    request<Session>(sessionPath(id), { method: 'PATCH', body: update }),
  deleteSession: (id: string) => request<{ ok: true }>(sessionPath(id), { method: 'DELETE' }),

  turnsPath: (id: string) => `${sessionPath(id)}/turns`,
};
