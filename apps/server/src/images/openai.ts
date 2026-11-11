import type { ImageQuality, ImageSubject } from '@roleplay/shared';
import { AppError } from '../errors';
import { endpointUrl, failFromResponse, requestHeaders, send } from '../llm/openaiHttp';
import { extensionOf, type Painter, type Painting, type PaintRequest } from './types';

/** The OpenAI Images API (`POST /images/generations`), or any endpoint that mirrors it. */

export interface OpenAIPainterOptions {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  quality: ImageQuality;
}

const SIZES: Record<ImageSubject, string> = {
  scene: '1536x1024',
  location: '1536x1024',
  character: '1024x1536',
  item: '1024x1024',
};

// A picture that has not arrived by now is not coming.
const TIMEOUT_MS = 180_000;

interface ImagesResponse {
  data?: { b64_json?: string; url?: string }[];
}

export class OpenAIPainter implements Painter {
  private readonly options: OpenAIPainterOptions;

  constructor(options: OpenAIPainterOptions) {
    this.options = options;
  }

  async paint(request: PaintRequest): Promise<Painting> {
    const { apiKey, baseUrl, model, quality } = this.options;
    const url = endpointUrl(baseUrl, '/images/generations');
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]);

    // GPT image models take a shape, a quality and an output format; WebP keeps
    // a picture to a few hundred KB where PNG runs to several MB. Other models
    // behind this API (older DALL·E, self-hosted servers) accept different
    // values, so they get the one size everything supports and their defaults.
    const gptImage = /^(gpt-image|chatgpt-image)/i.test(model);
    const body = {
      model,
      prompt: request.prompt,
      n: 1,
      size: gptImage ? SIZES[request.subject] : '1024x1024',
      ...(gptImage ? { quality, output_format: 'webp', output_compression: 85 } : {}),
    };

    const response = await send(url, {
      method: 'POST',
      headers: requestHeaders(apiKey),
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) return failFromResponse(response, url, apiKey !== null);

    const image = ((await response.json()) as ImagesResponse).data?.[0];
    let data: Buffer;
    if (image?.b64_json) {
      data = Buffer.from(image.b64_json, 'base64');
    } else if (image?.url) {
      // Some models answer with a short-lived link instead of the bytes.
      const download = await send(image.url, { signal });
      if (!download.ok) throw new AppError('provider_error', `Could not download the image (${download.status}).`);
      data = Buffer.from(await download.arrayBuffer());
    } else {
      throw new AppError('provider_error', 'The image API returned no image.');
    }
    return { data, extension: extensionOf(data) };
  }
}
