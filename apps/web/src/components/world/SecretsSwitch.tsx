import { useTranslation } from 'react-i18next';
import { useUi } from '../../store/ui';

/** One shared "show the game master's secrets" setting, reachable from several tabs. */
export function SecretsSwitch({ warning }: { warning?: string }) {
  const { t } = useTranslation();
  const showSecrets = useUi((s) => s.showSecrets);
  const setShowSecrets = useUi((s) => s.setShowSecrets);

  return (
    <div className="secrets-switch">
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          className="switch__input"
          checked={showSecrets}
          onChange={(event) => setShowSecrets(event.target.checked)}
        />
        <span className="switch__track" aria-hidden="true" />
        <span className="switch__label">{t('world.lore.showSecrets')}</span>
      </label>
      {showSecrets && warning && <p className="secrets__warning">{warning}</p>}
    </div>
  );
}
