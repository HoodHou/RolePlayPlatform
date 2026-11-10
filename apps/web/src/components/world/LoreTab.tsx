import type { LoreEntry, WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { splitLore } from '../../lib/world';
import { useUi } from '../../store/ui';
import { SecretsSwitch } from './SecretsSwitch';

function LoreCard({ entry, lang, secret }: { entry: LoreEntry; lang: string; secret: boolean }) {
  const { t } = useTranslation();
  return (
    <li className={secret ? 'card is-secret' : 'card'}>
      <div className="card__head">
        <h4 className="card__title" lang={lang}>
          {entry.title}
        </h4>
        {secret && <span className="tag tag--secret">{t('world.lore.secret')}</span>}
      </div>
      {entry.content && (
        <p className="card__text" lang={lang}>
          {entry.content}
        </p>
      )}
    </li>
  );
}

export function LoreTab({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const showSecrets = useUi((s) => s.showSecrets);
  const { visible, secret } = splitLore(world);

  return (
    <div className="lore">
      {/* The warning sits with the secret entries further down. */}
      <SecretsSwitch />

      {visible.length > 0 ? (
        <ul className="cards">
          {visible.map((entry) => (
            <LoreCard key={entry.id} entry={entry} lang={lang} secret={false} />
          ))}
        </ul>
      ) : (
        <p className="tab-empty">{t('world.lore.empty')}</p>
      )}

      {showSecrets && (
        <section className="secrets" aria-label={t('world.lore.secret')}>
          <p className="secrets__warning">{t('world.lore.secretsWarning')}</p>
          {secret.length > 0 ? (
            <ul className="cards">
              {secret.map((entry) => (
                <LoreCard key={entry.id} entry={entry} lang={lang} secret />
              ))}
            </ul>
          ) : (
            <p className="tab-empty">{t('world.lore.noSecrets')}</p>
          )}
        </section>
      )}

      {world.artStyle && (
        <p className="lore__art-style">
          {t('world.artStyle', { style: world.artStyle })}
        </p>
      )}
    </div>
  );
}
