import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  bondStage,
  createEmptyWorld,
  DEFAULT_SUBSCRIPTIONS,
  MODULE_IDS,
  type ModuleId,
  type ModuleLibraryResponse,
  type PublicSettings,
  type Session,
  type TurnEvent,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { createApp } from '../../app';
import { MockProvider } from '../../llm/mock';
import { NO_USAGE, type Conversation, type ConversationInit, type LLMProvider, type StepResult } from '../../llm/types';
import { ImageStore } from '../../store/imageStore';
import { SessionStore } from '../../store/sessionStore';
import { SettingsStore } from '../../store/settingsStore';
import { buildActorInit } from '../actor';
import { runTurn } from '../gameMaster';
import { getPrompts } from '../prompts';
import { getToolbox, type ToolContext } from '../tools';
import { setScene, upsertCharacter, upsertLocation } from '../world';
import { listLibrary, playableModules } from './index';
import { readFate } from './oracle';

/** A random source whose d100 comes up with these numbers, in order (the last one repeats). */
function d100(...values: number[]): () => number {
  let next = 0;
  return () => ((values[Math.min(next++, values.length - 1)] ?? 1) - 0.5) / 100;
}

const everything = getToolbox({ illustrations: false, modules: MODULE_IDS });

function run(name: string, world: WorldState, input: unknown, random: () => number = d100(50)) {
  const tool = everything.get(name);
  assert.ok(tool, name);
  const ctx: ToolContext = { random, narrate: () => {} };
  const outcome = tool.run(world, input, ctx);
  let report: unknown = outcome.content;
  try {
    report = JSON.parse(outcome.content);
  } catch {
    // Plain-text results are compared as they are.
  }
  return { ...outcome, report: report as Record<string, never> };
}

const rejectedAt = (report: unknown) => ((report as { rejected?: { at: string }[] }).rejected ?? []).map((entry) => entry.at);

function worldWithCast(): WorldState {
  const world = createEmptyWorld();
  upsertLocation(world, { id: 'loc_inn', name: 'Inn' });
  setScene(world, { locationId: 'loc_inn' });
  upsertCharacter(world, { id: 'pc', name: 'Ash', isPlayer: true });
  upsertCharacter(world, { id: 'npc_mara', name: 'Mara', role: 'Innkeeper' });
  world.turn = 3;
  return world;
}

function newSession(overrides: Partial<Session> = {}): Session {
  const now = new Date().toISOString();
  return {
    id: 'test-session',
    createdAt: now,
    updatedAt: now,
    language: 'en',
    seed: { premise: '', playerName: 'Ash', playerConcept: '' },
    modules: ['dice'],
    modulesAuto: false,
    world: createEmptyWorld(),
    messages: [],
    ...overrides,
  };
}

function harness(provider: LLMProvider = new MockProvider({ delayMs: 0 }), extra: { subscribed?: ModuleId[]; random?: () => number } = {}) {
  const events: TurnEvent[] = [];
  const deps = {
    provider,
    emit: (event: TurnEvent) => void events.push(structuredClone(event)),
    signal: new AbortController().signal,
    random: extra.random ?? (() => 0.5),
    ...(extra.subscribed ? { subscribed: extra.subscribed } : {}),
  };
  return { events, deps };
}

const logged = (session: Session, turn: number): WorldEvent[] =>
  session.messages.flatMap((message) => (message.kind === 'event' && message.turn === turn ? [message.event] : []));

/** A provider that records what each conversation was handed, and plays fixed steps. */
function spying(steps: Partial<StepResult>[]): LLMProvider & { inits: ConversationInit[] } {
  const provider = {
    kind: 'mock' as const,
    inits: [] as ConversationInit[],
    startConversation(init: ConversationInit): Conversation {
      provider.inits.push(init);
      let index = 0;
      return {
        step: async () => ({ text: '', toolCalls: [], stop: 'end', usage: { ...NO_USAGE }, ...steps[index++] }),
        submitToolResults: () => {},
        addUserMessage: () => {},
      };
    },
  };
  return provider;
}

const toolNames = (init: ConversationInit | undefined) => init?.tools.map((tool) => tool.name) ?? [];
const recordSections = (init: ConversationInit | undefined) =>
  Object.keys((init?.tools.find((tool) => tool.name === 'record')?.inputSchema.properties ?? {}) as object);

const opening = (record: Record<string, unknown>): Partial<StepResult>[] => [
  {
    stop: 'tool_use',
    toolCalls: [
      { id: 'n1', name: 'narrate', input: { text: 'It begins.' } },
      { id: 'r1', name: 'record', input: { scene: { summary: 'Begun.' }, suggestions: ['Go on'], ...record } },
    ],
  },
];

// --- subscriptions: the gate every turn goes through ----------------------------

test('a story is played only with modules the player subscribes to, whatever the save says', async () => {
  // A save from when the player subscribed to more than they do now.
  const session = newSession({ modules: ['dice', 'oracle', 'sandbox'] });
  session.world.turn = 1;
  assert.deepEqual(playableModules(session, ['dice', 'clocks']), ['dice']);

  const provider = spying(opening({}));
  const outcome = await runTurn(session, { kind: 'action', text: 'Look around' }, harness(provider, { subscribed: ['dice', 'clocks'] }).deps);

  assert.equal(outcome.error, null);
  assert.deepEqual(toolNames(provider.inits[0]), ['narrate', 'roll_dice', 'check', 'record']);
  assert.ok(!provider.inits[0]?.system.includes('ask_fate'), 'no instructions for a module that is not offered');
  // The story still lists them, for the day the player subscribes again.
  assert.deepEqual(session.modules, ['dice', 'oracle', 'sandbox']);
});

test('a fresh install subscribes to dice alone, and the library says what each module is', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'roleplay-'));
  try {
    const app = createApp({
      sessions: new SessionStore(dataDir),
      settings: new SettingsStore(dataDir, {}),
      images: new ImageStore(dataDir),
      createProvider: () => new MockProvider({ delayMs: 0 }),
      createPainter: () => null,
    });
    const send = (method: string, url: string, body?: unknown) =>
      app.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const json = async <T>(response: Response | Promise<Response>) => (await (await response).json()) as T;

    assert.deepEqual((await json<PublicSettings>(send('GET', '/api/settings'))).subscribedModules, DEFAULT_SUBSCRIPTIONS);
    const library = await json<ModuleLibraryResponse>(send('GET', '/api/modules'));
    assert.deepEqual(library.modules.map((entry) => entry.id), [...MODULE_IDS]);
    assert.deepEqual(library.modules.filter((entry) => entry.subscribed).map((entry) => entry.id), ['dice']);

    // A story begun now gets nothing the player has not subscribed to, however it is asked for.
    const greedy = await json<Session>(send('POST', '/api/sessions', { language: 'en', modules: ['dice', 'sandbox', 'oracle'] }));
    assert.deepEqual(greedy.modules, ['dice']);
    const auto = await json<Session>(send('POST', '/api/sessions', { language: 'en' }));
    assert.deepEqual([auto.modules, auto.modulesAuto], [['dice'], true]);
    assert.deepEqual((await json<Session>(send('PATCH', `/api/sessions/${greedy.id}`, { modules: ['dice', 'sandbox'] }))).modules, ['dice']);

    // Subscribing is a settings update; it replaces the list, in the library's own order.
    const updated = await json<PublicSettings>(send('PUT', '/api/settings', { subscribedModules: ['sandbox', 'oracle', 'dice'] }));
    assert.deepEqual(updated.subscribedModules, ['dice', 'oracle', 'sandbox']);
    assert.equal((await send('PUT', '/api/settings', { subscribedModules: ['cards'] })).status, 400);
    assert.deepEqual((await json<Session>(send('PATCH', `/api/sessions/${greedy.id}`, { modules: ['dice', 'sandbox'] }))).modules, ['dice', 'sandbox']);

    // Unsubscribing takes a module out of play at once, without rewriting the stories that had it.
    await send('PUT', '/api/settings', { subscribedModules: ['dice'] });
    const stream = await (await send('POST', `/api/sessions/${greedy.id}/turns`, { kind: 'start' })).text();
    assert.ok(!stream.includes('faction_added'), 'the board was not on offer');
    const after = await json<Session>(send('GET', `/api/sessions/${greedy.id}`));
    assert.deepEqual([after.modules, after.world.modules.sandbox], [['dice', 'sandbox'], undefined]);
    // Switching dice off in that story leaves the unsubscribed board listed as it was.
    assert.deepEqual((await json<Session>(send('PATCH', `/api/sessions/${greedy.id}`, { modules: [] }))).modules, ['sandbox']);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('the library tells modules apart: what they give the game master, and what they cost', () => {
  const library = Object.fromEntries(listLibrary(['dice']).map((entry) => [entry.id, entry]));

  assert.deepEqual(library.dice?.tools, ['roll_dice', 'check']);
  assert.deepEqual(library.oracle?.tools, ['ask_fate']);
  assert.deepEqual([library.oracle?.keepsRecords, library.oracle?.hasPanel], [false, false]);
  // Clocks and bonds are bookkeeping: no tool, so no extra round trip in a turn.
  assert.deepEqual([library.clocks?.tools, library.clocks?.keepsRecords, library.clocks?.hasPanel], [[], true, true]);
  assert.deepEqual([library.bonds?.tools, library.bonds?.reachesCharacters], [[], true]);
  // The board is shown to characters; dice are nothing to them.
  assert.deepEqual([library.sandbox?.reachesCharacters, library.dice?.reachesCharacters], [true, false]);
  assert.deepEqual([library.oracle?.category, library.sandbox?.category, library.bonds?.category], ['story', 'world', 'characters']);

  for (const entry of Object.values(library)) {
    assert.ok(entry.promptTokens.en > 50 && entry.promptTokens.zh > 50, `${entry.id} has a cost`);
  }
  // The board, with its map and its ledger, is the heaviest thing to carry.
  assert.ok((library.sandbox?.promptTokens.en ?? 0) > (library.clocks?.promptTokens.en ?? 0) * 2);
});

// --- the game master's own choice ------------------------------------------------

test('left to choose, the game master is offered what the player subscribes to and keeps what it names', async () => {
  const subscribed: ModuleId[] = ['dice', 'oracle', 'clocks', 'sandbox'];
  const session = newSession({ modules: subscribed, modulesAuto: true });
  const provider = spying(opening({ modules: ['clocks', 'dice', 'dragons'] }));

  const outcome = await runTurn(session, { kind: 'start' }, harness(provider, { subscribed }).deps);

  assert.equal(outcome.error, null);
  // Asked to choose: the record has a place for the answer, and the instructions say so.
  assert.ok(recordSections(provider.inits[0]).includes('modules'));
  assert.match(provider.inits[0]?.system ?? '', /Choosing this story's modules/);
  // A name it made up is ignored; the rest stand, in the library's order.
  assert.deepEqual([session.modules, session.modulesAuto], [['dice', 'clocks'], false]);

  // From then on the choice is settled: nothing to choose, and only the kept modules are carried.
  const later = spying(opening({}));
  await runTurn(session, { kind: 'action', text: 'Go on' }, harness(later, { subscribed }).deps);
  assert.ok(!recordSections(later.inits[0]).includes('modules'));
  assert.ok(!later.inits[0]?.system.includes('Choosing this story'));
  assert.deepEqual(toolNames(later.inits[0]), ['narrate', 'roll_dice', 'check', 'record']);
});

test('a module the game master set up is kept even if it forgot to name it; saying nothing falls back on each module\'s default', async () => {
  const subscribed: ModuleId[] = ['dice', 'oracle', 'clocks', 'sandbox'];

  // Named dice only, but started a clock: the clock is in use, so it stays.
  const forgetful = newSession({ modules: subscribed, modulesAuto: true });
  const clock = { clocks: [{ id: 'clock_tide', name: 'The tide comes in', segments: 4 }], modules: ['dice'] };
  await runTurn(forgetful, { kind: 'start' }, harness(spying(opening(clock)), { subscribed }).deps);
  assert.deepEqual(forgetful.modules, ['dice', 'clocks']);

  // Named nothing at all: the cheap, widely useful ones stay, the board does not.
  const silent = newSession({ modules: subscribed, modulesAuto: true });
  await runTurn(silent, { kind: 'start' }, harness(spying(opening({})), { subscribed }).deps);
  assert.deepEqual(silent.modules, ['dice', 'oracle', 'clocks']);

  // A story whose modules the player picked is not asked.
  const picked = newSession({ modules: ['dice', 'oracle'], modulesAuto: false });
  const provider = spying(opening({ modules: ['dice'] }));
  await runTurn(picked, { kind: 'start' }, harness(provider, { subscribed }).deps);
  assert.ok(!recordSections(provider.inits[0]).includes('modules'));
  assert.deepEqual(picked.modules, ['dice', 'oracle']);
});

test('a choice the engine cannot read is no choice; one it can read stands even if the turn then breaks off', async () => {
  const subscribed: ModuleId[] = ['dice', 'oracle', 'sandbox'];

  // Names in the wrong case are understood.
  const shouted = newSession({ modules: subscribed, modulesAuto: true });
  await runTurn(shouted, { kind: 'start' }, harness(spying(opening({ modules: ['DICE', ' Oracle '] })), { subscribed }).deps);
  assert.deepEqual(shouted.modules, ['dice', 'oracle']);

  // Names that match nothing say nothing: the defaults apply, rather than "keep none".
  const garbled = newSession({ modules: subscribed, modulesAuto: true });
  await runTurn(garbled, { kind: 'start' }, harness(spying(opening({ modules: ['骰子', 'the map'] })), { subscribed }).deps);
  assert.deepEqual(garbled.modules, ['dice', 'oracle']);

  // An empty list does say "none".
  const bare = newSession({ modules: subscribed, modulesAuto: true });
  await runTurn(bare, { kind: 'start' }, harness(spying(opening({ modules: [] })), { subscribed }).deps);
  assert.deepEqual(bare.modules, []);

  // The story was told and the choice recorded, then the model's next step was cut off: the turn is kept, and so is the choice.
  const cutOff = newSession({ modules: subscribed, modulesAuto: true });
  const steps: Partial<StepResult>[] = [
    {
      stop: 'tool_use',
      toolCalls: [
        { id: 'n1', name: 'narrate', input: { text: 'It begins.' } },
        { id: 'f1', name: 'ask_fate', input: { question: 'Is the gate open?' } },
        { id: 'r1', name: 'record', input: { scene: { summary: 'Begun.' }, suggestions: ['Go on'], modules: ['dice'] } },
      ],
    },
    { stop: 'max_tokens', toolCalls: [{ id: 'r2', name: 'record', input: { suggestions: ['Go'] } }] },
  ];
  const outcome = await runTurn(cutOff, { kind: 'start' }, harness(spying(steps), { subscribed }).deps);
  assert.deepEqual([outcome.error?.code, outcome.committed], ['output_truncated', true]);
  assert.deepEqual([cutOff.modules, cutOff.modulesAuto], [['dice'], false]);
});

test('settling leaves alone a module that was never on offer', async () => {
  // The player unsubscribed from the board after creating the story and before its opening.
  const session = newSession({ modules: ['dice', 'oracle', 'sandbox'], modulesAuto: true });
  await runTurn(session, { kind: 'start' }, harness(spying(opening({ modules: ['dice'] })), { subscribed: ['dice', 'oracle'] }).deps);
  // The oracle was offered and not kept. The board was not the game master's to drop: it waits for the player to subscribe again.
  assert.deepEqual(session.modules, ['dice', 'sandbox']);
});

test('the demo game master chooses too: an inn story has no use for a board', async () => {
  const subscribed: ModuleId[] = [...MODULE_IDS];
  const session = newSession({ modules: subscribed, modulesAuto: true });
  await runTurn(session, { kind: 'start' }, harness(undefined, { subscribed }).deps);
  assert.deepEqual(session.modules, MODULE_IDS.filter((id) => id !== 'sandbox'));
  assert.equal(session.modulesAuto, false);
});

// --- oracle ------------------------------------------------------------------------

test('the oracle answers by the odds, with "and" at the far ends and "but" near the line', () => {
  const answer = (roll: number, odds: Parameters<typeof readFate>[0] = 'even') => readFate(odds, d100(roll)).answer;

  // Even odds: 1-10 yes and, 11-40 yes, 41-50 yes but, 51-60 no but, 61-90 no, 91-100 no and.
  assert.deepEqual([1, 10, 11, 40, 41, 50].map((roll) => answer(roll)), ['yes_and', 'yes_and', 'yes', 'yes', 'yes_but', 'yes_but']);
  assert.deepEqual([51, 60, 61, 90, 91, 100].map((roll) => answer(roll)), ['no_but', 'no_but', 'no', 'no', 'no_and', 'no_and']);
  // Long odds leave a yes barely room: 1-2 and, 3-8 plain, 9-10 but.
  assert.deepEqual([2, 5, 10, 11].map((roll) => answer(roll, 'almost_impossible')), ['yes_and', 'yes', 'yes_but', 'no_but']);
  assert.deepEqual([90, 91, 95, 99].map((roll) => answer(roll, 'almost_certain')), ['yes_but', 'no_but', 'no', 'no_and']);

  // A double brings a twist, picked by a second roll; anything else brings none.
  assert.equal(readFate('even', d100(44, 1)).twist, 'new_arrival');
  assert.equal(readFate('even', d100(99, 100)).twist, 'respite');
  assert.deepEqual([readFate('even', d100(45)).twist, readFate('even', d100(100)).twist], [null, null]);
});

test('ask_fate tells the game master what the answer means and shows the player the roll', () => {
  const world = worldWithCast();
  const asked = run('ask_fate', world, { question: 'Is the bridge still standing?', odds: 'likely' }, d100(66, 51));

  assert.equal(asked.isError, false);
  assert.deepEqual(asked.events, [
    { type: 'fate_asked', question: 'Is the bridge still standing?', odds: 'likely', chance: 70, roll: 66, answer: 'yes_but', twist: 'reversal' },
  ]);
  assert.equal(asked.report.answer, 'yes_but');
  assert.match(String(asked.report.means), /catch/);
  assert.match(String(asked.report.twist_means), /Work it into this turn/);
  // The oracle keeps nothing.
  assert.deepEqual(world.modules, {});

  assert.equal(run('ask_fate', world, { question: 'Does the patrol pass?' }, d100(70)).report.chance, 50);
  assert.equal(run('ask_fate', world, { question: '' }).isError, true);
});

// --- clocks --------------------------------------------------------------------------

test('a clock is started, ticked and filled through the record, and the player is told each step', () => {
  const world = worldWithCast();

  const started = run('record', world, {
    clocks: [
      { id: 'clock_guards', name: 'The guards close in', description: 'They find the cellar.', segments: 4 },
      // Its size is left to the default.
      { id: 'clock_forge', name: 'Forging the blade' },
      { id: 'clock_nameless' },
    ],
    suggestions: ['Go on'],
  });
  assert.deepEqual(rejectedAt(started.report), ['clocks[2]']);
  assert.deepEqual(started.events, [
    { type: 'clock_started', id: 'clock_guards', name: 'The guards close in', segments: 4, filled: 0 },
    { type: 'clock_started', id: 'clock_forge', name: 'Forging the blade', segments: 6, filled: 0 },
  ]);

  const ticked = run('record', world, { clocks: [{ id: 'clock_guards', tick: 3 }, { id: 'clock_forge', filled: 2 }], suggestions: ['Go on'] });
  assert.deepEqual(ticked.events, [
    { type: 'clock_ticked', id: 'clock_guards', name: 'The guards close in', from: 0, to: 3, segments: 4 },
    { type: 'clock_ticked', id: 'clock_forge', name: 'Forging the blade', from: 0, to: 2, segments: 6 },
  ]);

  // It cannot overfill; reaching the last segment is the event the player sees as "filled".
  const filled = run('record', world, { clocks: [{ id: 'clock_guards', tick: 5 }], suggestions: ['Go on'] });
  assert.deepEqual(filled.events, [{ type: 'clock_ticked', id: 'clock_guards', name: 'The guards close in', from: 3, to: 4, segments: 4 }]);
  // Progress can be undone, and a tick that changes nothing is not news.
  assert.equal(run('record', world, { clocks: [{ id: 'clock_forge', tick: -9 }], suggestions: ['Go on'] }).events[0]?.type, 'clock_ticked');
  assert.deepEqual(run('record', world, { clocks: [{ id: 'clock_forge', tick: -1 }], suggestions: ['Go on'] }).events, []);

  run('record', world, { clocks: [{ id: 'clock_guards', remove: true }], suggestions: ['Go on'] });
  assert.deepEqual(Object.keys(world.modules.clocks?.clocks ?? {}), ['clock_forge']);
  assert.deepEqual(rejectedAt(run('record', world, { clocks: [{ id: 'clock_guards', remove: true }], suggestions: ['Go on'] }).report), ['clocks[0]']);
});

test('a hidden clock is the game master\'s own until it is revealed', () => {
  const world = worldWithCast();
  const secret = run('record', world, {
    clocks: [{ id: 'clock_ambush', name: 'The ambush is set', segments: 4, hidden: true }],
    suggestions: ['Go on'],
  });
  assert.deepEqual(secret.events, []);
  assert.deepEqual(run('record', world, { clocks: [{ id: 'clock_ambush', tick: 2 }], suggestions: ['Go on'] }).events, []);
  assert.equal(world.modules.clocks?.clocks.clock_ambush?.filled, 2);

  // Revealed, it reads to the player as a clock that has just appeared, part full.
  const revealed = run('record', world, { clocks: [{ id: 'clock_ambush', hidden: false }], suggestions: ['Go on'] });
  assert.deepEqual(revealed.events, [{ type: 'clock_started', id: 'clock_ambush', name: 'The ambush is set', segments: 4, filled: 2 }]);
});

// --- bonds ---------------------------------------------------------------------------

test('a bond moves with what the player does, within its range, and remembers why', () => {
  const world = worldWithCast();

  const moved = run('record', world, {
    bonds: [
      { character_id: 'npc_mara', change: 5, reason: 'Paid for the broken window' },
      { character_id: 'pc', change: 5, reason: 'Self-regard' },
      { character_id: 'npc_ghost', change: 5, reason: 'Nobody' },
    ],
    suggestions: ['Go on'],
  });
  assert.deepEqual(rejectedAt(moved.report), ['bonds[1]', 'bonds[2]']);
  assert.deepEqual(moved.events, [
    { type: 'bond_changed', characterId: 'npc_mara', characterName: 'Mara', from: 0, to: 5, reason: 'Paid for the broken window' },
  ]);
  assert.deepEqual(world.modules.bonds?.bonds.npc_mara, {
    characterId: 'npc_mara',
    score: 5,
    history: [{ turn: 3, change: 5, reason: 'Paid for the broken window' }],
  });

  // An old friend starts where they stand; nothing goes past the ends of the scale.
  run('record', world, { bonds: [{ character_id: 'npc_mara', set: 90, reason: 'Years on the road together' }], suggestions: ['Go on'] });
  const capped = run('record', world, { bonds: [{ character_id: 'npc_mara', change: 40, reason: 'Took the blade meant for her' }], suggestions: ['Go on'] });
  assert.deepEqual([capped.events[0]?.type === 'bond_changed' && capped.events[0].to, world.modules.bonds?.bonds.npc_mara?.history.at(-1)?.change], [100, 10]);
  // A change that moves nothing is not news.
  assert.deepEqual(run('record', world, { bonds: [{ character_id: 'npc_mara', change: 3, reason: 'A kind word' }], suggestions: ['Go on'] }).events, []);

  // Only the latest few reasons are kept.
  for (let i = 0; i < 9; i++) run('record', world, { bonds: [{ character_id: 'npc_mara', change: -1, reason: `Slight ${i}` }], suggestions: ['Go on'] });
  const history = world.modules.bonds?.bonds.npc_mara?.history ?? [];
  assert.deepEqual([history.length, history.at(-1)?.reason, history[0]?.reason], [6, 'Slight 8', 'Slight 3']);

  assert.deepEqual([-100, -60, -59, -20, -19, 0, 19, 20, 49, 50, 79, 80, 100].map(bondStage), [
    'hostile', 'hostile', 'cold', 'cold', 'neutral', 'neutral', 'neutral', 'warm', 'warm', 'close', 'close', 'devoted', 'devoted',
  ]);
});

test('a character who speaks for themselves moves their own bond, and knows where it stands', async () => {
  const session = newSession({ modules: ['dice', 'bonds'] });
  const subscribed: ModuleId[] = ['dice', 'bonds'];
  await runTurn(session, { kind: 'start' }, harness(undefined, { subscribed }).deps);
  const mara = session.world.characters.npc_mara;
  assert.ok(mara);

  // Talking to her: one quick call, and her own account of it moves the bond.
  const outcome = await runTurn(session, { kind: 'talk', characterId: mara.id, text: 'Tell me about the courier.' }, harness(undefined, { subscribed }).deps);
  assert.equal(outcome.error, null);
  assert.deepEqual(logged(session, 2), [
    { type: 'bond_changed', characterId: 'npc_mara', characterName: 'Mara Venn', from: 0, to: 2, reason: 'You asked, and listened to the answer' },
  ]);

  // She is shown her own bond, and asked for it back; neither is there in a story without the module.
  const withBonds = buildActorInit(session, mara, 'And the cellar?', 3, 12, ['dice', 'bonds']);
  // Where it stands, and no more: the reasons are written for the player, and are not hers to read.
  assert.match(withBonds.prompt, /<your_bond>\n\{"closeness":"neutral","score":2\}\n/);
  assert.ok('bond' in ((withBonds.tools[0]?.inputSchema.properties ?? {}) as object));
  const without = buildActorInit(session, mara, 'And the cellar?', 3, 12, ['dice']);
  assert.ok(!without.prompt.includes('<your_bond>'));
  assert.ok(!('bond' in ((without.tools[0]?.inputSchema.properties ?? {}) as object)));

  // What a character says of their bond is read leniently: a change far out of range is brought into it, and
  // a malformed one is ignored. Either way the line they spoke stands.
  const replies = (bond: unknown): LLMProvider =>
    spying([{ stop: 'tool_use', toolCalls: [{ id: 'a1', name: 'respond', input: { text: 'Hm.', bond } }] }]);
  const eager = await runTurn(session, { kind: 'talk', characterId: mara.id, text: 'I saved your inn.' }, harness(replies({ change: 60, reason: 'Everything' }), { subscribed }).deps);
  assert.equal(eager.error, null);
  assert.equal(session.world.modules.bonds?.bonds.npc_mara?.score, 17);
  const muddled = await runTurn(session, { kind: 'talk', characterId: mara.id, text: 'Well?' }, harness(replies('closer'), { subscribed }).deps);
  assert.equal(muddled.error, null);
  const last = session.messages.at(-1);
  assert.equal(last?.kind === 'dialogue' ? last.text : undefined, 'Hm.');
  assert.equal(session.world.modules.bonds?.bonds.npc_mara?.score, 17);

  // Unsubscribed, the story is played without it: the same talk moves nothing.
  await runTurn(session, { kind: 'talk', characterId: mara.id, text: 'And the lantern?' }, harness(undefined, { subscribed: ['dice'] }).deps);
  assert.deepEqual(logged(session, 5), []);
  assert.equal(session.world.modules.bonds?.bonds.npc_mara?.score, 17);
});

test('the demo story uses the modules it is given: a question goes to the oracle, a failure ticks the clock', async () => {
  const subscribed: ModuleId[] = ['dice', 'oracle', 'clocks', 'bonds'];
  const session = newSession({ modules: subscribed });
  // Every d20 a 1, every d100 a 100: checks fumble and the oracle says no.
  const { deps } = harness(undefined, { subscribed, random: () => 0 });
  await runTurn(session, { kind: 'start' }, deps);
  assert.equal(session.world.modules.clocks?.clocks.clock_marsh?.filled, 1);

  await runTurn(session, { kind: 'action', text: 'I force the cellar door' }, deps);
  const failed = logged(session, 2).map((event) => event.type);
  assert.ok(failed.includes('check_rolled') && failed.includes('clock_ticked') && failed.includes('bond_changed'), failed.join(','));
  assert.equal(session.world.modules.clocks?.clocks.clock_marsh?.filled, 2);
  assert.equal(session.world.modules.bonds?.bonds.npc_mara?.score, -2);

  await runTurn(session, { kind: 'action', text: 'Is anyone watching the door?' }, { ...deps, random: () => 0.999 });
  assert.equal(logged(session, 3)[0]?.type, 'fate_asked');
});

test('the demo story only comes to blows when the player plainly means it', async () => {
  const subscribed: ModuleId[] = ['dice', 'combat'];
  for (const [language, harmless, hostile] of [
    ['zh', ['向温玛打听信使的事', '我打开地窖的门', '打量那盏铜灯'], '我拔刀冲向院子里的东西'],
    ['en', ['I open the drawer behind the bar', 'I ask about the stables', 'I withdraw to the fire'], 'I attack the thing in the yard'],
  ] as const) {
    const session = newSession({ language, modules: subscribed });
    const { deps } = harness(undefined, { subscribed });
    await runTurn(session, { kind: 'start' }, deps);
    for (const text of harmless) {
      await runTurn(session, { kind: 'action', text }, deps);
      assert.equal(session.world.modules.combat, undefined, text);
    }
    await runTurn(session, { kind: 'action', text: hostile }, deps);
    assert.equal(session.world.modules.combat?.active, true, hostile);
  }
});

test('every module explains itself to the game master in both languages', () => {
  for (const locale of ['en', 'zh'] as const) {
    const system = getPrompts(locale).system({ illustrations: false, modules: MODULE_IDS });
    for (const needle of ['roll_dice', 'ask_fate', 'clocks', 'bonds', 'record.sandbox']) {
      assert.ok(system.includes(needle), `${locale}: ${needle}`);
    }
  }
});

test('the demo story keeps a calendar: time passes with every action, and what comes due unseen is settled unseen', async () => {
  const subscribed: ModuleId[] = ['dice', 'calendar'];
  const session = newSession({ modules: subscribed });
  const { deps } = harness(undefined, { subscribed });
  await runTurn(session, { kind: 'start' }, deps);

  const calendar = () => session.world.modules.calendar;
  assert.deepEqual([calendar()?.day, calendar()?.hour], [1, 18]);
  assert.deepEqual(Object.values(calendar()?.schedule ?? {}).map((entry) => [entry.id, entry.hidden, entry.status]), [
    ['sched_road_closes', false, 'pending'],
    ['sched_lantern', true, 'pending'],
  ]);
  // The player was told of the deadline they can see, and nothing of the other.
  assert.deepEqual(logged(session, 1), []);

  // Two hours an action: the third reaches midnight, when the hidden arrival is due.
  for (const turn of [2, 3, 4]) {
    await runTurn(session, { kind: 'action', text: 'I wait by the fire' }, deps);
    const passed = logged(session, turn).find((event) => event.type === 'time_passed');
    assert.equal(passed?.type === 'time_passed' && passed.reason, 'The evening wears on');
    assert.ok(!logged(session, turn).some((event) => event.type === 'schedule_due'), 'a hidden entry is never announced');
  }
  assert.deepEqual([calendar()?.day, calendar()?.hour], [2, 0]);
  assert.equal(calendar()?.schedule.sched_lantern?.status, 'done');
  assert.equal(calendar()?.schedule.sched_road_closes?.status, 'pending');
  assert.ok(session.messages.some((message) => message.kind === 'narration' && message.turn === 4 && message.text.includes('pale light')));
});

test('the demo story can come to blows: the first round is fought the turn the knife is drawn, on the player\'s own sheet', async () => {
  const subscribed: ModuleId[] = ['dice', 'combat'];
  const session = newSession({ modules: subscribed });
  // Every die comes up in the middle: d20s of 11, a d8 of 5, a d6 of 4.
  const { deps } = harness(undefined, { subscribed, random: () => 0.5 });
  await runTurn(session, { kind: 'start' }, deps);
  const health = () => session.world.characters.pc_player?.stats.find((stat) => stat.name === 'HP')?.value;
  assert.equal(health(), 20);

  await runTurn(session, { kind: 'action', text: 'I draw my knife and attack the thing in the yard' }, deps);
  assert.deepEqual(logged(session, 2).map((event) => event.type), ['combat_started', 'attack_resolved', 'attack_resolved', 'combat_round']);
  const fight = () => session.world.modules.combat;
  assert.deepEqual([fight()?.active, fight()?.round, fight()?.order], [true, 2, ['pc_player', 'foe_lantern']]);
  // The player took a 4 on the sheet itself; the foe, who has no sheet, is down to 3 of 9.
  assert.deepEqual([health(), fight()?.combatants.pc_player?.hp, fight()?.combatants.foe_lantern?.hp], [16, 16, 3]);

  // Whatever the player does next is the next round. The foe falls before it can strike back, and the fight ends there.
  await runTurn(session, { kind: 'action', text: 'Again' }, deps);
  assert.deepEqual(logged(session, 3).map((event) => event.type), ['attack_resolved', 'combat_ended']);
  assert.deepEqual([fight()?.active, fight()?.round, fight()?.combatants.foe_lantern?.down, health()], [false, 2, true, 16]);
  assert.match(fight()?.outcome ?? '', /lantern-bearer fell/);
});
