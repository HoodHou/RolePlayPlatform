import type { ReactNode } from 'react';

/**
 * A small, safe formatter for the game master's prose. It understands
 * blank-line paragraphs, *emphasis*, **strong**, scene breaks (*** / ---),
 * and tints quoted speech. Everything else stays plain text: the output is
 * React nodes, never HTML.
 */

type Inline = string | { kind: 'em' | 'strong' | 'speech'; children: Inline[] };

/** Opening quote → closing quote. */
const QUOTES: Record<string, string> = {
  '“': '”', // “ ”
  '"': '"',
  '「': '」', // 「 」
  '『': '』', // 『 』
};

const SCENE_BREAK = /^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$/;
const SPACE = /\s/;
const ASCII_ALNUM = /[A-Za-z0-9]/;

/**
 * Finds the closing run for an emphasis opened with `width` stars (1 or 2),
 * starting the search at `start`. Returns the index where the closing marker
 * begins, or -1. Runs of three or more are split so that `***x***` reads as
 * strong(em(x)) and `*a **b***` as em(a strong(b)).
 */
function findEmphasisEnd(src: string, start: number, width: 1 | 2): number {
  const first = src[start];
  if (first === undefined || SPACE.test(first)) return -1;
  let i = start;
  while (i < src.length) {
    if (src[i] !== '*') {
      i++;
      continue;
    }
    let runEnd = i;
    while (src[runEnd] === '*') runEnd++;
    const run = runEnd - i;
    const canClose = i > start && !SPACE.test(src[i - 1] ?? ' ');
    if (canClose) {
      if (width === 2 && run >= 2) return runEnd - 2;
      if (width === 1 && run % 2 === 1) return runEnd - 1;
    }
    i = runEnd;
  }
  return -1;
}

/** Whether the quote mark at `i` opens speech. Straight quotes need a word after them and no letter before (not 6" or 5'10"). */
function opensSpeech(src: string, i: number): boolean {
  if (src[i] !== '"') return true;
  const next = src[i + 1];
  const prev = src[i - 1];
  return next !== undefined && !SPACE.test(next) && (prev === undefined || !ASCII_ALNUM.test(prev));
}

function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push(text);
    text = '';
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i] ?? '';

    if (ch === '*') {
      const width = src[i + 1] === '*' ? 2 : 1;
      const start = i + width;
      const end = findEmphasisEnd(src, start, width);
      if (end === -1) {
        text += src.slice(i, start);
        i = start;
      } else {
        flush();
        out.push({ kind: width === 2 ? 'strong' : 'em', children: parseInline(src.slice(start, end)) });
        i = end + width;
      }
      continue;
    }

    const close = QUOTES[ch];
    if (close !== undefined && opensSpeech(src, i)) {
      // An unclosed quote runs to the end of the paragraph, which is also the
      // convention for speech that continues into the next paragraph.
      const end = src.indexOf(close, i + 1);
      const innerEnd = end === -1 ? src.length : end;
      flush();
      const children: Inline[] = [ch, ...parseInline(src.slice(i + 1, innerEnd))];
      if (end !== -1) children.push(close);
      out.push({ kind: 'speech', children });
      i = end === -1 ? src.length : end + 1;
      continue;
    }

    text += ch;
    i++;
  }
  flush();
  return out;
}

function renderInline(nodes: Inline[], key: string): ReactNode[] {
  return nodes.map((node, index) => {
    const k = `${key}.${index}`;
    if (typeof node === 'string') {
      const lines = node.split('\n');
      if (lines.length === 1) return node;
      return lines.flatMap((line, n) => (n === 0 ? [line] : [<br key={`${k}.br${n}`} />, line]));
    }
    const children = renderInline(node.children, k);
    if (node.kind === 'em') return <em key={k}>{children}</em>;
    if (node.kind === 'strong') return <strong key={k}>{children}</strong>;
    return (
      <span key={k} className="speech">
        {children}
      </span>
    );
  });
}

/**
 * Formats narration into paragraphs. `trailing` (e.g. a streaming caret) is
 * placed inline at the end of the last paragraph.
 */
export function formatNarration(text: string, trailing?: ReactNode): ReactNode[] {
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((block) => block.trim())
    .filter((block) => block !== '');

  const out = blocks.map((block, index) => {
    if (SCENE_BREAK.test(block)) return <hr key={index} className="scene-break" />;
    return <p key={index}>{renderInline(parseInline(block), String(index))}</p>;
  });

  if (trailing !== undefined) {
    const lastIndex = blocks.length - 1;
    const last = blocks[lastIndex];
    if (last === undefined || SCENE_BREAK.test(last)) {
      out.push(<p key="trailing">{trailing}</p>);
    } else {
      out[lastIndex] = (
        <p key={lastIndex}>
          {renderInline(parseInline(last), String(lastIndex))}
          {trailing}
        </p>
      );
    }
  }
  return out;
}
