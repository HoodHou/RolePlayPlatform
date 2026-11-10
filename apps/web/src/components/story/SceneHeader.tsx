import type { Session } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { languageTag } from '../../i18n';
import { snippet } from '../../lib/text';

export function SceneHeader({ session }: { session: Session }) {
  const { t } = useTranslation();
  const { world } = session;
  const storyLang = languageTag(session.language);

  const locationName = world.scene.locationId ? world.locations[world.scene.locationId]?.name : undefined;
  const where = [locationName, world.scene.time, world.scene.weather].filter((part): part is string => Boolean(part));
  // Until the game master names the world, the premise is a subtitle, not a headline:
  // a whole sentence set in the title face overwhelms the page.
  const subtitle = world.scene.summary || (world.title ? '' : snippet(session.seed.premise || world.premise, 120));

  return (
    <div className="scene">
      <h1 className="scene__title" lang={world.title ? storyLang : undefined}>
        {world.title || t('scene.untitledWorld')}
      </h1>
      {where.length > 0 && (
        <p className="scene__where" lang={storyLang}>
          {where.join(' · ')}
        </p>
      )}
      {subtitle && (
        <p className="scene__summary" lang={storyLang}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
