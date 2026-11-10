import { useState } from 'react';

interface CharacterAvatarProps {
  name: string;
  imageUrl?: string | undefined;
  size?: 'small' | 'medium';
}

/**
 * A character's portrait cropped to a square, or their initial when there is
 * none. Decorative: the name is always shown beside it.
 */
export function CharacterAvatar({ name, imageUrl, size = 'medium' }: CharacterAvatarProps) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const showImage = imageUrl !== undefined && imageUrl !== '' && imageUrl !== brokenUrl;
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';

  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {showImage ? (
        <img src={imageUrl} alt="" loading="lazy" decoding="async" onError={() => setBrokenUrl(imageUrl)} />
      ) : (
        <span className="avatar__initial">{initial}</span>
      )}
    </span>
  );
}
