export const PROVIDER_KINDS = ['anthropic', 'openai-compatible', 'mock'] as const;
/** `mock` is a scripted offline game master for trying the app without an API key. */
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export const IMAGE_QUALITIES = ['low', 'medium', 'high', 'auto'] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_MODEL = 'gpt-6.1-sol';
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-flare';

/** A known endpoint that speaks the OpenAI wire format. */
export interface EndpointPreset {
  id: string;
  name: string;
  baseUrl: string;
  /** Suggested model; empty when the choice depends on what the user has installed or bought. */
  model: string;
}

export const OPENAI_COMPAT_PRESETS: readonly EndpointPreset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_OPENAI_MODEL },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: '' },
];

/**
 * One-click set-ups for the two official APIs. Applying one is an ordinary
 * settings update; the only thing left for the user to supply is the key.
 */
export const OFFICIAL_SHORTCUTS = {
  claude: {
    activeProvider: 'anthropic',
    anthropic: { model: DEFAULT_ANTHROPIC_MODEL, baseUrl: '', effort: 'medium' },
  },
  openai: {
    activeProvider: 'openai-compatible',
    openaiCompatible: { model: DEFAULT_OPENAI_MODEL, baseUrl: DEFAULT_OPENAI_BASE_URL },
    image: { baseUrl: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_IMAGE_MODEL },
  },
} as const satisfies Record<string, UpdateSettingsRequest>;

export interface AnthropicSettings {
  model: string;
  /** Empty string means the official endpoint. */
  baseUrl: string;
  /** Thinking depth. null leaves it to the model's default (for models without effort support). */
  effort: Effort | null;
}

export interface OpenAICompatSettings {
  model: string;
  baseUrl: string;
}

/**
 * Illustrations. Painting is a separate service from the game master: Claude
 * can run the story while an image model draws it. When enabled, the game
 * master is given a drawing tool; when off, it never hears about pictures.
 * Speaks the OpenAI Images API.
 */
export interface ImageSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  quality: ImageQuality;
}

/**
 * Where the key in use comes from. The key itself never leaves the server.
 * `shared` means illustrations reuse the key saved for the OpenAI-compatible
 * provider, because both point at the same endpoint.
 */
export type KeySource = 'settings' | 'env' | 'shared' | 'none';

export interface PublicSettings {
  activeProvider: ProviderKind;
  anthropic: AnthropicSettings & { apiKeySource: KeySource };
  openaiCompatible: OpenAICompatSettings & { apiKeySource: KeySource };
  image: ImageSettings & { apiKeySource: KeySource };
  /**
   * Whether the game master can paint right now. True in demo mode too, where
   * a placeholder painter stands in so the feature can be seen without a key.
   */
  illustrationsActive: boolean;
}

/**
 * Partial update. For `apiKey`: a string saves it, null removes the saved key,
 * and leaving it out keeps whatever is stored.
 */
export interface UpdateSettingsRequest {
  activeProvider?: ProviderKind;
  anthropic?: Partial<AnthropicSettings> & { apiKey?: string | null };
  openaiCompatible?: Partial<OpenAICompatSettings> & { apiKey?: string | null };
  image?: Partial<ImageSettings> & { apiKey?: string | null };
}

/** Which model list to fetch: the two text providers, or the image endpoint. */
export const MODEL_LIST_TARGETS = ['anthropic', 'openai-compatible', 'image'] as const;
export type ModelListTarget = (typeof MODEL_LIST_TARGETS)[number];
