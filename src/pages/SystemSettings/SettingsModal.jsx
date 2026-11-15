import { useEffect } from 'react';
import Icon from '../../components/common/Icon';
import './SystemSettings.css';

/** Form dialog used by the System Settings panels. Escape and the backdrop close it. */
export default function SettingsModal({ title, children, footer, onClose, onSubmit, wide = false }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !event.defaultPrevented) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ss-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form
        className={`ss-modal ${wide ? 'is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        noValidate
        onSubmit={(event) => { event.preventDefault(); onSubmit?.(); }}
      >
        <header className="ss-modal-head">
          <h2>{title}</h2>
          <button type="button" className="ss-icon-button" onClick={onClose} aria-label="Close"><Icon name="close" size={17} /></button>
        </header>
        <div className="ss-modal-body">{children}</div>
        <footer className="ss-modal-foot">{footer}</footer>
      </form>
    </div>
  );
}
