import { randomUUID } from 'node:crypto';
import {
  MODULE_IDS,
  type DialogueMessage,
  type ImageMessage,
  type Message,
  type ModuleId,
  type Session,
  type TokenUsage,
  type TurnEvent,
  type TurnRequest,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { AppError, toAppError } from '../errors';
import type { PaintRequest } from '../images/types';
import { NO_USAGE, type ConversationInit, type LLMProvider, type ToolCall, type ToolResult } from '../llm/types';
import { buildActorInit, playCharacter } from './actor';
import {
  buildRefereeInit,
  buildSummaryInit,
  buildTurnInit,
  DEFAULT_TUNING,
  findDroppedTranscript,
  type Tuning,
} from './context';
import { isPresent } from './memory';
import { getPrompts } from './prompts';
import { StreamingStringField } from './streamingField';
import { getModules, playableModules, settleModules } from './modules';
import { getToolbox, NARRATE, type PictureRequest, type ToolContext } from './tools';
import { addMemory, attachPicture, buildCharacterPortraitPrompt, WorldOpError } from './world';

/**
 * The turn loop.
 *
 * A story turn (`start`, `action`) belongs to the game master: it is shown the
 * world and what the player did, tells the story and records what changed
 * through tools, and the engine applies those calls to the world.
 *
 * A `talk` turn belongs to one character, who answers for themselves from
 * their own memory (see actor.ts). The game master is only brought in
 * afterwards, and only if the character does something that changes the world.
 */

// A story turn is narrate + record, preceded by a dice roll when one is needed:
// one model step if the calls come together, up to three if they come one at a
// time. The cap leaves room for corrections and stops a model that never finishes.
const MAX_STEPS = 10;

// Pictures are slow and billed one by one.
const MAX_PICTURES_PER_TURN = 2;
const MAX_AUTO_PORTRAITS_PER_TURN = 2;

// A memory the engine writes when a character answers but does not say what
// they will remember of it. Long exchanges are cut to this.
const FALLBACK_MEMORY_LENGTH = 600;

export interface TurnDeps {
  /** The game master: tells the story and keeps the world. */
  provider: LLMProvider;
  /** Speaks for characters in conversation. Defaults to the game master's model. */
  actorProvider?: LLMProvider;
  /** How much story and memory the models are given. */
  tuning?: Tuning;
  /**
   * The play modules the player subscribes to. A story is played with those of
   * its modules that are among them, and no others. Defaults to all of them.
   */
  subscribed?: readonly ModuleId[];
  emit(event: TurnEvent): void;
  signal: AbortSignal;
  random?: () => number;
  /**
   * Paints a picture, stores it and returns its URL. Leave out when
   * illustrations are off: the game master is then not offered the tool.
   */
  illustrate?: (request: PaintRequest) => Promise<string>;
  /**
   * When true alongside `illustrate`, newly added NPCs without a portrait have
   * one queued automatically in the background (up to 2 per turn).
   */
  autoCharacterPortraits?: boolean;
  /**
   * When provided, `runTurn` returns as soon as narration and world updates
   * finish instead of waiting on slow image APIs, invoking this callback for
   * any picture that finishes after the turn's stream has closed.
   */
  onBackgroundPicture?: (settled: ImageMessage) => Promise<void> | void;
}

export interface TurnOutcome {
  usage: TokenUsage;
  /** Why the turn stopped early, if it did. */
  error: AppError | null;
  /** False when the turn was undone and the session is exactly as it was before. */
  committed: boolean;
}

interface AppliedCalls {
  results: ToolResult[];
  events: WorldEvent[];
  /** Every call was a silent update that succeeded: the model has nothing left to read. */
  settled: boolean;
  /** At least one call changed the world, as opposed to only telling the story. */
  recorded: boolean;
  /** The model made the call that ends the turn. */
  finished: boolean;
}

/** Throws when the request does not fit where the story is. */
export function validateTurn(session: Session, request: TurnRequest): void {
  const { world } = session;
  const begun = world.turn > 0;
  if (request.kind === 'start') {
    if (begun) throw new AppError('bad_request', 'This story has already begun.');
    return;
  }
  if (!begun) throw new AppError('bad_request', 'The opening scene has not been generated yet.');
  if (!request.text.trim()) throw new AppError('bad_request', 'There is nothing to say or do.');

  if (request.kind === 'talk') {
    const character = world.characters[request.characterId];
    if (!character) throw new AppError('bad_request', 'There is no such character.');
    if (character.isPlayer) throw new AppError('bad_request', 'The player character cannot be spoken to.');
    // You can only speak to someone who is there to hear it.
    if (!isPresent(world, character)) throw new AppError('bad_request', `${character.name} is not here.`);
  }
}

/**
 * Plays one turn, mutating the session in place and reporting progress through
 * `emit`. Never throws: a failure comes back in the outcome.
 */
export async function runTurn(session: Session, request: TurnRequest, deps: TurnDeps): Promise<TurnOutcome> {
  const usage: TokenUsage = { ...NO_USAGE };
  try {
    validateTurn(session, request);
  } catch (err) {
    return { usage, error: toAppError(err), committed: false };
  }

  const prompts = getPrompts(session.language);
  const checkpoint = { world: structuredClone(session.world), messages: session.messages.length };
  const turn = session.world.turn + 1;

  // Once something has been told to the player the turn has happened, whatever follows.
  let told = false;
  // The story is coming through the narrate tool, so plain text is only commentary.
  let toldByTool = false;
  // Set once the model was asked to record changes it had only narrated. From
  // then on its tool calls count and anything it tells again is ignored.
  let recordOnly = false;

  const push = (message: Message): void => {
    session.messages.push(message);
    deps.emit({ type: 'message', message });
  };
  const stamp = () => ({ id: randomUUID(), turn, createdAt: new Date().toISOString() });

  // --- Narration, streamed while the narrate call is still being written -----
  // Keyed by tool call id: the streamed preview and the final message share an id.
  const streaming = new Map<string, { id: string; field: StreamingStringField }>();
  let currentCallId = '';

  const narrate = (text: string): void => {
    if (recordOnly) return;
    const id = streaming.get(currentCallId)?.id ?? randomUUID();
    streaming.delete(currentCallId);
    told = true;
    toldByTool = true;
    push({ ...stamp(), id, kind: 'narration', text: text.trim() });
  };

  // --- Pictures, painted in the background -----------------------------------
  const pictures: Promise<void>[] = [];
  const paintAbort = new AbortController();
  const stopPainting = () => paintAbort.abort();
  deps.signal.addEventListener('abort', stopPainting, { once: true });
  let turnReturned = false;

  const paint = async (illustrate: NonNullable<TurnDeps['illustrate']>, message: ImageMessage, prompt: string) => {
    try {
      const style = session.world.artStyle;
      message.url = await illustrate({
        prompt: style ? `${prompt}\n\nArt style: ${style}` : prompt,
        subject: message.subject,
        signal: paintAbort.signal,
      });
      message.status = 'ready';
      delete message.error;
    } catch (err) {
      // A picture that fails costs the turn nothing but the picture.
      message.status = 'failed';
      message.error = toAppError(err).toApiError();
    }

    if (turnReturned && deps.onBackgroundPicture) {
      await deps.onBackgroundPicture(structuredClone(message));
      return;
    }

    if (message.status === 'ready' && message.url && attachPicture(session.world, message.subject, message.targetId, message.url)) {
      deps.emit({ type: 'world', world: session.world });
    }
    // Same id as the placeholder, so the client swaps it in place.
    deps.emit({ type: 'message', message });
  };

  const { illustrate } = deps;
  const tuning = deps.tuning ?? DEFAULT_TUNING;
  // The modules this turn is played with: the story's own, as far as the player subscribes to them.
  const playing = playableModules(session, deps.subscribed ?? MODULE_IDS);
  // While the choice of modules is the game master's, its record says which the story keeps.
  const choosing = session.modulesAuto && request.kind !== 'talk';
  let chosen: ModuleId[] | undefined;
  const contextOptions = { illustrations: illustrate !== undefined, modules: playing, choosing, ...tuning };
  const toolbox = getToolbox(contextOptions);
  const picturedCharacterIds = new Set<string>();
  const requestPicture = illustrate
    ? (picture: PictureRequest): void => {
        if (pictures.length >= MAX_PICTURES_PER_TURN) {
          throw new WorldOpError(`Only ${MAX_PICTURES_PER_TURN} pictures can be painted per turn.`);
        }
        if (picture.subject === 'character' && picture.targetId) {
          picturedCharacterIds.add(picture.targetId);
        }
        const message: ImageMessage = {
          ...stamp(),
          kind: 'image',
          status: 'pending',
          url: null,
          caption: picture.caption,
          prompt: picture.prompt,
          subject: picture.subject,
          targetId: picture.targetId,
        };
        push(message);
        pictures.push(paint(illustrate, message, picture.prompt));
      }
    : undefined;

  const ctx: ToolContext = {
    random: deps.random ?? Math.random,
    narrate,
    requestPicture,
    ...(choosing ? { chooseModules: (ids: ModuleId[]) => void (chosen = ids) } : {}),
  };

  const applyToolCalls = (world: WorldState, calls: ToolCall[]): AppliedCalls => {
    const applied: AppliedCalls = { results: [], events: [], settled: true, recorded: false, finished: false };
    for (const call of toolbox.inExecutionOrder(calls)) {
      // A tool of a module this story does not have is as unknown as any other.
      const tool = toolbox.get(call.name);
      if (!tool) {
        applied.results.push({ id: call.id, content: `Unknown tool "${call.name}".`, isError: true });
        applied.settled = false;
        continue;
      }
      currentCallId = call.id;
      const outcome = tool.run(world, call.input, ctx);
      applied.results.push({ id: call.id, content: outcome.content, isError: outcome.isError });
      applied.events.push(...outcome.events);
      if (outcome.isError || !tool.silent) applied.settled = false;
      // A record with a rejected entry still wrote the rest, but is not the last word.
      if (tool.records) applied.recorded = true;
      if (tool.endsTurn && !outcome.isError) applied.finished = true;
    }
    return applied;
  };

  /**
   * Runs the game master until it has told the story and recorded the turn.
   * `announce` decides whether world changes are put in the log as events.
   */
  const runGameMaster = async (init: ConversationInit, announce: boolean): Promise<void> => {
    const conversation = deps.provider.startConversation(init);
    let recorded = false;
    let finished = false;
    let remindedToNarrate = false;

    for (let step = 0; step < MAX_STEPS; step++) {
      // Plain text is shown as it arrives, on the chance that it is the story
      // (a model that ignores the narrate tool). It is taken back if a narrate
      // call follows.
      const textId = randomUUID();
      let textShown = false;
      const takeBackText = () => {
        if (textShown) deps.emit({ type: 'narration_discard', id: textId });
        textShown = false;
      };
      const toldBefore = toldByTool;
      const startedHere: string[] = [];

      const result = await conversation.step({
        signal: deps.signal,
        onTextDelta: (text) => {
          if (toldByTool || recordOnly) return;
          textShown = true;
          deps.emit({ type: 'narration_delta', id: textId, text });
        },
        onToolInput: (call, fragment) => {
          if (call.name !== NARRATE || recordOnly) return;
          let entry = streaming.get(call.id);
          if (!entry) {
            entry = { id: randomUUID(), field: new StreamingStringField('text') };
            streaming.set(call.id, entry);
            startedHere.push(call.id);
            toldByTool = true;
            takeBackText();
          }
          const text = entry.field.push(fragment);
          if (text) deps.emit({ type: 'narration_delta', id: entry.id, text });
        },
        onStepReset: () => {
          takeBackText();
          for (const callId of startedHere.splice(0)) {
            const entry = streaming.get(callId);
            if (entry) deps.emit({ type: 'narration_discard', id: entry.id });
            streaming.delete(callId);
          }
          toldByTool = toldBefore;
        },
      });
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      usage.cachedInputTokens += result.usage.cachedInputTokens;

      if (result.stop === 'refusal') {
        throw new AppError('refused', 'The model declined to continue this scene.');
      }
      // Input cut off by the output limit can still parse as a valid, shorter
      // object, so never apply the tool calls of a truncated step.
      if (result.stop === 'max_tokens' && result.toolCalls.length > 0) {
        throw new AppError('output_truncated', 'The response was cut off before the world updates finished.');
      }

      // Plain text counts as the story only when the narrate tool was never used.
      const usesNarrate = toldByTool || result.toolCalls.some((call) => call.name === NARRATE);
      const text = result.text.trim();
      if (text && !usesNarrate && !recordOnly) {
        told = true;
        push({ ...stamp(), id: textId, kind: 'narration', text });
      } else {
        takeBackText();
      }

      if (result.toolCalls.length === 0) {
        // The model stopped. If something is missing, say so once and go on;
        // otherwise the world would silently fall out of step with the story.
        if (!told && !remindedToNarrate) {
          remindedToNarrate = true;
          conversation.addUserMessage(prompts.narrateReminder);
          continue;
        }
        if (told && !recorded && !recordOnly) {
          recordOnly = true;
          conversation.addUserMessage(prompts.recordReminder);
          continue;
        }
        break;
      }

      const applied = applyToolCalls(session.world, result.toolCalls);
      recorded ||= applied.recorded;
      finished ||= applied.finished;
      // A narrate call that was streamed but then failed validation told nothing.
      for (const callId of startedHere) {
        const entry = streaming.get(callId);
        if (entry) deps.emit({ type: 'narration_discard', id: entry.id });
        streaming.delete(callId);
      }
      if (announce) {
        for (const event of applied.events) push({ ...stamp(), kind: 'event', event });
      }
      deps.emit({ type: 'world', world: session.world });

      // The next turn is rebuilt from the world state, not from this exchange,
      // so once the story is told, the record is in and nothing in this step
      // needs an answer, there is no reason to pay for another model call just
      // to hear "done". This holds whether the model sent narrate and record
      // together or one after the other, in either order.
      if (told && finished && applied.settled) break;
      conversation.submitToolResults(applied.results);
    }
  };

  /** One character answers the player; the game master follows only if the character acts. */
  const runConversation = async (request: Extract<TurnRequest, { kind: 'talk' }>): Promise<void> => {
    const { world } = session;
    const character = world.characters[request.characterId];
    if (!character) throw new AppError('bad_request', 'There is no such character.');
    const said = request.text.trim();

    const init = buildActorInit(session, character, said, turn, tuning.memoriesRecalled, playing);
    world.turn = turn;
    push({ ...stamp(), kind: 'player', text: said, to: character.id });

    // Announce who is about to speak; the words follow as they are written.
    const line: DialogueMessage = {
      ...stamp(),
      kind: 'dialogue',
      characterId: character.id,
      characterName: character.name,
      text: '',
    };
    deps.emit({ type: 'message', message: line });
    const reply = await playCharacter(
      deps.actorProvider ?? deps.provider,
      init,
      {
        signal: deps.signal,
        onDelta: (text) => deps.emit({ type: 'narration_delta', id: line.id, text }),
        // Sending the still-empty line again clears what had streamed.
        onReset: () => deps.emit({ type: 'message', message: line }),
      },
      usage,
      playing,
    );
    line.text = reply.text.trim();
    push(line);
    told = true;

    // The exchange becomes part of what the character knows, in their own account
    // of it; without one, the words themselves are kept.
    const player = world.playerId ? world.characters[world.playerId] : undefined;
    const fallback = `${player?.name ?? '?'}: ${said}\n${character.name}: ${line.text}`.slice(0, FALLBACK_MEMORY_LENGTH);
    addMemory(world, {
      characterId: character.id,
      text: reply.memory?.trim() || fallback,
      about: player ? [player.id] : [],
      importance: reply.importance,
    });
    if (reply.attitude?.trim()) character.attitude = reply.attitude.trim();
    // What the character's own account moves in the story's modules: how close they now feel.
    for (const module of getModules(playing)) {
      for (const event of module.actor?.apply(world, character, reply) ?? []) push({ ...stamp(), kind: 'event', event });
    }
    deps.emit({ type: 'world', world });

    // Plain talk changes nothing but minds, and costs one quick call. When the
    // character says the exchange changed something (they acted, promised, or
    // told the player something that matters), the game master rules on it and
    // records it, so the world panels keep up with the conversation. The actor
    // knows what its character did, not what the world makes of it.
    const changes = reply.changes?.trim();
    if (!changes) return;
    await archiveDroppedTurns();
    const exchange = { name: character.name, said, reply: line.text, changes };
    await runGameMaster(buildRefereeInit(session, character.id, exchange, turn, contextOptions), true);
  };

  /**
   * Folds turns that have slid out of `buildHistory` into `world.storySummary`
   * so long campaigns never lose early plot causality. Never throws: if the
   * model summary call fails, a compact deterministic digest is kept instead.
   */
  const archiveDroppedTurns = async (): Promise<void> => {
    const nameOf = (id: string) => session.world.characters[id]?.name ?? id;
    const dropped = findDroppedTranscript(
      session.messages,
      prompts.openingMarker,
      nameOf,
      tuning.historyTurns,
      session.world.summarizedUpToTurn ?? 0,
    );
    if (!dropped) return;

    const appendDigest = () => {
      const combined = session.world.storySummary
        ? `${session.world.storySummary}\n${dropped.fallbackDigest}`
        : dropped.fallbackDigest;
      return combined.length > 2400 ? combined.slice(combined.length - 2400) : combined;
    };

    if (deps.provider.kind === 'mock') {
      session.world.storySummary = appendDigest();
      session.world.summarizedUpToTurn = dropped.upToTurn;
      return;
    }

    try {
      const summaryConv = deps.provider.startConversation(buildSummaryInit(session, dropped.transcript));
      const result = await summaryConv.step({
        signal: deps.signal,
        onTextDelta: () => {},
        onToolInput: () => {},
        onStepReset: () => {},
      });
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      usage.cachedInputTokens += result.usage.cachedInputTokens;
      const condensed = result.text.trim();
      session.world.storySummary = condensed || appendDigest();
    } catch {
      session.world.storySummary = appendDigest();
    }
    session.world.summarizedUpToTurn = dropped.upToTurn;
  };

  try {
    if (request.kind === 'talk') {
      await runConversation(request);
    } else {
      session.world.suggestions = [];
      await archiveDroppedTurns();
      const init = buildTurnInit(session, request, turn, contextOptions);
      session.world.turn = turn;
      if (request.kind === 'action') push({ ...stamp(), kind: 'player', text: request.text.trim() });
      // The opening turn is all set-up: the panels filling in say it better than
      // a dozen "added" notices under the first paragraph.
      await runGameMaster(init, request.kind === 'action');
    }

    if (!told) throw new AppError('empty_response', 'The model told no story this turn.');
    // The game master has had a whole turn with every subscribed module on offer: keep the ones it asked for.
    if (choosing) settleModules(session, playing, chosen);
    if (illustrate && deps.autoCharacterPortraits) {
      const newcomers = Object.values(session.world.characters)
        .filter(
          (c) =>
            !c.isPlayer &&
            !checkpoint.world.characters[c.id] &&
            !c.imageUrl &&
            !picturedCharacterIds.has(c.id),
        )
        .sort((a, b) => Number(isPresent(session.world, b)) - Number(isPresent(session.world, a)))
        .slice(0, MAX_AUTO_PORTRAITS_PER_TURN);
      for (const npc of newcomers) {
        const prompt = buildCharacterPortraitPrompt(npc, session.world);
        const caption = npc.role ? `${npc.name} — ${npc.role}` : npc.name;
        const message: ImageMessage = {
          ...stamp(),
          kind: 'image',
          status: 'pending',
          url: null,
          caption,
          prompt,
          subject: 'character',
          targetId: npc.id,
        };
        push(message);
        pictures.push(paint(illustrate, message, prompt));
      }
    }
    if (deps.onBackgroundPicture) {
      turnReturned = true;
    } else {
      await Promise.all(pictures);
    }
    return { usage, error: null, committed: true };
  } catch (err) {
    const error = toAppError(err);
    if (error.code === 'internal') console.error('Turn failed:', err);
    if (told) {
      // The turn stands as far as it got; so does a choice of modules made in it.
      if (choosing && chosen !== undefined) settleModules(session, playing, chosen);
      if (deps.onBackgroundPicture) {
        turnReturned = true;
      } else {
        await Promise.all(pictures);
      }
      return { usage, error, committed: true };
    }

    // Nothing reached the player: undo the turn so it can simply be tried again.
    stopPainting();
    await Promise.all(pictures);
    session.world = checkpoint.world;
    session.messages.length = checkpoint.messages;
    return { usage, error, committed: false };
  } finally {
    deps.signal.removeEventListener('abort', stopPainting);
  }
}
