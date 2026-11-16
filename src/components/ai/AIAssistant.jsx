import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../common/Icon';
import PriorityIcon from '../common/PriorityIcon';
import { useAppShell } from '../../context/appShellContext';
import { api } from '../../services/api';
import { canInSpace } from '../../services/projectPermissions';
import './AIAssistant.css';

const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
const ISSUE_TYPES = ['Task', 'Bug', 'Story', 'Feature', 'Improvement', 'Epic'];
const QUICK_PROMPTS = [
  { id: 'review', label: 'Đánh giá & rà soát lại Priority', icon: 'flag' },
  { id: 'plan', label: 'Lập kế hoạch thực hiện công việc', icon: 'workflow' },
  { id: 'suggest', label: 'Tạo đề xuất task từ mô tả', icon: 'plus' }
];
const INTENT_LABELS = {
  review: 'Đánh giá & rà soát lại Priority',
  plan: 'Lập kế hoạch thực hiện công việc',
  risks: 'Cảnh báo rủi ro',
  workload: 'Phân bổ công việc theo người',
  mine: 'Việc của tôi',
  help: 'Bạn làm được gì?'
};
const EXAMPLES = ['Việc nào có nguy cơ trễ hạn?', 'Ai đang quá tải?', 'Việc của tôi nên làm gì trước?', 'Bạn làm được gì?'];
const STORE_LIMIT = 40;
const HISTORY_LIMIT = 8;

// ---- per-project conversation memory (this browser only) ----------------------------------
function storeKey(userId, spaceId) {
  return `taskflow.ai.${userId || 'anon'}.${spaceId}`;
}
function loadConversation(userId, spaceId) {
  try {
    const stored = JSON.parse(localStorage.getItem(storeKey(userId, spaceId)) || '[]');
    return Array.isArray(stored) ? stored.map((message) => ({ ...message, restored: true })) : [];
  } catch {
    return [];
  }
}
function saveConversation(userId, spaceId, messages) {
  try {
    const kept = messages.filter((message) => !message.pending).slice(-STORE_LIMIT).map((message) => {
      const copy = { ...message };
      delete copy.restored;
      return copy;
    });
    if (kept.length) localStorage.setItem(storeKey(userId, spaceId), JSON.stringify(kept));
    else localStorage.removeItem(storeKey(userId, spaceId));
  } catch {
    // Storage full or blocked: the conversation simply is not remembered.
  }
}

function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Safe rendering of the assistant's text: paragraphs, "- " and "1. " lists, "### " headings,
 * **bold**, _italic_, `code`, and work item keys of the project as links.
 */
function RichText({ text, keyIndex, onOpenKey }) {
  const blocks = [];
  let list = null;
  String(text || '').split('\n').forEach((line, index) => {
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered && !bullet);
      if (!list || list.ordered !== ordered) { list = { type: 'list', ordered, items: [], key: `l${index}` }; blocks.push(list); }
      list.items.push(bullet ? bullet[1] : numbered[2]);
      return;
    }
    list = null;
    const heading = line.match(/^\s*#{1,4}\s+(.*)$/);
    if (heading) blocks.push({ type: 'h', text: heading[1], key: `h${index}` });
    else if (line.trim()) blocks.push({ type: 'p', text: line, key: `p${index}` });
  });

  const withKeys = (value, prefix) => value.split(/\b([A-Z][A-Z0-9]{0,9}-\d{1,6})\b/g).map((part, index) => {
    const task = keyIndex.get(part);
    return task
      ? <button type="button" key={`${prefix}-${index}`} className="ai-key" onClick={() => onOpenKey(task)} title={`Mở ${part}: ${task.title || task.summary || ''}`}>{part}</button>
      : <span key={`${prefix}-${index}`}>{part}</span>;
  });
  const inline = (value) => value.split(/(\*\*[^*]+\*\*|`[^`]+`|(?<![\w])_[^_]+_(?![\w]))/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{withKeys(part.slice(2, -2), index)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (/^_[^_]+_$/.test(part)) return <em key={index}>{withKeys(part.slice(1, -1), index)}</em>;
    return <span key={index}>{withKeys(part, index)}</span>;
  });

  return (
    <div className="ai-rich">
      {blocks.map((block) => {
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return <Tag key={block.key}>{block.items.map((item, index) => <li key={index}>{inline(item)}</li>)}</Tag>;
        }
        if (block.type === 'h') return <h4 key={block.key}>{inline(block.text)}</h4>;
        return <p key={block.key}>{inline(block.text)}</p>;
      })}
    </div>
  );
}

function PriorityBadge({ value }) {
  return <span className={`ai-priority is-${String(value).toLowerCase()}`}><PriorityIcon priority={value} size={13} />{value}</span>;
}

function KeyButton({ itemKey, keyIndex, onOpenKey }) {
  const task = keyIndex.get(itemKey);
  if (!task) return <strong>{itemKey}</strong>;
  return <button type="button" className="ai-key" onClick={() => onOpenKey(task)} title={`Mở ${itemKey}`}>{itemKey}</button>;
}

/** Priority proposals with selection and "Cập nhật Priority ngay". */
function ProposalCard({ proposals, onApply, keyIndex, onOpenKey }) {
  const [selected, setSelected] = useState(() => new Set(proposals.filter((item) => item.canApply && !item.applied).map((item) => item.taskId)));
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const applicable = proposals.filter((item) => item.canApply && !item.applied);
  const toggle = (id) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  async function apply() {
    setBusy(true);
    await onApply(proposals.filter((item) => selected.has(item.taskId)));
    setSelected(new Set());
    setBusy(false);
  }

  return (
    <div className="ai-card" aria-label="Priority proposals">
      <div className="ai-card-head">
        <strong><Icon name="flag" size={14} /> Đề xuất điều chỉnh Priority</strong>
        <span>{proposals.length} công việc</span>
      </div>
      <div className="ai-proposals">
        {proposals.map((item) => (
          <div key={item.taskId} className={`ai-proposal ${item.applied ? 'is-applied' : ''}`}>
            <div className="ai-proposal-main">
              <input
                type="checkbox"
                checked={selected.has(item.taskId)}
                disabled={!item.canApply || item.applied}
                onChange={() => toggle(item.taskId)}
                aria-label={`Apply ${item.key}`}
              />
              <span className="ai-proposal-text">
                <span><KeyButton itemKey={item.key} keyIndex={keyIndex} onOpenKey={onOpenKey} /> <span className="ai-proposal-title">{item.title}</span></span>
                <span className="ai-change">
                  <PriorityBadge value={item.currentPriority} />
                  <span className={`ai-arrow ${item.direction}`} aria-hidden="true">➔</span>
                  <PriorityBadge value={item.newPriority} />
                  {item.applied && <span className="ai-applied"><Icon name="check" size={12} /> Đã cập nhật</span>}
                  {!item.canApply && !item.applied && <span className="ai-locked" title='Bạn không có quyền "Update task"'><Icon name="lock" size={11} /> Không có quyền</span>}
                </span>
              </span>
            </div>
            <button type="button" className="ai-why" onClick={() => setOpen(open === item.taskId ? null : item.taskId)} aria-expanded={open === item.taskId}>
              Lý do <Icon name="chevron" size={11} />
            </button>
            {open === item.taskId && (
              <ul className="ai-reasons">
                {item.reasons.map((reason, index) => <li key={index}><span className={`ai-pillar is-${reason.pillar}`}>{reason.label}</span>{reason.text}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
      {applicable.length > 0 && (
        <div className="ai-card-foot">
          <button type="button" className="ai-link" onClick={() => setSelected(selected.size === applicable.length ? new Set() : new Set(applicable.map((item) => item.taskId)))}>
            {selected.size === applicable.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
          </button>
          <button type="button" className="ai-button is-primary" disabled={!selected.size || busy} onClick={apply}>
            <Icon name="check" size={14} /> {busy ? 'Đang cập nhật…' : `Cập nhật Priority ngay (${selected.size})`}
          </button>
        </div>
      )}
    </div>
  );
}

/** Execution plan as a timeline grouped by phase. */
function PlanCard({ plan, keyIndex, onOpenKey }) {
  const total = plan.reduce((sum, phase) => sum + phase.steps.length, 0);
  return (
    <div className="ai-card" aria-label="Execution plan">
      <div className="ai-card-head">
        <strong><Icon name="workflow" size={14} /> Kế hoạch thực hiện</strong>
        <span>{total} công việc</span>
      </div>
      <div className="ai-plan">
        {plan.map((phase) => (
          <section key={phase.id} className={`ai-phase is-${phase.id}`}>
            <h5><span className="ai-phase-dot" aria-hidden="true" />{phase.title} <small>{phase.steps.length}</small></h5>
            <ol>
              {phase.steps.map((step) => (
                <li key={step.taskId}>
                  <span className="ai-step-order">{step.order}</span>
                  <span className="ai-step-body">
                    <span className="ai-step-title"><KeyButton itemKey={step.key} keyIndex={keyIndex} onOpenKey={onOpenKey} /> {step.title}</span>
                    <span className="ai-step-meta">
                      <PriorityBadge value={step.priority} />
                      {step.dueDate && <span className="ai-chip"><Icon name="calendar" size={11} /> {step.dueDate}</span>}
                      {step.assignee && <span className="ai-chip"><Icon name="user" size={11} /> {step.assignee}</span>}
                      {step.notes.map((note) => <span key={note} className="ai-chip is-note">{note}</span>)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

function RiskCard({ risks, keyIndex, onOpenKey }) {
  const labels = { high: 'Cao', medium: 'Trung bình', low: 'Thấp' };
  return (
    <div className="ai-card" aria-label="Risks">
      <div className="ai-card-head">
        <strong><Icon name="info" size={14} /> Rủi ro</strong>
        <span>{risks.length} cảnh báo</span>
      </div>
      <ul className="ai-risks">
        {risks.slice(0, 20).map((risk, index) => (
          <li key={`${risk.taskId}-${index}`} className={`is-${risk.level}`}>
            <span className="ai-risk-level">{labels[risk.level]}</span>
            <span className="ai-risk-text">
              <KeyButton itemKey={risk.key} keyIndex={keyIndex} onOpenKey={onOpenKey} /> {risk.text.replace(`${risk.key} `, '')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorkloadCard({ workload }) {
  const max = Math.max(1, ...workload.map((person) => person.open));
  return (
    <div className="ai-card" aria-label="Workload">
      <div className="ai-card-head">
        <strong><Icon name="users" size={14} /> Phân bổ công việc</strong>
        <span>{workload.filter((person) => person.assigneeId).length} người</span>
      </div>
      <ul className="ai-workload">
        {workload.map((person) => (
          <li key={person.assigneeId || 'unassigned'} className={`${person.overloaded ? 'is-overloaded' : ''} ${person.assigneeId ? '' : 'is-unassigned'}`}>
            <span className="ai-person">{person.name}{person.overloaded && <span className="ai-overload">Quá tải</span>}</span>
            <span className="ai-bar" aria-hidden="true">
              <span className="ai-bar-fill" style={{ width: `${(person.open / max) * 100}%` }} />
              <span className="ai-bar-urgent" style={{ width: `${(person.urgent / max) * 100}%` }} />
            </span>
            <span className="ai-person-stats">{person.open} việc{person.urgent ? ` · ${person.urgent} gấp` : ''}{person.overdue ? ` · ${person.overdue} quá hạn` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Suggested work item: editable, then "Tạo task vào Project". */
function SuggestionCard({ suggestion, space, onCreate }) {
  const [values, setValues] = useState({
    title: suggestion.title,
    description: suggestion.description,
    issueType: ISSUE_TYPES.includes(suggestion.issueType) ? suggestion.issueType : 'Task',
    priority: suggestion.priority,
    dueDate: suggestion.dueDate || ''
  });
  const [state, setState] = useState({ busy: false, created: suggestion.createdKey ? { key: suggestion.createdKey } : null, error: '' });
  const set = (name) => (event) => setValues((current) => ({ ...current, [name]: event.target.value }));

  async function create() {
    if (!values.title.trim()) { setState({ busy: false, created: null, error: 'Tiêu đề không được để trống.' }); return; }
    setState({ busy: true, created: null, error: '' });
    const created = await onCreate(values);
    setState(created ? { busy: false, created, error: '' } : { busy: false, created: null, error: 'Không tạo được công việc (xem thông báo lỗi).' });
  }

  return (
    <div className="ai-card" aria-label="Task suggestion">
      <div className="ai-card-head">
        <strong><Icon name="sparkles" size={14} /> Đề xuất task mới</strong>
        <span>{space?.name}</span>
      </div>
      <div className="ai-suggest">
        <label className="ai-field ai-span-2"><span>Tiêu đề</span><input value={values.title} onChange={set('title')} maxLength={200} disabled={Boolean(state.created)} /></label>
        <label className="ai-field"><span>Loại công việc</span>
          <select value={values.issueType} onChange={set('issueType')} disabled={Boolean(state.created)}>{ISSUE_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
        </label>
        <label className="ai-field"><span>Priority</span>
          <select value={values.priority} onChange={set('priority')} disabled={Boolean(state.created)}>{PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}</select>
        </label>
        <label className="ai-field"><span>Due date</span><input type="date" value={values.dueDate} onChange={set('dueDate')} disabled={Boolean(state.created)} /></label>
        <label className="ai-field ai-span-2"><span>Mô tả</span><textarea rows={3} value={values.description} onChange={set('description')} disabled={Boolean(state.created)} /></label>
      </div>
      {suggestion.reasons?.length > 0 && (
        <ul className="ai-reasons is-inline">
          {suggestion.reasons.map((reason, index) => <li key={index}><span className={`ai-pillar is-${reason.pillar}`}>{reason.label}</span>{reason.text}</li>)}
        </ul>
      )}
      <div className="ai-card-foot">
        {state.error && <span className="ai-error" role="alert">{state.error}</span>}
        {state.created ? (
          <span className="ai-applied"><Icon name="check" size={12} /> Đã tạo {state.created.key}</span>
        ) : suggestion.canCreate === false ? (
          <span className="ai-locked"><Icon name="lock" size={11} /> Bạn không có quyền "Create task" trong project này</span>
        ) : (
          <button type="button" className="ai-button is-primary" disabled={state.busy} onClick={create}>
            <Icon name="plus" size={14} /> {state.busy ? 'Đang tạo…' : 'Tạo task vào Project'}
          </button>
        )}
      </div>
    </div>
  );
}

/** First paragraph only: used when a card already shows the details (rules-engine answers). */
function summaryOf(text) {
  return String(text || '').split('\n').filter((line) => line.trim())[0] || '';
}

/**
 * AI Project Assistant: a side drawer that reads the work items of a project (all of
 * them or the chosen ones) and reviews priorities, plans the work, flags risks, shows the
 * workload and suggests new work items. Actions run only when the user presses their buttons.
 * The conversation of each project is remembered in this browser.
 */
export default function AIAssistant({ initialSpaceId = null, initialTaskIds = [], spaces = [], tasks = [], onClose = () => {} }) {
  const { user, replaceWorkItem, createTask, openTask } = useAppShell();
  const firstSpace = spaces.find((space) => String(space.id) === String(initialSpaceId)) || spaces[0] || null;
  const [spaceId, setSpaceId] = useState(firstSpace?.id || '');
  const [scope, setScope] = useState(initialTaskIds.length ? 'selected' : 'all');
  const [selectedIds, setSelectedIds] = useState(() => new Set(initialTaskIds));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [taskQuery, setTaskQuery] = useState('');
  const [messages, setMessages] = useState(() => (firstSpace ? loadConversation(user?.id, firstSpace.id) : []));
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('chat'); // chat | suggest
  const [busy, setBusy] = useState(false);
  const [wide, setWide] = useState(false);
  const [copied, setCopied] = useState(null);
  const [provider, setProvider] = useState(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  const space = spaces.find((item) => String(item.id) === String(spaceId)) || null;
  const projectTasks = useMemo(() => tasks.filter((task) => String(task.spaceId ?? task.projectId) === String(spaceId)), [tasks, spaceId]);
  const keyIndex = useMemo(() => new Map(projectTasks.map((task) => [String(task.key || '').toUpperCase(), task])), [projectTasks]);
  const visibleTasks = projectTasks.filter((task) => !taskQuery.trim() || `${task.key} ${task.title || task.summary}`.toLowerCase().includes(taskQuery.trim().toLowerCase()));
  const selectedInProject = projectTasks.filter((task) => selectedIds.has(String(task.id)));

  useEffect(() => {
    let active = true;
    api.aiStatus().then((status) => { if (active) setProvider(status.provider); }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !event.defaultPrevented) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy]);

  // Remember the conversation of this project.
  useEffect(() => {
    if (spaceId) saveConversation(user?.id, spaceId, messages);
  }, [messages, spaceId, user]);

  // Stop a running request when the drawer closes.
  useEffect(() => () => abortRef.current?.abort(), []);

  const scopeLabel = scope === 'selected' && selectedInProject.length ? `${selectedInProject.length} công việc đã chọn` : 'Toàn bộ Project';

  function push(message) {
    setMessages((current) => [...current, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString(), ...message }]);
  }

  function historyFor() {
    return messages.filter((message) => !message.error && message.text).slice(-HISTORY_LIMIT).map((message) => ({ role: message.role, text: message.text }));
  }

  function switchProject(nextId) {
    abortRef.current?.abort();
    setSpaceId(nextId);
    setSelectedIds(new Set());
    setScope('all');
    setMessages(loadConversation(user?.id, nextId));
  }

  function openKey(task) {
    onClose();
    openTask(task);
  }

  async function run(request, label) {
    if (!space || busy) return;
    if (request.kind === 'chat' && scope === 'selected' && !selectedInProject.length) {
      push({ role: 'assistant', text: 'Hãy chọn ít nhất một công việc, hoặc chuyển sang **Toàn bộ Project**.' });
      return;
    }
    push({ role: 'user', text: label, scopeLabel: request.kind === 'suggest' ? 'Đề xuất task' : scopeLabel });
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (request.kind === 'suggest') {
        const result = await api.aiSuggestTask({ projectId: space.id, description: request.payload.description, history: historyFor() }, { signal: controller.signal });
        push({ role: 'assistant', text: result.reply, result: { suggestion: result, provider: result.provider, followUps: [{ intent: 'suggest', label: 'Đề xuất task khác' }, { intent: 'review', label: 'Đánh giá Priority' }] }, request });
      } else {
        const result = await api.aiChat({
          projectId: space.id,
          selectedTaskIds: scope === 'selected' ? selectedInProject.map((task) => task.id) : [],
          message: request.payload.message || '',
          intent: request.payload.intent || null,
          history: historyFor()
        }, { signal: controller.signal });
        if (result.provider) setProvider(result.provider);
        (result.applied?.updated || []).forEach((item) => replaceWorkItem(item));
        push({ role: 'assistant', text: result.reply, result, request });
      }
    } catch (error) {
      if (error.name === 'AbortError') push({ role: 'assistant', text: 'Đã dừng.', stopped: true, request });
      else push({ role: 'assistant', text: `Không thể xử lý yêu cầu: ${error.message}`, error: true, request });
    } finally {
      abortRef.current = null;
      setBusy(false);
      setMode('chat');
    }
  }

  const ask = ({ message = '', intent = null }) => run({ kind: 'chat', payload: { message, intent } }, message || INTENT_LABELS[intent] || '');
  const suggest = (description) => run({ kind: 'suggest', payload: { description } }, description);

  function send(event) {
    event?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (mode === 'suggest') suggest(text);
    else ask({ message: text });
  }

  function quick(intent) {
    if (intent === 'suggest') {
      if (input.trim()) { const text = input.trim(); setInput(''); suggest(text); return; }
      setMode('suggest');
      inputRef.current?.focus();
      return;
    }
    ask({ intent });
  }

  async function copy(message) {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(message.id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  async function applyProposals(messageId, proposals) {
    try {
      const result = await api.aiApplyPriority(proposals.map((item) => ({ taskId: item.taskId, newPriority: item.newPriority })));
      result.updated.forEach((item) => replaceWorkItem(item));
      const done = new Set(result.updated.map((item) => item.id));
      setMessages((current) => current.map((message) => (message.id === messageId
        ? { ...message, result: { ...message.result, proposals: message.result.proposals.map((item) => (done.has(item.taskId) ? { ...item, applied: true } : item)) } }
        : message)));
      push({
        role: 'assistant',
        text: [
          result.updated.length ? `Đã cập nhật Priority cho **${result.updated.length}** công việc: ${result.updated.map((item) => `${item.key} ➔ ${item.priority}`).join(', ')}.` : 'Không có Priority nào được cập nhật.',
          ...result.skipped.map((item) => `- ${item.key || item.taskId}: ${item.reason}`)
        ].join('\n')
      });
    } catch (error) {
      push({ role: 'assistant', text: `Không cập nhật được Priority: ${error.message}`, error: true });
    }
  }

  async function createFromSuggestion(messageId, values) {
    const created = await createTask({
      spaceId: space.id,
      issueType: values.issueType,
      title: values.title.trim(),
      summary: values.title.trim(),
      description: values.description,
      priority: values.priority,
      dueDate: values.dueDate || null,
      attachments: [],
      links: []
    });
    if (created) {
      setMessages((current) => current.map((message) => (message.id === messageId
        ? { ...message, result: { ...message.result, suggestion: { ...message.result.suggestion, createdKey: created.key } } }
        : message)));
      push({ role: 'assistant', text: `Đã tạo ${created.key} ${created.title} trong ${space.name}.` });
    }
    return created;
  }

  const canCreateHere = space ? canInSpace(space, 'task.create', null, user) : false;
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');

  return (
    <div className="ai-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className={`ai-drawer ${wide ? 'is-wide' : ''}`} role="dialog" aria-modal="true" aria-label="AI Project Assistant">
        <header className="ai-head">
          <span className="ai-logo"><Icon name="sparkles" size={18} /></span>
          <div className="ai-head-text">
            <h2>AI Project Assistant</h2>
            <small title={provider?.note || ''}>
              <span className={`ai-engine-dot ${provider?.name === 'rules' ? 'is-rules' : provider ? 'is-llm' : ''}`} aria-hidden="true" />
              {provider ? `Engine: ${provider.label}` : 'Đang kết nối…'}
            </small>
          </div>
          <button type="button" className="ai-icon-button" onClick={() => setWide((value) => !value)} aria-label={wide ? 'Thu nhỏ' : 'Mở rộng'} title={wide ? 'Thu nhỏ' : 'Mở rộng'}><Icon name={wide ? 'minimize' : 'maximize'} size={15} /></button>
          <button type="button" className="ai-icon-button" onClick={() => { abortRef.current?.abort(); setMessages([]); }} disabled={!messages.length} aria-label="New conversation" title="Cuộc trò chuyện mới"><Icon name="refresh" size={15} /></button>
          <button type="button" className="ai-icon-button" onClick={onClose} aria-label="Close AI assistant" title="Đóng"><Icon name="close" size={16} /></button>
        </header>

        {!spaces.length ? (
          <div className="ai-empty-state"><Icon name="spaces" size={26} /><strong>Chưa có project nào</strong><span>Tạo hoặc tham gia một project để dùng trợ lý AI.</span></div>
        ) : (
          <>
            <section className="ai-context" aria-label="Phạm vi phân tích">
              <label className="ai-field">
                <span>Project</span>
                <select value={spaceId} onChange={(event) => switchProject(event.target.value)} aria-label="Project">
                  {spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <div className="ai-scope" role="radiogroup" aria-label="Phạm vi công việc">
                <button type="button" role="radio" aria-checked={scope === 'all'} className={scope === 'all' ? 'is-on' : ''} onClick={() => { setScope('all'); setPickerOpen(false); }}>
                  Toàn bộ Project <span>{projectTasks.length}</span>
                </button>
                <button type="button" role="radio" aria-checked={scope === 'selected'} className={scope === 'selected' ? 'is-on' : ''} onClick={() => { setScope('selected'); setPickerOpen(true); }}>
                  Chọn công việc <span>{selectedInProject.length}</span>
                </button>
                {scope === 'selected' && (
                  <button type="button" className="ai-link" onClick={() => setPickerOpen((value) => !value)} aria-expanded={pickerOpen}>{pickerOpen ? 'Thu gọn' : 'Sửa danh sách'}</button>
                )}
              </div>
              {scope === 'selected' && pickerOpen && (
                <div className="ai-picker">
                  <label className="ai-search"><Icon name="search" size={13} /><input value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="Tìm theo mã hoặc tiêu đề" aria-label="Tìm công việc" /></label>
                  <div className="ai-picker-list" role="group" aria-label="Công việc">
                    {visibleTasks.length ? visibleTasks.map((task) => (
                      <label key={task.id} className={`ai-picker-item ${selectedIds.has(String(task.id)) ? 'is-on' : ''}`}>
                        <input type="checkbox" checked={selectedIds.has(String(task.id))} onChange={() => setSelectedIds((current) => { const next = new Set(current); const id = String(task.id); if (next.has(id)) next.delete(id); else next.add(id); return next; })} />
                        <strong>{task.key}</strong>
                        <span>{task.title || task.summary}</span>
                        <PriorityIcon priority={task.priority} size={13} />
                      </label>
                    )) : <div className="ai-picker-empty">{projectTasks.length ? 'Không có công việc phù hợp.' : 'Project chưa có công việc.'}</div>}
                  </div>
                  <div className="ai-picker-foot">
                    <button type="button" className="ai-link" onClick={() => setSelectedIds((current) => new Set([...current, ...visibleTasks.map((task) => String(task.id))]))}>Chọn tất cả</button>
                    <button type="button" className="ai-link" onClick={() => setSelectedIds(new Set())}>Bỏ chọn</button>
                  </div>
                </div>
              )}
            </section>

            <div className="ai-quick" aria-label="Lệnh nhanh">
              {QUICK_PROMPTS.map((prompt) => (
                <button key={prompt.id} type="button" onClick={() => quick(prompt.id)} disabled={busy || (prompt.id === 'suggest' && !canCreateHere)} title={prompt.id === 'suggest' && !canCreateHere ? 'Bạn không có quyền "Create task" trong project này' : undefined}>
                  <Icon name={prompt.icon} size={14} /> {prompt.label}
                </button>
              ))}
            </div>

            <div className="ai-messages" ref={listRef} aria-live="polite">
              {!messages.length && (
                <div className="ai-welcome">
                  <strong>Xin chào{user?.fullName ? ` ${user.fullName}` : ''}!</strong>
                  <p>Tôi đọc công việc của <b>{space?.name}</b> ({scopeLabel.toLowerCase()}) để đánh giá Priority theo 3 trụ cột (ảnh hưởng, tính chất, thời gian), lập kế hoạch, cảnh báo rủi ro, xem phân bổ công việc và đề xuất task mới.</p>
                  <p>Bạn có thể hỏi bằng tiếng Việt có dấu hoặc không dấu, hoặc nhắc mã công việc (ví dụ <code>{projectTasks[0]?.key || 'ABC-1'}</code>). Thử:</p>
                  <div className="ai-examples">
                    {EXAMPLES.map((example) => <button key={example} type="button" onClick={() => ask({ message: example })} disabled={busy}>{example}</button>)}
                  </div>
                </div>
              )}
              {messages.length > 0 && messages[0].restored && (
                <div className="ai-divider"><span>Cuộc trò chuyện trước</span></div>
              )}
              {messages.map((message) => {
                const result = message.result || {};
                const hasCard = (result.plan?.length || (result.intent === 'risks' && result.risks?.length) || result.workload?.length || result.proposals?.length) > 0;
                const compact = hasCard && result.provider?.name === 'rules' && !result.applied && result.intent !== 'task';
                return (
                  <div key={message.id} className={`ai-message is-${message.role} ${message.error ? 'is-error' : ''} ${message.stopped ? 'is-stopped' : ''}`}>
                    {message.role === 'user' ? (
                      <>
                        <div className="ai-bubble">{message.text}</div>
                        <small className="ai-meta">{[message.scopeLabel, timeLabel(message.at)].filter(Boolean).join(' · ')}</small>
                      </>
                    ) : (
                      <>
                        <div className="ai-bubble"><RichText text={compact ? summaryOf(message.text) : message.text} keyIndex={keyIndex} onOpenKey={openKey} /></div>
                        {result.provider?.note && <small className="ai-meta">{result.provider.note} — đã dùng bộ quy tắc.</small>}
                        {result.proposals?.length > 0 && <ProposalCard proposals={result.proposals} onApply={(selected) => applyProposals(message.id, selected)} keyIndex={keyIndex} onOpenKey={openKey} />}
                        {result.plan?.length > 0 && <PlanCard plan={result.plan} keyIndex={keyIndex} onOpenKey={openKey} />}
                        {result.workload?.length > 0 && <WorkloadCard workload={result.workload} />}
                        {result.risks?.length > 0 && result.intent === 'risks' && <RiskCard risks={result.risks} keyIndex={keyIndex} onOpenKey={openKey} />}
                        {result.suggestion && <SuggestionCard suggestion={result.suggestion} space={space} onCreate={(values) => createFromSuggestion(message.id, values)} />}
                        <div className="ai-actions">
                          <small className="ai-meta">{timeLabel(message.at)}</small>
                          <button type="button" onClick={() => copy(message)} aria-label="Sao chép câu trả lời" title="Sao chép"><Icon name={copied === message.id ? 'check' : 'copy'} size={12} /></button>
                          {message.request && <button type="button" onClick={() => run(message.request, message.request.kind === 'suggest' ? message.request.payload.description : (message.request.payload.message || INTENT_LABELS[message.request.payload.intent] || ''))} disabled={busy} aria-label="Thử lại" title="Thử lại"><Icon name="refresh" size={12} /></button>}
                        </div>
                        {message === lastAssistant && !busy && result.followUps?.length > 0 && (
                          <div className="ai-followups" aria-label="Gợi ý tiếp theo">
                            {result.followUps.map((item) => (
                              <button key={item.intent} type="button" onClick={() => quick(item.intent)} disabled={item.intent === 'suggest' && !canCreateHere}>{item.label}</button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {busy && (
                <div className="ai-message is-assistant">
                  <div className="ai-bubble ai-typing" aria-label="Đang phân tích"><span /><span /><span /></div>
                </div>
              )}
            </div>

            <form className="ai-composer" onSubmit={send}>
              {mode === 'suggest' && (
                <div className="ai-mode">
                  <Icon name="sparkles" size={13} /> Mô tả công việc cần tạo, tôi sẽ đề xuất tiêu đề, loại và Priority.
                  <button type="button" className="ai-link" onClick={() => setMode('chat')}>Hủy</button>
                </div>
              )}
              <div className="ai-input-row">
                <textarea
                  ref={inputRef}
                  rows={Math.min(6, Math.max(2, input.split('\n').length))}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) send(event); }}
                  placeholder={mode === 'suggest' ? 'VD: Lỗi không đăng nhập được bằng Google trên production, cần xong trước ngày mai' : 'Hỏi về project, ví dụ: ai đang quá tải? / phân tích ' + (projectTasks[0]?.key || 'ABC-1')}
                  aria-label={mode === 'suggest' ? 'Mô tả công việc' : 'Tin nhắn cho trợ lý AI'}
                  disabled={!space}
                />
                {busy ? (
                  <button type="button" className="ai-send is-stop" onClick={() => abortRef.current?.abort()} aria-label="Dừng" title="Dừng"><span className="ai-stop-icon" /></button>
                ) : (
                  <button type="submit" className="ai-send" disabled={!input.trim()} aria-label="Gửi"><Icon name="arrowLeft" size={16} /></button>
                )}
              </div>
              <small className="ai-hint">Enter để gửi · Shift+Enter xuống dòng · Bấm vào mã công việc để mở</small>
            </form>
          </>
        )}
      </aside>
    </div>
  );
}
