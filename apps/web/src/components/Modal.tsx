import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  onClose: () => void;
  /** Id of the visible title; or give `label` when there is none. */
  labelledBy?: string;
  label?: string;
  variant?: 'dialog' | 'drawer-left' | 'drawer-right' | 'lightbox';
  /** Close when the backdrop is clicked. Off for forms, where a stray click would lose input. */
  dismissOnBackdrop?: boolean;
  /** A wider centered dialog, for forms with sections. */
  wide?: boolean;
  /** Extra class on the dialog box, for a dialog that needs its own size. */
  className?: string;
  children: ReactNode;
}

/**
 * A modal built on the native <dialog>: showModal() gives us the top layer, an
 * inert background and a focus trap. Mount it to open, unmount it to close.
 * Esc closes; focus moves to `[data-autofocus]` (or the first focusable
 * element) and returns to the opener afterwards.
 */
export function Modal({
  onClose,
  labelledBy,
  label,
  variant = 'dialog',
  dismissOnBackdrop = false,
  wide = false,
  className,
  children,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();

    const onCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    // Browsers may close without a cancelable `cancel` (e.g. Esc pressed twice);
    // keep React in sync. A stale `close` queued by an earlier close() finds the
    // dialog open again and is ignored.
    const onNativeClose = () => {
      if (!dialog.open) onCloseRef.current();
    };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onNativeClose);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onNativeClose);
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={`modal modal--${variant}${wide ? ' modal--wide' : ''}${className ? ` ${className}` : ''}`}
      onPointerDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // The panel fills the dialog box, so a click on the dialog itself is a click on the backdrop.
        if (dismissOnBackdrop && pressedOnBackdrop.current && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal__panel">{children}</div>
    </dialog>
  );
}
