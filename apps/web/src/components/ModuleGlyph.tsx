import { MODULE_CATEGORY, type ModuleCategory, type ModuleId } from '@roleplay/shared';
import { MODULE_GLYPH } from '../lib/modules';

/** A module's mark: its glyph on a tile tinted by the kind of play it is for. Decorative; the name is always beside it. */
export function ModuleGlyph({
  id,
  category,
  glyph,
  size = 'medium',
}: {
  id: ModuleId;
  category?: ModuleCategory;
  glyph?: string;
  size?: 'small' | 'medium' | 'large';
}) {
  const cat = category ?? MODULE_CATEGORY[id] ?? 'rules';
  const mark = glyph ?? MODULE_GLYPH[id] ?? '✦';
  return (
    <span className={`module-glyph module-glyph--${cat} module-glyph--${size}`} aria-hidden="true">
      {mark}
    </span>
  );
}
