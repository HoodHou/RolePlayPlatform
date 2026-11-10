import type { Combatant, CombatState, WorldState } from '@roleplay/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { combatantsInOrder, healthPercent } from '../../lib/combat';
import { formatNumber } from '../../lib/text';
import { CharacterAvatar } from '../CharacterAvatar';
import { Icon } from '../Icon';

/** One combatant: where they act, who they are and for which side, their health, defense and conditions. */
function CombatantRow({ combatant, world, lang }: { combatant: Combatant; world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const num = (value: number) => formatNumber(value, uiTag);
  const character = combatant.characterId ? world.characters[combatant.characterId] : undefined;
  const percent = healthPercent(combatant.hp, combatant.maxHp);
  const low = !combatant.down && percent <= 25;

  return (
    <li className={`combatant side--${combatant.side}${combatant.down ? ' is-down' : ''}${low ? ' is-low' : ''}`}>
      <span className="combatant__initiative" title={t('world.combat.initiative', { n: num(combatant.initiative) })}>
        <span className="sr-only">{t('world.combat.initiative', { n: num(combatant.initiative) })}</span>
        <span aria-hidden="true">{num(combatant.initiative)}</span>
      </span>
      <CharacterAvatar name={combatant.name} imageUrl={character?.imageUrl} size="small" />
      <div className="combatant__main">
        <div className="combatant__head">
          <span className="combatant__name" lang={lang}>
            {combatant.name}
          </span>
          <span className="side-tag">{t(`world.combat.side.${combatant.side}`)}</span>
          {combatant.down && <span className="tag combatant__down">{t('world.combat.down')}</span>}
        </div>
        <div className="combatant__health">
          <div
            className="combatant__bar"
            role="meter"
            aria-label={t('world.combat.healthLabel', { name: combatant.name })}
            aria-valuemin={0}
            aria-valuemax={combatant.maxHp}
            aria-valuenow={combatant.hp}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="combatant__hp">
            {t('world.combat.health', { hp: num(combatant.hp), max: num(combatant.maxHp) })}
          </span>
          <span className="combatant__defense" title={t('world.combat.defenseLabel', { n: num(combatant.defense) })}>
            {t('world.combat.defense', { n: num(combatant.defense) })}
          </span>
        </div>
        {combatant.conditions.length > 0 && (
          <ul className="combatant__conditions">
            {combatant.conditions.map((condition) => (
              <li key={condition} className="tag" lang={lang}>
                {condition}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function CombatantList({ fight, world, lang, label }: { fight: CombatState; world: WorldState; lang: string; label: string }) {
  return (
    <ol className="combatants" aria-label={label}>
      {combatantsInOrder(fight).map((combatant) => (
        <CombatantRow key={combatant.id} combatant={combatant} world={world} lang={lang} />
      ))}
    </ol>
  );
}

/**
 * The fight. While it is on: the round, everyone in acting order with their
 * side, health, defense and conditions, and who is down. After it: how it
 * ended, with where everyone was left folded away.
 */
export function CombatTab({ fight, world, lang }: { fight: CombatState; world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const id = useId();
  const [showFinal, setShowFinal] = useState(false);
  const everyone = Object.values(fight.combatants);
  const standing = everyone.filter((combatant) => !combatant.down).length;

  if (!fight.active) {
    return (
      <div className="fight is-over">
        <div className="fight__head">
          <p className="fight__round">{t('world.combat.over')}</p>
        </div>
        <div className="fight__outcome">
          <p className="fight__over">{t('world.combat.overAfter', { count: fight.round })}</p>
          {fight.outcome && (
            <p className="fight__outcome-text" lang={lang}>
              {fight.outcome}
            </p>
          )}
        </div>
        {everyone.length > 0 && (
          <>
            <button
              type="button"
              className="disclosure"
              aria-expanded={showFinal}
              aria-controls={`${id}-final`}
              onClick={() => setShowFinal((value) => !value)}
            >
              {t('world.combat.finalStanding')}
              <Icon name="chevron" size={14} className="disclosure__chevron" />
            </button>
            <div id={`${id}-final`} hidden={!showFinal}>
              <CombatantList fight={fight} world={world} lang={lang} label={t('world.combat.finalStanding')} />
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="fight">
      <div className="fight__head">
        <p className="fight__round">{t('world.combat.round', { n: formatNumber(fight.round, uiTag) })}</p>
        <span className="tag tag--live">
          <span className="live-dot" aria-hidden="true" />
          {t('world.combat.live')}
        </span>
        <p className="fight__standing">{t('world.combat.standing', { count: standing, total: everyone.length })}</p>
      </div>
      <section aria-labelledby={`${id}-order`}>
        <h4 id={`${id}-order`} className="eyebrow fight__heading">
          {t('world.combat.order')}
        </h4>
        <CombatantList fight={fight} world={world} lang={lang} label={t('world.combat.order')} />
      </section>
    </div>
  );
}
