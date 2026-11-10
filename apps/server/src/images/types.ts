import type { ImageSubject } from '@roleplay/shared';

/**
 * Painting is a separate service from the game master: any model can tell the
 * story while an image model draws it. The game master asks for a picture
 * through the `draw_image` tool; a Painter turns that request into bytes.
 */

export interface PaintRequest {
  /** What to draw, already combined with the world's art style. */
  prompt: string;
  /** Decides the shape: scenes and places are wide, portraits tall, items square. */
  subject: ImageSubject;
  signal: AbortSignal;
}

export type ImageExtension = 'png' | 'jpg' | 'webp' | 'svg';

export interface Painting {
  data: Buffer;
  extension: ImageExtension;
}

export interface Painter {
  paint(request: PaintRequest): Promise<Painting>;
}
