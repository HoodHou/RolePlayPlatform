import type { ResolvedSettings } from '../store/settingsStore';
import { MockPainter } from './mock';
import { OpenAIPainter } from './openai';
import type { Painter } from './types';

/** The painter for the current settings, or null when the game master should not be offered pictures. */
export function createPainter(settings: ResolvedSettings): Painter | null {
  if (!settings.illustrationsActive) return null;
  // Demo mode never spends money, whatever the image settings say.
  if (settings.activeProvider === 'mock') return new MockPainter();
  const { apiKey, baseUrl, model, quality } = settings.image;
  return new OpenAIPainter({ apiKey, baseUrl, model, quality });
}
