import { MODULE_CATEGORY, type ModuleId } from '@roleplay/shared';
import { MODULE_GLYPH } from '../lib/modules';

/** A module's mark: its glyph on a tile tinted by the kind of play it is for. Decorative; the name is always beside it. */
export function ModuleGlyph({ id, size = 'medium' }: { id: ModuleId; size?: 'small' | 'medium' | 'large' }) {
  return (
    <span className={`module-glyph module-glyph--${MODULE_CATEGORY[id]} module-glyph--${size}`} aria-hidden="true">
      {MODULE_GLYPH[id]}
    </span>
  );
}
