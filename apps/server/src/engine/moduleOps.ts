import type { ModuleDirective, WorldEvent, WorldState } from '@roleplay/shared';
import { AppError } from '../errors';
import { lookupModule, type ModuleOperationOutcome } from './modules';
import type { GameTool } from './toolKit';
import { WorldOpError } from './world';

export interface ExecutedDirectiveReport {
  directive: ModuleDirective;
  events: WorldEvent[];
  summary: string;
}

/**
 * Runs one of a module's server tools (`trade`, `hold_court`, `develop_domain`,
 * `nurture_heir`, `run_operation`, `breakthrough`, `simulate`, `draw`, `pass_time`, etc.)
 * as a direct player operation, converting tool errors into `WorldOpError`.
 */
export function runToolAsOperation(
  tool: GameTool,
  world: WorldState,
  params: Record<string, unknown>,
  random: () => number,
  fallbackSummary?: string,
): ModuleOperationOutcome {
  const outcome = tool.run(world, params, { random, narrate: () => {} });
  if (outcome.isError) {
    throw new WorldOpError(outcome.content);
  }
  let detail = fallbackSummary ?? '';
  if (!detail) {
    detail = outcome.content;
  } else {
    try {
      const parsed = JSON.parse(outcome.content) as Record<string, unknown>;
      const outcomeTag =
        typeof parsed.outcome === 'string'
          ? parsed.outcome
          : typeof parsed.winner === 'string'
            ? `${parsed.winner} (${parsed.margin ?? ''})`
            : '';
      if (outcomeTag) detail = `${detail} [${outcomeTag}]`;
    } catch {
      // Keep fallback summary as-is.
    }
  }
  return { events: outcome.events, summary: detail };
}

/**
 * Executes a single structured `ModuleDirective` against `world` at zero LLM
 * token cost. Used both by `POST /api/sessions/:id/actions` (instant mode) and
 * at the start of an `action` turn when `request.directives` are batched.
 */
export function executeDirective(
  world: WorldState,
  directive: ModuleDirective,
  random: () => number = Math.random,
): ExecutedDirectiveReport {
  if (directive.op === 'advisor_note') {
    const summary = directive.aiNote?.trim() || directive.label.trim();
    if (!summary) {
      throw new AppError('bad_request', 'Advisor directive has no content.');
    }
    return { directive, events: [], summary };
  }

  const module = lookupModule(directive.moduleId);
  if (!module) {
    throw new AppError('bad_request', `Unknown module "${directive.moduleId}".`);
  }

  try {
    const matchingTool = module.tools.find((entry) => entry.tool.name === directive.op)?.tool;
    let result: ModuleOperationOutcome | undefined;

    if (matchingTool) {
      result = runToolAsOperation(matchingTool, world, directive.params, random, directive.label);
    } else if (module.operate) {
      result = module.operate(world, directive.op, directive.params, { random });
    }

    if (!result) {
      throw new AppError(
        'bad_request',
        `Module "${directive.moduleId}" does not support operation "${directive.op}".`,
      );
    }

    module.afterRecord?.(world);
    const summary = result.summary.trim() || directive.label.trim();
    return { directive, events: result.events, summary };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof WorldOpError) throw new AppError('bad_request', err.message);
    throw err;
  }
}

export function executeDirectivesBatch(
  world: WorldState,
  directives: readonly ModuleDirective[],
  random: () => number = Math.random,
): { events: WorldEvent[]; reports: ExecutedDirectiveReport[] } {
  const events: WorldEvent[] = [];
  const reports: ExecutedDirectiveReport[] = [];
  for (const directive of directives) {
    const report = executeDirective(world, directive, random);
    events.push(...report.events);
    reports.push(report);
  }
  return { events, reports };
}
