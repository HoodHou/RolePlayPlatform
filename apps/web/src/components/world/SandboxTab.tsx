import { STANCES, type SandboxFaction, type SandboxRelation, type SandboxState, type Stance, type WorldState } from '@roleplay/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { factionStyle, playerFactionOf, regionCounts, sortedFactions, stanceBetween, totalGarrisonOf } from '../../lib/sandbox';
import { formatNumber, formatSigned } from '../../lib/text';
import { Icon } from '../Icon';
import { MapDialog } from './MapDialog';
import { ModuleOpButtons } from './ModuleOpControls';
import { RegionDetails } from './RegionDetails';
import { MapLegend, SANDBOX_LENSES, SandboxMap, type SandboxLens } from './SandboxMap';

const LENS_LABEL_KEYS = {
  political: 'world.sandbox.ops.lensPolitical',
  military: 'world.sandbox.ops.lensMilitary',
  governance: 'world.sandbox.ops.lensGovernance',
  frontline: 'world.sandbox.ops.lensFrontline',
} as const satisfies Record<SandboxLens, string>;

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
  const uiTag = languageTag(useLocale());
  const id = useId();
  // The player's own holdings are always in view; the others fold away, so a crowded board stays scannable.
  const [open, setOpen] = useState(faction.isPlayer);
  const leader = faction.leaderId ? world.characters[faction.leaderId] : undefined;
  const leaderIsPlayer = leader !== undefined && (leader.isPlayer || leader.id === world.playerId);
  const totalGarrison = totalGarrisonOf(board, faction.id);
  const hasDetails = board.resources.length > 0 || faction.description !== '';

  const deficitAlerts = faction.isPlayer
    ? board.resources.flatMap((resource) => {
        const held = faction.resources[resource.id] ?? 0;
        const income = faction.income[resource.id] ?? 0;
        if (income >= 0) return [];
        if (held <= 0) {
          return [{ id: resource.id, tone: 'bad' as const, text: t('world.sandbox.deficitDepleted', { resource: resource.name }) }];
        }
        const roundsLeft = Math.ceil(held / Math.abs(income));
        if (roundsLeft <= 4) {
          return [
            {
              id: resource.id,
              tone: roundsLeft <= 2 ? ('bad' as const) : ('warn' as const),
              text: t('world.sandbox.deficitWarn', { resource: resource.name, rounds: roundsLeft }),
            },
          ];
        }
        return [];
      })
    : [];

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
      {deficitAlerts.length > 0 && (
        <div className="faction__warnings">
          {deficitAlerts.map((alert) => (
            <span key={alert.id} className={`tag tag--${alert.tone}`}>
              {alert.text}
            </span>
          ))}
        </div>
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
        {totalGarrison !== null && (
          <div className="facts__row">
            <dt>{t('world.sandbox.garrisonTotal')}</dt>
            <dd className="region-card__number">{formatNumber(totalGarrison, uiTag)}</dd>
          </div>
        )}
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
  const explicit = [...board.relations];
  if (mine) {
    for (const faction of Object.values(board.factions)) {
      if (faction.id === mine) continue;
      const exists = explicit.some(
        (rel) => (rel.a === mine && rel.b === faction.id) || (rel.a === faction.id && rel.b === mine),
      );
      if (!exists) {
        explicit.push({ a: mine, b: faction.id, stance: 'neutral', note: '' });
      }
    }
  }
  return explicit.sort((x, y) => rank(x) - rank(y));
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
  const [lens, setLens] = useState<SandboxLens>('political');
  const [openDiplomacyId, setOpenDiplomacyId] = useState<string | null>(null);

  // A region can disappear from the board between turns.
  const selectedId = selected !== null && board.regions[selected] ? selected : null;
  const hasRegions = Object.keys(board.regions).length > 0;
  const factions = sortedFactions(board);
  const playerFaction = playerFactionOf(board);
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
        <div className="sandbox__head-actions">
          {hasRegions && (
            <button type="button" className="btn btn--small" aria-haspopup="dialog" onClick={() => setEnlarged(true)}>
              <Icon name="expand" size={15} />
              {t('world.sandbox.enlarge')}
            </button>
          )}
        </div>
      </div>

      {hasRegions && (
        <div className="subtabs" role="group" aria-label={t('world.sandbox.mapLabel')}>
          {SANDBOX_LENSES.map((mode) => (
            <button
              key={mode}
              type="button"
              className="chip-button"
              aria-pressed={lens === mode}
              onClick={() => setLens(mode)}
            >
              {t(LENS_LABEL_KEYS[mode])}
            </button>
          ))}
        </div>
      )}

      <div className="sandbox__map">
        <SandboxMap
          board={board}
          world={world}
          lang={lang}
          selected={selectedId}
          onSelect={setSelected}
          lens={lens}
        />
        <MapLegend board={board} lang={lang} />
        {hasRegions &&
          (selectedId ? (
            <RegionDetails
              board={board}
              world={world}
              regionId={selectedId}
              lang={lang}
              onSelectRegion={setSelected}
            />
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
                {relations.map((relation) => {
                  const rivalId =
                    playerFaction && relation.a === playerFaction.id
                      ? relation.b
                      : playerFaction && relation.b === playerFaction.id
                        ? relation.a
                        : null;
                  const rival = rivalId ? board.factions[rivalId] : undefined;
                  const currentStance =
                    playerFaction && rivalId ? stanceBetween(board, playerFaction.id, rivalId) : relation.stance;
                  const dipOpen = rival !== undefined && openDiplomacyId === rival.id;

                  return (
                    <li key={`${relation.a}|${relation.b}`} className={`relation relation--${relation.stance}`}>
                      <div className="relation__head">
                        <span className="relation__pair">
                          <FactionName faction={board.factions[relation.a]} fallback={relation.a} lang={lang} />
                          <span className="relation__link" aria-hidden="true" />
                          <span className="sr-only">, </span>
                          <FactionName faction={board.factions[relation.b]} fallback={relation.b} lang={lang} />
                        </span>
                        <span className="relation__meta">
                          <StanceBadge stance={relation.stance} />
                          {rival && (
                            <button
                              type="button"
                              className="chip-button relation__dip-btn"
                              aria-pressed={dipOpen}
                              onClick={() => setOpenDiplomacyId((prev) => (prev === rival.id ? null : rival.id))}
                            >
                              {t('world.sandbox.ops.diplomacyBtn')}
                            </button>
                          )}
                        </span>
                      </div>
                      {relation.note && (
                        <p className="relation__note" lang={lang}>
                          {relation.note}
                        </p>
                      )}
                      {rival && dipOpen && (
                        <div className="diplomacy-drawer">
                          <ModuleOpButtons
                            directive={{
                              moduleId: 'sandbox',
                              op: 'advisor_note',
                              params: { target_faction_id: rival.id, intent: 'peace' },
                              label: t('world.sandbox.ops.diplomacyPeaceLabel', { faction: rival.name }),
                              aiNote: t('world.sandbox.ops.diplomacyPeaceLabel', { faction: rival.name }),
                            }}
                            instantLabel={t('world.sandbox.ops.proposePeace')}
                            compact
                            onAfter={() => setOpenDiplomacyId(null)}
                          />
                          <ModuleOpButtons
                            directive={{
                              moduleId: 'sandbox',
                              op: 'advisor_note',
                              params: { target_faction_id: rival.id, intent: 'alliance' },
                              label: t('world.sandbox.ops.diplomacyAllianceLabel', { faction: rival.name }),
                              aiNote: t('world.sandbox.ops.diplomacyAllianceLabel', { faction: rival.name }),
                            }}
                            instantLabel={t('world.sandbox.ops.proposeAlliance')}
                            compact
                            onAfter={() => setOpenDiplomacyId(null)}
                          />
                          <ModuleOpButtons
                            directive={{
                              moduleId: 'sandbox',
                              op: 'advisor_note',
                              params: { target_faction_id: rival.id, intent: 'tribute' },
                              label: t('world.sandbox.ops.diplomacyTributeLabel', { faction: rival.name }),
                              aiNote: t('world.sandbox.ops.diplomacyTributeLabel', { faction: rival.name }),
                            }}
                            instantLabel={t('world.sandbox.ops.demandTribute')}
                            compact
                            onAfter={() => setOpenDiplomacyId(null)}
                          />
                          {currentStance !== 'war' && (
                            <ModuleOpButtons
                              directive={{
                                moduleId: 'sandbox',
                                op: 'advisor_note',
                                params: { target_faction_id: rival.id, intent: 'declare_war' },
                                label: `${t('world.sandbox.ops.declareWar')} · ${rival.name}`,
                                aiNote: `向【${rival.name}】正式颁布讨伐诏书宣战，请推演朝野与对方势力的反应，并在 record.sandbox.relations 中将双方关系更新为 war。`,
                              }}
                              instantLabel={t('world.sandbox.ops.declareWar')}
                              compact
                              onAfter={() => setOpenDiplomacyId(null)}
                            />
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {!playerFaction && <p className="sandbox__note">{t('world.sandbox.unlistedNeutral')}</p>}
            </>
          ) : (
            <p className="sandbox__note">{t('world.sandbox.noRelations')}</p>
          )}
        </section>
      )}

      {enlarged && (
        <MapDialog
          board={board}
          world={world}
          round={round}
          lang={lang}
          selected={selectedId}
          onSelect={setSelected}
          lens={lens}
          onLensChange={setLens}
          onClose={() => setEnlarged(false)}
        />
      )}
    </div>
  );
}
