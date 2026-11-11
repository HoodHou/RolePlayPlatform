import type { ModuleId } from './modules';

/**
 * AI settings. Three ideas:
 *
 * - A **connection** is a way to reach models: an endpoint, a key, and the
 *   model used by default. There is one per provider.
 * - A **role** is a job a model does in the game. The game master tells the
 *   story and keeps the world; the actor speaks for one character at a time.
 *   Each role picks a connection, a model and how hard to think, so the story
 *   can run on a strong model while characters answer quickly on a cheaper one.
 * - **Generation** settings shape what any model is given and may return.
 */

/** `mock` is a scripted offline game master for trying the app without an API key. */
export const PROVIDER_KINDS = ['anthropic', 'openai', 'gemini', 'custom', 'mock'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** The providers that are real connections. `custom` is any endpoint that speaks OpenAI Chat Completions. */
export const CONNECTION_KINDS = ['anthropic', 'openai', 'gemini', 'custom'] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

/** How hard a model thinks before answering, weakest first. More thinking is slower and costs more. */
export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

/**
 * The effort levels each provider's API has a name for. Which of them a given
 * model accepts is up to that model; an unsupported level comes back as an
 * error from the provider.
 */
export const PROVIDER_EFFORTS: Record<ConnectionKind, readonly Effort[]> = {
  anthropic: ['low', 'medium', 'high', 'xhigh', 'max'],
  openai: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  gemini: ['none', 'minimal', 'low', 'medium', 'high'],
  custom: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
};

export const IMAGE_PROVIDERS = ['openai', 'gemini', 'custom'] as const;
export type ImageProviderKind = (typeof IMAGE_PROVIDERS)[number];

export const IMAGE_QUALITIES = ['low', 'medium', 'high', 'auto'] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_MODEL = 'gpt-6.1-sol';
/** Gemini through Google's OpenAI-compatible endpoint. */
export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
/** Native Gemini API endpoint for multimodal image generation (`:generateContent`). */
export const DEFAULT_GEMINI_IMAGE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image';
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-flare';

export const IMAGE_PROVIDER_DEFAULTS: Record<ImageProviderKind, { baseUrl: string; model: string }> = {
  openai: { baseUrl: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_IMAGE_MODEL },
  gemini: { baseUrl: DEFAULT_GEMINI_IMAGE_BASE_URL, model: DEFAULT_GEMINI_IMAGE_MODEL },
  custom: { baseUrl: '', model: DEFAULT_IMAGE_MODEL },
};

export const IMAGE_MODEL_PRESETS: Record<ImageProviderKind, readonly string[]> = {
  openai: [DEFAULT_IMAGE_MODEL, 'gpt-image-1.5', 'gpt-image-1'],
  gemini: [DEFAULT_GEMINI_IMAGE_MODEL, 'gemini-3-pro-image', 'gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image'],
  custom: [DEFAULT_IMAGE_MODEL, DEFAULT_GEMINI_IMAGE_MODEL, 'gemini-3-pro-image'],
};

/** Normalizes a Gemini base URL to the `v1beta` root, stripping any trailing `/openai` path. */
export function geminiImageBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/openai$/i, '');
}

/** The endpoint and model a connection uses when nothing else is set. `custom` has none: it is whatever the user points it at. */
export const CONNECTION_DEFAULTS: Record<ConnectionKind, { baseUrl: string; model: string }> = {
  anthropic: { baseUrl: '', model: DEFAULT_ANTHROPIC_MODEL },
  openai: { baseUrl: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_OPENAI_MODEL },
  gemini: { baseUrl: DEFAULT_GEMINI_BASE_URL, model: DEFAULT_GEMINI_MODEL },
  custom: { baseUrl: '', model: '' },
};

/** A known endpoint that speaks OpenAI Chat Completions, for filling in the custom connection. */
export interface EndpointPreset {
  id: string;
  name: string;
  baseUrl: string;
  /** Suggested model; empty when the choice depends on what the user has installed or bought. */
  model: string;
}

export const CUSTOM_ENDPOINT_PRESETS: readonly EndpointPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: '' },
];

export interface ConnectionSettings {
  /** Where requests go. Empty means the provider's own endpoint; `custom` has to name one. */
  baseUrl: string;
  /** The model a role gets when it does not name one itself. */
  model: string;
}

export interface RoleSettings {
  /** Which connection does this job. */
  provider: ProviderKind;
  /** Model id. Empty means the connection's model. */
  model: string;
  /** How hard to think. null leaves it to the model's own default. */
  effort: Effort | null;
}

/** The actor may simply follow the game master: same connection, same model. */
export interface ActorSettings extends Omit<RoleSettings, 'provider'> {
  provider: ProviderKind | 'same';
}

export interface GenerationSettings {
  /** Upper bound on one response, in tokens. null leaves it to the provider. */
  maxOutputTokens: number | null;
  /**
   * Sampling temperature, 0–2. Only sent to Gemini and custom endpoints:
   * current Claude and OpenAI reasoning models reject it. null is the default.
   */
  temperature: number | null;
  /** How many past turns of story the game master is shown. */
  historyTurns: number;
  /** How many memories a character has in mind when they speak. */
  memoriesRecalled: number;
}

export const GENERATION_DEFAULTS: GenerationSettings = {
  maxOutputTokens: null,
  temperature: null,
  historyTurns: 30,
  memoriesRecalled: 12,
};

/** Bounds the settings form and the server both enforce. */
export const GENERATION_LIMITS = {
  maxOutputTokens: { min: 256, max: 128_000 },
  temperature: { min: 0, max: 2 },
  historyTurns: { min: 4, max: 200 },
  memoriesRecalled: { min: 2, max: 40 },
} as const;

/**
 * Illustrations. Painting is a separate service from the game master: Claude
 * can run the story while an image model draws it. When enabled, the game
 * master can have pictures painted; when off, it never hears about pictures.
 * Supports OpenAI Images API, Google Gemini native image models, and custom endpoints.
 */
export interface ImageSettings {
  enabled: boolean;
  provider: ImageProviderKind;
  baseUrl: string;
  model: string;
  quality: ImageQuality;
  /** Automatically queue background portraits for newly introduced NPCs each turn. */
  autoCharacterPortraits: boolean;
}

/**
 * Where the key in use comes from. The key itself never leaves the server.
 * `shared` means illustrations reuse the key of the OpenAI, Gemini or custom
 * connection, because both point at the same endpoint.
 */
export type KeySource = 'settings' | 'env' | 'shared' | 'none';

export interface PublicSettings {
  gameMaster: RoleSettings;
  actor: ActorSettings;
  connections: Record<ConnectionKind, ConnectionSettings & { apiKeySource: KeySource }>;
  generation: GenerationSettings;
  image: ImageSettings & { apiKeySource: KeySource };
  /**
   * Whether the game master can paint right now. True in demo mode too, where
   * a placeholder painter stands in so the feature can be seen without a key.
   */
  illustrationsActive: boolean;
  /**
   * The play modules the player subscribes to (see modules.ts). Only these can
   * ever be on in a story.
   */
  subscribedModules: ModuleId[];
}

/**
 * Partial update: only what is present changes. For `apiKey`: a string saves
 * it, null removes the saved key, and leaving it out keeps whatever is stored.
 */
export interface UpdateSettingsRequest {
  gameMaster?: Partial<RoleSettings>;
  actor?: Partial<ActorSettings>;
  connections?: Partial<Record<ConnectionKind, Partial<ConnectionSettings> & { apiKey?: string | null }>>;
  generation?: Partial<GenerationSettings>;
  image?: Partial<ImageSettings> & { apiKey?: string | null };
  /** The whole list of subscriptions, replacing the saved one. */
  subscribedModules?: ModuleId[];
}

/**
 * One-click set-ups for the official APIs. Applying one is an ordinary
 * settings update that makes that provider the game master with its official
 * endpoint and default model; the only thing left to supply is the key.
 */
export const OFFICIAL_SHORTCUTS = {
  claude: {
    gameMaster: { provider: 'anthropic', model: '', effort: null },
    connections: { anthropic: CONNECTION_DEFAULTS.anthropic },
  },
  openai: {
    gameMaster: { provider: 'openai', model: '', effort: null },
    connections: { openai: CONNECTION_DEFAULTS.openai },
    image: { provider: 'openai', baseUrl: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_IMAGE_MODEL },
  },
  gemini: {
    gameMaster: { provider: 'gemini', model: '', effort: null },
    connections: { gemini: CONNECTION_DEFAULTS.gemini },
    image: { provider: 'gemini', baseUrl: DEFAULT_GEMINI_IMAGE_BASE_URL, model: DEFAULT_GEMINI_IMAGE_MODEL },
  },
} as const satisfies Record<string, UpdateSettingsRequest>;

/** Which model list to fetch: one of the connections, or the image endpoint. */
export const MODEL_LIST_TARGETS = [...CONNECTION_KINDS, 'image'] as const;
export type ModelListTarget = (typeof MODEL_LIST_TARGETS)[number];
