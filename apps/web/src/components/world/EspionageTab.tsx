import type { EspionageOperation, IntelDossier, SpyAgent, WorldState } from '@roleplay/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUi } from '../../store/ui';
import { ModuleOpButtons, useCanOperateModule } from './ModuleOpControls';
import { SecretsSwitch } from './SecretsSwitch';

export function visibleDossiers(world: WorldState, showSecrets: boolean): IntelDossier[] {
  const state = world.modules?.espionage;
  if (!state) return [];
  return Object.values(state.dossiers).filter((d) => showSecrets || !d.hidden);
}

export function hasEspionageContent(world: WorldState, showSecrets: boolean): boolean {
  const state = world.modules?.espionage;
  if (!state) return false;
  return Boolean(
    state.agencyName ||
      Object.keys(state.agents).length > 0 ||
      visibleDossiers(world, showSecrets).length > 0,
  );
}

const OPERATIONS: readonly EspionageOperation[] = [
  'recon',
  'infiltrate',
  'wiretap',
  'frame',
  'subvert',
  'raid',
];

function AgentCard({
  agent,
  world,
  lang,
}: {
  agent: SpyAgent;
  world: WorldState;
  lang: string;
}) {
  const { t } = useTranslation();
  const openDossier = useUi((s) => s.openDossier);
  const canOperate = useCanOperateModule();
  const [operation, setOperation] = useState<EspionageOperation>('recon');

  const operativeChar = agent.characterId ? world.characters[agent.characterId] : undefined;
  const targetChar = agent.targetId ? world.characters[agent.targetId] : undefined;
  const targetLabel = targetChar?.name || agent.targetName;

  const statusTag =
    agent.status === 'active'
      ? 'tag tag--accent'
      : agent.status === 'compromised'
        ? 'tag tag--failed'
        : 'tag';

  const opName = t(`world.espionage.operation.${operation}`);
  const opReason = targetLabel ? `${opName} · ${targetLabel}` : `${opName} · ${agent.codename}`;

  return (
    <li className={agent.status === 'compromised' ? 'card' : 'card is-present'}>
      <div className="card__head">
        <h4 className="card__title" lang={lang}>
          {operativeChar ? (
            <button
              type="button"
              className="card__title-link"
              onClick={() => openDossier(operativeChar.id)}
            >
              {agent.codename}
            </button>
          ) : (
            agent.codename
          )}
        </h4>
        <span className={statusTag}>{t(`world.espionage.agentStatus.${agent.status}`)}</span>
      </div>

      <dl className="facts">
        {agent.cover && (
          <div className="facts__row">
            <dt>{t('world.espionage.cover')}</dt>
            <dd lang={lang}>{agent.cover}</dd>
          </div>
        )}
        {targetLabel && (
          <div className="facts__row">
            <dt>{t('world.espionage.target')}</dt>
            <dd>
              {targetChar ? (
                <button
                  type="button"
                  className="link-btn"
                  lang={lang}
                  onClick={() => openDossier(targetChar.id)}
                >
                  {targetLabel}
                </button>
              ) : (
                <span lang={lang}>{targetLabel}</span>
              )}
            </dd>
          </div>
        )}
      </dl>

      <div className="mini-meters">
        <div className="mini-meter mini-meter--accent">
          <div className="mini-meter__head">
            <span className="mini-meter__label">{t('world.espionage.infiltration')}</span>
            <span className="mini-meter__value">{agent.infiltration}%</span>
          </div>
          <div className="mini-meter__track" aria-hidden="true">
            <div className="mini-meter__fill" style={{ width: `${agent.infiltration}%` }} />
          </div>
        </div>

        <div className="exposure-row">
          <span className="mini-meter__label">{t('world.espionage.exposure')}</span>
          <div className="exposure-pips" aria-label={`${agent.exposure} / 10`}>
            {Array.from({ length: 10 }, (_, i) => (
              <span
                key={i}
                className={
                  i < agent.exposure
                    ? agent.exposure >= 7
                      ? 'exposure-pip is-danger'
                      : 'exposure-pip is-on'
                    : 'exposure-pip'
                }
              />
            ))}
          </div>
          <span className="mini-meter__value">{agent.exposure}/10</span>
        </div>
      </div>

      {agent.status !== 'compromised' && (
        <div className="op-drawer">
          {agent.status === 'active' && (
            <div className="op-drawer__row">
              <select
                className="op-select"
                value={operation}
                aria-label={t('world.espionage.ops.dispatch')}
                disabled={!canOperate}
                onChange={(e) => setOperation(e.target.value as EspionageOperation)}
              >
                {OPERATIONS.map((op) => (
                  <option key={op} value={op}>
                    {t(`world.espionage.operation.${op}`)}
                  </option>
                ))}
              </select>
              <ModuleOpButtons
                directive={{
                  moduleId: 'espionage',
                  op: 'run_operation',
                  params: {
                    agent_id: agent.id,
                    operation,
                    reason: opReason,
                  },
                  label: `${agent.codename} · ${opName}`,
                }}
                instantLabel={t('world.espionage.ops.dispatch')}
                compact
              />
            </div>
          )}
          <div className="op-drawer__foot">
            <ModuleOpButtons
              directive={{
                moduleId: 'espionage',
                op: 'set_agent_status',
                params: {
                  agent_id: agent.id,
                  status: agent.status === 'active' ? 'recalled' : 'active',
                },
                label: `${agent.codename} · ${
                  agent.status === 'active' ? t('world.espionage.ops.recall') : t('world.espionage.ops.redeploy')
                }`,
              }}
              instantLabel={
                agent.status === 'active' ? t('world.espionage.ops.recall') : t('world.espionage.ops.redeploy')
              }
              hideStage
              compact
            />
          </div>
        </div>
      )}
    </li>
  );
}

function DossierCard({
  dossier,
  world,
  lang,
}: {
  dossier: IntelDossier;
  world: WorldState;
  lang: string;
}) {
  const { t } = useTranslation();
  const openDossier = useUi((s) => s.openDossier);
  const subjectChar = dossier.subjectId ? world.characters[dossier.subjectId] : undefined;
  const subjectLabel = subjectChar?.name || dossier.subjectName;

  return (
    <li className={`card${dossier.hidden ? ' is-secret' : ''}`}>
      <div className="card__head">
        <h4 className="card__title" lang={lang}>
          {dossier.title}
        </h4>
        <div className="card__head-tags">
          <span className={dossier.verified ? 'tag tag--completed' : 'tag'}>
            {dossier.verified ? t('world.espionage.verified') : t('world.espionage.unverified')}
          </span>
          {dossier.hidden && <span className="tag tag--secret">{t('world.clocks.secret')}</span>}
        </div>
      </div>

      {subjectLabel && (
        <p className="card__meta">
          {t('world.espionage.subject')}:{' '}
          {subjectChar ? (
            <button
              type="button"
              className="link-btn"
              lang={lang}
              onClick={() => openDossier(subjectChar.id)}
            >
              {subjectLabel}
            </button>
          ) : (
            <span lang={lang}>{subjectLabel}</span>
          )}
        </p>
      )}

      {dossier.summary && (
        <p className="card__text" lang={lang}>
          {dossier.summary}
        </p>
      )}

      {dossier.leverage && (
        <div className="callout-box callout-box--secret">
          <span className="card__label">{t('world.espionage.leverage')}</span>
          <p className="card__text" lang={lang}>
            {dossier.leverage}
          </p>
        </div>
      )}
    </li>
  );
}

export function EspionageTab({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const showSecrets = useUi((s) => s.showSecrets);
  const openDossier = useUi((s) => s.openDossier);
  const state = world.modules?.espionage;
  if (!state) return null;

  const commander = state.commanderId ? world.characters[state.commanderId] : undefined;
  const agents = Object.values(state.agents);
  const dossiers = visibleDossiers(world, showSecrets);

  return (
    <div className="module-tab">
      <SecretsSwitch warning={t('world.espionage.secretsWarning')} />

      {(state.agencyName || commander || state.networkPower > 0) && (
        <header className="regime-banner">
          <div className="regime-banner__main">
            {state.agencyName && (
              <h3 className="regime-banner__title" lang={lang}>
                {state.agencyName}
              </h3>
            )}
          </div>
          {commander && (
            <p className="regime-banner__meta">
              {t('world.espionage.commander')}:{' '}
              <button
                type="button"
                className="link-btn"
                lang={lang}
                onClick={() => openDossier(commander.id)}
              >
                {commander.name}
              </button>
            </p>
          )}
          <div className="mini-meter">
            <div className="mini-meter__head">
              <span className="mini-meter__label">{t('world.espionage.networkPower')}</span>
              <span className="mini-meter__value">{state.networkPower}%</span>
            </div>
            <div className="mini-meter__track" aria-hidden="true">
              <div className="mini-meter__fill" style={{ width: `${state.networkPower}%` }} />
            </div>
          </div>
        </header>
      )}

      {agents.length > 0 && (
        <section className="world-section">
          <h3 className="eyebrow">{t('world.espionage.agentsTitle')}</h3>
          <ul className="cards">
            {agents.map((a) => (
              <AgentCard key={a.id} agent={a} world={world} lang={lang} />
            ))}
          </ul>
        </section>
      )}

      {dossiers.length > 0 && (
        <section className="world-section">
          <h3 className="eyebrow">{t('world.espionage.dossiersTitle')}</h3>
          <ul className="cards">
            {dossiers.map((d) => (
              <DossierCard key={d.id} dossier={d} world={world} lang={lang} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
