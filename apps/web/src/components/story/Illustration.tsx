import type { ImageMessage } from '@roleplay/shared';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../../lib/describe';
import { useGame } from '../../store/game';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';

/**
 * A picture the game master painted. Pending: a framed placeholder at the
 * picture's aspect; ready: the image (click to enlarge, or repaint); failed: a
 * quiet line with a Retry action. The frame's aspect and width come from
 * `subject` (see story.css).
 */
export const Illustration = memo(function Illustration({ message, lang }: { message: ImageMessage; lang: string }) {
  const { t } = useTranslation();
  const openLightbox = useUi((s) => s.openLightbox);
  const retrying = useGame((s) => Boolean(s.retryingImages[message.id]));
  const retryImage = useGame((s) => s.retryImage);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [message.url, message.status]);

  const canRepaint = Boolean(message.prompt?.trim() || message.caption.trim());

  if ((message.status === 'failed' || broken) && !retrying) {
    const reason = broken
      ? t('story.imageBroken')
      : describeError(t, message.error ?? { code: 'provider_error', message: '' });
    return (
      <div className="illustration-failed">
        <span className="illustration-failed__glyph" aria-hidden="true">
          ▨
        </span>
        <span>{broken ? reason : t('story.imageFailed', { reason })}</span>
        {canRepaint && (
          <button
            type="button"
            className="btn btn--ghost btn--small illustration-failed__retry"
            onClick={() => void retryImage(message.id)}
          >
            <Icon name="retry" size={14} />
            {t('story.retryImage')}
          </button>
        )}
      </div>
    );
  }

  const alt = message.caption || t('story.illustration');
  const ready = message.status === 'ready' && message.url && !retrying;

  return (
    <figure className={`illustration illustration--${message.subject}`}>
      {ready ? (
        <div className="illustration__wrap">
          <button
            type="button"
            className="illustration__frame"
            aria-haspopup="dialog"
            title={t('story.viewLarger')}
            onClick={() => openLightbox({ url: message.url ?? '', caption: message.caption, lang })}
          >
            <img src={message.url ?? ''} alt={alt} lang={lang} loading="lazy" decoding="async" onError={() => setBroken(true)} />
          </button>
          {canRepaint && (
            <button
              type="button"
              className="icon-btn illustration__repaint"
              title={t('story.repaintImage')}
              aria-label={t('story.repaintImage')}
              onClick={() => void retryImage(message.id)}
            >
              <Icon name="retry" size={15} />
            </button>
          )}
        </div>
      ) : (
        <div className="illustration__frame is-pending" role="img" aria-label={t('story.paintingImage')}>
          <span className="illustration__status" aria-hidden="true">
            {t('story.paintingImage')}
          </span>
        </div>
      )}
      {message.caption && (
        <figcaption className="illustration__caption" lang={lang}>
          {message.caption}
        </figcaption>
      )}
    </figure>
  );
});
