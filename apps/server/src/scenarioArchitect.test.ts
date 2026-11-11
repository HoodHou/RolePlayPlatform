import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  CHAT_MODEL_PRESETS,
  formatModelDisplayName,
  type ScenarioStreamEvent,
} from '@roleplay/shared';
import { createApp } from './app';
import { clearPlugins, PluginStore } from './engine/modules';
import { PROPOSE_SCENARIO, runScenarioArchitect } from './engine/scenarioArchitect';
import { MockPainter } from './images/mock';
import { MockProvider } from './llm/mock';
import { NO_USAGE, type Conversation, type LLMProvider, type StepResult } from './llm/types';
import { ImageStore } from './store/imageStore';
import { SessionStore } from './store/sessionStore';
import { SettingsStore, type ResolvedSettings } from './store/settingsStore';

function parseSseEvents<T>(raw: string): T[] {
  const frames = raw
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const events: T[] = [];
  for (const frame of frames) {
    const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
    if (dataLine) {
      events.push(JSON.parse(dataLine.slice(5).trim()) as T);
    }
  }
  return events;
}

test('CHAT_MODEL_PRESETS & formatModelDisplayName: maps flagship presets and prettifies unknown IDs', () => {
  assert.ok(CHAT_MODEL_PRESETS.gemini.length >= 2);
  assert.ok(CHAT_MODEL_PRESETS.anthropic.length >= 2);
  assert.ok(CHAT_MODEL_PRESETS.openai.length >= 2);

  const geminiTop = CHAT_MODEL_PRESETS.gemini[0]!;
  assert.equal(formatModelDisplayName('gemini', geminiTop.model), geminiTop.label);
  assert.equal(formatModelDisplayName('mock', ''), 'Demo (Offline)');
  assert.equal(formatModelDisplayName('custom', 'deepseek-reasoner'), 'DeepSeek R1');
  assert.equal(formatModelDisplayName('anthropic', 'claude-sonnet-4-5-20250929'), 'Claude Sonnet 4.5');
});

test('runScenarioArchitect: streams reply deltas, builds imperial blueprint, and filters by availableModules', async () => {
  const provider = new MockProvider({ delayMs: 0 });
  const events: ScenarioStreamEvent[] = [];

  await runScenarioArchitect(
    {
      language: 'zh',
      messages: [{ role: 'user', text: '我想玩一个刚登基的新皇帝，朝堂权臣林立，准备推行变法' }],
      availableModules: ['court', 'lineage', 'espionage', 'bonds'],
    },
    {
      provider,
      emit: (ev) => events.push(ev),
      signal: new AbortController().signal,
    },
  );

  const deltas = events
    .filter((e): e is Extract<ScenarioStreamEvent, { type: 'reply_delta' }> => e.type === 'reply_delta')
    .map((e) => e.text)
    .join('');

  const done = events.find((e): e is Extract<ScenarioStreamEvent, { type: 'done' }> => e.type === 'done');
  assert.ok(done, 'Expected a done event');
  assert.ok(deltas.length > 0, 'Expected streamed reply deltas');
  assert.equal(deltas, done.reply);
  assert.ok(done.blueprint, 'Expected structured scenario blueprint');
  assert.ok(done.blueprint.title.length > 0);
  assert.ok(done.blueprint.premise.length > 40);
  assert.ok(done.blueprint.playerName.length > 0);
  assert.ok(done.blueprint.playerConcept.length > 0);
  assert.ok(done.suggestions.length >= 2);

  // Recommended modules must be strictly within availableModules.
  for (const mod of done.blueprint.modules) {
    assert.ok(
      ['court', 'lineage', 'espionage', 'bonds'].includes(mod),
      `Unexpected module "${mod}" outside availableModules`,
    );
  }
  assert.ok(done.blueprint.modules.includes('court'));
});

test('runScenarioArchitect: refines existing currentDraft and preserves player chosen name', async () => {
  const provider = new MockProvider({ delayMs: 0 });
  const events: ScenarioStreamEvent[] = [];

  await runScenarioArchitect(
    {
      language: 'zh',
      messages: [
        { role: 'user', text: '帮我设计朝堂皇帝开局' },
        { role: 'assistant', text: '已为你拟好永宁初政开局。' },
        { role: 'user', text: '在这个基础上加入修仙国运龙脉元素' },
      ],
      currentDraft: {
        title: '九重惊雷 · 新帝亲政',
        premise: '大乾永宁元年冬，先帝暴崩，清流与勋贵对峙朝堂。',
        playerName: '李长歌',
        playerConcept: '隐忍果决的少年天子',
        modules: ['court', 'lineage', 'domain'],
      },
    },
    {
      provider,
      emit: (ev) => events.push(ev),
      signal: new AbortController().signal,
    },
  );

  const done = events.find((e): e is Extract<ScenarioStreamEvent, { type: 'done' }> => e.type === 'done');
  assert.ok(done?.blueprint);
  assert.equal(done.blueprint.playerName, '李长歌');
  assert.ok(done.blueprint.premise.includes('大乾永宁元年冬'));
});

test('runScenarioArchitect: recovers from malformed tool call and supports plain-text fallback', async () => {
  let stepCount = 0;
  const recoveringProvider: LLMProvider = {
    kind: 'mock',
    startConversation(): Conversation {
      return {
        async step(handlers): Promise<StepResult> {
          stepCount += 1;
          if (stepCount === 1) {
            const badCall = { id: 'c1', name: PROPOSE_SCENARIO, input: { reply: '' } };
            handlers.onToolInput(badCall, '{"reply":"partial...');
            return {
              text: '',
              toolCalls: [badCall],
              stop: 'tool_use',
              usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
            };
          }
          const goodInput = {
            reply: 'Refined your dark fantasy frontier premise!',
            blueprint: {
              title: 'Ashen Watch',
              premise: 'On the frost-bitten march, the beacon towers have fallen silent one by one.',
              player_name: 'Kaelen',
              player_concept: 'Last sworn warden of the Seventh Tower',
              modules: ['combat', 'travel', 'dice', 'nonexistent_module'],
            },
            suggestions: ['Add an ancient curse', 'Introduce a rival captain'],
          };
          const goodCall = { id: 'c2', name: PROPOSE_SCENARIO, input: goodInput };
          handlers.onToolInput(goodCall, JSON.stringify(goodInput));
          return {
            text: '',
            toolCalls: [goodCall],
            stop: 'tool_use',
            usage: { inputTokens: 20, outputTokens: 30, cachedInputTokens: 5 },
          };
        },
        submitToolResults: () => {},
        addUserMessage: () => {},
      };
    },
  };

  const events: ScenarioStreamEvent[] = [];
  await runScenarioArchitect(
    {
      language: 'en',
      messages: [{ role: 'user', text: 'Dark fantasy frontier watchtower' }],
    },
    {
      provider: recoveringProvider,
      emit: (ev) => events.push(ev),
      signal: new AbortController().signal,
    },
  );

  assert.equal(stepCount, 2);
  const done = events.find((e): e is Extract<ScenarioStreamEvent, { type: 'done' }> => e.type === 'done');
  assert.ok(done?.blueprint);
  assert.equal(done.blueprint.title, 'Ashen Watch');
  assert.deepEqual(done.blueprint.modules, ['dice', 'combat', 'travel']);
  assert.equal(done.usage.inputTokens, 30);
  assert.equal(done.usage.outputTokens, 35);

  // Plain-text fallback when a custom model does not invoke the tool at all:
  const plainProvider: LLMProvider = {
    kind: 'mock',
    startConversation: () => ({
      async step() {
        return {
          text: 'What era would you like—ancient dynasty or futuristic sci-fi?',
          toolCalls: [],
          stop: 'end',
          usage: { ...NO_USAGE, inputTokens: 12, outputTokens: 14 },
        };
      },
      submitToolResults: () => {},
      addUserMessage: () => {},
    }),
  };

  const plainEvents: ScenarioStreamEvent[] = [];
  await runScenarioArchitect(
    {
      language: 'en',
      messages: [{ role: 'user', text: 'Hi' }],
    },
    {
      provider: plainProvider,
      emit: (ev) => plainEvents.push(ev),
      signal: new AbortController().signal,
    },
  );
  const plainDone = plainEvents.find((e): e is Extract<ScenarioStreamEvent, { type: 'done' }> => e.type === 'done');
  assert.ok(plainDone);
  assert.equal(plainDone.blueprint, null);
  assert.match(plainDone.reply, /What era would you like/);
});

test('POST /api/scenarios/architect streams SSE events and honors modelOverride', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'roleplay-architect-'));
  try {
    clearPlugins();
    const sessions = new SessionStore(dataDir);
    const settings = new SettingsStore(dataDir, {});
    const images = new ImageStore(dataDir);
    const plugins = new PluginStore(dataDir);
    await plugins.loadAll();

    const seenResolved: ResolvedSettings[] = [];
    const mockLlm = new MockProvider({ delayMs: 0 });
    const app = createApp({
      sessions,
      settings,
      images,
      plugins,
      createProvider: (resolved, role) => {
        if (role === 'gameMaster') seenResolved.push(resolved);
        return mockLlm;
      },
      createPainter: () => new MockPainter({ delayMs: 0 }),
    });

    const res = await app.request('/api/scenarios/architect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'zh',
        messages: [{ role: 'user', text: '帮我写一个锦衣卫雪夜查案的开局剧本' }],
        availableModules: ['espionage', 'clues', 'combat', 'dice', 'bonds'],
        modelOverride: {
          provider: 'mock',
          effort: null,
        },
      }),
    });

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const body = await res.text();
    const events = parseSseEvents<ScenarioStreamEvent>(body);

    const done = events.find((e): e is Extract<ScenarioStreamEvent, { type: 'done' }> => e.type === 'done');
    assert.ok(done?.blueprint);
    assert.ok(done.blueprint.modules.includes('espionage'));
    assert.equal(seenResolved.length, 1);
    assert.equal(seenResolved[0]!.gameMaster.provider, 'mock');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
