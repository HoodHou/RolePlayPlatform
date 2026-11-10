const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reads one string property out of a JSON object while the object is still
 * being written, so a tool input can be shown as it streams in.
 *
 * It only looks for the property as the object's first key (`{"text": "…`),
 * which is how a single-property input always arrives. Anything else simply
 * yields nothing: this is a preview, and the complete, validated input is
 * what counts in the end.
 */
export class StreamingStringField {
  private readonly opening: RegExp;
  private raw = '';
  private position = 0;
  private state: 'seeking' | 'reading' | 'done' = 'seeking';

  constructor(key: string) {
    this.opening = new RegExp(`^\\s*\\{\\s*"${escapeRegExp(key)}"\\s*:\\s*"`);
  }

  /** Feeds the next fragment of JSON and returns the text that became readable. */
  push(fragment: string): string {
    this.raw += fragment;

    if (this.state === 'seeking') {
      const match = this.opening.exec(this.raw);
      if (!match) return '';
      this.position = match[0].length;
      this.state = 'reading';
    }
    if (this.state !== 'reading') return '';

    let text = '';
    while (this.position < this.raw.length) {
      const char = this.raw[this.position]!;
      if (char === '"') {
        this.state = 'done';
        break;
      }
      if (char !== '\\') {
        text += char;
        this.position += 1;
        continue;
      }
      // An escape may be split across fragments; wait until all of it is here.
      const escape = this.raw[this.position + 1];
      if (escape === undefined) break;
      if (escape === 'u') {
        if (this.position + 6 > this.raw.length) break;
        const code = Number.parseInt(this.raw.slice(this.position + 2, this.position + 6), 16);
        if (!Number.isNaN(code)) text += String.fromCharCode(code);
        this.position += 6;
      } else {
        text += ESCAPES[escape] ?? escape;
        this.position += 2;
      }
    }
    return text;
  }
}
