import { STANCES, type SandboxFaction, type SandboxRelation, type SandboxState, type Stance, type WorldState } from '@roleplay/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { factionStyle, playerFactionOf, regionCounts, sortedFactions } from '../../lib/sandbox';
import { formatNumber, formatSigned } from '../../lib/text';
import { Icon } from '../Icon';
import { MapDialog } from './MapDialog';
import { RegionDetails } from './RegionDetails';
import { MapLegend, SandboxMap } from './SandboxMap';

/** Where a stance sits between war and alliance, drawn as five steps with the current one lit. */
function StanceBadge({ stance }: { stance: Stance }) {
  const { t } = useTranslation();
  const index = STANCES.indexOf(stance);
  return (
    <span className={`stance stance--${stance}`}>
      <span className="stance__scale" aria-hidden="true">
        {STANCES.map((step, i) => (
          <span key={step} className={`stance__step stance__step--${step}${i === index ? ' is-on' : ''}`} />
        ))}
      </span>
      <span className="stance__label">{t(`world.sandbox.stance.${stance}`)}</span>
    </span>
  );
}

function FactionName({ faction, fallback, lang }: { faction: SandboxFaction | undefined; fallback: string; lang: string }) {
  return (
    <span className="faction-name" style={factionStyle(faction)}>
      <span className={faction ? 'swatch' : 'swatch swatch--unclaimed'} aria-hidden="true" />
      <span lang={lang}>{faction?.name ?? fallback}</span>
    </span>
  );
}

function Holdings({ board, faction, lang }: { board: SandboxState; faction: SandboxFaction; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  if (board.resources.length === 0) return null;

  return (
    <table className="holdings">
      <thead>
        <tr>
          <th scope="col">
            <span className="sr-only">{t('world.sandbox.resource')}</span>
          </th>
          <th scope="col">{t('world.sandbox.held')}</th>
          <th scope="col">{t('world.sandbox.perRound')}</th>
        </tr>
      </thead>
      <tbody>
        {board.resources.map((resource) => {
          const income = faction.income[resource.id] ?? 0;
          const trend = income > 0 ? 'is-up' : income < 0 ? 'is-down' : 'is-flat';
          return (
            <tr key={resource.id}>
              <th scope="row" lang={lang}>
                {resource.name}
              </th>
              <td>{formatNumber(faction.resources[resource.id] ?? 0, uiTag)}</td>
              <td className={trend}>{income === 0 ? '—' : formatSigned(income, uiTag)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface FactionCardProps {
  faction: SandboxFaction;
  board: SandboxState;
  world: WorldState;
  regions: number;
  lang: string;
}

function FactionCard({ faction, board, world, regions, lang }: FactionCardProps) {
  const { t } = useTranslation();
  const id = useId();
  // The player's own holdings are always in view; the others fold away, so a crowded board stays scannable.
  const [open, setOpen] = useState(faction.isPlayer);
  const leader = faction.leaderId ? world.characters[faction.leaderId] : undefined;
  const leaderIsPlayer = leader !== undefined && (leader.isPlayer || leader.id === world.playerId);
  const hasDetails = board.resources.length > 0 || faction.description !== '';

  return (
    <li className={faction.isPlayer ? 'card faction is-player' : 'card faction'} style={factionStyle(faction)}>
      <div className="card__head">
        <h5 id={`${id}-name`} className="card__title faction__name" lang={lang}>
          <span className="swatch" aria-hidden="true" />
          {faction.name}
        </h5>
        {faction.isPlayer && <span className="tag tag--accent">{t('world.sandbox.you')}</span>}
      </div>
      {faction.status && (
        <p className="faction__status" lang={lang}>
          {faction.status}
        </p>
      )}
      <dl className="facts">
        {leader && (
          <div className="facts__row">
            <dt>{t('world.sandbox.leader')}</dt>
            <dd lang={lang}>{leaderIsPlayer ? t('world.sandbox.yourSide', { name: leader.name }) : leader.name}</dd>
          </div>
        )}
        <div className="facts__row">
          <dt>{t('world.sandbox.lands')}</dt>
          <dd>{regions > 0 ? t('world.sandbox.regionCount', { count: regions }) : t('world.sandbox.noLands')}</dd>
        </div>
      </dl>
      {hasDetails && !faction.isPlayer && (
        <button
          type="button"
          className="disclosure"
          aria-expanded={open}
          aria-controls={`${id}-details`}
          aria-describedby={`${id}-name`}
          onClick={() => setOpen((value) => !value)}
        >
          {t('world.sandbox.details')}
          <Icon name="chevron" size={14} className="disclosure__chevron" />
        </button>
      )}
      {hasDetails && (
        <div id={`${id}-details`} hidden={!open}>
          <Holdings board={board} faction={faction} lang={lang} />
          {faction.description && (
            <p className="card__text faction__description" lang={lang}>
              {faction.description}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** The player's own relations first, then the rest; within each, from war to alliance. */
function sortedRelations(board: SandboxState): SandboxRelation[] {
  const mine = playerFactionOf(board)?.id;
  const rank = (relation: SandboxRelation) =>
    (relation.a === mine || relation.b === mine ? 0 : STANCES.length) + STANCES.indexOf(relation.stance);
  return [...board.relations].sort((x, y) => rank(x) - rank(y));
}

interface SandboxTabProps {
  board: SandboxState;
  world: WorldState;
  lang: string;
}

/** The board. Shown while it exists, the module on or not; the panel says when it is not (ModuleNote). */
export function SandboxTab({ board, world, lang }: SandboxTabProps) {
  const { t } = useTranslation();
  const id = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState(false);

  // A region can disappear from the board between turns.
  const selectedId = selected !== null && board.regions[selected] ? selected : null;
  const hasRegions = Object.keys(board.regions).length > 0;
  const factions = sortedFactions(board);
  const counts = regionCounts(board);
  const relations = sortedRelations(board);
  const round = board.round > 0 ? t('world.sandbox.round', { n: board.round }) : t('world.sandbox.roundZero');

  return (
    <div className="sandbox">
      <div className="sandbox__head">
        <div className="sandbox__when">
          <p className="sandbox__round">{round}</p>
          {board.period && (
            <p className="sandbox__period" lang={lang}>
              {board.period}
            </p>
          )}
        </div>
        {hasRegions && (
          <button type="button" className="btn btn--small" aria-haspopup="dialog" onClick={() => setEnlarged(true)}>
            <Icon name="expand" size={15} />
            {t('world.sandbox.enlarge')}
          </button>
        )}
      </div>

      <div className="sandbox__map">
        <SandboxMap board={board} lang={lang} selected={selectedId} onSelect={setSelected} />
        <MapLegend board={board} lang={lang} />
        {hasRegions &&
          (selectedId ? (
            <RegionDetails board={board} regionId={selectedId} lang={lang} />
          ) : (
            <p className="sandbox__hint">{t('world.sandbox.selectHint')}</p>
          ))}
      </div>

      <section className="sandbox__section" aria-labelledby={`${id}-factions`}>
        <h4 id={`${id}-factions`} className="eyebrow sandbox__heading">
          {t('world.sandbox.factions')}
        </h4>
        {factions.length > 0 ? (
          <ul className="cards">
            {factions.map((faction) => (
              <FactionCard
                key={faction.id}
                faction={faction}
                board={board}
                world={world}
                regions={counts.get(faction.id) ?? 0}
                lang={lang}
              />
            ))}
          </ul>
        ) : (
          <p className="tab-empty">{t('world.sandbox.noFactions')}</p>
        )}
      </section>

      {factions.length > 1 && (
        <section className="sandbox__section" aria-labelledby={`${id}-relations`}>
          <h4 id={`${id}-relations`} className="eyebrow sandbox__heading">
            {t('world.sandbox.relations')}
          </h4>
          {relations.length > 0 ? (
            <>
              <ul className="relations">
                {relations.map((relation) => (
                  <li key={`${relation.a}|${relation.b}`} className={`relation relation--${relation.stance}`}>
                    <div className="relation__head">
                      <span className="relation__pair">
                        <FactionName faction={board.factions[relation.a]} fallback={relation.a} lang={lang} />
                        <span className="relation__link" aria-hidden="true" />
                        <span className="sr-only">, </span>
                        <FactionName faction={board.factions[relation.b]} fallback={relation.b} lang={lang} />
                      </span>
                      <StanceBadge stance={relation.stance} />
                    </div>
                    {relation.note && (
                      <p className="relation__note" lang={lang}>
                        {relation.note}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <p className="sandbox__note">{t('world.sandbox.unlistedNeutral')}</p>
            </>
          ) : (
            <p className="sandbox__note">{t('world.sandbox.noRelations')}</p>
          )}
        </section>
      )}

      {enlarged && (
        <MapDialog
          board={board}
          round={round}
          lang={lang}
          selected={selectedId}
          onSelect={setSelected}
          onClose={() => setEnlarged(false)}
        />
      )}
    </div>
  );
}
