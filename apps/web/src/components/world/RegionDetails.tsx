import {
  inferSandboxRegionKind,
  matchSandboxResourcePools,
  niceSandboxNumber,
  sandboxEconomicScale,
  sandboxRegionDefense,
  sandboxRegionProsperity,
  sandboxRegionStability,
  sandboxStepPresets,
  type SandboxState,
  type WorldState,
} from '@roleplay/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import {
  borderingPlayerRegionsOf,
  connectedFriendlyRegionsOf,
  factionStyle,
  neighborsOf,
  playerFactionOf,
} from '../../lib/sandbox';
import { formatCompact, formatNumber } from '../../lib/text';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { ModuleOpButtons } from './ModuleOpControls';

type CommandTab = 'transfer' | 'reinforce' | 'fortify' | 'pacify' | 'develop' | 'occupy' | 'campaign';

function MetricGauge({
  label,
  value,
  tone = 'accent',
}: {
  label: string;
  value: number;
  tone?: 'accent' | 'good' | 'warn' | 'bad';
}) {
  return (
    <div className={`region-metric region-metric--${tone}`}>
      <div className="region-metric__top">
        <span className="region-metric__label">{label}</span>
        <span className="region-metric__val">{value}</span>
      </div>
      <div className="region-metric__bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

interface RegionDetailsProps {
  board: SandboxState;
  world: WorldState;
  regionId: string;
  lang: string;
  onSelectRegion?: (regionId: string) => void;
}

/** Strategic region dossier & command console shown beneath the sandbox map. */
export function RegionDetails({ board, world, regionId, lang, onSelectRegion }: RegionDetailsProps) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const openDossier = useUi((s) => s.openDossier);

  const region = board.regions[regionId];
  const [activeTab, setActiveTab] = useState<CommandTab | null>(null);
  const [transferDir, setTransferDir] = useState<'in' | 'out'>('in');
  const [partnerId, setPartnerId] = useState<string>('');
  const [customAmount, setCustomAmount] = useState<number | null>(null);
  const [pacifyResId, setPacifyResId] = useState<string>('');
  const [developYieldId, setDevelopYieldId] = useState<string>('');

  useEffect(() => {
    setActiveTab(null);
    setPartnerId('');
    setCustomAmount(null);
  }, [regionId]);

  if (!region) return null;

  const owner = region.ownerId ? board.factions[region.ownerId] : undefined;
  const playerFaction = playerFactionOf(board);
  const neighbors = neighborsOf(board, region.id);
  const kind = inferSandboxRegionKind(region);
  const defense = sandboxRegionDefense(region);
  const stability = sandboxRegionStability(region);
  const prosperity = sandboxRegionProsperity(region);
  const stabilityTone = stability >= 65 ? 'good' : stability >= 38 ? 'warn' : 'bad';

  const commander = region.commanderId ? world.characters[region.commanderId] : undefined;
  const courtOfficials = world.modules.court?.officials;
  const commanderOfficial = commander && courtOfficials ? courtOfficials[commander.id] : undefined;

  const pools = matchSandboxResourcePools(board);
  const scale = sandboxEconomicScale(board);

  // Connected friendly regions for troop redeployment
  const connectedFriendly =
    owner?.isPlayer && playerFaction ? connectedFriendlyRegionsOf(board, region.id, playerFaction.id) : [];
  const inboundCandidates = connectedFriendly.filter((r) => (r.strength ?? 0) > 0);
  const effectiveDir: 'in' | 'out' =
    transferDir === 'in' && inboundCandidates.length === 0 && (region.strength ?? 0) > 0 ? 'out' : transferDir;
  const transferPartners = effectiveDir === 'in' ? inboundCandidates : connectedFriendly;
  const selectedPartner = transferPartners.find((r) => r.id === partnerId) ?? transferPartners[0];

  // Staging regions for marching into unclaimed or rival territory
  const stagingRegions =
    !owner?.isPlayer && playerFaction
      ? borderingPlayerRegionsOf(board, region.id, playerFaction.id).filter((r) => (r.strength ?? 0) > 0)
      : [];
  const selectedStaging = stagingRegions.find((r) => r.id === partnerId) ?? stagingRegions[0];

  // Available troop cap depending on active tab
  const maxTransfer =
    effectiveDir === 'in' ? (selectedPartner?.strength ?? 0) : Math.max(0, region.strength ?? 0);
  const manpowerPool = pools.manpower;
  const manpowerHeld =
    manpowerPool && playerFaction
      ? (playerFaction.resources[manpowerPool.id] ?? 0)
      : Math.max(2000, (region.strength ?? 500) * 2);
  const maxCampaign = selectedStaging?.strength ?? 0;

  const activeCap =
    activeTab === 'transfer'
      ? maxTransfer
      : activeTab === 'reinforce'
        ? manpowerHeld
        : activeTab === 'occupy' || activeTab === 'campaign'
          ? maxCampaign
          : 0;

  const presets = sandboxStepPresets(activeCap);
  const defaultPreset = presets[Math.min(1, presets.length - 1)] ?? (activeCap > 0 ? activeCap : 0);
  const amount =
    customAmount !== null && customAmount > 0 ? Math.min(Math.round(customAmount), Math.max(1, activeCap)) : defaultPreset;

  // Costs & checks
  const fundsPool = pools.funds;
  const grainPool = pools.grain;
  const fundsHeld = fundsPool && playerFaction ? (playerFaction.resources[fundsPool.id] ?? 0) : 0;

  const reinforceFee =
    fundsPool && fundsPool.id !== manpowerPool?.id && amount > 0
      ? niceSandboxNumber(Math.max(1, amount * scale.costPerTroop), 1)
      : 0;
  const canReinforce =
    amount > 0 &&
    (!manpowerPool || (playerFaction?.resources[manpowerPool.id] ?? 0) >= amount) &&
    (!fundsPool || fundsPool.id === manpowerPool?.id || fundsHeld >= reinforceFee);

  const canFortify = defense < 100 && (!fundsPool || fundsHeld >= scale.fortifyCost);

  const pacifyOptions = [grainPool, fundsPool].filter(
    (item, idx, arr): item is NonNullable<typeof item> => Boolean(item) && arr.findIndex((x) => x?.id === item?.id) === idx,
  );
  const activePacifyPool = pacifyOptions.find((p) => p.id === pacifyResId) ?? pacifyOptions[0];
  const pacifyCost = activePacifyPool
    ? activePacifyPool.id === grainPool?.id
      ? scale.pacifyGrainCost
      : scale.pacifyFundsCost
    : 0;
  const pacifyHeld = activePacifyPool && playerFaction ? (playerFaction.resources[activePacifyPool.id] ?? 0) : 0;
  const canPacify = stability < 100 && (!activePacifyPool || pacifyHeld >= pacifyCost);

  const yieldOptions = [fundsPool, grainPool].filter(
    (item, idx, arr): item is NonNullable<typeof item> => Boolean(item) && arr.findIndex((x) => x?.id === item?.id) === idx,
  );
  const activeYieldPool = yieldOptions.find((p) => p.id === developYieldId) ?? yieldOptions[0];
  const developYieldAmt =
    activeYieldPool?.id === grainPool?.id ? scale.developGrainYield : scale.developFundsYield;
  const canDevelop = prosperity < 100 && (!fundsPool || fundsHeld >= scale.developCost);

  const toggleTab = (tab: CommandTab) => {
    setActiveTab((prev) => (prev === tab ? null : tab));
    setCustomAmount(null);
  };

  const kindLabel = t(`world.sandbox.kind.${kind}`);
  const showTerrainTag = Boolean(region.terrain && region.terrain !== kindLabel);

  return (
    <div className="card region-card" style={factionStyle(owner)} aria-live="polite">
      <div className="card__head region-card__head">
        <div className="region-card__title-wrap">
          <h5 className="card__title" lang={lang}>
            {region.name}
          </h5>
          <span className={`tag region-kind region-kind--${kind}`}>{kindLabel}</span>
          {showTerrainTag && (
            <span className="tag" lang={lang}>
              {region.terrain}
            </span>
          )}
        </div>
        {(region.status || stability < 38) && (
          <span className="tag tag--bad" lang={region.status ? lang : undefined}>
            {region.status || t('world.sandbox.region.crisisAlert')}
          </span>
        )}
      </div>

      <dl className="facts region-card__facts">
        <div className="facts__row">
          <dt>{t('world.sandbox.region.owner')}</dt>
          <dd className="region-card__owner">
            <span className={owner ? 'swatch' : 'swatch swatch--unclaimed'} aria-hidden="true" />
            <span lang={owner ? lang : undefined}>{owner?.name ?? t('world.sandbox.unclaimed')}</span>
            {owner?.isPlayer && <span className="tag tag--accent">{t('world.sandbox.you')}</span>}
          </dd>
        </div>
        <div className="facts__row">
          <dt>{t('world.sandbox.region.strength')}</dt>
          <dd className="region-card__number">
            {region.strength !== null ? formatNumber(region.strength, uiTag) : t('world.sandbox.region.noGarrison')}
          </dd>
        </div>
        {(commander || owner?.isPlayer) && (
          <div className="facts__row">
            <dt>{t('world.sandbox.region.commander')}</dt>
            <dd className="region-card__commander">
              {commander ? (
                <button
                  type="button"
                  className="commander-chip"
                  onClick={() => openDossier(commander.id)}
                  title={t('world.dossier.openFor', { name: commander.name })}
                >
                  {commander.imageUrl ? (
                    <img src={commander.imageUrl} alt="" className="commander-chip__avatar" />
                  ) : (
                    <Icon name="dossier" size={13} />
                  )}
                  <span lang={lang}>{commander.name}</span>
                  {commanderOfficial && (
                    <span className="commander-chip__stat">
                      {t('world.sandbox.ops.commanderMilitary', {
                        mil: commanderOfficial.military,
                        gov: commanderOfficial.governance,
                      })}
                    </span>
                  )}
                </button>
              ) : (
                <span className="world-note">{t('world.sandbox.region.noCommander')}</span>
              )}
              {owner?.isPlayer && (
                <ModuleOpButtons
                  directive={{
                    moduleId: 'sandbox',
                    op: 'advisor_note',
                    params: {
                      intent: 'appoint_commander',
                      region_id: region.id,
                      current_commander_id: region.commanderId ?? null,
                    },
                    label: `${region.name} · ${
                      commander ? t('world.sandbox.region.changeCommander') : t('world.sandbox.region.assignBtn')
                    }`,
                    aiNote: commander
                      ? `拟旨调整【${region.name}】驻守主将（现任：${commander.name}）。请由朝廷/兵部结合战局与官制，从符合身份与阵营立场的我方臣将中推举或调派合适人选，妥善处置${commander.name}的原职交接，并同步更新 record.sandbox.regions 的 commander_id 与朝堂差遣。`
                      : `拟旨为【${region.name}】选派驻守主将。请由朝廷/兵部从符合身份与阵营立场、堪任军务的我方在案臣将（或新擢拔将领）中择定镇守人选，兼顾原职交接，并同步写入 record.sandbox.regions 的 commander_id。`,
                  }}
                  instantLabel={
                    commander ? t('world.sandbox.region.changeCommander') : t('world.sandbox.region.assignBtn')
                  }
                  compact
                />
              )}
            </dd>
          </div>
        )}
        <div className="facts__row">
          <dt>{t('world.sandbox.region.borders')}</dt>
          <dd className="region-card__borders">
            {neighbors.length > 0 ? (
              neighbors.map((nb) => {
                const nbOwner = nb.ownerId ? board.factions[nb.ownerId] : undefined;
                return (
                  <button
                    key={nb.id}
                    type="button"
                    className="border-pill"
                    style={factionStyle(nbOwner)}
                    onClick={() => onSelectRegion?.(nb.id)}
                  >
                    <span className={nbOwner ? 'swatch' : 'swatch swatch--unclaimed'} aria-hidden="true" />
                    <span lang={lang}>{nb.name}</span>
                    {nb.strength !== null && (
                      <span className="border-pill__num">{formatCompact(nb.strength, uiTag)}</span>
                    )}
                  </button>
                );
              })
            ) : (
              <span>{t('world.sandbox.region.noBorders')}</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="region-metrics">
        <MetricGauge label={t('world.sandbox.region.defense')} value={defense} tone="accent" />
        <MetricGauge label={t('world.sandbox.region.stability')} value={stability} tone={stabilityTone} />
        <MetricGauge label={t('world.sandbox.region.prosperity')} value={prosperity} tone="accent" />
      </div>

      {region.description && (
        <p className="card__text" lang={lang}>
          {region.description}
        </p>
      )}

      {/* --- Player-owned strategic commands --- */}
      {owner?.isPlayer && (
        <div className="region-ops">
          <div className="region-ops__bar" role="group" aria-label={t('world.sandbox.ops.decreesTitle')}>
            {(
              [
                ['transfer', 'world.sandbox.ops.tabTransfer'],
                ['reinforce', 'world.sandbox.ops.tabReinforce'],
                ['fortify', 'world.sandbox.ops.tabFortify'],
                ['pacify', 'world.sandbox.ops.tabPacify'],
                ['develop', 'world.sandbox.ops.tabDevelop'],
              ] as const
            ).map(([key, labelKey]) => (
              <button
                key={key}
                type="button"
                className="chip-button region-ops__pill"
                aria-pressed={activeTab === key}
                onClick={() => toggleTab(key)}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>

          {activeTab === 'transfer' && (
            <div className="op-drawer">
              <div className="op-drawer__row op-drawer__row--chips">
                <button
                  type="button"
                  className="chip-button"
                  aria-pressed={effectiveDir === 'in'}
                  onClick={() => {
                    setTransferDir('in');
                    setPartnerId('');
                    setCustomAmount(null);
                  }}
                >
                  {t('world.sandbox.ops.transferModeIn')}
                </button>
                <button
                  type="button"
                  className="chip-button"
                  aria-pressed={effectiveDir === 'out'}
                  onClick={() => {
                    setTransferDir('out');
                    setPartnerId('');
                    setCustomAmount(null);
                  }}
                >
                  {t('world.sandbox.ops.transferModeOut')}
                </button>
              </div>

              {transferPartners.length === 0 ? (
                <p className="world-note">{t('world.sandbox.ops.noConnectedRegions')}</p>
              ) : (
                <>
                  <div className="op-drawer__row">
                    <select
                      className="op-select"
                      aria-label={
                        effectiveDir === 'in'
                          ? t('world.sandbox.ops.transferFrom')
                          : t('world.sandbox.ops.transferTo')
                      }
                      value={selectedPartner?.id ?? ''}
                      onChange={(e) => {
                        setPartnerId(e.target.value);
                        setCustomAmount(null);
                      }}
                    >
                      {transferPartners.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}（{t('world.sandbox.region.strength')} {formatNumber(p.strength ?? 0, uiTag)}）
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="op-drawer__row op-drawer__row--chips">
                    {presets.map((val) => (
                      <button
                        key={val}
                        type="button"
                        className="chip-button"
                        aria-pressed={amount === val}
                        onClick={() => setCustomAmount(val)}
                      >
                        {formatNumber(val, uiTag)}
                      </button>
                    ))}
                    <input
                      type="number"
                      className="op-input region-ops__num"
                      min={1}
                      max={Math.max(1, maxTransfer)}
                      value={amount || ''}
                      onChange={(e) => setCustomAmount(Math.max(0, Number(e.target.value) || 0))}
                      aria-label={t('world.sandbox.ops.troopAmount')}
                    />
                  </div>

                  {selectedPartner && amount > 0 && (
                    <p className="region-ops__preview">
                      {effectiveDir === 'in'
                        ? t('world.sandbox.ops.transferPreview', {
                            from: selectedPartner.name,
                            fromBefore: formatNumber(selectedPartner.strength ?? 0, uiTag),
                            fromAfter: formatNumber(Math.max(0, (selectedPartner.strength ?? 0) - amount), uiTag),
                            to: region.name,
                            toBefore: formatNumber(region.strength ?? 0, uiTag),
                            toAfter: formatNumber((region.strength ?? 0) + amount, uiTag),
                          })
                        : t('world.sandbox.ops.transferPreview', {
                            from: region.name,
                            fromBefore: formatNumber(region.strength ?? 0, uiTag),
                            fromAfter: formatNumber(Math.max(0, (region.strength ?? 0) - amount), uiTag),
                            to: selectedPartner.name,
                            toBefore: formatNumber(selectedPartner.strength ?? 0, uiTag),
                            toAfter: formatNumber((selectedPartner.strength ?? 0) + amount, uiTag),
                          })}
                    </p>
                  )}
                  <p className="world-note">{t('world.sandbox.ops.freeCost')}</p>

                  {selectedPartner && (
                    <div className="op-drawer__foot">
                      <ModuleOpButtons
                        directive={{
                          moduleId: 'sandbox',
                          op: 'advisor_note',
                          params: {
                            intent: 'transfer_troops',
                            from_region_id: effectiveDir === 'in' ? selectedPartner.id : region.id,
                            to_region_id: effectiveDir === 'in' ? region.id : selectedPartner.id,
                            amount,
                          },
                          label:
                            effectiveDir === 'in'
                              ? `${t('world.sandbox.ops.tabTransfer')}：${selectedPartner.name} → ${region.name} (${formatNumber(amount, uiTag)})`
                              : `${t('world.sandbox.ops.tabTransfer')}：${region.name} → ${selectedPartner.name} (${formatNumber(amount, uiTag)})`,
                          aiNote:
                            effectiveDir === 'in'
                              ? `下令调兵移防：自友邻【${selectedPartner.name}】（现驻 ${selectedPartner.strength ?? 0}）经连通防线调拨 ${amount} 兵力增戍【${region.name}】（现驻 ${region.strength ?? 0}）。请核验沿途防务态势并同步更新 record.sandbox.regions 双方驻军。`
                              : `下令调兵移防：自【${region.name}】（现驻 ${region.strength ?? 0}）经连通防线调拨 ${amount} 兵力移防【${selectedPartner.name}】（现驻 ${selectedPartner.strength ?? 0}）。请核验沿途防务态势并同步更新 record.sandbox.regions 双方驻军。`,
                        }}
                        instantLabel={t('world.sandbox.ops.executeTransfer')}
                        disabled={amount <= 0 || amount > maxTransfer}
                        onAfter={() => setActiveTab(null)}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'reinforce' && (
            <div className="op-drawer">
              {manpowerPool && playerFaction && (
                <p className="world-note">
                  {t('world.sandbox.ops.reserveAvailable', {
                    name: manpowerPool.name,
                    held: formatNumber(playerFaction.resources[manpowerPool.id] ?? 0, uiTag),
                  })}
                </p>
              )}
              <div className="op-drawer__row op-drawer__row--chips">
                {presets.map((val) => (
                  <button
                    key={val}
                    type="button"
                    className="chip-button"
                    aria-pressed={amount === val}
                    onClick={() => setCustomAmount(val)}
                  >
                    +{formatNumber(val, uiTag)}
                  </button>
                ))}
                <input
                  type="number"
                  className="op-input region-ops__num"
                  min={1}
                  max={Math.max(1, manpowerHeld)}
                  value={amount || ''}
                  onChange={(e) => setCustomAmount(Math.max(0, Number(e.target.value) || 0))}
                  aria-label={t('world.sandbox.ops.troopAmount')}
                />
              </div>
              <p className="region-ops__preview">
                {t('world.sandbox.ops.reinforceEffect', {
                  region: region.name,
                  amount: formatNumber(amount, uiTag),
                  after: formatNumber((region.strength ?? 0) + amount, uiTag),
                })}
              </p>
              {fundsPool && reinforceFee > 0 && (
                <p className={fundsHeld < reinforceFee ? 'region-ops__cost is-short' : 'region-ops__cost'}>
                  {fundsHeld < reinforceFee
                    ? t('world.sandbox.ops.insufficientResource', {
                        name: fundsPool.name,
                        cost: formatNumber(reinforceFee, uiTag),
                        held: formatNumber(fundsHeld, uiTag),
                      })
                    : t('world.sandbox.ops.costPreview', {
                        cost: formatNumber(reinforceFee, uiTag),
                        name: fundsPool.name,
                        held: formatNumber(fundsHeld, uiTag),
                      })}
                </p>
              )}
              <div className="op-drawer__foot">
                <ModuleOpButtons
                  directive={{
                    moduleId: 'sandbox',
                    op: 'advisor_note',
                    params: {
                      intent: 'reinforce_garrison',
                      region_id: region.id,
                      amount,
                    },
                    label: `${region.name} · ${t('world.sandbox.ops.tabReinforce')} +${formatNumber(amount, uiTag)}`,
                    aiNote: `下令征调增戍：自后备兵源向【${region.name}】征发增派 ${amount} 兵力（当前驻军 ${region.strength ?? 0}${
                      fundsPool && reinforceFee > 0 ? `，预计需支用${fundsPool.name}约 ${reinforceFee}` : ''
                    }）。请核验并扣减我方势力可动员兵力与钱粮，同步更新 record.sandbox.factions 与 record.sandbox.regions。`,
                  }}
                  instantLabel={t('world.sandbox.ops.executeReinforce')}
                  disabled={!canReinforce}
                  onAfter={() => setActiveTab(null)}
                />
              </div>
            </div>
          )}

          {activeTab === 'fortify' && (
            <div className="op-drawer">
              {defense >= 100 ? (
                <p className="world-note">{t('world.sandbox.ops.maxedOut')}</p>
              ) : (
                <>
                  <p className="region-ops__preview">
                    {t('world.sandbox.ops.fortifyEffect', {
                      before: defense,
                      after: Math.min(100, defense + 15),
                    })}
                  </p>
                  {fundsPool && scale.fortifyCost > 0 && (
                    <p className={fundsHeld < scale.fortifyCost ? 'region-ops__cost is-short' : 'region-ops__cost'}>
                      {fundsHeld < scale.fortifyCost
                        ? t('world.sandbox.ops.insufficientResource', {
                            name: fundsPool.name,
                            cost: formatNumber(scale.fortifyCost, uiTag),
                            held: formatNumber(fundsHeld, uiTag),
                          })
                        : t('world.sandbox.ops.costPreview', {
                            cost: formatNumber(scale.fortifyCost, uiTag),
                            name: fundsPool.name,
                            held: formatNumber(fundsHeld, uiTag),
                          })}
                    </p>
                  )}
                  <div className="op-drawer__foot">
                    <ModuleOpButtons
                      directive={{
                        moduleId: 'sandbox',
                        op: 'advisor_note',
                        params: {
                          intent: 'fortify_region',
                          region_id: region.id,
                        },
                        label: `${region.name} · ${t('world.sandbox.ops.tabFortify')}`,
                        aiNote: `下令修筑【${region.name}】城防工事（当前城防 ${defense}/100${
                          fundsPool && scale.fortifyCost > 0 ? `，预计耗支${fundsPool.name}约 ${scale.fortifyCost}` : ''
                        }）。请核扣钱粮、结合当地守将与工期实情裁定城防提升幅度，并更新 record.sandbox.regions 与 resources。`,
                      }}
                      instantLabel={t('world.sandbox.ops.executeFortify')}
                      disabled={!canFortify}
                      onAfter={() => setActiveTab(null)}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'pacify' && (
            <div className="op-drawer">
              {stability >= 100 ? (
                <p className="world-note">{t('world.sandbox.ops.maxedOut')}</p>
              ) : (
                <>
                  {pacifyOptions.length > 1 && (
                    <div className="op-drawer__row op-drawer__row--chips">
                      {pacifyOptions.map((pool) => (
                        <button
                          key={pool.id}
                          type="button"
                          className="chip-button"
                          aria-pressed={activePacifyPool?.id === pool.id}
                          onClick={() => setPacifyResId(pool.id)}
                        >
                          {pool.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="region-ops__preview">
                    {t('world.sandbox.ops.pacifyEffect', {
                      before: stability,
                      after: Math.min(100, stability + 20),
                    })}
                  </p>
                  {activePacifyPool && pacifyCost > 0 && (
                    <p className={pacifyHeld < pacifyCost ? 'region-ops__cost is-short' : 'region-ops__cost'}>
                      {pacifyHeld < pacifyCost
                        ? t('world.sandbox.ops.insufficientResource', {
                            name: activePacifyPool.name,
                            cost: formatNumber(pacifyCost, uiTag),
                            held: formatNumber(pacifyHeld, uiTag),
                          })
                        : t('world.sandbox.ops.costPreview', {
                            cost: formatNumber(pacifyCost, uiTag),
                            name: activePacifyPool.name,
                            held: formatNumber(pacifyHeld, uiTag),
                          })}
                    </p>
                  )}
                  <div className="op-drawer__foot">
                    <ModuleOpButtons
                      directive={{
                        moduleId: 'sandbox',
                        op: 'advisor_note',
                        params: {
                          intent: 'pacify_region',
                          region_id: region.id,
                          resource_id: activePacifyPool?.id ?? null,
                        },
                        label: `${region.name} · ${t('world.sandbox.ops.tabPacify')}`,
                        aiNote: `下令赈灾安民：向【${region.name}】拨付${
                          activePacifyPool && pacifyCost > 0 ? `${activePacifyPool.name}约 ${pacifyCost}` : '赈济钱粮'
                        }开仓抚恤流亡、平抑动荡（当前民心治安 ${stability}/100${
                          region.status ? `，态势：${region.status}` : ''
                        }）。请核扣钱粮、考察地方官吏清廉与执行实效，同步更新 record.sandbox.regions 的 stability 与 status。`,
                      }}
                      instantLabel={t('world.sandbox.ops.executePacify')}
                      disabled={!canPacify}
                      onAfter={() => setActiveTab(null)}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'develop' && (
            <div className="op-drawer">
              {prosperity >= 100 ? (
                <p className="world-note">{t('world.sandbox.ops.maxedOut')}</p>
              ) : (
                <>
                  {yieldOptions.length > 1 && (
                    <div className="op-drawer__row op-drawer__row--chips">
                      {yieldOptions.map((pool) => (
                        <button
                          key={pool.id}
                          type="button"
                          className="chip-button"
                          aria-pressed={activeYieldPool?.id === pool.id}
                          onClick={() => setDevelopYieldId(pool.id)}
                        >
                          +{pool.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="region-ops__preview">
                    {t('world.sandbox.ops.developEffect', {
                      before: prosperity,
                      after: Math.min(100, prosperity + 15),
                      yield: formatNumber(developYieldAmt, uiTag),
                      resource: activeYieldPool?.name ?? '',
                    })}
                  </p>
                  {fundsPool && scale.developCost > 0 && (
                    <p className={fundsHeld < scale.developCost ? 'region-ops__cost is-short' : 'region-ops__cost'}>
                      {fundsHeld < scale.developCost
                        ? t('world.sandbox.ops.insufficientResource', {
                            name: fundsPool.name,
                            cost: formatNumber(scale.developCost, uiTag),
                            held: formatNumber(fundsHeld, uiTag),
                          })
                        : t('world.sandbox.ops.costPreview', {
                            cost: formatNumber(scale.developCost, uiTag),
                            name: fundsPool.name,
                            held: formatNumber(fundsHeld, uiTag),
                          })}
                    </p>
                  )}
                  <div className="op-drawer__foot">
                    <ModuleOpButtons
                      directive={{
                        moduleId: 'sandbox',
                        op: 'advisor_note',
                        params: {
                          intent: 'develop_region',
                          region_id: region.id,
                          yield_resource_id: activeYieldPool?.id ?? null,
                        },
                        label: `${region.name} · ${t('world.sandbox.ops.tabDevelop')}`,
                        aiNote: `下令在【${region.name}】兴修水利、清丈垦殖（当前富庶度 ${prosperity}/100${
                          fundsPool && scale.developCost > 0 ? `，预计投入${fundsPool.name}约 ${scale.developCost}` : ''
                        }，侧重提升每回合${activeYieldPool?.name ?? '税粮'}产出）。请核扣投入并同步更新 record.sandbox.regions.prosperity 及我方势力 income。`,
                      }}
                      instantLabel={t('world.sandbox.ops.executeDevelop')}
                      disabled={!canDevelop}
                      onAfter={() => setActiveTab(null)}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* --- Bordering Unclaimed / Enemy Campaign Console --- */}
      {!owner?.isPlayer && playerFaction && (
        <div className="region-ops">
          <div className="region-ops__bar">
            <button
              type="button"
              className="chip-button region-ops__pill"
              aria-pressed={activeTab === (owner ? 'campaign' : 'occupy')}
              onClick={() => toggleTab(owner ? 'campaign' : 'occupy')}
            >
              {owner ? t('world.sandbox.ops.tabCampaign') : t('world.sandbox.ops.tabOccupy')}
            </button>
          </div>

          {(activeTab === 'occupy' || activeTab === 'campaign') && (
            <div className="op-drawer">
              {stagingRegions.length === 0 ? (
                <p className="world-note">{t('world.sandbox.ops.noStagingRegion')}</p>
              ) : (
                <>
                  <div className="op-drawer__row">
                    <select
                      className="op-select"
                      aria-label={t('world.sandbox.ops.stagingFrom')}
                      value={selectedStaging?.id ?? ''}
                      onChange={(e) => {
                        setPartnerId(e.target.value);
                        setCustomAmount(null);
                      }}
                    >
                      {stagingRegions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}（{t('world.sandbox.region.strength')} {formatNumber(s.strength ?? 0, uiTag)}）
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="op-drawer__row op-drawer__row--chips">
                    {presets.map((val) => (
                      <button
                        key={val}
                        type="button"
                        className="chip-button"
                        aria-pressed={amount === val}
                        onClick={() => setCustomAmount(val)}
                      >
                        {formatNumber(val, uiTag)}
                      </button>
                    ))}
                    <input
                      type="number"
                      className="op-input region-ops__num"
                      min={1}
                      max={Math.max(1, maxCampaign)}
                      value={amount || ''}
                      onChange={(e) => setCustomAmount(Math.max(0, Number(e.target.value) || 0))}
                      aria-label={t('world.sandbox.ops.troopAmount')}
                    />
                  </div>

                  {selectedStaging && amount > 0 && (
                    <p className="region-ops__preview">
                      {owner
                        ? t('world.sandbox.ops.campaignPreview', {
                            force: formatNumber(amount, uiTag),
                            defender: owner.name,
                            enemyForce: formatNumber(region.strength ?? 0, uiTag),
                            defense,
                          })
                        : t('world.sandbox.ops.occupyPreview', {
                            from: selectedStaging.name,
                            force: formatNumber(amount, uiTag),
                            left: formatNumber(Math.max(0, (selectedStaging.strength ?? 0) - amount), uiTag),
                            target: region.name,
                          })}
                    </p>
                  )}

                  {owner && amount > 0 && amount < (region.strength ?? 0) && (
                    <p className="region-ops__cost is-short">{t('world.sandbox.ops.outnumberedWarn')}</p>
                  )}

                  {selectedStaging && (
                    <div className="op-drawer__foot">
                      <ModuleOpButtons
                        directive={{
                          moduleId: 'sandbox',
                          op: 'advisor_note',
                          params: {
                            intent: owner ? 'launch_campaign' : 'occupy_region',
                            from_region_id: selectedStaging.id,
                            target_region_id: region.id,
                            force: amount,
                          },
                          label: owner
                            ? `${t('world.sandbox.ops.tabCampaign')}：${selectedStaging.name} → ${region.name} (${formatNumber(amount, uiTag)})`
                            : `${t('world.sandbox.ops.tabOccupy')}：${selectedStaging.name} → ${region.name} (${formatNumber(amount, uiTag)})`,
                          aiNote: owner
                            ? `下令出师攻伐：自【${selectedStaging.name}】（现驻 ${selectedStaging.strength ?? 0}）发兵 ${amount} 讨伐【${owner.name}】所属【${region.name}】（敌驻军 ${region.strength ?? 0}，城防 ${defense}/100）。请务必先调用 simulate 工具裁定两军交战结果与伤亡折损，再依据战果更新 record.sandbox 的兵力、版图归属与交战关系。`
                            : `下令发兵进驻：自【${selectedStaging.name}】（现驻 ${selectedStaging.strength ?? 0}）分兵 ${amount} 进驻无主之地【${region.name}】。请结合当地流民、险隘或潜在敌情裁定收复过程（遇抵抗时调用 simulate），并更新 record.sandbox.regions 的归属与驻军。`,
                        }}
                        instantLabel={
                          owner ? t('world.sandbox.ops.executeCampaign') : t('world.sandbox.ops.executeOccupy')
                        }
                        disabled={amount <= 0 || amount > maxCampaign}
                        onAfter={() => setActiveTab(null)}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
