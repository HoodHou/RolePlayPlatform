import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  GENERATION_DEFAULTS,
} from '@roleplay/shared';
import { resolveRole, resolveSettings, toPublicSettings, upgradeSettings } from './settingsStore';

test('a fresh checkout with no keys plays the demo, pictures included', () => {
  const settings = resolveSettings({}, {});
  assert.equal(settings.gameMaster.provider, 'mock');
  assert.equal(settings.actor.provider, 'same');
  assert.equal(settings.illustrationsActive, true);
  assert.equal(settings.image.enabled, false);
  assert.deepEqual(settings.generation, GENERATION_DEFAULTS);
});

test('one key in the environment is enough: that provider runs the game on its official endpoint', () => {
  const openai = resolveSettings({}, { OPENAI_API_KEY: 'sk-env' });
  assert.equal(openai.gameMaster.provider, 'openai');
  assert.deepEqual(openai.connections.openai, {
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    model: DEFAULT_OPENAI_MODEL,
    apiKey: 'sk-env',
    apiKeySource: 'env',
  });
  // Painting stays off until the user turns it on.
  assert.equal(openai.illustrationsActive, false);

  const gemini = resolveSettings({}, { GEMINI_API_KEY: 'g-env' });
  assert.equal(gemini.gameMaster.provider, 'gemini');
  assert.deepEqual(resolveRole(gemini, 'gameMaster'), { provider: 'gemini', model: DEFAULT_GEMINI_MODEL, effort: null });
  assert.equal(gemini.connections.gemini.baseUrl, DEFAULT_GEMINI_BASE_URL);

  const custom = resolveSettings(
    {},
    { RP_CUSTOM_BASE_URL: 'https://gateway.example/v1', RP_CUSTOM_API_KEY: 'gw-env', RP_CUSTOM_MODEL: 'some-model' },
  );
  assert.equal(custom.gameMaster.provider, 'custom');
  assert.deepEqual(custom.connections.custom, {
    baseUrl: 'https://gateway.example/v1',
    model: 'some-model',
    apiKey: 'gw-env',
    apiKeySource: 'env',
  });
});

test('Claude is preferred when several keys are present, and its key stays in the environment for the SDK', () => {
  const settings = resolveSettings({}, { ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-env' });
  assert.equal(settings.gameMaster.provider, 'anthropic');
  assert.equal(settings.connections.anthropic.apiKey, null);
  assert.equal(settings.connections.anthropic.apiKeySource, 'env');
  assert.equal(settings.connections.anthropic.model, DEFAULT_ANTHROPIC_MODEL);

  // An empty base URL and the official address are the same place for Claude.
  const withOfficialUrl = resolveSettings(
    { connections: { anthropic: { baseUrl: '' } } },
    { ANTHROPIC_API_KEY: 'sk-ant', ANTHROPIC_BASE_URL: 'https://api.anthropic.com' },
  );
  assert.equal(withOfficialUrl.connections.anthropic.apiKeySource, 'env');
  assert.equal(withOfficialUrl.connections.anthropic.model, DEFAULT_ANTHROPIC_MODEL);
});

test('an environment key is never sent to a different endpoint typed into the app', () => {
  const settings = resolveSettings(
    { gameMaster: { provider: 'openai' }, connections: { openai: { baseUrl: 'https://proxy.example/v1' } } },
    { OPENAI_API_KEY: 'sk-env', GEMINI_API_KEY: 'g-env' },
  );
  assert.equal(settings.connections.openai.apiKey, null);
  assert.equal(settings.connections.openai.apiKeySource, 'none');
  // No default model either: only the provider's own endpoint has names known in advance.
  assert.equal(settings.connections.openai.model, '');
  // The custom connection has no environment of its own to borrow from.
  assert.deepEqual(settings.connections.custom, { baseUrl: '', model: '', apiKey: null, apiKeySource: 'none' });
});

test('the story and the characters can run on different models', () => {
  const settings = resolveSettings(
    {
      gameMaster: { provider: 'anthropic', effort: 'high' },
      actor: { provider: 'custom', model: 'fast-model', effort: 'low' },
      connections: { custom: { baseUrl: 'https://gateway.example/v1', apiKey: 'gw', model: 'big-model' } },
    },
    { ANTHROPIC_API_KEY: 'sk-ant' },
  );
  assert.deepEqual(resolveRole(settings, 'gameMaster'), { provider: 'anthropic', model: DEFAULT_ANTHROPIC_MODEL, effort: 'high' });
  assert.deepEqual(resolveRole(settings, 'actor'), { provider: 'custom', model: 'fast-model', effort: 'low' });
});

test('by default characters follow the game master, and answer quickly on Claude', () => {
  const claude = resolveSettings({ gameMaster: { provider: 'anthropic', model: 'claude-sonnet-5-5' } }, {});
  assert.deepEqual(resolveRole(claude, 'actor'), { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'low' });

  // Elsewhere nothing is sent by default: not every server knows the setting.
  const custom = resolveSettings(
    { gameMaster: { provider: 'custom' }, connections: { custom: { baseUrl: 'http://localhost:11434/v1', model: 'llama' } } },
    {},
  );
  assert.deepEqual(resolveRole(custom, 'actor'), { provider: 'custom', model: 'llama', effort: null });

  // An explicit choice, including "let the model decide", is kept.
  const explicit = resolveSettings({ gameMaster: { provider: 'anthropic' }, actor: { effort: null } }, {});
  assert.equal(resolveRole(explicit, 'actor').effort, null);
});

test('an effort level the provider has no name for is dropped', () => {
  const settings = resolveSettings({ gameMaster: { provider: 'anthropic', effort: 'minimal' }, actor: { effort: 'none' } }, {});
  assert.equal(settings.gameMaster.effort, null);
  assert.equal(settings.actor.effort, null);

  const gemini = resolveSettings({ gameMaster: { provider: 'gemini', effort: 'minimal' } }, {});
  assert.equal(gemini.gameMaster.effort, 'minimal');
});

test('painting reuses a connection key only when both point at the same endpoint', () => {
  const sameEndpoint = resolveSettings({ connections: { openai: { apiKey: 'sk-saved' } }, image: { enabled: true } }, {});
  assert.equal(sameEndpoint.image.apiKey, 'sk-saved');
  assert.equal(sameEndpoint.image.apiKeySource, 'shared');
  assert.equal(sameEndpoint.image.model, DEFAULT_IMAGE_MODEL);
  assert.equal(sameEndpoint.illustrationsActive, true);

  const gateway = resolveSettings(
    {
      connections: { custom: { apiKey: 'gw', baseUrl: 'https://gateway.example/v1' } },
      image: { enabled: true, baseUrl: 'https://gateway.example/v1/' },
    },
    {},
  );
  assert.equal(gateway.image.apiKey, 'gw');

  const elsewhere = resolveSettings(
    { connections: { custom: { apiKey: 'gw', baseUrl: 'https://gateway.example/v1' } }, image: { enabled: true } },
    {},
  );
  assert.equal(elsewhere.image.apiKey, null);
  assert.equal(elsewhere.illustrationsActive, false);
});

test('Claude can tell the story while an OpenAI key paints it', () => {
  const settings = resolveSettings({ image: { enabled: true } }, { ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-env' });
  assert.equal(settings.gameMaster.provider, 'anthropic');
  assert.equal(settings.image.apiKeySource, 'env');
  assert.equal(settings.illustrationsActive, true);
});

test('keys never appear in what is sent to the browser', () => {
  const settings = resolveSettings(
    {
      connections: {
        anthropic: { apiKey: 'sk-ant-secret' },
        openai: { apiKey: 'sk-oai-secret' },
        gemini: { apiKey: 'g-secret' },
        custom: { apiKey: 'gw-secret', baseUrl: 'https://gateway.example/v1' },
      },
      image: { apiKey: 'sk-img-secret' },
    },
    { OPENAI_API_KEY: 'sk-env-secret', RP_CUSTOM_API_KEY: 'gw-env-secret' },
  );
  const sent = toPublicSettings(settings);
  assert.equal(JSON.stringify(sent).includes('secret'), false);
  assert.equal(sent.connections.anthropic.apiKeySource, 'settings');
  assert.equal(sent.connections.custom.baseUrl, 'https://gateway.example/v1');
});

test('settings saved before connections existed are carried over', () => {
  // The earlier layout had one "OpenAI-compatible" slot; it becomes OpenAI or a custom endpoint.
  assert.deepEqual(
    upgradeSettings({
      activeProvider: 'anthropic',
      anthropic: { model: 'claude-opus-5-5', baseUrl: '', effort: 'medium', apiKey: 'sk-ant' },
      openaiCompatible: { model: 'gpt-6.1-sol', baseUrl: 'https://api.openai.com/v1' },
      image: { enabled: true, quality: 'low' },
    }),
    {
      gameMaster: { provider: 'anthropic', effort: 'medium' },
      connections: {
        anthropic: { model: 'claude-opus-5-5', baseUrl: '', apiKey: 'sk-ant' },
        openai: { model: 'gpt-6.1-sol', baseUrl: 'https://api.openai.com/v1' },
      },
      image: { enabled: true, quality: 'low' },
    },
  );

  assert.deepEqual(
    upgradeSettings({
      activeProvider: 'openai-compatible',
      openaiCompatible: { model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'ds' },
    }),
    {
      gameMaster: { provider: 'custom' },
      connections: { custom: { model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'ds' } },
    },
  );

  // Already in the current layout: left alone.
  const current = { gameMaster: { provider: 'gemini' as const } };
  assert.equal(upgradeSettings(current), current);
});
