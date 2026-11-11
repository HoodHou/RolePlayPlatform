import type { ModuleDirective } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { sameDirective, useGame } from '../../store/game';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';

const EMPTY_DIRECTIVES: readonly ModuleDirective[] = [];

/** Whether the open session accepts module operations right now (started and not mid-turn). */
export function useCanOperateModule(): boolean {
  return useGame(
    (s) =>
      s.current !== null &&
      s.current.world.turn >= 1 &&
      s.turn === null &&
      !s.historyBusy &&
      !s.moduleBusy,
  );
}

interface ModuleOpButtonsProps {
  directive: ModuleDirective;
  instantLabel?: string;
  stageLabel?: string;
  hideInstant?: boolean;
  hideStage?: boolean;
  disabled?: boolean;
  compact?: boolean;
  onAfter?: () => void;
}

/**
 * Dual-mode AI-scheduled module directive trigger:
 * - Dispatch (`▶`): sends the directive (plus any queued orders) as a real AI turn for GM scheduling & narration.
 * - Stage (`+`): queues into the current turn's batched directive tray (`TurnRequest.directives`) at 0 tokens.
 */
export function ModuleOpButtons({
  directive,
  instantLabel,
  stageLabel,
  hideInstant = false,
  hideStage = false,
  disabled = false,
  compact = false,
  onAfter,
}: ModuleOpButtonsProps) {
  const { t } = useTranslation();
  const canOperate = useCanOperateModule();
  const dispatchDirective = useGame((s) => s.dispatchDirective);
  const stageDirective = useGame((s) => s.stageDirective);
  const closeDrawer = useUi((s) => s.closeDrawer);
  const stagedList = useGame((s) => (s.current ? (s.stagedDirectives[s.current.id] ?? EMPTY_DIRECTIVES) : EMPTY_DIRECTIVES));
  const isStaged = stagedList.some((d) => sameDirective(d, directive));
  const blocked = !canOperate || disabled;

  const splitCompact = compact && !hideInstant && !hideStage && !stageLabel;
  const stageText = isStaged ? t('world.workspace.staged') : (stageLabel ?? t('world.workspace.stage'));
  const rootClass = splitCompact
    ? 'op-btns op-btns--compact op-btns--split'
    : compact
      ? 'op-btns op-btns--compact'
      : 'op-btns';

  return (
    <span className={rootClass}>
      {!hideInstant && (
        <button
          type="button"
          className={splitCompact ? 'op-btn op-btn--instant op-btn--split-main' : 'op-btn op-btn--instant'}
          disabled={blocked}
          title={t('world.workspace.instantHint')}
          onClick={() => {
            dispatchDirective(directive);
            closeDrawer();
            onAfter?.();
          }}
        >
          <Icon name="send" size={12} />
          <span>{instantLabel ?? t('world.workspace.instant')}</span>
        </button>
      )}
      {!hideStage && (
        <button
          type="button"
          className={[
            'op-btn',
            'op-btn--stage',
            splitCompact ? 'op-btn--split-queue' : '',
            isStaged ? 'is-staged' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          disabled={blocked && !isStaged}
          title={`${stageText} · ${t('world.workspace.stageHint')}`}
          aria-label={splitCompact ? `${directive.label} — ${stageText}` : undefined}
          aria-pressed={isStaged}
          onClick={() => {
            stageDirective(directive);
            onAfter?.();
          }}
        >
          <Icon name={isStaged ? 'check' : splitCompact ? 'plus' : 'queue'} size={12} />
          {!splitCompact && <span>{stageText}</span>}
        </button>
      )}
    </span>
  );
}
