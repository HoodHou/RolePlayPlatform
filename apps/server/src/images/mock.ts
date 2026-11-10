import type { ImageSubject } from '@roleplay/shared';
import { AppError } from '../errors';
import type { Painter, Painting, PaintRequest } from './types';

/**
 * A painter that costs nothing: it draws an abstract placeholder as SVG, tinted
 * from the prompt so different requests look different. It stands in for a real
 * image model in demo mode and in tests.
 */

const SHAPES: Record<ImageSubject, [width: number, height: number]> = {
  scene: [1536, 1024],
  location: [1536, 1024],
  character: [1024, 1536],
  item: [1024, 1024],
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function landscape(w: number, h: number, hue: number): string {
  const far = `M0 ${h * 0.62} C ${w * 0.2} ${h * 0.5}, ${w * 0.35} ${h * 0.68}, ${w * 0.55} ${h * 0.56} S ${w * 0.85} ${h * 0.5}, ${w} ${h * 0.6} V ${h} H0 Z`;
  const near = `M0 ${h * 0.78} C ${w * 0.25} ${h * 0.68}, ${w * 0.45} ${h * 0.86}, ${w * 0.7} ${h * 0.74} S ${w * 0.9} ${h * 0.8}, ${w} ${h * 0.72} V ${h} H0 Z`;
  return [
    `<circle cx="${w * 0.72}" cy="${h * 0.3}" r="${h * 0.09}" fill="hsl(${hue + 40} 60% 82%)" opacity="0.85"/>`,
    `<path d="${far}" fill="hsl(${hue} 28% 24%)"/>`,
    `<path d="${near}" fill="hsl(${hue} 30% 14%)"/>`,
  ].join('');
}

function figure(w: number, h: number, hue: number): string {
  const cx = w / 2;
  return [
    `<ellipse cx="${cx}" cy="${h * 1.02}" rx="${w * 0.42}" ry="${h * 0.34}" fill="hsl(${hue} 30% 16%)"/>`,
    `<circle cx="${cx}" cy="${h * 0.42}" r="${w * 0.19}" fill="hsl(${hue} 26% 22%)"/>`,
  ].join('');
}

function object(w: number, h: number, hue: number): string {
  const s = w * 0.2;
  return `<rect x="${w / 2 - s}" y="${h / 2 - s}" width="${s * 2}" height="${s * 2}" rx="${s * 0.3}" transform="rotate(45 ${w / 2} ${h / 2})" fill="hsl(${hue} 30% 20%)" stroke="hsl(${hue + 40} 60% 70%)" stroke-width="6" opacity="0.9"/>`;
}

export function placeholderSvg(subject: ImageSubject, prompt: string): string {
  const [w, h] = SHAPES[subject];
  const hue = hash(prompt) % 360;
  const art =
    subject === 'character' ? figure(w, h, hue) : subject === 'item' ? object(w, h, hue) : landscape(w, h, hue);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="hsl(${hue} 42% 16%)"/><stop offset="1" stop-color="hsl(${hue + 30} 46% 40%)"/>`,
    `</linearGradient></defs>`,
    `<rect width="${w}" height="${h}" fill="url(#sky)"/>`,
    art,
    `</svg>`,
  ].join('');
}

export class MockPainter implements Painter {
  private readonly delayMs: number;

  constructor(options: { delayMs?: number } = {}) {
    // Long enough for the "painting" state to be seen in the UI.
    this.delayMs = options.delayMs ?? 1200;
  }

  async paint(request: PaintRequest): Promise<Painting> {
    if (this.delayMs > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.delayMs);
        request.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
    if (request.signal.aborted) throw new AppError('aborted', 'The request was cancelled.');
    return { data: Buffer.from(placeholderSvg(request.subject, request.prompt), 'utf8'), extension: 'svg' };
  }
}
