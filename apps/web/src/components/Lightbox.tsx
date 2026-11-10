import { useTranslation } from 'react-i18next';
import { useUi, type LightboxImage } from '../store/ui';
import { Icon } from './Icon';
import { Modal } from './Modal';

export function Lightbox({ image }: { image: LightboxImage }) {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeLightbox);
  const alt = image.caption || t('story.illustration');

  return (
    <Modal variant="lightbox" label={alt} onClose={close} dismissOnBackdrop>
      <figure className="lightbox">
        <img className="lightbox__image" src={image.url} alt={alt} />
        {image.caption && (
          <figcaption className="lightbox__caption" lang={image.lang}>
            {image.caption}
          </figcaption>
        )}
      </figure>
      <button type="button" className="icon-btn lightbox__close" aria-label={t('common.close')} onClick={close} data-autofocus>
        <Icon name="close" size={20} />
      </button>
    </Modal>
  );
}
