import type { WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import type { BattleEvent } from '../../lib/modules';
import { boardOf, factionStyle } from '../../lib/sandbox';
import { formatNumber } from '../../lib/text';

type Side = 'attacker' | 'defender';

/**
 * A battle the server settled: the two sides facing each other, each with a
 * bar for the force it brought (to scale with the other's) and the part of it
 * lost, then who won and by how much. Toned by whether the player's side won.
 */
export function BattleCard({ event, world, lang }: { event: BattleEvent; world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  // Colours come from the board as it is now; a faction that has since left it is drawn neutral.
  const board = boardOf(world);
  const factions = { attacker: board?.factions[event.attackerId], defender: board?.factions[event.defenderId] };
  const playerSide: Side | null = factions.attacker?.isPlayer ? 'attacker' : factions.defender?.isPlayer ? 'defender' : null;
  const tone = playerSide === null ? 'neutral' : playerSide === event.winner ? 'good' : 'bad';
  const largest = Math.max(event.attackerForce, event.defenderForce) || 1;
  const winnerName = event.winner === 'attacker' ? event.attackerName : event.defenderName;

  const renderSide = (side: Side) => {
    const name = side === 'attacker' ? event.attackerName : event.defenderName;
    const force = Math.max(side === 'attacker' ? event.attackerForce : event.defenderForce, 0);
    const losses = Math.min(Math.max(side === 'attacker' ? event.attackerLosses : event.defenderLosses, 0), force);
    const won = event.winner === side;
    return (
      <div className={`battle__side battle__side--${side} ${won ? 'is-winner' : 'is-loser'}`} style={factionStyle(factions[side])}>
        <p className="battle__role">
          {t(`events.battle.${side}`)}
          <span className="battle__result">{won ? t('events.battle.victory') : t('events.battle.defeat')}</span>
        </p>
        <p className="battle__name" lang={lang}>
          <span className={factions[side] ? 'swatch' : 'swatch swatch--unclaimed'} aria-hidden="true" />
          {name}
        </p>
        <div className="battle__bar" aria-hidden="true">
          <span className="battle__kept" style={{ width: `${((force - losses) / largest) * 100}%` }} />
          <span className="battle__lost" style={{ width: `${(losses / largest) * 100}%` }} />
        </div>
        <p className="battle__numbers">
          <span>{t('events.battle.force', { n: formatNumber(force, uiTag) })}</span>
          <span className="battle__losses">{t('events.battle.losses', { n: formatNumber(losses, uiTag) })}</span>
        </p>
      </div>
    );
  };

  return (
    <div className={`battle battle--${tone}`}>
      <div className="battle__head">
        <span className="battle__glyph" aria-hidden="true">
          ⚔
        </span>
        <p className="battle__title">
          {event.regionName ? t('events.battle.title', { region: event.regionName }) : t('events.battle.titleBare')}
        </p>
      </div>
      {event.reason && (
        <p className="battle__reason" lang={lang}>
          {event.reason}
        </p>
      )}
      <div className="battle__sides">
        {renderSide('attacker')}
        <span className="sr-only">{t('events.battle.versus')}</span>
        {renderSide('defender')}
      </div>
      <p className="battle__verdict">{t(`events.battle.verdict.${event.margin}`, { name: winnerName })}</p>
    </div>
  );
}
