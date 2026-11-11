import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createEmptyWorld,
  type GeneratePortraitResponse,
  type PublicSettings,
  type Session,
  type TurnEvent,
} from '@roleplay/shared';
import { createApp } from './app';
import { runTurn } from './engine/gameMaster';
import { clearPlugins, PluginStore } from './engine/modules';
import { buildCharacterPortraitPrompt, upsertCharacter, upsertLocation } from './engine/world';
import { MockPainter } from './images/mock';
import type { Painter, Painting, PaintRequest } from './images/types';
import { MockProvider } from './llm/mock';
import { NO_USAGE, type Conversation, type LLMProvider, type StepResult } from './llm/types';
import { ImageStore } from './store/imageStore';
import { SessionStore } from './store/sessionStore';
import { SettingsStore } from './store/settingsStore';

function scripted(steps: Partial<StepResult>[]): LLMProvider {
  return {
    kind: 'mock' as const,
    startConversation(): Conversation {
      let index = 0;
      return {
        async step(handlers) {
          const step = steps[index++] ?? {};
          if (step.text) handlers.onTextDelta(step.text);
          return { text: '', toolCalls: [], stop: 'end', usage: { ...NO_USAGE }, ...step };
        },
        submitToolResults: () => {},
        addUserMessage: () => {},
      };
    },
  };
}

test('appearance & buildCharacterPortraitPrompt: stores visual anchor and composes self-contained portrait prompts', () => {
  const world = createEmptyWorld();
  world.title = '大乾盛世';
  upsertLocation(world, { id: 'loc_court', name: '太和殿' });
  upsertCharacter(world, {
    id: 'npc_minister',
    name: '沈墨卿',
    role: '礼部侍郎',
    appearance: '三十许清癯文士，鬓染微霜，绯色仙鹤官袍，手持象牙笏板',
    description: '三朝元老门生，博古通今。',
    personality: '温润谦和而暗藏机锋',
    status: '立于丹墀之下候旨',
    locationId: 'loc_court',
  });

  const minister = world.characters.npc_minister!;
  assert.equal(minister.appearance, '三十许清癯文士，鬓染微霜，绯色仙鹤官袍，手持象牙笏板');

  const prompt = buildCharacterPortraitPrompt(minister, world, '立于风雪宫门前');
  assert.match(prompt, /Character portrait of 沈墨卿/);
  assert.match(prompt, /Role: 礼部侍郎/);
  assert.match(prompt, /Appearance: 三十许清癯文士/);
  assert.match(prompt, /World setting: 大乾盛世/);
  assert.match(prompt, /立于风雪宫门前/);
});

test('POST /api/sessions/:id/characters/:characterId/portrait paints & repaints character portraits and updates snapshots', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'roleplay-portrait-'));
  try {
    clearPlugins();
    const sessions = new SessionStore(dataDir);
    const settings = new SettingsStore(dataDir, {});
    const images = new ImageStore(dataDir);
    const plugins = new PluginStore(dataDir);
    await plugins.loadAll();

    const capturedPrompts: string[] = [];
    const basePainter = new MockPainter({ delayMs: 0 });
    const trackingPainter: Painter = {
      async paint(req: PaintRequest): Promise<Painting> {
        capturedPrompts.push(req.prompt);
        return basePainter.paint(req);
      },
    };

    const app = createApp({
      sessions,
      settings,
      images,
      plugins,
      createProvider: () => new MockProvider({ delayMs: 0 }),
      createPainter: () => trackingPainter,
    });

    // Enable autoCharacterPortraits via PUT /api/settings and verify public settings round-trip.
    const putSettings = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: { autoCharacterPortraits: true } }),
    });
    assert.equal(putSettings.status, 200);
    const pubSettings = (await putSettings.json()) as PublicSettings;
    assert.equal(pubSettings.image.autoCharacterPortraits, true);

    // Create a session and run opening turn.
    const createRes = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'zh', premise: '金銮殿早朝，百官肃立', playerName: '萧景琰' }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as Session;

    const turn1Res = await app.request(`/api/sessions/${created.id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'start' }),
    });
    assert.equal(turn1Res.status, 200);
    await turn1Res.text();
    await new Promise((r) => setTimeout(r, 30));

    const afterStart = (await (await app.request(`/api/sessions/${created.id}`)).json()) as Session;
    // Because autoCharacterPortraits is true, npc_mara introduced on turn 1 automatically received a portrait!
    assert.ok(afterStart.world.characters.npc_mara?.imageUrl, 'newcomer NPC received automatic portrait');

    // Manually paint the player sovereign's portrait with custom attire prompt.
    const playerId = afterStart.world.playerId!;
    const portraitRes = await app.request(`/api/sessions/${created.id}/characters/${playerId}/portrait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '身穿十二章玄金龙袍，头戴冕旒' }),
    });
    assert.equal(portraitRes.status, 200);
    const painted = (await portraitRes.json()) as GeneratePortraitResponse;
    assert.equal(painted.characterId, playerId);
    assert.ok(painted.url.startsWith(`/api/images/${created.id}/`));
    assert.equal(painted.world.characters[playerId]?.imageUrl, painted.url);
    assert.match(capturedPrompts[capturedPrompts.length - 1] ?? '', /身穿十二章玄金龙袍/);
    assert.match(capturedPrompts[capturedPrompts.length - 1] ?? '', /Art style:/);

    // Repainting produces a fresh image URL and updates persisted session + snapshots.
    const repaintRes = await app.request(`/api/sessions/${created.id}/characters/${playerId}/portrait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '微服私访青衫常服' }),
    });
    assert.equal(repaintRes.status, 200);
    const repainted = (await repaintRes.json()) as GeneratePortraitResponse;
    assert.notEqual(repainted.url, painted.url);

    const reloaded = (await (await app.request(`/api/sessions/${created.id}`)).json()) as Session;
    assert.equal(reloaded.world.characters[playerId]?.imageUrl, repainted.url);
    const latestSnap = reloaded.snapshots?.[reloaded.snapshots.length - 1];
    assert.equal(latestSnap?.world.characters[playerId]?.imageUrl, repainted.url);

    // Unknown character returns 404.
    const missingRes = await app.request(`/api/sessions/${created.id}/characters/npc_nobody/portrait`, {
      method: 'POST',
    });
    assert.equal(missingRes.status, 404);
  } finally {
    clearPlugins();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('autoCharacterPortraits: queues up to 2 newcomer NPC portraits per turn, prioritizing present NPCs and skipping already-pictured ones', async () => {
  const now = new Date().toISOString();
  const session: Session = {
    id: 'sess-auto-portraits',
    createdAt: now,
    updatedAt: now,
    language: 'zh',
    seed: { premise: '', playerName: '萧景琰', playerConcept: '' },
    modules: [],
    modulesAuto: false,
    world: createEmptyWorld(),
    messages: [],
  };

  const provider = scripted([
    {
      stop: 'tool_use',
      toolCalls: [
        { id: 'n1', name: 'narrate', input: { text: '早朝钟鸣，三位重臣立于殿内外。' } },
        {
          id: 'r1',
          name: 'record',
          input: {
            world: { title: '大乾早朝', art_style: '工笔重彩古风立绘' },
            locations: [
              { id: 'loc_hall', name: '太和殿' },
              { id: 'loc_frontier', name: '雁门关' },
            ],
            scene: { location_id: 'loc_hall' },
            characters: [
              { id: 'pc', name: '萧景琰', is_player: true },
              { id: 'npc_offscene', name: '镇边大将', role: '边将', location_id: 'loc_frontier' },
              { id: 'npc_minister_a', name: '左相严嵩', role: '内阁首辅', appearance: '白须紫袍', location_id: 'loc_hall' },
              { id: 'npc_minister_b', name: '右相徐阶', role: '次辅', appearance: '清瘦绯袍', location_id: 'loc_hall' },
              { id: 'npc_already_painted', name: '司礼监掌印', role: '大珰', location_id: 'loc_hall' },
            ],
            pictures: [
              {
                subject: 'character',
                id: 'npc_already_painted',
                caption: '司礼监掌印',
                prompt: 'Crimson eunuch robes in palace shadow',
              },
            ],
            suggestions: ['宣旨'],
          },
        },
      ],
    },
    { stop: 'end' },
  ]);

  const events: TurnEvent[] = [];
  let count = 0;
  const outcome = await runTurn(
    session,
    { kind: 'start' },
    {
      provider,
      emit: (e) => events.push(e),
      signal: new AbortController().signal,
      illustrate: async () => `/api/images/sess-auto-portraits/${++count}.svg`,
      autoCharacterPortraits: true,
    },
  );

  assert.equal(outcome.error, null);
  // 1 explicit picture (`npc_already_painted`) + 2 auto portraits (the two present ministers `npc_minister_a` & `npc_minister_b`),
  // while `npc_offscene` (3rd unpictured newcomer, off-scene) and `pc` (player) are skipped!
  assert.equal(count, 3);
  assert.ok(session.world.characters.npc_already_painted?.imageUrl);
  assert.ok(session.world.characters.npc_minister_a?.imageUrl);
  assert.ok(session.world.characters.npc_minister_b?.imageUrl);
  assert.equal(session.world.characters.npc_offscene?.imageUrl, undefined);
  assert.equal(session.world.characters.pc?.imageUrl, undefined);
});
