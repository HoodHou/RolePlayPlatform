import type { ImageMessage } from '@roleplay/shared';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../../lib/describe';
import { useUi } from '../../store/ui';

/**
 * A picture the game master painted. Pending: a framed placeholder at the
 * picture's aspect; ready: the image (click to enlarge); failed: a quiet line.
 * The frame's aspect and width come from `subject` (see story.css).
 */
export const Illustration = memo(function Illustration({ message, lang }: { message: ImageMessage; lang: string }) {
  const { t } = useTranslation();
  const openLightbox = useUi((s) => s.openLightbox);
  const [broken, setBroken] = useState(false);

  if (message.status === 'failed' || broken) {
    const reason = broken
      ? t('story.imageBroken')
      : describeError(t, message.error ?? { code: 'provider_error', message: '' });
    return (
      <p className="illustration-failed">
        <span className="illustration-failed__glyph" aria-hidden="true">
          ▨
        </span>
        <span>{broken ? reason : t('story.imageFailed', { reason })}</span>
      </p>
    );
  }

  const alt = message.caption || t('story.illustration');
  const ready = message.status === 'ready' && message.url;

  return (
    <figure className={`illustration illustration--${message.subject}`}>
      {ready ? (
        <button
          type="button"
          className="illustration__frame"
          aria-haspopup="dialog"
          title={t('story.viewLarger')}
          onClick={() => openLightbox({ url: message.url ?? '', caption: message.caption, lang })}
        >
          <img src={message.url ?? ''} alt={alt} lang={lang} loading="lazy" decoding="async" onError={() => setBroken(true)} />
        </button>
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
