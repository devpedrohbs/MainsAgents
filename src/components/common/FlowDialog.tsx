import { useEffect, useId, useRef, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { useLanguage } from '../../app/LanguageProvider';

/** Shared dialog with contained keyboard focus and restoration to its trigger. */
export function FlowDialog({
  title,
  description,
  onClose,
  children,
}: PropsWithChildren<{ title: string; description?: string; onClose: () => void }>) {
  const { t } = useLanguage();
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    (
      ref.current?.querySelector<HTMLElement>('[data-autofocus],input') ??
      ref.current?.querySelector<HTMLElement>('.flow-option') ??
      ref.current?.querySelector<HTMLElement>('button')
    )?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key === 'Tab') {
        const elements = Array.from(
          ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex="0"]') ??
            [],
        ).filter((item) => item.getClientRects().length);
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      if (origin?.isConnected) origin.focus();
    };
  }, []);
  return createPortal(
    <div
      className="flow-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        className="flow-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        aria-describedby={description ? `${id}-description` : undefined}
      >
        <header>
          <div>
            <h2 id={id}>{title}</h2>
            {description && <p id={`${id}-description`}>{description}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t('Close')}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
