import { geminiImageBaseUrl, type ImageQuality, type ImageSubject } from '@roleplay/shared';
import { AppError } from '../errors';
import { failFromResponse, send } from '../llm/openaiHttp';
import { extensionOf, type Painter, type Painting, type PaintRequest } from './types';

/**
 * Google Gemini native image generation (`POST /models/{model}:generateContent`),
 * with `:predict` support when pointed at an `imagen-*` model.
 */

export interface GeminiPainterOptions {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  quality: ImageQuality;
}

const ASPECT_RATIOS: Record<ImageSubject, string> = {
  scene: '3:2',
  location: '3:2',
  character: '2:3',
  item: '1:1',
};

const IMAGEN_ASPECT_RATIOS: Record<ImageSubject, string> = {
  scene: '4:3',
  location: '4:3',
  character: '3:4',
  item: '1:1',
};

const GEMINI_IMAGE_SIZES: Partial<Record<ImageQuality, string>> = {
  low: '1K',
  medium: '2K',
  high: '4K',
};

const REFUSAL_REASONS = new Set([
  'SAFETY',
  'IMAGE_SAFETY',
  'PROHIBITED_CONTENT',
  'IMAGE_PROHIBITED_CONTENT',
  'BLOCKLIST',
  'RECITATION',
  'SPII',
]);

const TIMEOUT_MS = 180_000;

interface GeminiPart {
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

interface GeminiGenerateResponse {
  promptFeedback?: { blockReason?: string };
  candidates?: {
    finishReason?: string;
    finishMessage?: string;
    content?: { parts?: GeminiPart[] };
  }[];
  predictions?: { bytesBase64Encoded?: string; raiFilteredReason?: string }[];
}

export function geminiHeaders(apiKey: string | null): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-goog-api-key': apiKey } : {}),
  };
}

export class GeminiPainter implements Painter {
  private readonly options: GeminiPainterOptions;

  constructor(options: GeminiPainterOptions) {
    this.options = options;
  }

  async paint(request: PaintRequest): Promise<Painting> {
    const { apiKey, baseUrl, model, quality } = this.options;
    const root = geminiImageBaseUrl(baseUrl);
    const bareModel = model.trim().replace(/^models\//, '');
    if (!root || !bareModel) {
      throw new AppError('not_configured', 'Gemini image generation needs both a base URL and a model.');
    }

    const isImagen = /^imagen-/i.test(bareModel);
    const action = isImagen ? 'predict' : 'generateContent';
    const url = `${root}/models/${encodeURIComponent(bareModel)}:${action}`;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]);

    // Gemini 3+ image models accept explicit output resolutions (1K/2K/4K);
    // earlier Gemini 2.5 image models only accept aspectRatio.
    const supportsImageSize = /^gemini-(?:[3-9]|\d{2,})/i.test(bareModel);
    const imageSize = supportsImageSize ? GEMINI_IMAGE_SIZES[quality] : undefined;

    const body = isImagen
      ? {
          instances: [{ prompt: request.prompt }],
          parameters: { sampleCount: 1, aspectRatio: IMAGEN_ASPECT_RATIOS[request.subject] },
        }
      : {
          contents: [{ parts: [{ text: request.prompt }] }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: {
              aspectRatio: ASPECT_RATIOS[request.subject],
              ...(imageSize ? { imageSize } : {}),
            },
          },
        };

    const response = await send(url, {
      method: 'POST',
      headers: geminiHeaders(apiKey),
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) return failFromResponse(response, url, apiKey !== null);

    const payload = (await response.json()) as GeminiGenerateResponse;

    if (isImagen) {
      const prediction = payload.predictions?.[0];
      if (prediction?.bytesBase64Encoded) {
        const data = Buffer.from(prediction.bytesBase64Encoded, 'base64');
        return { data, extension: extensionOf(data) };
      }
      if (prediction?.raiFilteredReason) {
        throw new AppError('refused', prediction.raiFilteredReason);
      }
      throw new AppError('provider_error', 'The Gemini image API returned no image.');
    }

    const candidate = payload.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    for (const part of parts) {
      const encoded = part.inlineData?.data ?? part.inline_data?.data;
      if (encoded) {
        const data = Buffer.from(encoded, 'base64');
        return { data, extension: extensionOf(data) };
      }
    }

    const blockReason = payload.promptFeedback?.blockReason;
    if (blockReason || (candidate?.finishReason && REFUSAL_REASONS.has(candidate.finishReason))) {
      const detail = candidate?.finishMessage ?? blockReason ?? candidate?.finishReason ?? 'Safety filter';
      throw new AppError('refused', `Gemini refused the image request (${detail}).`);
    }

    throw new AppError('provider_error', 'The Gemini image API returned no image.');
  }
}
