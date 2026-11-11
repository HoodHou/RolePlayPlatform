import type { Session, SessionBackupImage } from '@roleplay/shared';
import type { TFunction } from 'i18next';
import { describeEvent } from './describe';

export function safeFileSlug(title: string, fallback = 'roleplay-story'): string {
  const cleaned = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return cleaned || fallback;
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJson(filename: string, value: unknown): void {
  const json = JSON.stringify(value, null, 2);
  downloadBlob(filename, new Blob([json], { type: 'application/json;charset=utf-8' }));
}

export function downloadText(filename: string, text: string, mimeType: string): void {
  downloadBlob(filename, new Blob([text], { type: `${mimeType};charset=utf-8` }));
}

function resolveImageSrc(url: string | null, images?: Record<string, SessionBackupImage>): string | null {
  if (!url) return null;
  if (images) {
    const match = /\/([^/?#]+)$/.exec(url);
    const entry = match ? images[match[1]!] : undefined;
    if (entry) return `data:${entry.contentType};base64,${entry.dataBase64}`;
  }
  return url;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** Exports a session as a readable Markdown story chronicle. */
export function formatStoryMarkdown(
  session: Session,
  t: TFunction,
  localeTag: string,
  images?: Record<string, SessionBackupImage>,
): string {
  const { world } = session;
  const title = world.title || session.seed.premise || t('scene.untitledWorld');
  const player = world.playerId ? world.characters[world.playerId] : undefined;
  const playerFaction =
    Object.values(world.modules?.sandbox?.factions ?? {}).find((f) => f.isPlayer)?.id ?? null;
  const describeCtx = {
    isSecretLore: (id: string) => Boolean(world.lore[id]?.hidden),
    playerFaction,
    locale: localeTag,
  };

  const lines: string[] = [`# ${title}`, ''];
  const premise = world.premise || session.seed.premise;
  if (premise) {
    lines.push(`*${premise.trim()}*`, '');
  }
  if (player) {
    const stats = player.stats.map((s) => `${s.name}: ${s.value}${s.max !== undefined ? `/${s.max}` : ''}`).join(' · ');
    lines.push(`**${player.name}**${player.role ? ` (${player.role})` : ''}${stats ? ` — ${stats}` : ''}`, '');
  }
  if (world.storyArc && (world.storyArc.chapter || world.storyArc.summary)) {
    lines.push(
      `## ${world.storyArc.chapter || t('export.storyArcHeading')}`,
      '',
      ...(world.storyArc.summary ? [world.storyArc.summary.trim(), ''] : []),
    );
  }
  const publicChronicle = (world.chronicle ?? []).filter((e) => !e.secret);
  if (publicChronicle.length > 0) {
    lines.push(`## ${t('export.chronicleHeading')}`, '');
    for (const item of publicChronicle) {
      const when = [t('world.lore.chronicleTurn', { turn: item.turn }), item.time].filter(Boolean).join(' · ');
      lines.push(`- **${item.title}** (${when})${item.summary ? ` — ${item.summary}` : ''}`);
    }
    lines.push('');
  }
  if (world.storySummary) {
    lines.push(`## ${t('export.storySummaryHeading')}`, '', world.storySummary.trim(), '');
  }
  lines.push('---', '');

  let currentTurn = 0;
  for (const message of session.messages) {
    if (message.turn !== currentTurn) {
      currentTurn = message.turn;
      lines.push(`### ${t('export.turnHeading', { turn: currentTurn })}`, '');
    }
    if (message.kind === 'player') {
      const who = player?.name ?? t('story.you');
      const to = message.to ? world.characters[message.to]?.name ?? message.to : null;
      const head = to ? `**${who}** (${t('story.saidTo', { name: to })})` : `**${who}**`;
      lines.push(`> ${head}: ${message.text}`, '');
    } else if (message.kind === 'narration') {
      lines.push(message.text.trim(), '');
    } else if (message.kind === 'dialogue') {
      lines.push(`**${message.characterName}**: ${message.text.trim()}`, '');
    } else if (message.kind === 'event') {
      const view = describeEvent(t, message.event, describeCtx);
      if (view) lines.push(`- *${view.glyph} ${view.text}*`);
    } else if (message.kind === 'image' && message.status === 'ready' && message.url) {
      const src = resolveImageSrc(message.url, images);
      if (src) {
        const caption = message.caption || t('story.illustration');
        lines.push('', `![${caption.replace(/[\[\]]/g, '')}](${src})`, `*${caption}*`, '');
      }
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Exports a session as a standalone, self-contained HTML book with embedded illustrations. */
export function formatStoryHtml(
  session: Session,
  t: TFunction,
  localeTag: string,
  images?: Record<string, SessionBackupImage>,
): string {
  const { world } = session;
  const title = world.title || session.seed.premise || t('scene.untitledWorld');
  const player = world.playerId ? world.characters[world.playerId] : undefined;
  const playerFaction =
    Object.values(world.modules?.sandbox?.factions ?? {}).find((f) => f.isPlayer)?.id ?? null;
  const describeCtx = {
    isSecretLore: (id: string) => Boolean(world.lore[id]?.hidden),
    playerFaction,
    locale: localeTag,
  };

  const parts: string[] = [];
  let currentTurn = 0;

  for (const message of session.messages) {
    if (message.turn !== currentTurn) {
      currentTurn = message.turn;
      parts.push(`<div class="turn-divider"><span>${escapeHtml(t('export.turnHeading', { turn: currentTurn }))}</span></div>`);
    }
    if (message.kind === 'player') {
      const who = player?.name ?? t('story.you');
      const to = message.to ? world.characters[message.to]?.name ?? message.to : null;
      const label = to ? `${escapeHtml(who)} · ${escapeHtml(t('story.saidTo', { name: to }))}` : escapeHtml(who);
      parts.push(
        `<blockquote class="player"><div class="player-who">${label}</div><div class="player-text">${escapeHtml(message.text)}</div></blockquote>`,
      );
    } else if (message.kind === 'narration') {
      const paragraphs = message.text
        .trim()
        .split(/\n{2,}/)
        .map((p) => `<p>${renderInlineHtml(p.trim())}</p>`)
        .join('\n');
      parts.push(`<div class="narration">${paragraphs}</div>`);
    } else if (message.kind === 'dialogue') {
      parts.push(
        `<div class="dialogue"><div class="speaker">${escapeHtml(message.characterName)}</div><div class="line">${renderInlineHtml(message.text.trim())}</div></div>`,
      );
    } else if (message.kind === 'event') {
      const view = describeEvent(t, message.event, describeCtx);
      if (view) {
        parts.push(`<div class="event"><span>${escapeHtml(view.glyph)}</span> ${escapeHtml(view.text)}</div>`);
      }
    } else if (message.kind === 'image' && message.status === 'ready' && message.url) {
      const src = resolveImageSrc(message.url, images);
      if (src) {
        const caption = message.caption || '';
        parts.push(
          `<figure class="illustration"><img src="${escapeHtml(src)}" alt="${escapeHtml(caption || t('story.illustration'))}" />${
            caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''
          }</figure>`,
        );
      }
    }
  }

  const premise = world.premise || session.seed.premise;
  const stats = player
    ? player.stats.map((s) => `${escapeHtml(s.name)}: ${escapeHtml(String(s.value))}${s.max !== undefined ? `/${s.max}` : ''}`).join(' · ')
    : '';

  return `<!doctype html>
<html lang="${escapeHtml(session.language)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; --bg: #141210; --panel: #1d1a17; --text: #ebe4d8; --muted: #a39887; --accent: #d4a359; --speech: #dfc496; --border: #2e2924; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: Georgia, "Songti SC", "Noto Serif SC", serif; line-height: 1.85; padding: 3rem 1.25rem 5rem; }
  main { max-width: 42rem; margin: 0 auto; }
  header { text-align: center; padding-bottom: 2rem; border-bottom: 1px solid var(--border); margin-bottom: 2.2rem; }
  h1 { margin: 0; font-size: 2rem; font-weight: 600; }
  .premise { color: var(--muted); margin: 0.75rem auto 0; font-style: italic; }
  .sheet { margin-top: 0.9rem; font-family: system-ui, sans-serif; font-size: 0.85rem; color: var(--accent); }
  .summary { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 2rem; font-size: 0.95rem; color: var(--muted); }
  .summary h2 { margin: 0 0 0.4rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); font-family: system-ui, sans-serif; }
  .turn-divider { display: flex; align-items: center; gap: 0.75rem; margin: 2.2rem 0 1.2rem; color: var(--muted); font-family: system-ui, sans-serif; font-size: 0.74rem; letter-spacing: 0.1em; text-transform: uppercase; }
  .turn-divider::before, .turn-divider::after { content: ""; flex: 1; border-top: 1px solid var(--border); }
  blockquote.player { margin: 1.4rem 0; padding: 0.25rem 0 0.25rem 1rem; border-left: 2px solid var(--accent); font-family: system-ui, sans-serif; }
  .player-who { font-size: 0.75rem; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; }
  .player-text { margin-top: 0.2rem; white-space: pre-wrap; }
  .narration p { margin: 0 0 0.95em; font-size: 1.1rem; }
  .dialogue { margin: 1.3rem 0; padding-left: 1rem; border-left: 2px solid rgba(223,196,150,0.35); color: var(--speech); }
  .dialogue .speaker { font-family: system-ui, sans-serif; font-size: 0.76rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  .dialogue .line { margin-top: 0.15rem; font-size: 1.08rem; }
  .event { display: inline-block; margin: 0.25rem 0.35rem 0.25rem 0; padding: 0.18rem 0.65rem; border: 1px solid var(--border); border-radius: 999px; background: var(--panel); color: var(--muted); font-family: system-ui, sans-serif; font-size: 0.78rem; }
  figure.illustration { margin: 1.6rem auto; text-align: center; }
  figure.illustration img { max-width: 100%; border-radius: 8px; border: 1px solid var(--border); }
  figure.illustration figcaption { margin-top: 0.45rem; color: var(--muted); font-size: 0.88rem; }
</style>
</head>
<body>
<main>
  <header>
    <h1>${escapeHtml(title)}</h1>
    ${premise ? `<p class="premise">${escapeHtml(premise)}</p>` : ''}
    ${player ? `<p class="sheet">${escapeHtml(player.name)}${stats ? ` · ${stats}` : ''}</p>` : ''}
  </header>
  ${
    world.storyArc && (world.storyArc.chapter || world.storyArc.summary)
      ? `<section class="summary"><h2>${escapeHtml(world.storyArc.chapter || t('export.storyArcHeading'))}</h2>${world.storyArc.summary ? `<div>${escapeHtml(world.storyArc.summary)}</div>` : ''}</section>`
      : ''
  }
  ${
    world.storySummary
      ? `<section class="summary"><h2>${escapeHtml(t('export.storySummaryHeading'))}</h2><div>${escapeHtml(world.storySummary)}</div></section>`
      : ''
  }
  ${parts.join('\n  ')}
</main>
</body>
</html>`;
}
