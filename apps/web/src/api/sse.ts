/**
 * A minimal Server-Sent Events parser (the parts of the WHATWG spec a fetch
 * client needs). Text is fed in arbitrary chunks; complete frames come out.
 */

export interface SseFrame {
  event: string;
  data: string;
  id: string | undefined;
}

export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];
  private eventType = '';
  private lastId: string | undefined;
  private started = false;

  /** Feeds a chunk of decoded text and returns the frames it completed. */
  push(chunk: string): SseFrame[] {
    if (!this.started) {
      if (chunk.length === 0) return [];
      this.started = true;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
    }
    this.buffer += chunk;

    const frames: SseFrame[] = [];
    let lineStart = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (ch !== '\n' && ch !== '\r') continue;
      // A trailing CR may be the first half of a CRLF split across chunks; wait for more.
      if (ch === '\r' && i === this.buffer.length - 1) break;
      const line = this.buffer.slice(lineStart, i);
      if (ch === '\r' && this.buffer[i + 1] === '\n') i++;
      lineStart = i + 1;
      const frame = this.processLine(line);
      if (frame) frames.push(frame);
    }
    this.buffer = this.buffer.slice(lineStart);
    return frames;
  }

  /** Call when the stream ends; dispatches a final frame that lacked its blank line. */
  end(): SseFrame[] {
    const frames: SseFrame[] = [];
    if (this.buffer.length > 0) {
      const frame = this.processLine(this.buffer.replace(/\r$/, ''));
      if (frame) frames.push(frame);
      this.buffer = '';
    }
    const last = this.processLine('');
    if (last) frames.push(last);
    return frames;
  }

  private processLine(line: string): SseFrame | null {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return null; // comment / keep-alive

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'data':
        this.dataLines.push(value);
        break;
      case 'event':
        this.eventType = value;
        break;
      case 'id':
        if (!value.includes('\0')) this.lastId = value;
        break;
      default:
        // `retry` and unknown fields are irrelevant to a one-shot stream.
        break;
    }
    return null;
  }

  private dispatch(): SseFrame | null {
    const hasData = this.dataLines.length > 0;
    const frame: SseFrame = { event: this.eventType || 'message', data: this.dataLines.join('\n'), id: this.lastId };
    this.dataLines = [];
    this.eventType = '';
    return hasData ? frame : null;
  }
}

/**
 * Reads an event-stream body to the end. `onFrame` may return true to stop
 * early (the body is then cancelled). Rejects with an AbortError when the
 * request's signal fires.
 */
export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: SseFrame) => boolean | void,
): Promise<void> {
  const reader = body.getReader();
  // `stream: true` keeps a multi-byte character (any CJK text) intact across chunk boundaries.
  const decoder = new TextDecoder('utf-8');
  const parser = new SseParser();
  const deliver = (frames: SseFrame[]): boolean => frames.some((frame) => onFrame(frame) === true);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (deliver(parser.push(decoder.decode(value, { stream: true })))) {
        await reader.cancel();
        return;
      }
    }
    deliver([...parser.push(decoder.decode()), ...parser.end()]);
  } finally {
    reader.releaseLock();
  }
}
