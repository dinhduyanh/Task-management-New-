import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/common/Icon';

/**
 * Icon button with a dropdown menu. `items`: [{ label, onSelect, danger?, disabled?, title? }
 * | { heading } | null]. Closes on outside click and Escape.
 */
export default function MenuButton({ label, icon = 'more', items, className = '', align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`bl-menu-wrap ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        type="button"
        className={`bl-icon-button ${className}`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={icon} size={16} />
      </button>
      {open && (
        <div className={`bl-menu align-${align}`} role="menu">
          {items.filter(Boolean).map((item, index) => item.heading
            ? <div key={`h-${index}`} className="bl-menu-heading">{item.heading}</div>
            : (
              <button
                key={`${item.label}-${index}`}
                type="button"
                role="menuitem"
                className={item.danger ? 'danger' : ''}
                disabled={item.disabled}
                title={item.title}
                onClick={() => { setOpen(false); item.onSelect(); }}
              >
                {item.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
