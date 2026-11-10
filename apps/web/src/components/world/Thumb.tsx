import { useState } from 'react';
import { useUi } from '../../store/ui';

interface ThumbProps {
  url: string;
  /** Accessible description, e.g. "Portrait of Mira". */
  alt: string;
  /** Shown under the picture in the lightbox. */
  caption: string;
  shape: 'portrait' | 'landscape' | 'square';
  lang: string;
  size?: 'small' | 'large';
}

/** A clickable picture from the world panel; opens the lightbox. Hides itself if the file is missing. */
export function Thumb({ url, alt, caption, shape, lang, size = 'small' }: ThumbProps) {
  const openLightbox = useUi((s) => s.openLightbox);
  const [broken, setBroken] = useState(false);
  if (broken) return null;

  return (
    <button
      type="button"
      className={`thumb thumb--${shape} thumb--${size}`}
      aria-haspopup="dialog"
      onClick={() => openLightbox({ url, caption, lang })}
    >
      <img src={url} alt={alt} loading="lazy" decoding="async" onError={() => setBroken(true)} />
    </button>
  );
}
