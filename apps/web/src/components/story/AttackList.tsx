import type { EventMessage } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { healthPercent, sideTone } from '../../lib/combat';
import { MODULE_GLYPH, type AttackEvent } from '../../lib/modules';
import { formatNumber } from '../../lib/text';

/** The d20s of an attack in the order rolled; with an edge, the one that did not count is marked. */
function d20s(event: AttackEvent): { value: number; kept: boolean }[] {
  let claimed = false;
  return event.rolls.map((value) => {
    const kept = !claimed && value === event.kept;
    if (kept) claimed = true;
    return { value, kept };
  });
}

/**
 * One blow, kept to two or three short lines because a fight throws many:
 * attacker and target, the outcome, the d20 and bonus against defense, the
 * damage dice, and the target's health after it, down or not. Toned by who
 * gains: a hit by the player's side is good news, a hit by the enemy bad.
 */
function AttackRow({ event, lang }: { event: AttackEvent; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const num = (value: number) => formatNumber(value, uiTag);
  const landed = event.outcome === 'hit' || event.outcome === 'critical';
  const tone = landed ? sideTone(event.attackerSide) : 'miss';
  const dice = d20s(event);
  const edge =
    event.rolls.length === 2 && dice.some((die) => !die.kept)
      ? event.kept === Math.max(...event.rolls)
        ? 'advantage'
        : 'disadvantage'
      : null;

  return (
    <div className={`attack attack--${event.outcome} attack--${tone}`}>
      <p className="attack__head">
        <span className="attack__glyph" aria-hidden="true">
          {MODULE_GLYPH.combat}
        </span>
        <span className="attack__who">
          <span className="sr-only">{t('events.attack.attacks', { attacker: event.attackerName, target: event.targetName })}</span>
          <span aria-hidden="true">
            <span className={`side-name side--${event.attackerSide}`} lang={lang}>
              {event.attackerName}
            </span>
            <span className="attack__arrow"> → </span>
            <span className={`side-name side--${event.targetSide}`} lang={lang}>
              {event.targetName}
            </span>
          </span>
        </span>
        <span className="attack__outcome">{t(`events.attack.outcome.${event.outcome}`)}</span>
      </p>
      {event.reason && (
        <p className="attack__reason" lang={lang}>
          {event.reason}
        </p>
      )}
      <p className="attack__math">
        <span className="roll__system">
          d20
          {edge && ` · ${t(`events.attack.edge.${edge}`)}`}
        </span>
        <span className="roll__dice">
          {dice.map((die, index) => (
            <span key={index} className={die.kept ? 'die die--small' : 'die die--small is-dropped'}>
              {num(die.value)}
            </span>
          ))}
        </span>
        {event.bonus !== 0 && (
          <span>
            {event.bonus > 0 ? '+' : '−'} {num(Math.abs(event.bonus))}
          </span>
        )}
        {event.bonus !== 0 && <span className="attack__total">= {num(event.total)}</span>}
        <span className="attack__versus">{t('events.attack.versus', { defense: num(event.defense) })}</span>
        {landed && (
          <span className="attack__damage">
            <span className="attack__notation">
              {event.damageNotation}
              {event.outcome === 'critical' && event.damageRolls.length > 0 && ` · ${t('events.attack.doubled')}`}
            </span>
            {event.damageRolls.length > 0 && (
              <span className="roll__dice">
                {event.damageRolls.map((value, index) => (
                  <span key={index} className="die die--small">
                    {num(value)}
                  </span>
                ))}
              </span>
            )}
            <strong className="attack__amount">{t('events.attack.damage', { n: num(event.damage) })}</strong>
          </span>
        )}
        {landed && (
          <span className={`attack__target side--${event.targetSide}${event.targetDown ? ' is-down' : ''}`}>
            <span className="attack__bar" aria-hidden="true">
              <span style={{ width: `${healthPercent(event.targetHp, event.targetMaxHp)}%` }} />
            </span>
            <span lang={lang}>
              {t('events.attack.health', { name: event.targetName, hp: num(event.targetHp), max: num(event.targetMaxHp) })}
            </span>
            {event.targetDown && <span className="attack__down">{t('events.attack.down')}</span>}
          </span>
        )}
      </p>
    </div>
  );
}

/** Consecutive blows share one frame, a row each, so a round reads as one block rather than a stack of cards. */
export function AttackList({ messages, lang }: { messages: EventMessage[]; lang: string }) {
  return (
    <ul className="attacks">
      {messages.map((message) =>
        message.event.type === 'attack_resolved' ? (
          <li key={message.id}>
            <AttackRow event={message.event} lang={lang} />
          </li>
        ) : null,
      )}
    </ul>
  );
}
