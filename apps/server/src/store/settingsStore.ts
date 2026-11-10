import path from 'node:path';
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  PROVIDER_KINDS,
  type AnthropicSettings,
  type ImageSettings,
  type KeySource,
  type OpenAICompatSettings,
  type ProviderKind,
  type PublicSettings,
  type UpdateSettingsRequest,
} from '@roleplay/shared';
import { readJson, writeJson } from './jsonFile';

/** What is written to disk: only what the user changed in the app. */
interface StoredSettings {
  activeProvider?: ProviderKind;
  anthropic?: Partial<AnthropicSettings> & { apiKey?: string };
  openaiCompatible?: Partial<OpenAICompatSettings> & { apiKey?: string };
  image?: Partial<ImageSettings> & { apiKey?: string };
}

interface ResolvedKey {
  apiKey: string | null;
  apiKeySource: KeySource;
}

/** Saved settings layered over environment variables over defaults. */
export interface ResolvedSettings {
  activeProvider: ProviderKind;
  /** apiKey is only set when saved in the app; otherwise the SDK reads the environment itself. */
  anthropic: AnthropicSettings & ResolvedKey;
  openaiCompatible: OpenAICompatSettings & ResolvedKey;
  image: ImageSettings & ResolvedKey;
  illustrationsActive: boolean;
}

const NO_KEY: ResolvedKey = { apiKey: null, apiKeySource: 'none' };

function isProviderKind(value: unknown): value is ProviderKind {
  return PROVIDER_KINDS.includes(value as ProviderKind);
}

function sameEndpoint(a: string, b: string): boolean {
  const normalize = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();
  return normalize(a) === normalize(b);
}

/**
 * OPENAI_API_KEY belongs to the endpoint the environment names. It is never
 * handed to a different base URL the user typed into the app, which would
 * send one vendor's key to another.
 */
function openAiEnvKey(baseUrl: string, env: NodeJS.ProcessEnv): ResolvedKey {
  const envEndpoint = env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL;
  return env.OPENAI_API_KEY && sameEndpoint(baseUrl, envEndpoint)
    ? { apiKey: env.OPENAI_API_KEY, apiKeySource: 'env' }
    : NO_KEY;
}

export function resolveSettings(stored: StoredSettings, env: NodeJS.ProcessEnv): ResolvedSettings {
  const a = stored.anthropic ?? {};
  const o = stored.openaiCompatible ?? {};
  const i = stored.image ?? {};

  const anthropic: ResolvedSettings['anthropic'] = {
    model: a.model || env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
    baseUrl: a.baseUrl ?? env.ANTHROPIC_BASE_URL ?? '',
    // null is a real choice here ("let the model decide"), so only default when unset.
    effort: a.effort !== undefined ? a.effort : 'medium',
    ...(a.apiKey
      ? { apiKey: a.apiKey, apiKeySource: 'settings' }
      : env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN
        ? { apiKey: null, apiKeySource: 'env' }
        : NO_KEY),
  };

  const compatUrl = o.baseUrl || env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL;
  const openaiCompatible: ResolvedSettings['openaiCompatible'] = {
    baseUrl: compatUrl,
    // Only OpenAI itself has a model we can name in advance.
    model:
      o.model ||
      env.OPENAI_MODEL ||
      (sameEndpoint(compatUrl, DEFAULT_OPENAI_BASE_URL) ? DEFAULT_OPENAI_MODEL : ''),
    ...(o.apiKey ? { apiKey: o.apiKey, apiKeySource: 'settings' } : openAiEnvKey(compatUrl, env)),
  };

  const imageUrl = i.baseUrl || env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL;
  let imageKey: ResolvedKey;
  if (i.apiKey) imageKey = { apiKey: i.apiKey, apiKeySource: 'settings' };
  // Painting on the same endpoint as the text provider reuses the key saved for it.
  else if (o.apiKey && sameEndpoint(imageUrl, compatUrl)) imageKey = { apiKey: o.apiKey, apiKeySource: 'shared' };
  else imageKey = openAiEnvKey(imageUrl, env);
  const image: ResolvedSettings['image'] = {
    enabled: i.enabled ?? false,
    baseUrl: imageUrl,
    model: i.model || env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
    quality: i.quality ?? 'low',
    ...imageKey,
  };

  // Without any choice, use whichever provider has a key, and fall back to the
  // offline game master so a fresh checkout is playable straight away.
  let activeProvider: ProviderKind = 'mock';
  if (stored.activeProvider) activeProvider = stored.activeProvider;
  else if (isProviderKind(env.RP_PROVIDER)) activeProvider = env.RP_PROVIDER;
  else if (anthropic.apiKeySource !== 'none') activeProvider = 'anthropic';
  else if (openaiCompatible.apiKeySource !== 'none') activeProvider = 'openai-compatible';

  // Demo mode paints with a free placeholder painter; otherwise painting needs
  // to be switched on and able to authenticate (a self-hosted endpoint may need no key).
  const canPaint = image.apiKeySource !== 'none' || !sameEndpoint(image.baseUrl, DEFAULT_OPENAI_BASE_URL);
  const illustrationsActive = activeProvider === 'mock' || (image.enabled && canPaint);

  return { activeProvider, anthropic, openaiCompatible, image, illustrationsActive };
}

export function toPublicSettings(settings: ResolvedSettings): PublicSettings {
  const { apiKey: _a, ...anthropic } = settings.anthropic;
  const { apiKey: _o, ...openaiCompatible } = settings.openaiCompatible;
  const { apiKey: _i, ...image } = settings.image;
  return {
    activeProvider: settings.activeProvider,
    anthropic,
    openaiCompatible,
    image,
    illustrationsActive: settings.illustrationsActive,
  };
}

/** Merges a section of a settings update into what is stored, handling the key separately. */
function merge<T extends { apiKey?: string }>(
  current: T | undefined,
  patch: (Omit<Partial<T>, 'apiKey'> & { apiKey?: string | null }) | undefined,
): T | undefined {
  if (!patch) return current;
  const { apiKey, ...fields } = patch;
  const next = { ...current, ...fields } as T;
  if (apiKey !== undefined) {
    const trimmed = apiKey?.trim();
    if (trimmed) next.apiKey = trimmed;
    else delete next.apiKey;
  }
  return next;
}

export class SettingsStore {
  private readonly file: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(dataDir: string, env: NodeJS.ProcessEnv = process.env) {
    this.file = path.join(dataDir, 'settings.json');
    this.env = env;
  }

  private async read(): Promise<StoredSettings> {
    return (await readJson<StoredSettings>(this.file)) ?? {};
  }

  async get(): Promise<ResolvedSettings> {
    return resolveSettings(await this.read(), this.env);
  }

  async update(patch: UpdateSettingsRequest): Promise<ResolvedSettings> {
    const stored = await this.read();
    if (patch.activeProvider) stored.activeProvider = patch.activeProvider;
    stored.anthropic = merge(stored.anthropic, patch.anthropic);
    stored.openaiCompatible = merge(stored.openaiCompatible, patch.openaiCompatible);
    stored.image = merge(stored.image, patch.image);

    await writeJson(this.file, stored);
    return resolveSettings(stored, this.env);
  }
}
