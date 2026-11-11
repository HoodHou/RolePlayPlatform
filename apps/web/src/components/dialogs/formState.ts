import {
  CONNECTION_KINDS,
  DEFAULT_GEMINI_IMAGE_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  geminiImageBaseUrl,
  GENERATION_DEFAULTS,
  GENERATION_LIMITS,
  IMAGE_MODEL_PRESETS,
  IMAGE_PROVIDER_DEFAULTS,
  PROVIDER_EFFORTS,
  type ConnectionKind,
  type Effort,
  type GenerationSettings,
  type ImageProviderKind,
  type ImageQuality,
  type KeySource,
  type ModelListTarget,
  type ProviderKind,
  type PublicSettings,
  type UpdateSettingsRequest,
} from '@roleplay/shared';
import { keyPatch, NO_KEY_EDIT, type KeyEdit } from './ApiKeyField';

export interface RoleForm {
  provider: ProviderKind;
  model: string;
  effort: Effort | null;
}

export interface ActorForm {
  provider: ProviderKind | 'same';
  model: string;
  effort: Effort | null;
}

export interface ConnectionForm {
  baseUrl: string;
  model: string;
  key: KeyEdit;
}

export interface ImageForm {
  enabled: boolean;
  provider: ImageProviderKind;
  baseUrl: string;
  model: string;
  quality: ImageQuality;
  autoCharacterPortraits: boolean;
  key: KeyEdit;
}

export type GenerationField = keyof GenerationSettings;
export const GENERATION_FIELDS: readonly GenerationField[] = [
  'maxOutputTokens',
  'temperature',
  'historyTurns',
  'memoriesRecalled',
];
/** Number inputs as typed; an empty string means "use the default". */
export type GenerationForm = Record<GenerationField, string>;

/** Everything the Settings dialog edits. Nothing reaches the server until Save. */
export interface SettingsFormState {
  gameMaster: RoleForm;
  actor: ActorForm;
  connections: Record<ConnectionKind, ConnectionForm>;
  image: ImageForm;
  generation: GenerationForm;
}

export function isConnectionKind(provider: ProviderKind | 'same'): provider is ConnectionKind {
  return (CONNECTION_KINDS as readonly string[]).includes(provider);
}

/** The effort levels a provider has names for; none for the demo. */
export function effortsFor(provider: ProviderKind): readonly Effort[] {
  return isConnectionKind(provider) ? PROVIDER_EFFORTS[provider] : [];
}

/** The provider the actor really uses: its own, or the game master's when it follows. */
export function actorProvider(form: Pick<SettingsFormState, 'gameMaster' | 'actor'>): ProviderKind {
  return form.actor.provider === 'same' ? form.gameMaster.provider : form.actor.provider;
}

function validEffort(effort: Effort | null, provider: ProviderKind): Effort | null {
  return effort !== null && effortsFor(provider).includes(effort) ? effort : null;
}

/** After a provider changes, an effort level the new provider has no name for goes back to the default. */
export function withValidEfforts(form: SettingsFormState): SettingsFormState {
  const gameMasterEffort = validEffort(form.gameMaster.effort, form.gameMaster.provider);
  const actorEffort = validEffort(form.actor.effort, actorProvider(form));
  if (gameMasterEffort === form.gameMaster.effort && actorEffort === form.actor.effort) return form;
  return {
    ...form,
    gameMaster: { ...form.gameMaster, effort: gameMasterEffort },
    actor: { ...form.actor, effort: actorEffort },
  };
}

// --- Generation numbers ---

const isDefaultGeneration = (field: GenerationField, value: number | null) =>
  value === null || value === GENERATION_DEFAULTS[field];

function generationToForm(generation: GenerationSettings): GenerationForm {
  const show = (field: GenerationField) => {
    const value = generation[field];
    return value === null || isDefaultGeneration(field, value) ? '' : String(value);
  };
  return {
    maxOutputTokens: show('maxOutputTokens'),
    temperature: show('temperature'),
    historyTurns: show('historyTurns'),
    memoriesRecalled: show('memoriesRecalled'),
  };
}

/** Parses a typed value into range (rounded; temperature to one decimal). Empty or not a number is null: the default. */
export function parseGeneration(field: GenerationField, text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  const { min, max } = GENERATION_LIMITS[field];
  const clamped = Math.min(max, Math.max(min, value));
  return field === 'temperature' ? Math.round(clamped * 10) / 10 : Math.round(clamped);
}

/** What the input should show after editing: the parsed, in-range value, or empty for the default. */
export function normalizeGeneration(field: GenerationField, text: string): string {
  const value = parseGeneration(field, text);
  return value === null || isDefaultGeneration(field, value) ? '' : String(value);
}

function generationToUpdate(form: GenerationForm): GenerationSettings {
  return {
    maxOutputTokens: parseGeneration('maxOutputTokens', form.maxOutputTokens),
    temperature: parseGeneration('temperature', form.temperature),
    historyTurns: parseGeneration('historyTurns', form.historyTurns) ?? GENERATION_DEFAULTS.historyTurns,
    memoriesRecalled: parseGeneration('memoriesRecalled', form.memoriesRecalled) ?? GENERATION_DEFAULTS.memoriesRecalled,
  };
}

export const DEFAULT_GENERATION_FORM: GenerationForm = generationToForm(GENERATION_DEFAULTS);

// --- Whole form ---

export function formFromSettings(settings: PublicSettings): SettingsFormState {
  const connection = (kind: ConnectionKind): ConnectionForm => ({
    baseUrl: settings.connections[kind]?.baseUrl ?? '',
    model: settings.connections[kind]?.model ?? '',
    key: NO_KEY_EDIT,
  });
  return {
    gameMaster: { ...settings.gameMaster },
    actor: { ...settings.actor },
    connections: {
      anthropic: connection('anthropic'),
      openai: connection('openai'),
      gemini: connection('gemini'),
      custom: connection('custom'),
    },
    image: {
      enabled: settings.image.enabled,
      provider: settings.image.provider,
      baseUrl: settings.image.baseUrl,
      model: settings.image.model,
      quality: settings.image.quality,
      autoCharacterPortraits: settings.image.autoCharacterPortraits,
      key: NO_KEY_EDIT,
    },
    generation: generationToForm(settings.generation),
  };
}

export function formToUpdate(input: SettingsFormState): UpdateSettingsRequest {
  const form = withValidEfforts(input);
  const connections: NonNullable<UpdateSettingsRequest['connections']> = {};
  for (const kind of CONNECTION_KINDS) {
    const connection = form.connections[kind];
    // Empty base URL and model are meaningful (the provider's endpoint, the default model), so they go as typed.
    connections[kind] = { baseUrl: connection.baseUrl.trim(), model: connection.model.trim(), ...keyPatch(connection.key) };
  }
  const imageDefaults = IMAGE_PROVIDER_DEFAULTS[form.image.provider];
  const rawImageUrl = form.image.baseUrl.trim() || imageDefaults.baseUrl;
  return {
    gameMaster: { provider: form.gameMaster.provider, model: form.gameMaster.model.trim(), effort: form.gameMaster.effort },
    actor: { provider: form.actor.provider, model: form.actor.model.trim(), effort: form.actor.effort },
    connections,
    generation: generationToUpdate(form.generation),
    image: {
      enabled: form.image.enabled,
      provider: form.image.provider,
      baseUrl: form.image.provider === 'gemini' ? geminiImageBaseUrl(rawImageUrl) : rawImageUrl,
      model: form.image.model.trim() || imageDefaults.model,
      quality: form.image.quality,
      autoCharacterPortraits: form.image.autoCharacterPortraits,
      ...keyPatch(form.image.key),
    },
  };
}

/** Fills the form from a settings update (an official shortcut) without saving it. Keys are left alone. */
export function applyToForm(form: SettingsFormState, update: UpdateSettingsRequest): SettingsFormState {
  const connections = { ...form.connections };
  for (const kind of CONNECTION_KINDS) {
    const patch = update.connections?.[kind];
    if (!patch) continue;
    connections[kind] = {
      ...connections[kind],
      baseUrl: patch.baseUrl ?? connections[kind].baseUrl,
      model: patch.model ?? connections[kind].model,
    };
  }
  const { gameMaster, actor, image } = update;
  return withValidEfforts({
    ...form,
    gameMaster: {
      provider: gameMaster?.provider ?? form.gameMaster.provider,
      model: gameMaster?.model ?? form.gameMaster.model,
      effort: gameMaster?.effort !== undefined ? gameMaster.effort : form.gameMaster.effort,
    },
    actor: {
      provider: actor?.provider ?? form.actor.provider,
      model: actor?.model ?? form.actor.model,
      effort: actor?.effort !== undefined ? actor.effort : form.actor.effort,
    },
    connections,
    image: {
      ...form.image,
      enabled: image?.enabled ?? form.image.enabled,
      provider: image?.provider ?? form.image.provider,
      baseUrl: image?.baseUrl ?? form.image.baseUrl,
      model: image?.model ?? form.image.model,
      quality: image?.quality ?? form.image.quality,
      autoCharacterPortraits: image?.autoCharacterPortraits ?? form.image.autoCharacterPortraits,
    },
  });
}

const KNOWN_IMAGE_BASE_URLS = new Set([
  '',
  DEFAULT_OPENAI_BASE_URL.toLowerCase(),
  DEFAULT_GEMINI_IMAGE_BASE_URL.toLowerCase(),
  `${DEFAULT_GEMINI_IMAGE_BASE_URL.toLowerCase()}/openai`,
]);

const KNOWN_PRESET_IMAGE_MODELS = new Set<string>([
  '',
  ...IMAGE_MODEL_PRESETS.openai,
  ...IMAGE_MODEL_PRESETS.gemini,
]);

/** Updates default address and model when switching between OpenAI, Gemini, and Custom in Illustrations. */
export function switchImageProvider(current: ImageForm, next: ImageProviderKind): ImageForm {
  if (current.provider === next) return current;
  const defaults = IMAGE_PROVIDER_DEFAULTS[next];
  const normalizedUrl = current.baseUrl.trim().replace(/\/+$/, '').toLowerCase();
  const baseUrl = KNOWN_IMAGE_BASE_URLS.has(normalizedUrl) ? defaults.baseUrl : next === 'custom' ? current.baseUrl : defaults.baseUrl;
  const trimmedModel = current.model.trim();
  const model = KNOWN_PRESET_IMAGE_MODELS.has(trimmedModel) ? defaults.model : current.model;
  return { ...current, provider: next, baseUrl, model };
}

// --- Questions the dialog asks of the form ---

const keyTyped = (edit: KeyEdit) => edit.value.trim() !== '';
const keyEdited = (edit: KeyEdit) => keyTyped(edit) || edit.remove;
const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();
const resolvedImageBaseUrl = (image: Pick<ImageForm, 'provider' | 'baseUrl'>) => {
  const raw = image.baseUrl.trim() || IMAGE_PROVIDER_DEFAULTS[image.provider].baseUrl;
  return image.provider === 'gemini' ? geminiImageBaseUrl(raw) : raw;
};

/** How the image key is sourced given the current form selection and saved keys. */
export function effectiveImageKeySource(form: SettingsFormState, saved: PublicSettings): KeySource {
  if (saved.image.apiKeySource === 'settings') return 'settings';
  const imgUrl = resolvedImageBaseUrl(form.image);
  if (!imgUrl) return 'none';
  if (form.image.provider === 'gemini') {
    const connUrl = form.connections.gemini.baseUrl.trim() || saved.connections.gemini?.baseUrl || '';
    const connSource = saved.connections.gemini?.apiKeySource ?? 'none';
    if (connSource !== 'none' && connUrl && normalizeUrl(geminiImageBaseUrl(imgUrl)) === normalizeUrl(geminiImageBaseUrl(connUrl))) {
      return connSource === 'settings' ? 'shared' : 'env';
    }
    return 'none';
  }
  for (const kind of ['openai', 'custom'] as const) {
    const connUrl = form.connections[kind].baseUrl.trim() || saved.connections[kind]?.baseUrl || '';
    const connSource = saved.connections[kind]?.apiKeySource ?? 'none';
    if (connSource !== 'none' && connUrl && normalizeUrl(imgUrl) === normalizeUrl(connUrl)) {
      return connSource === 'settings' ? 'shared' : 'env';
    }
  }
  return 'none';
}

/**
 * Model lists are fetched with the *saved* address and key. True when the form
 * changes one of those for `target`, so it has to be saved first.
 */
export function modelListNeedsSave(form: SettingsFormState, saved: PublicSettings, target: ModelListTarget): boolean {
  if (target === 'image') {
    // The image section may borrow the OpenAI, Gemini or custom connection's key ("shared").
    const connectionKeyChanged =
      keyEdited(form.connections.openai.key) ||
      keyEdited(form.connections.gemini.key) ||
      keyEdited(form.connections.custom.key);
    return (
      form.image.provider !== saved.image.provider ||
      normalizeUrl(resolvedImageBaseUrl(form.image)) !== normalizeUrl(resolvedImageBaseUrl(saved.image)) ||
      keyEdited(form.image.key) ||
      connectionKeyChanged
    );
  }
  const connection = form.connections[target];
  return connection.baseUrl.trim() !== (saved.connections[target]?.baseUrl ?? '') || keyEdited(connection.key);
}

export type ConnectionIssue = 'noKey' | 'noKeyOptional' | 'noBaseUrl';

/** What, if anything, keeps a connection from working, judging by the form and what is saved. */
export function connectionIssue(kind: ConnectionKind, form: SettingsFormState, saved: PublicSettings): ConnectionIssue | null {
  const connection = form.connections[kind];
  if (kind === 'custom' && connection.baseUrl.trim() === '') return 'noBaseUrl';
  const source = saved.connections[kind]?.apiKeySource ?? 'none';
  // Removing a saved key may fall back to an environment variable; only a typed key is certain.
  const hasKey = keyTyped(connection.key) || (source !== 'none' && !(connection.key.remove && source === 'settings'));
  if (hasKey) return null;
  return kind === 'custom' ? 'noKeyOptional' : 'noKey';
}

export type RoleName = 'gameMaster' | 'actor';

/** Which roles use a connection. A following actor uses the game master's. */
export function rolesUsing(kind: ConnectionKind, form: SettingsFormState): RoleName[] {
  const roles: RoleName[] = [];
  if (form.gameMaster.provider === kind) roles.push('gameMaster');
  if (actorProvider(form) === kind) roles.push('actor');
  return roles;
}
