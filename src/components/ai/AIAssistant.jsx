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

/** Minimal, safe rendering of the assistant's text: paragraphs, "- " lists and **bold**. */
function RichText({ text }) {
  const blocks = [];
  let list = null;
  String(text || '').split('\n').forEach((line, index) => {
    const bullet = line.match(/^\s*[-•]\s+(.*)$/);
    if (bullet) {
      if (!list) { list = []; blocks.push({ type: 'list', items: list, key: `l${index}` }); }
      list.push(bullet[1]);
      return;
    }
    list = null;
    if (line.trim()) blocks.push({ type: 'p', text: line, key: `p${index}` });
  });
  const inline = (value) => value.split(/(\*\*[^*]+\*\*)/g).map((part, index) => (
    part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <span key={index}>{part}</span>
  ));
  return (
    <div className="ai-rich">
      {blocks.map((block) => (block.type === 'list'
        ? <ul key={block.key}>{block.items.map((item, index) => <li key={index}>{inline(item)}</li>)}</ul>
        : <p key={block.key}>{inline(block.text)}</p>))}
    </div>
  );
}

function PriorityBadge({ value }) {
  return <span className={`ai-priority is-${String(value).toLowerCase()}`}><PriorityIcon priority={value} size={13} />{value}</span>;
}

/** Priority proposals with selection and "Cập nhật Priority ngay". */
function ProposalCard({ proposals, onApply }) {
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
            <label className="ai-proposal-main">
              <input
                type="checkbox"
                checked={selected.has(item.taskId)}
                disabled={!item.canApply || item.applied}
                onChange={() => toggle(item.taskId)}
                aria-label={`Apply ${item.key}`}
              />
              <span className="ai-proposal-text">
                <strong>{item.key}</strong> <span className="ai-proposal-title">{item.title}</span>
                <span className="ai-change">
                  <PriorityBadge value={item.currentPriority} />
                  <span className={`ai-arrow ${item.direction}`} aria-hidden="true">➔</span>
                  <PriorityBadge value={item.newPriority} />
                  {item.applied && <span className="ai-applied"><Icon name="check" size={12} /> Đã cập nhật</span>}
                  {!item.canApply && !item.applied && <span className="ai-locked" title='Bạn không có quyền "Update task"'><Icon name="lock" size={11} /> Không có quyền</span>}
                </span>
              </span>
            </label>
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

/** Suggested work item: editable, then "Tạo task vào Project". */
function SuggestionCard({ suggestion, space, onCreate }) {
  const [values, setValues] = useState({
    title: suggestion.title,
    description: suggestion.description,
    issueType: ISSUE_TYPES.includes(suggestion.issueType) ? suggestion.issueType : 'Task',
    priority: suggestion.priority,
    dueDate: suggestion.dueDate || ''
  });
  const [state, setState] = useState({ busy: false, created: null, error: '' });
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

/**
 * AI Project Assistant: a side drawer that reads the work items of a project (all of
 * them or the chosen ones) and reviews priorities, plans the work, flags risks and
 * suggests new work items. Actions run only when the user presses their buttons.
 */
export default function AIAssistant({ initialSpaceId = null, initialTaskIds = [], spaces = [], tasks = [], onClose = () => {} }) {
  const { user, replaceWorkItem, createTask } = useAppShell();
  const firstSpace = spaces.find((space) => String(space.id) === String(initialSpaceId)) || spaces[0] || null;
  const [spaceId, setSpaceId] = useState(firstSpace?.id || '');
  const [scope, setScope] = useState(initialTaskIds.length ? 'selected' : 'all');
  const [selectedIds, setSelectedIds] = useState(() => new Set(initialTaskIds));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [taskQuery, setTaskQuery] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('chat'); // chat | suggest
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const space = spaces.find((item) => String(item.id) === String(spaceId)) || null;
  const projectTasks = useMemo(() => tasks.filter((task) => String(task.spaceId ?? task.projectId) === String(spaceId)), [tasks, spaceId]);
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

  const scopeLabel = scope === 'selected' && selectedInProject.length
    ? `${selectedInProject.length} công việc đã chọn`
    : 'Toàn bộ Project';

  function push(message) {
    setMessages((current) => [...current, { id: `${Date.now()}-${current.length}`, ...message }]);
  }

  async function ask({ message = '', intent = null }) {
    if (!space || busy) return;
    if (scope === 'selected' && !selectedInProject.length) {
      push({ role: 'assistant', text: 'Hãy chọn ít nhất một công việc, hoặc chuyển sang **Toàn bộ Project**.' });
      return;
    }
    push({ role: 'user', text: message || QUICK_PROMPTS.find((item) => item.id === intent)?.label || '', scopeLabel });
    setBusy(true);
    try {
      const result = await api.aiChat({
        projectId: space.id,
        selectedTaskIds: scope === 'selected' ? selectedInProject.map((task) => task.id) : [],
        message,
        intent
      });
      if (result.provider) setProvider(result.provider);
      (result.applied?.updated || []).forEach((item) => replaceWorkItem(item));
      push({ role: 'assistant', text: result.reply, result });
    } catch (error) {
      push({ role: 'assistant', text: `Không thể phân tích: ${error.message}`, error: true });
    } finally {
      setBusy(false);
    }
  }

  async function suggest(description) {
    if (!space || busy) return;
    push({ role: 'user', text: description, scopeLabel: 'Đề xuất task' });
    setBusy(true);
    try {
      const result = await api.aiSuggestTask({ projectId: space.id, description });
      push({ role: 'assistant', text: result.reply, result: { suggestion: result, provider: result.provider } });
    } catch (error) {
      push({ role: 'assistant', text: `Không thể đề xuất: ${error.message}`, error: true });
    } finally {
      setBusy(false);
      setMode('chat');
    }
  }

  function send(event) {
    event?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (mode === 'suggest') suggest(text);
    else ask({ message: text });
  }

  function quick(prompt) {
    if (prompt.id === 'suggest') {
      if (input.trim()) { const text = input.trim(); setInput(''); suggest(text); return; }
      setMode('suggest');
      inputRef.current?.focus();
      return;
    }
    ask({ intent: prompt.id });
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
          result.updated.length ? `Đã cập nhật Priority cho **${result.updated.length}** công việc: ${result.updated.map((item) => `**${item.key}** ➔ ${item.priority}`).join(', ')}.` : 'Không có Priority nào được cập nhật.',
          ...result.skipped.map((item) => `- ${item.key || item.taskId}: ${item.reason}`)
        ].join('\n')
      });
    } catch (error) {
      push({ role: 'assistant', text: `Không cập nhật được Priority: ${error.message}`, error: true });
    }
  }

  async function createFromSuggestion(values) {
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
    if (created) push({ role: 'assistant', text: `Đã tạo **${created.key}** ${created.title} trong ${space.name}.` });
    return created;
  }

  const canCreateHere = space ? canInSpace(space, 'task.create', null, user) : false;

  return (
    <div className="ai-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="ai-drawer" role="dialog" aria-modal="true" aria-label="AI Project Assistant">
        <header className="ai-head">
          <span className="ai-logo"><Icon name="sparkles" size={18} /></span>
          <div className="ai-head-text">
            <h2>AI Project Assistant</h2>
            <small title={provider?.note || ''}>{provider ? `Engine: ${provider.label}` : 'Đang kết nối…'}</small>
          </div>
          <button type="button" className="ai-icon-button" onClick={() => setMessages([])} disabled={!messages.length} aria-label="New conversation" title="Cuộc trò chuyện mới"><Icon name="refresh" size={15} /></button>
          <button type="button" className="ai-icon-button" onClick={onClose} aria-label="Close AI assistant" title="Đóng"><Icon name="close" size={16} /></button>
        </header>

        {!spaces.length ? (
          <div className="ai-empty-state"><Icon name="spaces" size={26} /><strong>Chưa có project nào</strong><span>Tạo hoặc tham gia một project để dùng trợ lý AI.</span></div>
        ) : (
          <>
            <section className="ai-context" aria-label="Phạm vi phân tích">
              <label className="ai-field">
                <span>Project</span>
                <select value={spaceId} onChange={(event) => { setSpaceId(event.target.value); setSelectedIds(new Set()); setScope('all'); setMessages([]); }} aria-label="Project">
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
                <button key={prompt.id} type="button" onClick={() => quick(prompt)} disabled={busy || (prompt.id === 'suggest' && !canCreateHere)} title={prompt.id === 'suggest' && !canCreateHere ? 'Bạn không có quyền "Create task" trong project này' : undefined}>
                  <Icon name={prompt.icon} size={14} /> {prompt.label}
                </button>
              ))}
            </div>

            <div className="ai-messages" ref={listRef} aria-live="polite">
              {!messages.length && (
                <div className="ai-welcome">
                  <strong>Xin chào{user?.fullName ? ` ${user.fullName}` : ''}!</strong>
                  <p>Tôi đọc công việc của <b>{space?.name}</b> ({scopeLabel.toLowerCase()}) để đánh giá Priority theo 3 trụ cột (ảnh hưởng, tính chất, thời gian), lập kế hoạch, cảnh báo rủi ro và đề xuất task mới.</p>
                  <p>Chọn một lệnh nhanh ở trên hoặc nhập câu hỏi, ví dụ: <i>“Việc nào đang có nguy cơ trễ hạn?”</i></p>
                </div>
              )}
              {messages.map((message) => (
                <div key={message.id} className={`ai-message is-${message.role} ${message.error ? 'is-error' : ''}`}>
                  {message.role === 'user' ? (
                    <>
                      <div className="ai-bubble">{message.text}</div>
                      {message.scopeLabel && <small className="ai-meta">{message.scopeLabel}</small>}
                    </>
                  ) : (
                    <>
                      <div className="ai-bubble"><RichText text={message.text} /></div>
                      {message.result?.provider?.note && <small className="ai-meta">{message.result.provider.note} — đã dùng bộ quy tắc.</small>}
                      {message.result?.proposals?.length > 0 && <ProposalCard proposals={message.result.proposals} onApply={(selected) => applyProposals(message.id, selected)} />}
                      {message.result?.suggestion && <SuggestionCard suggestion={message.result.suggestion} space={space} onCreate={createFromSuggestion} />}
                    </>
                  )}
                </div>
              ))}
              {busy && <div className="ai-message is-assistant"><div className="ai-bubble ai-typing" aria-label="Đang phân tích"><span /><span /><span /></div></div>}
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
                  rows={2}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) send(event); }}
                  placeholder={mode === 'suggest' ? 'VD: Lỗi không đăng nhập được bằng Google trên production, cần xong trước ngày mai' : 'Hỏi về project, ví dụ: cập nhật priority theo đề xuất'}
                  aria-label={mode === 'suggest' ? 'Mô tả công việc' : 'Tin nhắn cho trợ lý AI'}
                  disabled={!space}
                />
                <button type="submit" className="ai-send" disabled={busy || !input.trim()} aria-label="Gửi"><Icon name="arrowLeft" size={16} /></button>
              </div>
            </form>
          </>
        )}
      </aside>
    </div>
  );
}
