import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_IMAGE_MODEL, DEFAULT_OPENAI_BASE_URL, DEFAULT_OPENAI_MODEL } from '@roleplay/shared';
import { resolveSettings, toPublicSettings } from './settingsStore';

test('a fresh checkout with no keys plays the demo, pictures included', () => {
  const settings = resolveSettings({}, {});
  assert.equal(settings.activeProvider, 'mock');
  assert.equal(settings.illustrationsActive, true);
  assert.equal(settings.image.enabled, false);
});

test('an OpenAI key alone is enough: official endpoint and a default model follow', () => {
  const settings = resolveSettings({}, { OPENAI_API_KEY: 'sk-env' });
  assert.equal(settings.activeProvider, 'openai-compatible');
  assert.equal(settings.openaiCompatible.baseUrl, DEFAULT_OPENAI_BASE_URL);
  assert.equal(settings.openaiCompatible.model, DEFAULT_OPENAI_MODEL);
  assert.equal(settings.openaiCompatible.apiKey, 'sk-env');
  assert.equal(settings.openaiCompatible.apiKeySource, 'env');
  // Painting stays off until the user turns it on.
  assert.equal(settings.illustrationsActive, false);
});

test('an Anthropic key is preferred, and stays in the environment for the SDK to read', () => {
  const settings = resolveSettings({}, { ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-env' });
  assert.equal(settings.activeProvider, 'anthropic');
  assert.equal(settings.anthropic.apiKey, null);
  assert.equal(settings.anthropic.apiKeySource, 'env');
});

test('the environment key is never sent to a different endpoint typed into the app', () => {
  const settings = resolveSettings(
    { openaiCompatible: { baseUrl: 'https://api.deepseek.com/v1' } },
    { OPENAI_API_KEY: 'sk-env' },
  );
  assert.equal(settings.openaiCompatible.apiKey, null);
  assert.equal(settings.openaiCompatible.apiKeySource, 'none');
  // No default model either: only OpenAI's own names are known in advance.
  assert.equal(settings.openaiCompatible.model, '');
});

test('painting reuses the text provider key only when both point at the same endpoint', () => {
  const sameEndpoint = resolveSettings(
    { openaiCompatible: { apiKey: 'sk-saved' }, image: { enabled: true } },
    {},
  );
  assert.equal(sameEndpoint.image.apiKey, 'sk-saved');
  assert.equal(sameEndpoint.image.apiKeySource, 'shared');
  assert.equal(sameEndpoint.image.model, DEFAULT_IMAGE_MODEL);
  assert.equal(sameEndpoint.illustrationsActive, true);

  const elsewhere = resolveSettings(
    { openaiCompatible: { apiKey: 'sk-deepseek', baseUrl: 'https://api.deepseek.com/v1' }, image: { enabled: true } },
    {},
  );
  assert.equal(elsewhere.image.apiKey, null);
  assert.equal(elsewhere.image.apiKeySource, 'none');
  assert.equal(elsewhere.illustrationsActive, false);
});

test('Claude can tell the story while an OpenAI key paints it', () => {
  const settings = resolveSettings(
    { image: { enabled: true } },
    { ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-env' },
  );
  assert.equal(settings.activeProvider, 'anthropic');
  assert.equal(settings.image.apiKeySource, 'env');
  assert.equal(settings.illustrationsActive, true);
});

test('keys never appear in what is sent to the browser', () => {
  const settings = resolveSettings(
    { anthropic: { apiKey: 'sk-ant-secret' }, openaiCompatible: { apiKey: 'sk-oai-secret' }, image: { apiKey: 'sk-img-secret' } },
    { OPENAI_API_KEY: 'sk-env-secret' },
  );
  const sent = JSON.stringify(toPublicSettings(settings));
  assert.equal(sent.includes('secret'), false);
  assert.equal(toPublicSettings(settings).anthropic.apiKeySource, 'settings');
});
