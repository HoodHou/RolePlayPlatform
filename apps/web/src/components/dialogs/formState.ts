import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  type Effort,
  type ImageQuality,
  type ModelListTarget,
  type ProviderKind,
  type PublicSettings,
  type UpdateSettingsRequest,
} from '@roleplay/shared';
import { keyPatch, NO_KEY_EDIT, type KeyEdit } from './ApiKeyField';

/** Everything the Settings dialog edits. Nothing reaches the server until Save. */
export interface SettingsFormState {
  provider: ProviderKind;
  anthropic: { model: string; baseUrl: string; effort: Effort | null; key: KeyEdit };
  openai: { model: string; baseUrl: string; key: KeyEdit };
  image: { enabled: boolean; baseUrl: string; model: string; quality: ImageQuality; key: KeyEdit };
}

export function formFromSettings(settings: PublicSettings): SettingsFormState {
  return {
    provider: settings.activeProvider,
    anthropic: {
      model: settings.anthropic.model,
      baseUrl: settings.anthropic.baseUrl,
      effort: settings.anthropic.effort,
      key: NO_KEY_EDIT,
    },
    openai: { model: settings.openaiCompatible.model, baseUrl: settings.openaiCompatible.baseUrl, key: NO_KEY_EDIT },
    image: {
      enabled: settings.image.enabled,
      baseUrl: settings.image.baseUrl,
      model: settings.image.model,
      quality: settings.image.quality,
      key: NO_KEY_EDIT,
    },
  };
}

// Blank fields are sent as the documented defaults rather than as empty strings.
const openaiBaseUrl = (value: string) => value.trim() || DEFAULT_OPENAI_BASE_URL;
const imageBaseUrl = (value: string) => value.trim() || DEFAULT_OPENAI_BASE_URL;

export function formToUpdate(form: SettingsFormState): UpdateSettingsRequest {
  return {
    activeProvider: form.provider,
    anthropic: {
      model: form.anthropic.model.trim() || DEFAULT_ANTHROPIC_MODEL,
      baseUrl: form.anthropic.baseUrl.trim(),
      effort: form.anthropic.effort,
      ...keyPatch(form.anthropic.key),
    },
    openaiCompatible: {
      model: form.openai.model.trim(),
      baseUrl: openaiBaseUrl(form.openai.baseUrl),
      ...keyPatch(form.openai.key),
    },
    image: {
      enabled: form.image.enabled,
      baseUrl: imageBaseUrl(form.image.baseUrl),
      model: form.image.model.trim() || DEFAULT_IMAGE_MODEL,
      quality: form.image.quality,
      ...keyPatch(form.image.key),
    },
  };
}

/** Fills the form from a settings update (an official shortcut) without saving it. Keys are left alone. */
export function applyToForm(form: SettingsFormState, update: UpdateSettingsRequest): SettingsFormState {
  const { anthropic, openaiCompatible, image } = update;
  return {
    provider: update.activeProvider ?? form.provider,
    anthropic: {
      ...form.anthropic,
      model: anthropic?.model ?? form.anthropic.model,
      baseUrl: anthropic?.baseUrl ?? form.anthropic.baseUrl,
      effort: anthropic?.effort !== undefined ? anthropic.effort : form.anthropic.effort,
    },
    openai: {
      ...form.openai,
      model: openaiCompatible?.model ?? form.openai.model,
      baseUrl: openaiCompatible?.baseUrl ?? form.openai.baseUrl,
    },
    image: {
      ...form.image,
      enabled: image?.enabled ?? form.image.enabled,
      baseUrl: image?.baseUrl ?? form.image.baseUrl,
      model: image?.model ?? form.image.model,
      quality: image?.quality ?? form.image.quality,
    },
  };
}

const keyEdited = (edit: KeyEdit) => edit.value.trim() !== '' || edit.remove;

/**
 * Model lists are fetched with the *saved* address and key. True when the form
 * changes one of those for `target`, so it has to be saved first.
 */
export function modelListNeedsSave(form: SettingsFormState, saved: PublicSettings, target: ModelListTarget): boolean {
  switch (target) {
    case 'anthropic':
      return form.anthropic.baseUrl.trim() !== saved.anthropic.baseUrl || keyEdited(form.anthropic.key);
    case 'openai-compatible':
      return (
        openaiBaseUrl(form.openai.baseUrl) !== openaiBaseUrl(saved.openaiCompatible.baseUrl) || keyEdited(form.openai.key)
      );
    case 'image':
      // The image section may borrow the OpenAI-compatible key ("shared").
      return (
        imageBaseUrl(form.image.baseUrl) !== imageBaseUrl(saved.image.baseUrl) ||
        keyEdited(form.image.key) ||
        (saved.image.apiKeySource === 'shared' && keyEdited(form.openai.key))
      );
  }
}
