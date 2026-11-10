import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmptyWorld, type Session, type TurnEvent } from '@roleplay/shared';
import { AppError } from '../errors';
import { MockProvider } from '../llm/mock';
import { NO_USAGE, type Conversation, type LLMProvider, type StepResult, type ToolResult } from '../llm/types';
import { buildActorInit, characterView, playCharacter } from './actor';
import { buildHistory } from './context';
import { runTurn } from './gameMaster';

function newSession(language: Session['language'] = 'en'): Session {
  const now = new Date().toISOString();
  return {
    id: 'test-session',
    createdAt: now,
    updatedAt: now,
    language,
    seed: { premise: '', playerName: 'Ash', playerConcept: '' },
    world: createEmptyWorld(),
    messages: [],
  };
}

function harness(provider: LLMProvider = new MockProvider({ delayMs: 0 })) {
  const events: TurnEvent[] = [];
  const deps = {
    provider,
    // Copied, as the server serializes each event the moment it is emitted.
    emit: (event: TurnEvent) => void events.push(structuredClone(event)),
    signal: new AbortController().signal,
    // 0.99 rolls a 20: the scripted action succeeds.
    random: () => 0.99,
  };
  return { events, deps };
}

/** A game that has opened and had one action, so the stranger has walked in. */
async function gameInProgress(language: Session['language'] = 'en') {
  const session = newSession(language);
  const { deps } = harness();
  await runTurn(session, { kind: 'start' }, deps);
  await runTurn(session, { kind: 'action', text: 'Look around' }, deps);
  return session;
}

// --- what a character is shown ---------------------------------------------------

test('a character is shown their own mind and what they can perceive, and nothing else', async () => {
  const session = await gameInProgress();
  const { world } = session;
  const mara = world.characters.npc_mara;
  assert.ok(mara);

  const init = buildActorInit(session, mara, 'What happened to the courier?', 3);
  // The prompt carries values as JSON, so look for them the way they are written there.
  const shows = (prompt: string, value: string) => prompt.includes(JSON.stringify(value).slice(1, -1));
  const shown = (value: string) => shows(init.prompt, value);

  // Her own secret, voice and memories are hers to use.
  assert.ok(shown(mara.secrets));
  assert.ok(shown(mara.voice));
  assert.ok(shown('the first since the courier'), 'her memory of the traveller arriving');
  // She can see who else is in the room, but not into their head.
  const stranger = world.characters.npc_stranger;
  assert.ok(stranger);
  assert.ok(shown(stranger.name));
  assert.ok(!shown(stranger.secrets), "another character's secret");
  assert.ok(!shown(stranger.goals), "another character's goals");
  assert.ok(!shown(stranger.memories[0]?.text ?? '∅'), "another character's memory");
  // Common knowledge is shared; the game master's hidden notes are not.
  assert.ok(shown('The Marsh Lights'));
  assert.ok(!shown('What Mara knows'), 'hidden lore title');
  assert.ok(!shown('something the marsh wants back'), 'hidden lore content');
  // Nor is the player's side of the game.
  assert.ok(!shown('The Missing Courier'), 'the player quest log');

  // The stranger, in turn, knows nothing of Mara's secret.
  const strangerInit = buildActorInit(session, stranger, 'Who are you?', 3);
  assert.ok(shows(strangerInit.prompt, stranger.secrets));
  assert.ok(!shows(strangerInit.prompt, mara.secrets));
  assert.equal(strangerInit.tools.map((tool) => tool.name).join(), 'respond');
  assert.equal(strangerInit.pace, 'quick');
});

test('a character knows the name of someone they remember, not of a stranger', async () => {
  const session = await gameInProgress();
  const { world } = session;
  const mara = world.characters.npc_mara;
  assert.ok(mara);

  assert.equal(characterView(world, mara, 'Hello').speaking_to_you.name, 'Ash');

  mara.memories = [];
  const view = characterView(world, mara, 'Hello');
  assert.equal(view.speaking_to_you.name, null);
  assert.equal(view.speaking_to_you.met_before, false);
});

test('what was said brings back memories about it, however old', async () => {
  const session = await gameInProgress();
  const { world } = session;
  const mara = world.characters.npc_mara;
  assert.ok(mara);
  mara.memories.unshift({
    id: 'm0_0',
    turn: 0,
    time: 'Last winter',
    locationId: 'loc_inn',
    text: 'I locked the cellar the night the lights came close.',
    about: ['loc_cellar'],
    importance: 1,
  });
  for (let i = 0; i < 20; i++) {
    mara.memories.push({ id: `m9_${i}`, turn: 2, time: 'Dusk', locationId: 'loc_inn', text: `A quiet hour ${i}.`, about: [], importance: 3 });
  }

  const recalled = (said: string) => characterView(world, mara, said).your_memories.map((m) => m.memory);
  assert.ok(!recalled('Nice weather.').some((m) => m.includes('locked the cellar')));
  assert.ok(recalled('What is down in the cellar?').some((m) => m.includes('locked the cellar')));
});

// --- a character answering ------------------------------------------------------------

test('talking to a character gets their own answer, which they then remember', async () => {
  const session = await gameInProgress();
  const { events, deps } = harness();
  const before = session.world.characters.npc_mara?.memories.length ?? 0;

  const outcome = await runTurn(session, { kind: 'talk', characterId: 'npc_mara', text: '  Who was the courier?  ' }, deps);

  assert.equal(outcome.error, null);
  assert.equal(session.world.turn, 3);
  const turn = session.messages.filter((m) => m.turn === 3);
  assert.deepEqual(turn.map((m) => m.kind), ['player', 'dialogue']);
  assert.ok(turn[0]?.kind === 'player' && turn[0].to === 'npc_mara' && turn[0].text === 'Who was the courier?');
  const line = turn[1];
  assert.ok(line?.kind === 'dialogue' && line.characterId === 'npc_mara' && line.characterName === 'Mara Venn');
  assert.ok(line.text.length > 0);

  // She remembers the exchange in her own words, and it changed how she sees the player.
  const mara = session.world.characters.npc_mara;
  assert.equal(mara?.memories.length, before + 1);
  assert.ok(mara?.memories.at(-1)?.text.includes('Who was the courier?'));
  assert.deepEqual(mara?.memories.at(-1)?.about, ['pc_player']);
  assert.notEqual(mara?.attitude, 'Wary');
  // Nobody else was told anything.
  assert.equal(session.world.characters.npc_stranger?.memories.length, 1);

  // On the wire: who is about to speak, then their words, then the finished line under the same id.
  const sent = events.filter((e) => e.type === 'message' && e.message.kind === 'dialogue');
  assert.equal(sent.length, 2);
  assert.ok(sent[0]?.type === 'message' && sent[0].message.kind === 'dialogue' && sent[0].message.text === '');
  const streamed = events.flatMap((e) => (e.type === 'narration_delta' && e.id === line.id ? [e.text] : []));
  assert.equal(streamed.join(''), line.text);
  // Just talking does not bring the game master in.
  assert.ok(!session.messages.some((m) => m.turn === 3 && m.kind === 'narration'));
});

test('a character with more history answers differently: memory carries across turns', async () => {
  const session = await gameInProgress('zh');
  const { deps } = harness();
  const ask = () => runTurn(session, { kind: 'talk', characterId: 'npc_stranger', text: '你是谁？' }, deps);

  await ask();
  await ask();

  const lines = session.messages.flatMap((m) => (m.kind === 'dialogue' ? [m.text] : []));
  assert.equal(lines.length, 2);
  assert.notEqual(lines[0], lines[1]);
  // The second answer is given with the first exchange in front of the actor, word for word.
  const init = buildActorInit(session, session.world.characters.npc_stranger!, '然后呢？', 5);
  assert.deepEqual(init.history.map((turn) => turn.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(init.history[1]?.text, lines[0]);
});

test('when a character acts, the game master rules on it and records the result', async () => {
  const session = await gameInProgress();
  const { deps } = harness();

  const outcome = await runTurn(session, { kind: 'talk', characterId: 'npc_mara', text: 'Show me the cellar.' }, deps);

  assert.equal(outcome.error, null);
  const turn = session.messages.filter((m) => m.turn === 3);
  assert.deepEqual(
    turn.map((m) => (m.kind === 'event' ? m.event.type : m.kind)),
    ['player', 'dialogue', 'narration', 'item_gained', 'quest_updated'],
  );
  assert.equal(session.world.items.item_cellar_key?.ownerId, 'pc_player');
  assert.ok(session.world.characters.npc_mara?.memories.at(-1)?.text.includes('gave them the key'));
});

test('you can only speak to someone who is there to hear it', async () => {
  const session = await gameInProgress();
  const { deps } = harness();
  const talk = (characterId: string) => runTurn(session, { kind: 'talk', characterId, text: 'Hello?' }, deps);

  session.world.characters.npc_stranger!.locationId = 'loc_marsh_road';
  assert.equal((await talk('npc_stranger')).error?.code, 'bad_request');
  assert.equal((await talk('pc_player')).error?.code, 'bad_request');
  assert.equal((await talk('npc_nobody')).error?.code, 'bad_request');
  assert.equal(session.world.turn, 2, 'nothing was played');
});

test('a reply that never arrives leaves no trace', async () => {
  const session = await gameInProgress();
  const before = structuredClone(session);
  const silent: LLMProvider = {
    kind: 'mock',
    startConversation: () => ({
      step: async () => {
        throw new AppError('rate_limited', 'slow down');
      },
      submitToolResults: () => {},
      addUserMessage: () => {},
    }),
  };

  const outcome = await runTurn(session, { kind: 'talk', characterId: 'npc_mara', text: 'Hello?' }, harness(silent).deps);

  assert.equal(outcome.error?.code, 'rate_limited');
  assert.equal(outcome.committed, false);
  assert.deepEqual(session, before);
});

test('the game master later reads conversations as part of the story', async () => {
  const session = await gameInProgress();
  await runTurn(session, { kind: 'talk', characterId: 'npc_mara', text: 'Who was the courier?' }, harness().deps);

  const history = buildHistory(session.messages, '(start)', (id) => session.world.characters[id]?.name ?? id);
  const said = history.at(-2);
  const answered = history.at(-1);

  assert.equal(said?.text, '→ Mara Venn: Who was the courier?');
  assert.ok(answered?.text.startsWith('Mara Venn: '));
});

// --- the actor loop against awkward models ----------------------------------------------

function scripted(steps: Partial<StepResult>[]) {
  const seen = { results: [] as ToolResult[][], notes: [] as string[] };
  const provider: LLMProvider = {
    kind: 'mock',
    startConversation(): Conversation {
      let index = 0;
      return {
        async step() {
          return { text: '', toolCalls: [], stop: 'end', usage: { ...NO_USAGE }, ...steps[index++] };
        },
        submitToolResults: (results) => void seen.results.push(results),
        addUserMessage: (text) => void seen.notes.push(text),
      };
    },
  };
  return { provider, seen };
}

async function play(steps: Partial<StepResult>[]) {
  const session = await gameInProgress();
  const init = buildActorInit(session, session.world.characters.npc_mara!, 'Hello', 3);
  const { provider, seen } = scripted(steps);
  const deltas: string[] = [];
  let resets = 0;
  const reply = await playCharacter(
    provider,
    init,
    { signal: new AbortController().signal, onDelta: (text) => void deltas.push(text), onReset: () => void resets++ },
    { ...NO_USAGE },
  ).catch((err: unknown) => err);
  return { reply, deltas, resets, seen };
}

test('a model that just talks has still answered', async () => {
  const { reply, deltas } = await play([{ text: '"Evening." *She nods.*' }]);
  assert.deepEqual(reply, { text: '"Evening." *She nods.*' });
  assert.deepEqual(deltas, ['"Evening." *She nods.*']);
});

test('a malformed answer is sent back once with what was wrong', async () => {
  const { reply, seen } = await play([
    { stop: 'tool_use', toolCalls: [{ id: 'a', name: 'respond', input: { memory: 'No text.' } }] },
    { stop: 'tool_use', toolCalls: [{ id: 'b', name: 'respond', input: { text: '"Evening."', intent: 'Leaves.' } }] },
  ]);
  assert.deepEqual(reply, { text: '"Evening."', intent: 'Leaves.' });
  assert.equal(seen.results.length, 1);
  assert.match(seen.results[0]?.[0]?.content ?? '', /invalid_input/);
});

test('a model that says nothing is reminded, and silence in the end is an error', async () => {
  const reminded = await play([{}, { stop: 'tool_use', toolCalls: [{ id: 'a', name: 'respond', input: { text: '"Yes?"' } }] }]);
  assert.deepEqual(reminded.reply, { text: '"Yes?"' });
  assert.equal(reminded.seen.notes.length, 1);

  const silent = await play([{}, {}, {}]);
  assert.ok(silent.reply instanceof AppError && silent.reply.code === 'empty_response');

  const refused = await play([{ stop: 'refusal' }]);
  assert.ok(refused.reply instanceof AppError && refused.reply.code === 'refused');
});
