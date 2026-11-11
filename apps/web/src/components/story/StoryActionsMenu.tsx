import type { Session } from '@roleplay/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toUiError, type UiError } from '../../api/errors';
import { languageTag } from '../../i18n';
import { describeError } from '../../lib/describe';
import { useGame } from '../../store/game';
import { Icon } from '../Icon';

function fileSlug(title: string, fallback: string): string {
  const cleaned = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return cleaned || fallback;
}

/**
 * Header popover for exporting the open story (full save backup, illustrated
 * HTML chronicle, Markdown transcript) or branching it into a parallel save.
 */
export function StoryActionsMenu({ session }: { session: Session }) {
  const { t } = useTranslation();
  const running = useGame((s) => s.turn !== null);
  const historyBusy = useGame((s) => s.historyBusy);
  const exportSave = useGame((s) => s.exportSave);
  const forkSession = useGame((s) => s.forkSession);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
    setError(null);
  }, [session.id]);

  const slug = fileSlug(session.world.title || session.seed.premise, `story-${session.id}`);
  const storyTag = languageTag(session.language);

  const onExportJson = async () => {
    setBusy(true);
    setError(null);
    try {
      const [{ downloadJson }, backup] = await Promise.all([
        import('../../lib/exportStory'),
        exportSave(),
      ]);
      if (!backup) return;
      downloadJson(`${slug}.roleplay.json`, backup);
      setOpen(false);
    } catch (err) {
      setError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  const onExportHtml = async () => {
    setBusy(true);
    setError(null);
    try {
      const [{ downloadText, formatStoryHtml }, backup] = await Promise.all([
        import('../../lib/exportStory'),
        exportSave(),
      ]);
      if (!backup) return;
      const html = formatStoryHtml(backup.session, t, storyTag, backup.images);
      downloadText(`${slug}.html`, html, 'text/html');
      setOpen(false);
    } catch (err) {
      setError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  const onExportMarkdown = async () => {
    setBusy(true);
    setError(null);
    try {
      const { downloadText, formatStoryMarkdown } = await import('../../lib/exportStory');
      const md = formatStoryMarkdown(session, t, storyTag);
      downloadText(`${slug}.md`, md, 'text/markdown');
      setOpen(false);
    } catch (err) {
      setError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  const onBranch = async () => {
    setOpen(false);
    await forkSession();
  };

  return (
    <div className="story-actions" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn"
        aria-label={t('export.menuLabel')}
        title={t('export.menuLabel')}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="download" size={18} />
      </button>

      {open && (
        <div id={`${id}-panel`} className="story-actions__panel" role="menu" aria-label={t('export.menuLabel')}>
          <p className="story-actions__title">{t('export.menuTitle')}</p>

          <button
            type="button"
            className="story-actions__item"
            role="menuitem"
            disabled={busy}
            onClick={() => void onExportJson()}
          >
            <Icon name="download" size={16} />
            <div>
              <span className="story-actions__item-name">{t('export.saveJson')}</span>
              <span className="story-actions__item-desc">{t('export.saveJsonHint')}</span>
            </div>
          </button>

          <button
            type="button"
            className="story-actions__item"
            role="menuitem"
            disabled={busy || session.messages.length === 0}
            onClick={() => void onExportHtml()}
          >
            <Icon name="book" size={16} />
            <div>
              <span className="story-actions__item-name">{t('export.htmlBook')}</span>
              <span className="story-actions__item-desc">{t('export.htmlBookHint')}</span>
            </div>
          </button>

          <button
            type="button"
            className="story-actions__item"
            role="menuitem"
            disabled={busy || session.messages.length === 0}
            onClick={() => void onExportMarkdown()}
          >
            <Icon name="code" size={16} />
            <div>
              <span className="story-actions__item-name">{t('export.markdown')}</span>
              <span className="story-actions__item-desc">{t('export.markdownHint')}</span>
            </div>
          </button>

          <div className="story-actions__sep" role="separator" />

          <button
            type="button"
            className="story-actions__item"
            role="menuitem"
            disabled={busy || running || historyBusy || session.world.turn < 1}
            onClick={() => void onBranch()}
          >
            <Icon name="branch" size={16} />
            <div>
              <span className="story-actions__item-name">{t('export.branchSave')}</span>
              <span className="story-actions__item-desc">{t('export.branchSaveHint')}</span>
            </div>
          </button>

          {error && (
            <p className="story-actions__error" role="alert">
              {describeError(t, error)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
