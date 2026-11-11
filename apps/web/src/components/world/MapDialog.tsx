import type { SandboxState, WorldState } from '@roleplay/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';
import { Modal } from '../Modal';
import { RegionDetails } from './RegionDetails';
import { MapLegend, SANDBOX_LENSES, SandboxMap, type SandboxLens } from './SandboxMap';

const LENS_LABEL_KEYS = {
  political: 'world.sandbox.ops.lensPolitical',
  military: 'world.sandbox.ops.lensMilitary',
  governance: 'world.sandbox.ops.lensGovernance',
  frontline: 'world.sandbox.ops.lensFrontline',
} as const satisfies Record<SandboxLens, string>;

interface MapDialogProps {
  board: SandboxState;
  world: WorldState;
  /** The round, as the panel words it. */
  round: string;
  lang: string;
  selected: string | null;
  onSelect: (regionId: string | null) => void;
  lens: SandboxLens;
  onLensChange: (lens: SandboxLens) => void;
  onClose: () => void;
}

/** The map at a size where a crowded board reads well. Shares its selection with the panel behind it. */
export function MapDialog({
  board,
  world,
  round,
  lang,
  selected,
  onSelect,
  lens,
  onLensChange,
  onClose,
}: MapDialogProps) {
  const { t } = useTranslation();
  const id = useId();

  return (
    <Modal labelledBy={`${id}-title`} onClose={onClose} wide dismissOnBackdrop>
      <div className="dialog map-dialog">
        <header className="dialog__head">
          <div className="map-dialog__heading">
            <h2 id={`${id}-title`} className="dialog__title">
              {t('world.sandbox.mapTitle')}
            </h2>
            <p className="map-dialog__when">
              {round}
              {board.period && (
                <>
                  {' · '}
                  <span lang={lang}>{board.period}</span>
                </>
              )}
            </p>
          </div>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose} data-autofocus>
            <Icon name="close" />
          </button>
        </header>
        <div className="dialog__body map-dialog__body">
          <div className="subtabs" role="group" aria-label={t('world.sandbox.mapLabel')}>
            {SANDBOX_LENSES.map((mode) => (
              <button
                key={mode}
                type="button"
                className="chip-button"
                aria-pressed={lens === mode}
                onClick={() => onLensChange(mode)}
              >
                {t(LENS_LABEL_KEYS[mode])}
              </button>
            ))}
          </div>
          <SandboxMap
            board={board}
            world={world}
            lang={lang}
            selected={selected}
            onSelect={onSelect}
            size="large"
            lens={lens}
          />
          <MapLegend board={board} lang={lang} />
          {selected && board.regions[selected] ? (
            <RegionDetails board={board} world={world} regionId={selected} lang={lang} onSelectRegion={onSelect} />
          ) : (
            <p className="sandbox__hint">{t('world.sandbox.selectHint')}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
