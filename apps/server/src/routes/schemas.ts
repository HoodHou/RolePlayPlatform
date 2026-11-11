import {
  EFFORTS,
  GENERATION_LIMITS,
  IMAGE_PROVIDERS,
  IMAGE_QUALITIES,
  LOCALES,
  PROVIDER_KINDS,
  type CreateSessionRequest,
  type ForkSessionRequest,
  type GeneratePortraitRequest,
  type ModuleDirective,
  type ModuleId,
  type ModuleOperationRequest,
  type RollbackSessionRequest,
  type ScenarioArchitectRequest,
  type Session,
  type TurnRequest,
  type UpdateSessionRequest,
  type UpdateSettingsRequest,
} from '@roleplay/shared';
import type { Context } from 'hono';
import { z } from 'zod';
import { allModuleIds } from '../engine/modules';
import { AppError } from '../errors';
import { toClientSession } from '../store/sessionStore';

export const moduleIdSchema = z
  .string()
  .refine((value): value is ModuleId => allModuleIds().includes(value as ModuleId), 'Unknown module id.');

export const modulesSchema = z.array(moduleIdSchema).max(64);

export const createSessionSchema = z.object({
  language: z.enum(LOCALES),
  premise: z.string().max(8000).optional(),
  playerName: z.string().max(120).optional(),
  playerConcept: z.string().max(4000).optional(),
  modules: modulesSchema.optional(),
}) satisfies z.ZodType<CreateSessionRequest>;

export const updateSessionSchema = z.object({ modules: modulesSchema }) satisfies z.ZodType<UpdateSessionRequest>;

export const rollbackSchema = z.object({
  toTurn: z.number().int().min(0).max(100_000),
}) satisfies z.ZodType<RollbackSessionRequest>;

export const forkSchema = z.object({
  upToTurn: z.number().int().min(0).max(100_000).optional(),
}) satisfies z.ZodType<ForkSessionRequest>;

export const generatePortraitSchema = z.object({
  prompt: z.string().trim().max(2000).optional(),
}) satisfies z.ZodType<GeneratePortraitRequest>;

const rawSessionSchema = z.looseObject({
  id: z.string().max(120).optional().default('imported'),
  createdAt: z.string().max(80).optional(),
  updatedAt: z.string().max(80).optional(),
  language: z.enum(LOCALES),
  seed: z
    .object({
      premise: z.string().max(8000).default(''),
      playerName: z.string().max(200).default(''),
      playerConcept: z.string().max(4000).default(''),
    })
    .default({ premise: '', playerName: '', playerConcept: '' }),
  world: z.looseObject({
    title: z.string().default(''),
    premise: z.string().default(''),
    scene: z.object({
      locationId: z.string().nullable().default(null),
      time: z.string().default(''),
      weather: z.string().default(''),
      summary: z.string().default(''),
    }),
    playerId: z.string().nullable().default(null),
    characters: z.record(z.string(), z.looseObject({ id: z.string(), name: z.string() })).default({}),
    locations: z.record(z.string(), z.looseObject({ id: z.string(), name: z.string() })).default({}),
    items: z.record(z.string(), z.looseObject({ id: z.string(), name: z.string() })).default({}),
    quests: z.record(z.string(), z.looseObject({ id: z.string(), title: z.string() })).default({}),
    lore: z.record(z.string(), z.looseObject({ id: z.string(), title: z.string() })).default({}),
    suggestions: z.array(z.string()).default([]),
    turn: z.number().int().min(0).default(0),
  }),
  messages: z.array(z.looseObject({ id: z.string(), turn: z.number().int(), kind: z.string() })).default([]),
});

const backupImagesSchema = z.record(
  z.string().max(120),
  z.object({ contentType: z.string().max(100), dataBase64: z.string() }),
);

export const importPayloadSchema = z.union([
  z.object({
    version: z.literal(1),
    exportedAt: z.string().optional(),
    session: rawSessionSchema,
    images: backupImagesSchema.optional().default({}),
  }),
  rawSessionSchema.transform((session) => ({ version: 1 as const, session, images: {} })),
]);

export const directiveSchema = z.object({
  id: z.string().max(80).optional(),
  moduleId: moduleIdSchema,
  op: z.string().trim().min(1).max(64),
  params: z.record(z.string(), z.unknown()).default({}),
  label: z.string().trim().min(1).max(300),
  aiNote: z.string().trim().max(1000).optional(),
}) satisfies z.ZodType<ModuleDirective>;

export const moduleOperationSchema = z.object({
  directive: directiveSchema,
}) satisfies z.ZodType<ModuleOperationRequest>;

const spoken = z.string().trim().min(1).max(8000);
const actionText = z.string().trim().max(8000);

export const turnSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('start') }),
  z
    .object({
      kind: z.literal('action'),
      text: actionText,
      directives: z.array(directiveSchema).max(20).optional(),
    })
    .refine(
      (val) => val.text.length > 0 || (val.directives?.length ?? 0) > 0,
      'Provide action text or at least one directive.',
    ),
  z.object({ kind: z.literal('talk'), characterId: z.string().min(1).max(64), text: spoken }),
]) satisfies z.ZodType<TurnRequest>;

const baseUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || /^https?:\/\//i.test(value), 'Must be an http(s) URL.');
const model = z.string().trim().max(200);
const apiKey = z.string().max(500).nullable().optional();
const effort = z.enum(EFFORTS).nullable();
const connection = z.object({ model: model.optional(), baseUrl: baseUrl.optional(), apiKey });
const limits = GENERATION_LIMITS;

export const settingsSchema = z.object({
  gameMaster: z
    .object({ provider: z.enum(PROVIDER_KINDS).optional(), model: model.optional(), effort: effort.optional() })
    .optional(),
  actor: z
    .object({
      provider: z.enum([...PROVIDER_KINDS, 'same']).optional(),
      model: model.optional(),
      effort: effort.optional(),
    })
    .optional(),
  connections: z
    .object({
      anthropic: connection.optional(),
      openai: connection.optional(),
      gemini: connection.optional(),
      custom: connection.optional(),
    })
    .optional(),
  generation: z
    .object({
      maxOutputTokens: z.number().int().min(limits.maxOutputTokens.min).max(limits.maxOutputTokens.max).nullable().optional(),
      temperature: z.number().min(limits.temperature.min).max(limits.temperature.max).nullable().optional(),
      historyTurns: z.number().int().min(limits.historyTurns.min).max(limits.historyTurns.max).optional(),
      memoriesRecalled: z.number().int().min(limits.memoriesRecalled.min).max(limits.memoriesRecalled.max).optional(),
    })
    .optional(),
  image: z
    .object({
      enabled: z.boolean().optional(),
      provider: z.enum(IMAGE_PROVIDERS).optional(),
      model: model.optional(),
      baseUrl: baseUrl.optional(),
      quality: z.enum(IMAGE_QUALITIES).optional(),
      autoCharacterPortraits: z.boolean().optional(),
      apiKey,
    })
    .optional(),
  subscribedModules: modulesSchema.optional(),
}) satisfies z.ZodType<UpdateSettingsRequest>;

export const scenarioArchitectSchema = z.object({
  language: z.enum(LOCALES),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().trim().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
  currentDraft: z
    .object({
      title: z.string().max(200).optional(),
      premise: z.string().max(8000).optional(),
      playerName: z.string().max(120).optional(),
      playerConcept: z.string().max(2000).optional(),
      modules: modulesSchema.optional(),
    })
    .optional(),
  availableModules: modulesSchema.optional(),
  modelOverride: z
    .object({
      provider: z.enum(PROVIDER_KINDS),
      model: model.optional(),
      effort: effort.optional(),
    })
    .optional(),
}) satisfies z.ZodType<ScenarioArchitectRequest>;

export async function readBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const json: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AppError('bad_request', z.prettifyError(parsed.error));
  return parsed.data;
}

export function formatSessionResponse(c: Context, session: Session): Session {
  return c.req.query('slim') === '1' ? toClientSession(session) : session;
}
