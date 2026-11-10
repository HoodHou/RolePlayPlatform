import type { SandboxState } from '@roleplay/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';
import { Modal } from '../Modal';
import { RegionDetails } from './RegionDetails';
import { MapLegend, SandboxMap } from './SandboxMap';

interface MapDialogProps {
  board: SandboxState;
  /** The round, as the panel words it. */
  round: string;
  lang: string;
  selected: string | null;
  onSelect: (regionId: string | null) => void;
  onClose: () => void;
}

/** The map at a size where a crowded board reads well. Shares its selection with the panel behind it. */
export function MapDialog({ board, round, lang, selected, onSelect, onClose }: MapDialogProps) {
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
          <SandboxMap board={board} lang={lang} selected={selected} onSelect={onSelect} size="large" />
          <MapLegend board={board} lang={lang} />
          {selected && board.regions[selected] ? (
            <RegionDetails board={board} regionId={selected} lang={lang} />
          ) : (
            <p className="sandbox__hint">{t('world.sandbox.selectHint')}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
