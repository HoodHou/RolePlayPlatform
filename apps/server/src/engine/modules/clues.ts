import {
  CLUE_KINDS,
  DEDUCTION_STATUSES,
  type Clue,
  type CluesState,
  type Deduction,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { z } from 'zod';
import { asParts, entryReader, id, type EntryError } from '../toolKit';
import { WorldOpError } from '../world';
import type { GameModule } from './types';

/**
 * Clues & Deductions: an investigation board for mysteries, detective stories,
 * conspiracies, and court cases. Clues (`evidence`, `testimony`, `observation`,
 * `document`) link to one another on the board, and deductions weigh hypotheses
 * (`open`, `confirmed`, `disproven`) against the clues gathered so far.
 * Bookkeeping only: no extra round trip.
 */

function ensureClues(world: WorldState): CluesState {
  return (world.modules.clues ??= {
    clues: {},
    deductions: {},
  });
}

const unique = (ids: string[]) => [...new Set(ids.map((item) => item.trim()).filter(Boolean))];

const clueEntry = z.strictObject({
  id,
  title: z.string().optional().describe('Short name of the clue as shown on the board. Required when creating.'),
  description: z.string().optional().describe('What was found, observed, or testified, and why it matters.'),
  kind: z.enum(CLUE_KINDS).optional().describe('Kind of clue: evidence, testimony, observation, or document. Defaults to evidence.'),
  source: z.string().optional().describe('Where or from whom it was found, e.g. "Cellar floorboards" or "Mara Venn".'),
  links: z.array(id).max(12).optional().describe('Ids of other clues connected to this one on the board (links run both ways).'),
  hidden: z.boolean().optional().describe('True keeps this clue on your own sheet until the player discovers it; set false to reveal it.'),
  remove: z.boolean().optional().describe('True to take this clue off the board.'),
});

const deductionEntry = z.strictObject({
  id,
  title: z.string().optional().describe('The hypothesis or question being weighed. Required when creating.'),
  conclusion: z.string().optional().describe('What the clues point to, or why the hypothesis stands or falls.'),
  clue_ids: z.array(id).max(12).optional().describe('Ids of clues that support or bear on this deduction.'),
  status: z.enum(DEDUCTION_STATUSES).optional().describe('open while being weighed, confirmed when proven true, disproven when ruled out.'),
  remove: z.boolean().optional().describe('True to remove this deduction from the board.'),
});

const cluesSection = z
  .strictObject({
    clues: z.array(clueEntry).max(20).optional().describe('Clues discovered, updated, linked, or revealed this turn.'),
    deductions: z.array(deductionEntry).max(12).optional().describe('Hypotheses and deductions opened, confirmed, or disproven.'),
  })
  .describe('Investigation board: clues, connections between them, and deductions drawn from the evidence.');

function upsertClue(world: WorldState, entry: z.infer<typeof clueEntry>): WorldEvent[] {
  const state = ensureClues(world);
  const existing = state.clues[entry.id];

  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is no clue with id "${entry.id}".`);
    delete state.clues[entry.id];
    for (const other of Object.values(state.clues)) {
      other.links = other.links.filter((linkId) => linkId !== entry.id);
    }
    for (const deduction of Object.values(state.deductions)) {
      deduction.clueIds = deduction.clueIds.filter((clueId) => clueId !== entry.id);
    }
    return [];
  }

  const title = entry.title?.trim();
  if (!existing && !title) {
    throw new WorldOpError(`Clue "${entry.id}" does not exist yet. Include "title" to record it.`);
  }

  const clue: Clue = existing ?? {
    id: entry.id,
    title: title ?? '',
    description: '',
    kind: entry.kind ?? 'evidence',
    source: '',
    links: [],
    hidden: false,
  };
  const wasHidden = clue.hidden;

  if (existing && title) clue.title = title;
  if (entry.description !== undefined) clue.description = entry.description;
  if (entry.kind !== undefined) clue.kind = entry.kind;
  if (entry.source !== undefined) clue.source = entry.source.trim();
  if (entry.hidden !== undefined) clue.hidden = entry.hidden;

  if (entry.links !== undefined) {
    clue.links = unique([...clue.links, ...entry.links]).filter((otherId) => otherId !== clue.id);
    for (const otherId of clue.links) {
      const other = state.clues[otherId];
      if (other && !other.links.includes(clue.id)) {
        other.links.push(clue.id);
      }
    }
  }

  state.clues[clue.id] = clue;
  // Also connect any clue created earlier in the same batch that already pointed to this id.
  for (const other of Object.values(state.clues)) {
    if (other.id !== clue.id && other.links.includes(clue.id) && !clue.links.includes(other.id)) {
      clue.links.push(other.id);
    }
  }

  if (clue.hidden) return [];
  if (!existing || wasHidden) {
    return [{ type: 'clue_found', id: clue.id, title: clue.title, kind: clue.kind, source: clue.source }];
  }
  return [];
}

function upsertDeduction(world: WorldState, entry: z.infer<typeof deductionEntry>): WorldEvent[] {
  const state = ensureClues(world);
  const existing = state.deductions[entry.id];

  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is no deduction with id "${entry.id}".`);
    delete state.deductions[entry.id];
    return [];
  }

  const title = entry.title?.trim();
  if (!existing && !title) {
    throw new WorldOpError(`Deduction "${entry.id}" does not exist yet. Include "title" to open it.`);
  }

  const deduction: Deduction = existing ?? {
    id: entry.id,
    title: title ?? '',
    conclusion: '',
    clueIds: [],
    status: entry.status ?? 'open',
  };
  const statusBefore = deduction.status;

  if (existing && title) deduction.title = title;
  if (entry.conclusion !== undefined) deduction.conclusion = entry.conclusion;
  if (entry.clue_ids !== undefined) deduction.clueIds = unique(entry.clue_ids);
  if (entry.status !== undefined) deduction.status = entry.status;

  state.deductions[deduction.id] = deduction;

  if (!existing || deduction.status !== statusBefore) {
    return [{ type: 'deduction_made', id: deduction.id, title: deduction.title, status: deduction.status }];
  }
  return [];
}

function applyClues(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
  const parts = asParts(section, 'clues', errors);
  if (!parts) return [];

  const events: WorldEvent[] = [];
  const reader = entryReader(parts, 'clues.', errors, events);
  reader.rejectUnknown(['clues', 'deductions'], 'clues field');

  reader.each('clues', clueEntry, (entry) => upsertClue(world, entry));
  reader.each('deductions', deductionEntry, (entry) => upsertDeduction(world, entry));

  return events;
}

const en = `## Clues and deductions

You have an investigation board under record.clues for mysteries, inquiries, and conspiracies.

Whenever the player uncovers a piece of evidence, hears key testimony, spots a telling detail, or reads a document, record it in record.clues.clues with its kind (evidence, testimony, observation, document), its source, and links to any other clues it connects with. You may plant undiscovered clues ahead of time with hidden: true and reveal them with hidden: false when the player finds them.

When the player forms a theory or a central question takes shape, record it under record.clues.deductions with the clue_ids that bear on it and its status: open while uncertain, confirmed once proven, or disproven when ruled out.`;

const zh = `## 线索与推理板

你在 record.clues 下有一块推理线索板，用于悬疑、查案与阴谋故事。

每当玩家查获物证、听取关键证词、留意到反常细节或读到文书信件，就在 record.clues.clues 中记录下来，标明类别（evidence 物证、testimony 证词、observation 观察、document 文书）、来源（source），以及与板上其他线索的关联（links）。你可以用 hidden: true 预先埋下尚未发现的线索，等玩家查到时再用 hidden: false 揭晓。

当玩家提出推论或案件的核心疑问成形时，记入 record.clues.deductions，附上支撑它的 clue_ids 与当前状态：待证实时为 open，证实后改为 confirmed，证伪后改为 disproven。`;

export const cluesModule: GameModule = {
  id: 'clues',
  keptWhenUnused: true,
  hasPanel: true,
  tools: [],
  record: { schema: cluesSection, apply: applyClues },
  guide: { en, zh },
};
