import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';
import PersonAvatar from '../common/PersonAvatar';
import { api } from '../../services/api';
import { useAppShell } from '../../context/appShellContext';
import { relativeTimeVi } from '../../services/relativeTime';
import './NotificationBell.css';

const POLL_MS = 30000;
const PAGE_SIZE = 20;

const TYPE_ICON = { assigned: 'user', comment: 'mail', reply: 'mail', task_updated: 'edit' };
const TYPE_LABEL = { assigned: 'Được gán', comment: 'Bình luận', reply: 'Trả lời', task_updated: 'Cập nhật' };

/** Badge text: 1-9, then "9+". */
function badgeText(count) {
  return count > 9 ? '9+' : String(count);
}

/** Message with the actor name and the task ("KEY: title") in bold. */
function MessageText({ item }) {
  const { message } = item;
  const actorName = item.actor?.fullName || item.actor?.name || '';
  const task = item.workItem ? `${item.workItem.key}: ${item.workItem.title}` : '';
  let rest = message;
  const parts = [];
  if (actorName && rest.startsWith(actorName)) {
    parts.push(<strong key="actor">{actorName}</strong>);
    rest = rest.slice(actorName.length);
  }
  const at = task ? rest.indexOf(task) : -1;
  if (at >= 0) {
    parts.push(rest.slice(0, at), <strong key="task" className="nb-task">{task}</strong>, rest.slice(at + task.length));
  } else parts.push(rest);
  return <p className="nb-message">{parts}</p>;
}

function NotificationItem({ item, now, onOpen }) {
  const detail = item.type === 'task_updated'
    ? (item.lines.length > 1 || !['priority', 'status'].includes(item.changes[0]?.field) ? item.lines : [])
    : item.preview ? [`“${item.preview}”`] : [];
  return (
    <li>
      <button type="button" className={`nb-item ${item.isRead ? '' : 'is-unread'}`} onClick={() => onOpen(item)}>
        <span className="nb-avatar-wrap">
          <PersonAvatar person={item.actor} className="nb-avatar" />
          <span className={`nb-type is-${item.type}`} title={TYPE_LABEL[item.type]}><Icon name={TYPE_ICON[item.type] || 'bell'} size={9} /></span>
        </span>
        <span className="nb-body">
          <MessageText item={item} />
          {detail.length > 0 && <span className="nb-detail">{detail.slice(0, 3).map((line) => <span key={line}>{line}</span>)}</span>}
          <time className="nb-time" dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString('vi-VN')}>{relativeTimeVi(item.createdAt, now)}</time>
        </span>
        {!item.isRead && <span className="nb-dot" aria-label="Chưa đọc" />}
      </button>
    </li>
  );
}

/** Header bell: unread badge + popover with the user's notifications. */
export default function NotificationBell() {
  const { openTaskById } = useAppShell();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all'); // all | unread
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [unread, setUnread] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const wrapRef = useRef(null);
  const requestRef = useRef(0);

  const openRef = useRef(false);
  const unreadRef = useRef(0);

  const load = useCallback(async ({ append = false, offset = 0, filter: listFilter } = {}) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const result = await api.getNotifications({ filter: listFilter, limit: PAGE_SIZE, offset });
      if (requestId !== requestRef.current) return;
      setItems((current) => {
        if (!append) return result.items;
        const seen = new Set(current.map((entry) => entry.id));
        return [...current, ...result.items.filter((entry) => !seen.has(entry.id))];
      });
      setHasMore(Boolean(result.hasMore));
      setUnread(result.unreadCount || 0);
      unreadRef.current = result.unreadCount || 0;
      setError('');
    } catch (loadError) {
      if (requestId === requestRef.current) setError(loadError.message || 'Không tải được thông báo.');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  const filterRef = useRef('all');

  // Unread count; when new notifications arrive while the popover is open, the list reloads.
  const refreshCount = useCallback(() => {
    api.getUnreadNotificationCount().then((result) => {
      const count = result?.unreadCount || 0;
      if (openRef.current && count > unreadRef.current) load({ filter: filterRef.current });
      unreadRef.current = count;
      setUnread(count);
    }).catch(() => {});
  }, [load]);

  // On start, every 30 s, and when the browser tab gets focus again.
  useEffect(() => {
    refreshCount();
    const timer = window.setInterval(refreshCount, POLL_MS);
    const onFocus = () => refreshCount();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [refreshCount]);

  // Relative times stay current while the popover is open.
  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [open]);

  function setOpenState(next) {
    openRef.current = next;
    setOpen(next);
    if (next) { setNow(Date.now()); load({ filter }); }
  }

  function changeFilter(next) {
    if (next === filter) return;
    filterRef.current = next;
    setFilter(next);
    setItems([]);
    load({ filter: next });
  }

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (!wrapRef.current?.contains(event.target)) { openRef.current = false; setOpen(false); } };
    // Escape closes only the popover, not a dialog or task drawer underneath it.
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); openRef.current = false; setOpen(false); } };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onPointer); window.removeEventListener('keydown', onKey, true); };
  }, [open]);

  async function openItem(item) {
    setOpenState(false);
    if (!item.isRead) {
      setItems((current) => (filter === 'unread' ? current.filter((entry) => entry.id !== item.id) : current.map((entry) => entry.id === item.id ? { ...entry, isRead: true } : entry)));
      setUnread((count) => Math.max(count - 1, 0));
      unreadRef.current = Math.max(unreadRef.current - 1, 0);
      api.markNotificationRead(item.id).then((result) => setUnread(result?.unreadCount ?? 0)).catch(() => refreshCount());
    }
    if (item.workItem?.id) await openTaskById?.(item.workItem.id);
  }

  async function markAllRead() {
    setItems((current) => (filter === 'unread' ? [] : current.map((entry) => ({ ...entry, isRead: true }))));
    setUnread(0);
    unreadRef.current = 0;
    try { await api.markAllNotificationsRead(); } catch { refreshCount(); load({ filter }); }
  }

  return (
    <div className="nb-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`header-icon-button notification-button ${open ? 'is-open' : ''}`}
        aria-label={unread ? `Thông báo, ${unread} chưa đọc` : 'Thông báo'}
        title="Thông báo"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpenState(!open)}
      >
        <Icon name="bell" size={19} />
        {unread > 0 && <span className="notification-badge" data-testid="notification-badge">{badgeText(unread)}</span>}
      </button>

      {open && (
        <section className="nb-popover" role="dialog" aria-label="Thông báo">
          <header className="nb-head">
            <h2>Thông báo</h2>
            <button type="button" className="nb-mark-all" onClick={markAllRead} disabled={!unread}>
              <Icon name="check" size={13} /> Đánh dấu tất cả đã đọc
            </button>
          </header>
          <div className="nb-tabs" role="tablist" aria-label="Lọc thông báo">
            {[['all', 'Tất cả'], ['unread', 'Chưa đọc']].map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => changeFilter(value)}>
                {label}{value === 'unread' && unread > 0 && <span className="nb-tab-count">{badgeText(unread)}</span>}
              </button>
            ))}
          </div>

          <div className="nb-scroll">
            {error && <p className="nb-state is-error">{error}</p>}
            {!error && !items.length && loading && <p className="nb-state">Đang tải…</p>}
            {!error && !items.length && !loading && (
              <div className="nb-empty">
                <span><Icon name="bell" size={22} /></span>
                <strong>{filter === 'unread' ? 'Bạn đã đọc hết thông báo' : 'Chưa có thông báo nào'}</strong>
                <small>Bạn sẽ được báo khi được gán việc, có bình luận hoặc công việc thay đổi.</small>
              </div>
            )}
            {items.length > 0 && (
              <ul className="nb-list">
                {items.map((item) => <NotificationItem key={item.id} item={item} now={now} onOpen={openItem} />)}
              </ul>
            )}
            {hasMore && items.length > 0 && (
              <button type="button" className="nb-more" disabled={loading} onClick={() => load({ append: true, offset: items.length, filter })}>
                {loading ? 'Đang tải…' : 'Xem thêm'}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
