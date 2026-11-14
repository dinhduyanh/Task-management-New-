import { useEffect, useRef } from 'react';
import './Toast.css';

/** Bottom-right notification. `toast` is { type: 'success' | 'error' | 'info', message } or null. */
export default function Toast({ toast, onClose, duration = 4500 }) {
  // Callers usually pass an inline onClose; keep the latest one without restarting the timer.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => closeRef.current?.(), duration);
    return () => clearTimeout(timer);
  }, [toast, duration]);

  if (!toast) return null;
  return (
    <div className={`tf-toast is-${toast.type || 'info'}`} role={toast.type === 'error' ? 'alert' : 'status'}>
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss">×</button>
    </div>
  );
}
