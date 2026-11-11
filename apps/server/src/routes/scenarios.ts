import type { ScenarioStreamEvent } from '@roleplay/shared';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { runScenarioArchitect } from '../engine/scenarioArchitect';
import { toAppError } from '../errors';
import type { LLMProvider } from '../llm/types';
import type { ResolvedSettings, SettingsStore } from '../store/settingsStore';
import { withGameMasterOverride } from '../store/settingsStore';
import { readBody, scenarioArchitectSchema } from './schemas';

export function registerScenarioRoutes(
  app: Hono,
  settings: SettingsStore,
  makeProvider: (settings: ResolvedSettings, role: 'gameMaster' | 'actor') => LLMProvider,
): void {
  app.post('/api/scenarios/architect', async (c) => {
    const request = await readBody(c, scenarioArchitectSchema);
    const current = await settings.get();
    const effective = withGameMasterOverride(current, request.modelOverride);
    const provider = makeProvider(effective, 'gameMaster');
    const availableModules = request.availableModules ?? current.subscribedModules;

    return streamSSE(c, async (stream) => {
      const abort = new AbortController();
      stream.onAbort(() => abort.abort());

      let writes: Promise<unknown> = Promise.resolve();
      const emit = (event: ScenarioStreamEvent): void => {
        const frame = { event: event.type, data: JSON.stringify(event) };
        writes = writes.then(() => stream.writeSSE(frame)).catch(() => {});
      };

      try {
        await runScenarioArchitect(
          { ...request, availableModules },
          { provider, emit, signal: abort.signal },
        );
      } catch (err) {
        emit({ type: 'error', error: toAppError(err).toApiError() });
      } finally {
        await writes;
      }
    });
  });
}
