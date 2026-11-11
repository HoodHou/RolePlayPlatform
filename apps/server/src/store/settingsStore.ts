import path from 'node:path';
import {
  CONNECTION_DEFAULTS,
  CONNECTION_KINDS,
  DEFAULT_GEMINI_IMAGE_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_SUBSCRIPTIONS,
  geminiImageBaseUrl,
  GENERATION_DEFAULTS,
  IMAGE_PROVIDER_DEFAULTS,
  IMAGE_PROVIDERS,
  PROVIDER_EFFORTS,
  PROVIDER_KINDS,
  type ActorSettings,
  type ConnectionKind,
  type ConnectionSettings,
  type Effort,
  type GenerationSettings,
  type ImageProviderKind,
  type ImageSettings,
  type KeySource,
  type ModuleId,
  type ProviderKind,
  type PublicSettings,
  type RoleSettings,
  type UpdateSettingsRequest,
} from '@roleplay/shared';
import { normalizeModules } from '../engine/modules';
import { readJson, writeJson } from './jsonFile';

/** What is written to disk: only what the user changed in the app. */
interface StoredSettings {
  gameMaster?: Partial<RoleSettings>;
  actor?: Partial<ActorSettings>;
  connections?: Partial<Record<ConnectionKind, Partial<ConnectionSettings> & { apiKey?: string }>>;
  generation?: Partial<GenerationSettings>;
  image?: Partial<ImageSettings> & { apiKey?: string };
  /** Module ids as saved; ones this version does not know are ignored when read. */
  subscribedModules?: string[];
}

interface ResolvedKey {
  apiKey: string | null;
  apiKeySource: KeySource;
}

export type ResolvedConnection = ConnectionSettings & ResolvedKey;

/** Saved settings layered over environment variables over defaults. */
export interface ResolvedSettings {
  gameMaster: RoleSettings;
  actor: ActorSettings;
  /**
   * For Anthropic, apiKey is only set when saved in the app; an environment
   * key is left for the SDK to read. The others carry the key whatever its source.
   */
  connections: Record<ConnectionKind, ResolvedConnection>;
  generation: GenerationSettings;
  image: ImageSettings & ResolvedKey;
  illustrationsActive: boolean;
  /** The play modules the player subscribes to: the only ones a story can be played with. */
  subscribedModules: ModuleId[];
}

/** What one role actually runs on, once "same as the game master" and empty models are filled in. */
export interface ResolvedRole {
  provider: ProviderKind;
  model: string;
  effort: Effort | null;
}

const NO_KEY: ResolvedKey = { apiKey: null, apiKeySource: 'none' };
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com';

function isProviderKind(value: unknown): value is ProviderKind {
  return PROVIDER_KINDS.includes(value as ProviderKind);
}

function sameEndpoint(a: string, b: string): boolean {
  const normalize = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();
  return normalize(a) === normalize(b);
}

function sameGeminiEndpoint(a: string, b: string): boolean {
  return sameEndpoint(geminiImageBaseUrl(a), geminiImageBaseUrl(b));
}

function inferImageProvider(
  stored: StoredSettings['image'],
  connections: Record<ConnectionKind, ResolvedConnection>,
  env: NodeJS.ProcessEnv,
): ImageProviderKind {
  if (stored?.provider && IMAGE_PROVIDERS.includes(stored.provider)) return stored.provider;
  if (stored?.baseUrl) {
    if (sameEndpoint(stored.baseUrl, DEFAULT_OPENAI_BASE_URL)) return 'openai';
    if (sameGeminiEndpoint(stored.baseUrl, DEFAULT_GEMINI_IMAGE_BASE_URL)) return 'gemini';
    return 'custom';
  }
  if (env.OPENAI_IMAGE_MODEL) return 'openai';
  if (env.GEMINI_IMAGE_MODEL) return 'gemini';
  if (connections.openai.apiKeySource !== 'none') return 'openai';
  if (connections.gemini.apiKeySource !== 'none') return 'gemini';
  return 'openai';
}

/** The environment variables that configure each connection. */
function environment(kind: ConnectionKind, env: NodeJS.ProcessEnv) {
  switch (kind) {
    case 'anthropic':
      return { key: env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN, baseUrl: env.ANTHROPIC_BASE_URL, model: env.ANTHROPIC_MODEL };
    case 'openai':
      return { key: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL, model: env.OPENAI_MODEL };
    case 'gemini':
      return { key: env.GEMINI_API_KEY || env.GOOGLE_API_KEY, baseUrl: env.GEMINI_BASE_URL, model: env.GEMINI_MODEL };
    case 'custom':
      return { key: env.RP_CUSTOM_API_KEY, baseUrl: env.RP_CUSTOM_BASE_URL, model: env.RP_CUSTOM_MODEL };
  }
}

function resolveConnection(
  kind: ConnectionKind,
  stored: Partial<ConnectionSettings> & { apiKey?: string },
  env: NodeJS.ProcessEnv,
): ResolvedConnection {
  const fromEnv = environment(kind, env);
  const defaults = CONNECTION_DEFAULTS[kind];
  // The endpoint the environment's key was issued for.
  const envEndpoint = fromEnv.baseUrl || defaults.baseUrl;
  const baseUrl = (kind === 'anthropic' ? stored.baseUrl : stored.baseUrl || undefined) ?? envEndpoint;
  // For Claude an empty base URL and the official address are the same place.
  const place = (url: string) => (kind === 'anthropic' && !url.trim() ? ANTHROPIC_ENDPOINT : url);
  const same = (a: string, b: string) => sameEndpoint(place(a), place(b));

  let key: ResolvedKey = NO_KEY;
  if (stored.apiKey) {
    key = { apiKey: stored.apiKey, apiKeySource: 'settings' };
  } else if (fromEnv.key && same(baseUrl, envEndpoint)) {
    // An environment key is never handed to a different base URL typed into
    // the app, which would send one vendor's key to another.
    key = { apiKey: kind === 'anthropic' ? null : fromEnv.key, apiKeySource: 'env' };
  }

  // A default model is only known for the provider's own endpoint.
  const model = stored.model || fromEnv.model || (same(baseUrl, defaults.baseUrl) ? defaults.model : '');
  return { baseUrl, model, ...key };
}

function supportedEffort(provider: ProviderKind, effort: Effort | null | undefined): Effort | null {
  if (!effort || provider === 'mock') return null;
  return PROVIDER_EFFORTS[provider].includes(effort) ? effort : null;
}

export function resolveSettings(stored: StoredSettings, env: NodeJS.ProcessEnv): ResolvedSettings {
  const connections = Object.fromEntries(
    CONNECTION_KINDS.map((kind) => [kind, resolveConnection(kind, stored.connections?.[kind] ?? {}, env)]),
  ) as Record<ConnectionKind, ResolvedConnection>;

  // Without any choice, use the first connection that has a key, and fall back
  // to the offline game master so a fresh checkout is playable straight away.
  let provider: ProviderKind = CONNECTION_KINDS.find((kind) => connections[kind].apiKeySource !== 'none') ?? 'mock';
  if (stored.gameMaster?.provider) provider = stored.gameMaster.provider;
  else if (isProviderKind(env.RP_PROVIDER)) provider = env.RP_PROVIDER;

  const gameMaster: RoleSettings = {
    provider,
    model: stored.gameMaster?.model ?? '',
    effort: supportedEffort(provider, stored.gameMaster?.effort),
  };

  const actorProvider = stored.actor?.provider ?? 'same';
  const actorRunsOn = actorProvider === 'same' ? provider : actorProvider;
  const actor: ActorSettings = {
    provider: actorProvider,
    model: stored.actor?.model ?? '',
    // A line of dialogue should not take as long as a turn of the story. Claude
    // takes a low effort on every current model; elsewhere the model decides.
    effort:
      stored.actor?.effort !== undefined
        ? supportedEffort(actorRunsOn, stored.actor.effort)
        : actorRunsOn === 'anthropic'
          ? 'low'
          : null,
  };

  const i = stored.image ?? {};
  const imageProvider = inferImageProvider(i, connections, env);
  const imageDefaults = IMAGE_PROVIDER_DEFAULTS[imageProvider];
  const envImageUrl =
    imageProvider === 'openai'
      ? env.OPENAI_BASE_URL
      : imageProvider === 'gemini'
        ? env.GEMINI_BASE_URL
        : undefined;
  const rawImageUrl = (imageProvider === 'custom' ? i.baseUrl : i.baseUrl || undefined) ?? envImageUrl ?? imageDefaults.baseUrl;
  const imageUrl = imageProvider === 'gemini' ? geminiImageBaseUrl(rawImageUrl) : rawImageUrl;
  const envImageModel =
    imageProvider === 'openai'
      ? env.OPENAI_IMAGE_MODEL
      : imageProvider === 'gemini'
        ? env.GEMINI_IMAGE_MODEL
        : undefined;
  const imageModel = i.model || envImageModel || imageDefaults.model;

  let imageKey: ResolvedKey = NO_KEY;
  if (i.apiKey) {
    imageKey = { apiKey: i.apiKey, apiKeySource: 'settings' };
  } else if (imageProvider === 'gemini') {
    const geminiConn = connections.gemini;
    if (geminiConn.apiKey && geminiConn.baseUrl && sameGeminiEndpoint(imageUrl, geminiConn.baseUrl)) {
      imageKey = { apiKey: geminiConn.apiKey, apiKeySource: geminiConn.apiKeySource === 'settings' ? 'shared' : 'env' };
    }
  } else {
    // Painting on the same endpoint as a connection reuses that connection's key.
    const host = (['openai', 'custom'] as const)
      .map((kind) => connections[kind])
      .find((connection) => connection.apiKey && connection.baseUrl && sameEndpoint(imageUrl, connection.baseUrl));
    if (host) imageKey = { apiKey: host.apiKey, apiKeySource: host.apiKeySource === 'settings' ? 'shared' : 'env' };
  }
  const image: ResolvedSettings['image'] = {
    enabled: i.enabled ?? false,
    provider: imageProvider,
    baseUrl: imageUrl,
    model: imageModel,
    quality: i.quality ?? 'low',
    ...imageKey,
  };

  // Demo mode paints with a free placeholder painter; otherwise painting needs
  // to be switched on and able to authenticate (a self-hosted endpoint may need no key).
  const hasEndpointAndModel = Boolean(image.baseUrl.trim() && image.model.trim());
  const officialNeedsKey =
    (imageProvider === 'openai' && sameEndpoint(image.baseUrl, DEFAULT_OPENAI_BASE_URL)) ||
    (imageProvider === 'gemini' && sameGeminiEndpoint(image.baseUrl, DEFAULT_GEMINI_IMAGE_BASE_URL));
  const canPaint = hasEndpointAndModel && (image.apiKeySource !== 'none' || !officialNeedsKey);
  const illustrationsActive = provider === 'mock' || (image.enabled && canPaint);

  return {
    gameMaster,
    actor,
    connections,
    generation: { ...GENERATION_DEFAULTS, ...stored.generation },
    image,
    illustrationsActive,
    // Until the player has been to the library, they have what every story had before there was one.
    subscribedModules: stored.subscribedModules ? normalizeModules(stored.subscribedModules) : [...DEFAULT_SUBSCRIPTIONS],
  };
}

/** The connection, model and effort a role runs on. */
export function resolveRole(settings: ResolvedSettings, role: 'gameMaster' | 'actor'): ResolvedRole {
  const { gameMaster, actor, connections } = settings;
  const connectionModel = (provider: ProviderKind) => (provider === 'mock' ? '' : connections[provider].model);

  if (role === 'gameMaster') {
    return { ...gameMaster, model: gameMaster.model || connectionModel(gameMaster.provider) };
  }
  if (actor.provider === 'same') {
    // Following the game master means its connection and its model; only the
    // effort is the actor's own. A model saved for the actor earlier is kept
    // for when it gets a provider of its own again, but not used here.
    const model = gameMaster.model || connectionModel(gameMaster.provider);
    return { provider: gameMaster.provider, model, effort: actor.effort };
  }
  return { provider: actor.provider, model: actor.model || connectionModel(actor.provider), effort: actor.effort };
}

export function toPublicSettings(settings: ResolvedSettings): PublicSettings {
  const withoutKey = <T extends ResolvedKey>({ apiKey: _, ...rest }: T) => rest;
  return {
    gameMaster: settings.gameMaster,
    actor: settings.actor,
    connections: Object.fromEntries(
      CONNECTION_KINDS.map((kind) => [kind, withoutKey(settings.connections[kind])]),
    ) as PublicSettings['connections'],
    generation: settings.generation,
    image: withoutKey(settings.image),
    illustrationsActive: settings.illustrationsActive,
    subscribedModules: settings.subscribedModules,
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

/** Settings as written before connections and roles existed. */
interface LegacySettings {
  activeProvider?: 'anthropic' | 'openai-compatible' | 'mock';
  anthropic?: { model?: string; baseUrl?: string; effort?: Effort | null; apiKey?: string };
  openaiCompatible?: { model?: string; baseUrl?: string; apiKey?: string };
  image?: StoredSettings['image'];
}

/**
 * Brings a settings file from the earlier layout up to this one. The single
 * "OpenAI-compatible" provider became two: OpenAI itself, or a custom endpoint.
 */
export function upgradeSettings(raw: StoredSettings | LegacySettings): StoredSettings {
  if (!('activeProvider' in raw || 'anthropic' in raw || 'openaiCompatible' in raw)) return raw;
  const legacy: LegacySettings = raw;
  const { effort, ...anthropic } = legacy.anthropic ?? {};
  const compat = legacy.openaiCompatible ?? {};
  const compatKind: ConnectionKind =
    !compat.baseUrl || sameEndpoint(compat.baseUrl, DEFAULT_OPENAI_BASE_URL) ? 'openai' : 'custom';
  const provider = legacy.activeProvider === 'openai-compatible' ? compatKind : legacy.activeProvider;

  const connections: NonNullable<StoredSettings['connections']> = {};
  if (Object.keys(anthropic).length > 0) connections.anthropic = anthropic;
  if (Object.keys(compat).length > 0) connections[compatKind] = compat;

  return {
    ...(provider ? { gameMaster: { provider, ...(provider === 'anthropic' && effort !== undefined ? { effort } : {}) } } : {}),
    connections,
    ...(legacy.image ? { image: legacy.image } : {}),
  };
}

export class SettingsStore {
  private readonly file: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(dataDir: string, env: NodeJS.ProcessEnv = process.env) {
    this.file = path.join(dataDir, 'settings.json');
    this.env = env;
  }

  private async read(): Promise<StoredSettings> {
    return upgradeSettings((await readJson<StoredSettings | LegacySettings>(this.file)) ?? {});
  }

  async get(): Promise<ResolvedSettings> {
    return resolveSettings(await this.read(), this.env);
  }

  async update(patch: UpdateSettingsRequest): Promise<ResolvedSettings> {
    const stored = await this.read();
    if (patch.gameMaster) stored.gameMaster = { ...stored.gameMaster, ...patch.gameMaster };
    if (patch.actor) stored.actor = { ...stored.actor, ...patch.actor };
    if (patch.generation) stored.generation = { ...stored.generation, ...patch.generation };
    for (const kind of CONNECTION_KINDS) {
      const merged = merge(stored.connections?.[kind], patch.connections?.[kind]);
      if (merged) stored.connections = { ...stored.connections, [kind]: merged };
    }
    stored.image = merge(stored.image, patch.image);
    if (patch.subscribedModules) stored.subscribedModules = normalizeModules(patch.subscribedModules);

    await writeJson(this.file, stored);
    return resolveSettings(stored, this.env);
  }
}
