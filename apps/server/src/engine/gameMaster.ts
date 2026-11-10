import { randomUUID } from 'node:crypto';
import type {
  ImageMessage,
  Message,
  Session,
  TokenUsage,
  TurnEvent,
  TurnRequest,
  WorldEvent,
  WorldState,
} from '@roleplay/shared';
import { AppError, toAppError } from '../errors';
import type { PaintRequest } from '../images/types';
import { NO_USAGE, type LLMProvider, type ToolCall, type ToolResult } from '../llm/types';
import { buildTurnInit } from './context';
import { getPrompts } from './prompts';
import { StreamingStringField } from './streamingField';
import { getTool, inExecutionOrder, NARRATE, type PictureRequest, type ToolContext } from './tools';
import { attachPicture, WorldOpError } from './world';

/**
 * The turn loop. One turn is: show the game master the world and the player's
 * action, let it tell the story and record what changed through tools, apply
 * those calls to the world, and repeat until it has nothing more to do.
 */

// A turn is narrate + record, preceded by a dice roll when one is needed: one
// model step if the calls come together, up to three if they come one at a
// time. The cap leaves room for corrections and stops a model that never finishes.
const MAX_STEPS = 10;

// Pictures are slow and billed one by one.
const MAX_PICTURES_PER_TURN = 2;

export interface TurnDeps {
  provider: LLMProvider;
  emit(event: TurnEvent): void;
  signal: AbortSignal;
  random?: () => number;
  /**
   * Paints a picture, stores it and returns its URL. Leave out when
   * illustrations are off: the game master is then not offered the tool.
   */
  illustrate?: (request: PaintRequest) => Promise<string>;
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
  const begun = session.world.turn > 0;
  if (request.kind === 'start' && begun) {
    throw new AppError('bad_request', 'This story has already begun.');
  }
  if (request.kind === 'action' && !begun) {
    throw new AppError('bad_request', 'The opening scene has not been generated yet.');
  }
  if (request.kind === 'action' && !request.text.trim()) {
    throw new AppError('bad_request', 'The action is empty.');
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

  // Once narration has reached the player the turn has happened, whatever follows.
  let narrated = false;
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
    narrated = true;
    toldByTool = true;
    push({ ...stamp(), id, kind: 'narration', text: text.trim() });
  };

  // --- Pictures, painted in the background and gathered before the turn ends -
  const pictures: Promise<void>[] = [];
  const paintAbort = new AbortController();
  const stopPainting = () => paintAbort.abort();
  deps.signal.addEventListener('abort', stopPainting, { once: true });

  const paint = async (illustrate: NonNullable<TurnDeps['illustrate']>, message: ImageMessage, prompt: string) => {
    try {
      const style = session.world.artStyle;
      message.url = await illustrate({
        prompt: style ? `${prompt}\n\nArt style: ${style}` : prompt,
        subject: message.subject,
        signal: paintAbort.signal,
      });
      message.status = 'ready';
      if (attachPicture(session.world, message.subject, message.targetId, message.url)) {
        deps.emit({ type: 'world', world: session.world });
      }
    } catch (err) {
      // A picture that fails costs the turn nothing but the picture.
      message.status = 'failed';
      message.error = toAppError(err).toApiError();
    }
    // Same id as the placeholder, so the client swaps it in place.
    deps.emit({ type: 'message', message });
  };

  const { illustrate } = deps;
  const requestPicture = illustrate
    ? (picture: PictureRequest): void => {
        if (pictures.length >= MAX_PICTURES_PER_TURN) {
          throw new WorldOpError(`Only ${MAX_PICTURES_PER_TURN} pictures can be painted per turn.`);
        }
        const message: ImageMessage = {
          ...stamp(),
          kind: 'image',
          status: 'pending',
          url: null,
          caption: picture.caption,
          subject: picture.subject,
          targetId: picture.targetId,
        };
        push(message);
        pictures.push(paint(illustrate, message, picture.prompt));
      }
    : undefined;

  const ctx: ToolContext = { random: deps.random ?? Math.random, narrate, requestPicture };

  const applyToolCalls = (world: WorldState, calls: ToolCall[]): AppliedCalls => {
    const applied: AppliedCalls = { results: [], events: [], settled: true, recorded: false, finished: false };
    for (const call of inExecutionOrder(calls)) {
      const tool = getTool(call.name);
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

  try {
    session.world.suggestions = [];
    const init = buildTurnInit(session, request, turn, { illustrations: illustrate !== undefined });
    session.world.turn = turn;
    if (request.kind === 'action') push({ ...stamp(), kind: 'player', text: request.text.trim() });

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
        narrated = true;
        push({ ...stamp(), id: textId, kind: 'narration', text });
      } else {
        takeBackText();
      }

      if (result.toolCalls.length === 0) {
        // The model stopped. If something is missing, say so once and go on;
        // otherwise the world would silently fall out of step with the story.
        if (!narrated && !remindedToNarrate) {
          remindedToNarrate = true;
          conversation.addUserMessage(prompts.narrateReminder);
          continue;
        }
        if (narrated && !recorded && !recordOnly) {
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
      // The opening turn is all set-up: the panels filling in say it better than
      // a dozen "added" notices under the first paragraph.
      if (request.kind === 'action') {
        for (const event of applied.events) push({ ...stamp(), kind: 'event', event });
      }
      deps.emit({ type: 'world', world: session.world });

      // The next turn is rebuilt from the world state, not from this exchange,
      // so once the story is told, the record is in and nothing in this step
      // needs an answer, there is no reason to pay for another model call just
      // to hear "done". This holds whether the model sent narrate and record
      // together or one after the other, in either order.
      if (narrated && finished && applied.settled) break;
      conversation.submitToolResults(applied.results);
    }

    if (!narrated) throw new AppError('empty_response', 'The model told no story this turn.');
    await Promise.all(pictures);
    return { usage, error: null, committed: true };
  } catch (err) {
    const error = toAppError(err);
    if (error.code === 'internal') console.error('Turn failed:', err);
    if (narrated) {
      await Promise.all(pictures);
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
