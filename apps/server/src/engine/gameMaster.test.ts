import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmptyWorld, type Session, type TurnEvent } from '@roleplay/shared';
import { AppError } from '../errors';
import { MockProvider } from '../llm/mock';
import { NO_USAGE, type Conversation, type LLMProvider, type StepResult } from '../llm/types';
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
    modules: ['dice'],
    modulesAuto: false,
    world: createEmptyWorld(),
    messages: [],
  };
}

function harness(provider: LLMProvider = new MockProvider({ delayMs: 0 })) {
  const events: TurnEvent[] = [];
  const deps = {
    provider,
    emit: (event: TurnEvent) => void events.push(event),
    signal: new AbortController().signal,
    random: () => 0.99,
  };
  return { events, deps };
}

/** A provider that replays fixed steps, for driving the loop into specific corners. */
function scripted(steps: Partial<StepResult>[]): LLMProvider & { submitted: number; notes: string[] } {
  const provider = {
    kind: 'mock' as const,
    submitted: 0,
    notes: [] as string[],
    startConversation(): Conversation {
      let index = 0;
      return {
        async step(handlers) {
          const step = steps[index++] ?? {};
          if (step.text) handlers.onTextDelta(step.text);
          return { text: '', toolCalls: [], stop: 'end', usage: { ...NO_USAGE }, ...step };
        },
        submitToolResults: () => void provider.submitted++,
        addUserMessage: (text) => void provider.notes.push(text),
      };
    },
  };
  return provider;
}

test('the opening turn builds the world through tools and narrates', async () => {
  const session = newSession();
  const { events, deps } = harness();

  const outcome = await runTurn(session, { kind: 'start' }, deps);

  assert.equal(outcome.error, null);
  assert.equal(outcome.committed, true);
  assert.equal(session.world.turn, 1);
  assert.equal(session.world.title, 'The Lantern Road');
  assert.equal(session.world.characters[session.world.playerId ?? '']?.name, 'Ash');
  assert.ok(session.world.characters.npc_mara, 'the game master added an NPC');
  assert.equal(session.world.scene.locationId, 'loc_inn');
  assert.ok(session.world.suggestions.length > 0);

  const narration = session.messages.filter((m) => m.kind === 'narration');
  assert.equal(narration.length, 1);
  // Streamed deltas add up to the final message, and share its id.
  const streamed = events
    .filter((e) => e.type === 'narration_delta')
    .map((e) => (e.type === 'narration_delta' && e.id === narration[0]?.id ? e.text : ''))
    .join('');
  assert.equal(streamed.trim(), narration[0]?.kind === 'narration' ? narration[0].text : '');
  assert.ok(events.some((e) => e.type === 'world'));
});

test('an action turn rolls dice, narrates the result and updates the world', async () => {
  const session = newSession('zh');
  const { deps } = harness();
  await runTurn(session, { kind: 'start' }, deps);

  const outcome = await runTurn(session, { kind: 'action', text: '向温玛打听信使的事' }, deps);

  assert.equal(outcome.error, null);
  assert.equal(session.world.turn, 2);
  const turn2 = session.messages.filter((m) => m.turn === 2);
  assert.equal(turn2[0]?.kind, 'player');
  assert.ok(turn2.some((m) => m.kind === 'event' && m.event.type === 'check_rolled'));
  assert.ok(turn2.some((m) => m.kind === 'event' && m.event.type === 'character_added'));
  assert.ok(turn2.some((m) => m.kind === 'narration'));
  assert.ok(session.world.characters.npc_stranger, 'a new NPC walked in');
  // random() = 0.99 rolls a 20: success pays out.
  const gold = session.world.characters.pc_player?.stats.find((s) => s.name === '铜钱');
  assert.equal(gold?.value, 15);
});

/** A `record` call; suggestions are filled in because every record needs them. */
const record = (id: string, sections: Record<string, unknown> = {}) => ({
  id,
  name: 'record',
  input: { suggestions: ['Go on'], ...sections },
});
const narrateCall = (id: string, text: string) => ({ id, name: 'narrate', input: { text } });

test('narrate and record in one response make a whole turn: no second model call', async () => {
  const provider = scripted([
    {
      stop: 'tool_use',
      toolCalls: [narrateCall('n1', 'The door creaks open.'), record('r1', { world: { title: 'Creak' } })],
    },
    { text: 'This step must never run.' },
  ]);
  const session = newSession();

  const outcome = await runTurn(session, { kind: 'start' }, harness(provider).deps);

  assert.equal(outcome.error, null);
  assert.equal(provider.submitted, 0);
  assert.equal(session.world.title, 'Creak');
  assert.equal(session.messages.filter((m) => m.kind === 'narration').length, 1);
});

test('a model that sends one call at a time gets there in two steps, in either order', async () => {
  for (const order of ['story first', 'record first'] as const) {
    const story = { stop: 'tool_use' as const, toolCalls: [narrateCall('n1', 'Rain on the roof.')] };
    const changes = { stop: 'tool_use' as const, toolCalls: [record('r1', { world: { title: 'Rain' } })] };
    const steps = order === 'story first' ? [story, changes] : [changes, story];
    const provider = scripted([...steps, { text: 'This step must never run.' }]);
    const session = newSession();

    const outcome = await runTurn(session, { kind: 'start' }, harness(provider).deps);

    assert.equal(outcome.error, null, order);
    assert.equal(provider.submitted, 1, order);
    assert.equal(session.world.title, 'Rain', order);
    assert.deepEqual(session.world.suggestions, ['Go on'], order);
    assert.equal(session.messages.filter((m) => m.kind === 'narration').length, 1, order);
  }
});

test('a rejected entry goes back to the model so it can correct itself', async () => {
  const provider = scripted([
    {
      stop: 'tool_use',
      toolCalls: [narrateCall('n1', 'A stranger arrives.'), record('r1', { characters: [{ id: 'npc_x' }] })],
    },
    { stop: 'tool_use', toolCalls: [record('r2', { characters: [{ id: 'npc_x', name: 'Xan' }] })] },
  ]);
  const session = newSession();

  await runTurn(session, { kind: 'start' }, harness(provider).deps);

  assert.equal(provider.submitted, 1);
  assert.equal(session.world.characters.npc_x?.name, 'Xan');
});

test('plain text still counts as the story for a model that never uses narrate', async () => {
  const provider = scripted([{ text: 'The door creaks open.', stop: 'tool_use', toolCalls: [record('r1')] }]);
  const session = newSession();

  const outcome = await runTurn(session, { kind: 'start' }, harness(provider).deps);

  assert.equal(outcome.error, null);
  const narration = session.messages.find((m) => m.kind === 'narration');
  assert.equal(narration?.kind === 'narration' && narration.text, 'The door creaks open.');
});

test('the story comes through the narrate tool and streams while the call is being written', async () => {
  const story = 'The door creaks.\n\n"Who\'s there?" someone calls.';
  const json = JSON.stringify({ text: story });
  const provider: LLMProvider = {
    kind: 'mock',
    startConversation: () => ({
      async step(handlers) {
        // A model thinking aloud before its tool calls: shown, then taken back.
        handlers.onTextDelta('Let me set the scene.');
        const call = { id: 'n1', name: 'narrate' };
        // Cut mid-escape on purpose: the \n\n and \" must survive being split.
        for (const cut of [json.slice(0, 24), json.slice(24, 25), json.slice(25)]) handlers.onToolInput(call, cut);
        return {
          text: 'Let me set the scene.',
          stop: 'tool_use',
          usage: { ...NO_USAGE },
          toolCalls: [{ ...call, input: { text: story } }, record('r1')],
        };
      },
      submitToolResults: () => assert.fail('the turn should end after one step'),
      addUserMessage: () => assert.fail('nothing is missing'),
    }),
  };
  const session = newSession();
  const { events, deps } = harness(provider);

  const outcome = await runTurn(session, { kind: 'start' }, deps);

  assert.equal(outcome.error, null);
  const narration = session.messages.filter((m) => m.kind === 'narration');
  assert.deepEqual(narration.map((m) => m.kind === 'narration' && m.text), [story]);

  // What the client sees: the aside appears and is discarded, then the story streams under the final message's id.
  const aside = events.find((e) => e.type === 'narration_delta');
  assert.ok(aside?.type === 'narration_delta' && aside.text === 'Let me set the scene.');
  assert.ok(events.some((e) => e.type === 'narration_discard' && e.id === aside.id));
  const streamed = events.flatMap((e) => (e.type === 'narration_delta' && e.id === narration[0]?.id ? [e.text] : []));
  assert.equal(streamed.join(''), story);
});

test('a model that records changes but tells nothing is asked once to narrate', async () => {
  const provider = scripted([
    // A dice roll keeps the loop going, and then the model just stops.
    { stop: 'tool_use', toolCalls: [{ id: 'd1', name: 'roll_dice', input: { notation: 'd6', reason: 'Luck' } }] },
    {},
    { stop: 'tool_use', toolCalls: [narrateCall('n1', 'Silence, then footsteps.'), record('r1', { world: { title: 'Quiet' } })] },
  ]);
  const session = newSession();

  const outcome = await runTurn(session, { kind: 'start' }, harness(provider).deps);

  assert.equal(outcome.error, null);
  assert.equal(provider.notes.length, 1);
  assert.equal(session.messages.filter((m) => m.kind === 'narration').length, 1);
  assert.equal(session.world.title, 'Quiet');
});

test('a model that narrates but records nothing is asked once for the record, and its reply is not narrated', async () => {
  const provider = scripted([
    { text: 'You step into the hall.' },
    {
      text: 'You step into the hall again.',
      stop: 'tool_use',
      toolCalls: [narrateCall('n1', 'You step into the hall a third time.'), record('r1')],
    },
  ]);
  const session = newSession();
  const { events, deps } = harness(provider);

  const outcome = await runTurn(session, { kind: 'start' }, deps);

  assert.equal(outcome.error, null);
  assert.equal(provider.notes.length, 1);
  assert.deepEqual(session.world.suggestions, ['Go on']);
  const narration = session.messages.filter((m) => m.kind === 'narration');
  assert.equal(narration.length, 1);
  assert.equal(events.filter((e) => e.type === 'narration_delta').length, 1);
});

test('pictures enter the log as pending, finish before the turn does, and become portraits', async () => {
  const session = newSession();
  const { events, deps } = harness();
  const prompts: string[] = [];
  const illustrate = async (request: { prompt: string }) => {
    prompts.push(request.prompt);
    return `/api/images/test-session/${prompts.length}.svg`;
  };

  await runTurn(session, { kind: 'start' }, { ...deps, illustrate });
  await runTurn(session, { kind: 'action', text: 'Look around' }, { ...deps, illustrate });

  const pictures = session.messages.filter((m) => m.kind === 'image');
  assert.deepEqual(
    pictures.map((p) => [p.subject, p.status, p.url, p.targetId]),
    [
      ['scene', 'ready', '/api/images/test-session/1.svg', null],
      ['character', 'ready', '/api/images/test-session/2.svg', 'npc_stranger'],
    ],
  );
  assert.equal(session.world.characters.npc_stranger?.imageUrl, '/api/images/test-session/2.svg');
  // The world's art style rides along with every request.
  assert.ok(session.world.artStyle);
  assert.ok(prompts.every((prompt) => prompt.endsWith(`Art style: ${session.world.artStyle}`)));

  // Each picture is announced twice under one id: the placeholder, then the result.
  const sent = events.flatMap((e) => (e.type === 'message' && e.message.kind === 'image' ? [e.message] : []));
  assert.equal(sent.length, 4);
  assert.equal(new Set(sent.map((m) => m.id)).size, 2);
  // Pictures are not part of what the model is shown as story.
  assert.ok(buildHistory(session.messages, '(start)').every((turn) => !turn.text.includes('/api/images')));
});

test('a picture that fails is marked failed and the turn still stands', async () => {
  const session = newSession();
  const { deps } = harness();
  const illustrate = async () => {
    throw new AppError('rate_limited', 'too many pictures');
  };

  const outcome = await runTurn(session, { kind: 'start' }, { ...deps, illustrate });

  assert.equal(outcome.error, null);
  assert.equal(outcome.committed, true);
  const picture = session.messages.find((m) => m.kind === 'image');
  assert.equal(picture?.kind === 'image' && picture.status, 'failed');
  assert.equal(picture?.kind === 'image' && picture.error?.code, 'rate_limited');
});

test('no more than two pictures are painted in a turn', async () => {
  const view = (name: string) => ({ subject: 'scene', prompt: `View ${name}` });
  const provider = scripted([
    {
      stop: 'tool_use',
      toolCalls: [
        narrateCall('n1', 'A grand vista.'),
        // Two calls, three pictures: the cap is per turn, not per call.
        record('r1', { pictures: [view('a'), view('b')] }),
        record('r2', { pictures: [view('c')] }),
      ],
    },
    { stop: 'end' },
  ]);
  const session = newSession();
  let painted = 0;

  await runTurn(session, { kind: 'start' }, { ...harness(provider).deps, illustrate: async () => `/img/${++painted}` });

  assert.equal(painted, 2);
  // The third request was refused, so the model heard back about it.
  assert.equal(provider.submitted, 1);
});

test('without a painter the game master is not offered pictures', async () => {
  const session = newSession();
  await runTurn(session, { kind: 'start' }, harness().deps);
  assert.equal(session.messages.filter((m) => m.kind === 'image').length, 0);
  assert.equal(session.world.artStyle, '');
});

test('a turn that fails before any narration is rolled back completely', async () => {
  const failing: LLMProvider = {
    kind: 'mock',
    startConversation: () => ({
      step: async () => {
        throw new AppError('rate_limited', 'slow down');
      },
      submitToolResults: () => {},
      addUserMessage: () => {},
    }),
  };
  const session = newSession();
  await runTurn(session, { kind: 'start' }, harness().deps);
  const before = structuredClone(session);

  const outcome = await runTurn(session, { kind: 'action', text: 'Look around' }, harness(failing).deps);

  assert.equal(outcome.error?.code, 'rate_limited');
  assert.equal(outcome.committed, false);
  assert.deepEqual(session, before);
});

test('a refusal and a truncated tool call are reported, not applied', async () => {
  const refused = await runTurn(newSession(), { kind: 'start' }, harness(scripted([{ stop: 'refusal' }])).deps);
  assert.equal(refused.error?.code, 'refused');

  const session = newSession();
  const truncated = await runTurn(
    session,
    { kind: 'start' },
    harness(
      scripted([{ stop: 'max_tokens', toolCalls: [record('t', { world: { title: 'Cut' } })] }]),
    ).deps,
  );
  assert.equal(truncated.error?.code, 'output_truncated');
  assert.equal(session.world.title, '');
});

test('turn requests are checked against the state of the story', async () => {
  const session = newSession();
  const early = await runTurn(session, { kind: 'action', text: 'Hello' }, harness().deps);
  assert.equal(early.error?.code, 'bad_request');

  await runTurn(session, { kind: 'start' }, harness().deps);
  const again = await runTurn(session, { kind: 'start' }, harness().deps);
  assert.equal(again.error?.code, 'bad_request');
});

test('history replays turns as player/narration pairs and leaves events out', async () => {
  const session = newSession();
  const { deps } = harness();
  await runTurn(session, { kind: 'start' }, deps);
  await runTurn(session, { kind: 'action', text: 'Look around' }, deps);

  const history = buildHistory(session.messages, '(The story begins.)');

  assert.deepEqual(history.map((turn) => turn.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(history[0]?.text, '(The story begins.)');
  assert.equal(history[2]?.text, 'Look around');
});

test('onBackgroundPicture lets runTurn finish immediately while painting settles asynchronously', async () => {
  const session = newSession();
  const { deps } = harness();
  let finishPaint!: (url: string) => void;
  const paintPromise = new Promise<string>((resolve) => {
    finishPaint = resolve;
  });
  const settledPictures: string[] = [];

  const outcome = await runTurn(
    session,
    { kind: 'start' },
    {
      ...deps,
      illustrate: () => paintPromise,
      onBackgroundPicture: (settled) => {
        settledPictures.push(`${settled.id}:${settled.status}:${settled.url}`);
      },
    },
  );

  // Turn finished immediately before paintPromise resolved!
  assert.equal(outcome.error, null);
  assert.equal(outcome.committed, true);
  const pendingImg = session.messages.find((m) => m.kind === 'image');
  assert.ok(pendingImg && pendingImg.kind === 'image');
  assert.equal(pendingImg.status, 'pending');
  assert.ok(pendingImg.prompt && pendingImg.prompt.length > 0, 'prompt is persisted on ImageMessage for single-image retry');
  assert.equal(settledPictures.length, 0);

  finishPaint('/api/images/test-session/async-1.png');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(settledPictures.length, 1);
  assert.ok(settledPictures[0]?.endsWith(':ready:/api/images/test-session/async-1.png'));
});

test('rolling story summary folds turns dropped outside historyTurns into world.storySummary', async () => {
  const session = newSession('zh');
  let summaryCalls = 0;
  const seenWorldStates: string[] = [];
  const seenSystems: string[] = [];

  const baseMock = new MockProvider({ delayMs: 0 });
  const trackingProvider: LLMProvider = {
    kind: 'gemini',
    startConversation(init) {
      if (init.meta.kind === 'summary') {
        summaryCalls++;
        return {
          async step(h) {
            const text = `前情提要#${summaryCalls}：旅人曾走入旧酒馆并遇见陌生人。`;
            h.onTextDelta(text);
            return { text, toolCalls: [], stop: 'end', usage: { inputTokens: 12, outputTokens: 8, cachedInputTokens: 0 } };
          },
          submitToolResults: () => {},
          addUserMessage: () => {},
        };
      }
      seenSystems.push(init.system);
      seenWorldStates.push(init.prompt);
      return baseMock.startConversation(init);
    },
  };

  const run = (req: Parameters<typeof runTurn>[1]) =>
    runTurn(session, req, { ...harness(trackingProvider).deps, tuning: { historyTurns: 2, memoriesRecalled: 8 } });

  await run({ kind: 'start' }); // Turn 1
  await run({ kind: 'action', text: '环顾四周' }); // Turn 2
  await run({ kind: 'action', text: '走近柜台' }); // Turn 3
  assert.equal(summaryCalls, 0, 'turns 1..2 still fit inside historyTurns=2 on turn 3');

  // Turn 4: completed turns are 1, 2, 3 -> window of 2 keeps turns 2 & 3, so turn 1 drops out and triggers summary!
  await run({ kind: 'action', text: '询问传闻' });
  assert.equal(summaryCalls, 1);
  assert.equal(session.world.summarizedUpToTurn, 1);
  assert.match(session.world.storySummary, /前情提要#1/);
  assert.ok(seenWorldStates.at(-1)?.includes('前情提要#1'), 'storySummary is injected into <world_state>');
  // System prompt stays byte-identical before and after storySummary is populated!
  assert.equal(seenSystems[1], seenSystems[3]);
});
