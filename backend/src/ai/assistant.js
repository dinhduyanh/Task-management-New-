// AI Project Assistant: reads a project's work items from SQLite and builds reviews,
// plans, risk lists and task suggestions with the rules engine. Replies are written in
// Vietnamese. An LLM (see llm.js) may rewrite the explanation; numbers and priority
// proposals always come from here.
import { db, parseJson } from '../db.js';
import { DONE_STATUSES, LEVEL, dependencyMap, evaluateTask, normalizePriority } from './priorityEngine.js';

const ISSUE_TYPES = ['Epic', 'Feature', 'Story', 'Task', 'Bug', 'Improvement'];
const DAY = 24 * 3600 * 1000;

/** Work items of a project as plain objects (with description and assignee name). */
export function loadProjectItems(spaceId) {
  const rows = db.prepare('SELECT * FROM work_items WHERE space_id = ? ORDER BY created_at').all(String(spaceId));
  const items = rows.map((row) => {
    const data = parseJson(row.data_json, {});
    const assignee = data.assignee && typeof data.assignee === 'object' ? (data.assignee.name || data.assignee.fullName || '') : (data.assignee || '');
    return {
      id: row.id,
      key: row.issue_key,
      title: row.title,
      description: typeof data.description === 'string' ? data.description : '',
      issueType: row.issue_type,
      status: row.status,
      priority: normalizePriority(row.priority) || 'Medium',
      startDate: row.start_date,
      dueDate: row.due_date,
      labels: parseJson(row.labels_json, []),
      assigneeId: row.assignee_id,
      assignee,
      creatorId: row.creator_id,
      sprintId: data.sprintId || null,
      row
    };
  });
  const ids = items.map((item) => item.id);
  const links = ids.length
    ? db.prepare(`SELECT source_work_item_id AS source, target_work_item_id AS target, link_type AS type FROM work_item_links
        WHERE source_work_item_id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  return { items, links };
}

/** Evaluations for the chosen items (dependencies are computed over the whole project). */
export function evaluateItems(allItems, links, chosen, now = Date.now()) {
  const deps = dependencyMap(allItems, links);
  return chosen.map((item) => ({ item, deps: deps.get(item.id), evaluation: evaluateTask(item, { now, ...deps.get(item.id) }) }));
}

const PILLAR_LABEL = { impact: 'Ảnh hưởng', nature: 'Tính chất', time: 'Thời gian' };

export function proposalsFrom(evaluations, mayUpdate) {
  return evaluations
    .filter(({ evaluation }) => evaluation.change && !evaluation.skipped)
    .sort((a, b) => (b.evaluation.level - a.evaluation.level) || (LEVEL[a.item.priority] - LEVEL[b.item.priority]))
    .map(({ item, evaluation }) => ({
      taskId: item.id,
      key: item.key,
      title: item.title,
      status: item.status,
      dueDate: item.dueDate,
      currentPriority: item.priority,
      newPriority: evaluation.priority,
      direction: evaluation.level > LEVEL[item.priority] ? 'up' : 'down',
      reasons: evaluation.reasons.map((reason) => ({ ...reason, label: PILLAR_LABEL[reason.pillar] })),
      canApply: mayUpdate(item)
    }));
}

/** Risks: overdue, due soon, at risk, blocked, unassigned urgent work, urgent work without due date. */
export function risksFrom(evaluations) {
  const risks = [];
  for (const { item, deps, evaluation } of evaluations) {
    if (DONE_STATUSES.has(item.status)) continue;
    const state = evaluation.time.state;
    if (state === 'overdue') risks.push({ level: 'high', taskId: item.id, key: item.key, text: `${item.key} đã quá hạn (Due ${item.dueDate}).` });
    else if (state === 'due-24h') risks.push({ level: 'high', taskId: item.id, key: item.key, text: `${item.key} sẽ hết hạn trong vòng 24 giờ.` });
    else if (state === 'at-risk') risks.push({ level: 'medium', taskId: item.id, key: item.key, text: `${item.key} có nguy cơ trễ hạn: thời gian còn lại sát với khối lượng việc.` });
    if (deps?.blockedBy.length) risks.push({ level: 'medium', taskId: item.id, key: item.key, text: `${item.key} đang bị chặn bởi ${deps.blockedBy.map((dep) => dep.key).join(', ')}.` });
    if (evaluation.level >= 4 && !item.assigneeId) risks.push({ level: 'medium', taskId: item.id, key: item.key, text: `${item.key} (${evaluation.priority}) chưa có người thực hiện.` });
    if (evaluation.level >= 4 && !item.dueDate) risks.push({ level: 'low', taskId: item.id, key: item.key, text: `${item.key} (${evaluation.priority}) chưa có Due Date.` });
  }
  const order = { high: 0, medium: 1, low: 2 };
  return risks.sort((a, b) => order[a.level] - order[b.level]);
}

/**
 * Execution plan: open items ordered by blockers first, then evaluated priority, then due date,
 * grouped into "Làm ngay" / "Trong tuần này" / "Tiếp theo".
 */
export function planFrom(evaluations, now = Date.now()) {
  const open = evaluations.filter(({ item }) => !DONE_STATUSES.has(item.status));
  const ids = new Set(open.map(({ item }) => item.id));
  const dueOf = (item) => (item.dueDate ? new Date(`${item.dueDate}T23:59:59`).getTime() : Infinity);
  const sorted = [...open].sort((a, b) => (b.evaluation.level - a.evaluation.level) || (dueOf(a.item) - dueOf(b.item)) || a.item.key.localeCompare(b.item.key));
  // Blockers inside the set go before the items they block.
  const placed = new Set();
  const ordered = [];
  const place = (entry, trail = new Set()) => {
    if (placed.has(entry.item.id) || trail.has(entry.item.id)) return;
    trail.add(entry.item.id);
    for (const blocker of entry.deps?.blockedBy || []) {
      const blockerEntry = sorted.find((candidate) => candidate.item.id === blocker.id);
      if (blockerEntry && ids.has(blocker.id)) place(blockerEntry, trail);
    }
    placed.add(entry.item.id);
    ordered.push(entry);
  };
  sorted.forEach((entry) => place(entry));

  const phaseOf = ({ item, evaluation }) => {
    const due = dueOf(item);
    if (evaluation.level === 5 || ['overdue', 'due-24h'].includes(evaluation.time.state)) return 'now';
    if (evaluation.level === 4 || evaluation.time.state === 'at-risk' || due - now <= 7 * DAY) return 'week';
    return 'next';
  };
  const phases = [
    { id: 'now', title: 'Làm ngay', steps: [] },
    { id: 'week', title: 'Trong tuần này', steps: [] },
    { id: 'next', title: 'Tiếp theo', steps: [] }
  ];
  // A blocker is at least as urgent as the work it blocks (repeat for chains).
  const rank = { now: 0, week: 1, next: 2 };
  const phaseById = new Map(ordered.map((entry) => [entry.item.id, phaseOf(entry)]));
  for (let pass = 0, changed = true; changed && pass < ordered.length; pass += 1) {
    changed = false;
    for (const entry of ordered) {
      for (const blocked of entry.deps?.blocks || []) {
        const blockedPhase = phaseById.get(blocked.id);
        if (blockedPhase && rank[blockedPhase] < rank[phaseById.get(entry.item.id)]) {
          phaseById.set(entry.item.id, blockedPhase);
          changed = true;
        }
      }
    }
  }
  ordered.forEach((entry, index) => {
    const { item, deps, evaluation } = entry;
    const notes = [];
    if (deps?.blockedBy.length) notes.push(`chờ ${deps.blockedBy.map((dep) => dep.key).join(', ')}`);
    if (deps?.blocks.length) notes.push(`mở khóa ${deps.blocks.map((dep) => dep.key).join(', ')}`);
    if (!item.assigneeId) notes.push('cần giao người thực hiện');
    phases.find((phase) => phase.id === phaseById.get(item.id)).steps.push({
      order: index + 1,
      taskId: item.id,
      key: item.key,
      title: item.title,
      status: item.status,
      priority: evaluation.priority,
      currentPriority: item.priority,
      dueDate: item.dueDate,
      assignee: item.assignee || null,
      notes
    });
  });
  return phases.filter((phase) => phase.steps.length);
}

export function statsFrom(items, evaluations) {
  const byStatus = {};
  const byPriority = {};
  items.forEach((item) => { byStatus[item.status] = (byStatus[item.status] || 0) + 1; byPriority[item.priority] = (byPriority[item.priority] || 0) + 1; });
  return {
    total: items.length,
    open: items.filter((item) => !DONE_STATUSES.has(item.status)).length,
    overdue: evaluations.filter(({ evaluation }) => evaluation.time.state === 'overdue').length,
    dueSoon: evaluations.filter(({ evaluation }) => evaluation.time.state === 'due-24h').length,
    byStatus,
    byPriority
  };
}

// ---- intent ----------------------------------------------------------------------
export function detectIntent(message) {
  const text = String(message || '').toLowerCase();
  if (/(tạo|đề xuất|gợi ý|soạn).{0,20}(task|công việc|việc|issue|ticket)|suggest.{0,10}task|create.{0,10}task|từ mô tả/.test(text)) return 'suggest';
  if (/kế hoạch|lập kế hoạch|\bplan\b|lộ trình|thứ tự (làm|thực hiện)|roadmap|sắp xếp công việc/.test(text)) return 'plan';
  if (/rủi ro|\brisk|cảnh báo|trễ hạn|quá hạn|overdue/.test(text)) return 'risks';
  if (/priority|ưu tiên|đánh giá|rà soát|review|triage|mức độ/.test(text)) return 'review';
  return 'overview';
}

/** "cập nhật / áp dụng / apply ... priority" in the message = apply the proposals directly. */
export function wantsApply(message) {
  const text = String(message || '').toLowerCase();
  return /(cập nhật|áp dụng|apply|update|sửa|đổi|thay đổi).{0,40}(priority|ưu tiên)/.test(text)
    && !/(đừng|không được|không cần|do not|don't)\s+(cập nhật|áp dụng|apply|update)/.test(text);
}

// ---- task suggestion ---------------------------------------------------------------
const TYPE_RULES = [
  ['Bug', /lỗi|\bbug\b|crash|sập|\berror\b|không hoạt động|không (thể|được)|\bfail|hỏng|\bbroken\b|sự cố|incident/],
  ['Story', /là (một )?người dùng|as an? (user|customer|admin)|user story|tôi muốn .* để/],
  ['Epic', /\bepic\b|dự án lớn|nhiều giai đoạn|toàn bộ module/],
  ['Improvement', /cải tiến|tối ưu|\boptimi[sz]|\bimprove|nâng cấp|\brefactor|ý tưởng|\bidea\b/],
  ['Feature', /tính năng mới|chức năng mới|\bnew feature\b|\bfeature\b|thêm (chức năng|tính năng|màn hình|trang)/]
];

function pad(number) { return String(number).padStart(2, '0'); }
function isoDay(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }

/** Due date mentioned in free text: "hôm nay", "ngày mai", "tuần sau", "20/11", "2026-11-20". */
export function parseDueDate(text, now = Date.now()) {
  const lower = String(text || '').toLowerCase();
  const today = new Date(now);
  const plus = (days) => { const date = new Date(today); date.setDate(date.getDate() + days); return isoDay(date); };
  const isoMatch = lower.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${pad(isoMatch[2])}-${pad(isoMatch[3])}`;
  const dmy = lower.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](20\d{2}))?\b/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      let year = dmy[3] ? Number(dmy[3]) : today.getFullYear();
      if (!dmy[3] && new Date(year, month - 1, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate())) year += 1;
      return `${year}-${pad(month)}-${pad(day)}`;
    }
  }
  if (/hôm nay|\btoday\b|trong ngày|\basap\b|ngay lập tức/.test(lower)) return plus(0);
  if (/ngày mai|\btomorrow\b/.test(lower)) return plus(1);
  if (/tuần (sau|tới)|next week/.test(lower)) return plus(7);
  const inDays = lower.match(/trong (\d{1,2}) ngày|in (\d{1,2}) days/);
  if (inDays) return plus(Number(inDays[1] || inDays[2]));
  return null;
}

/** Turns a raw description into { title, description, issueType, priority, dueDate, reasons }. */
export function suggestTask(rawDescription, now = Date.now()) {
  const raw = String(rawDescription || '').trim().replace(/\s+/g, ' ');
  const lower = raw.toLowerCase();
  const issueType = (TYPE_RULES.find(([, pattern]) => pattern.test(lower)) || ['Task'])[0];
  // Title: the first sentence without request phrases, up to 80 characters.
  let title = raw
    .replace(/^(hãy|vui lòng|làm ơn|please)\s+/i, '')
    .replace(/^(tạo|đề xuất|gợi ý|thêm|create|add)\s+(một\s+)?(task|công việc|việc|issue|ticket)\s*(để|về|cho|:)?\s*/i, '')
    .split(/(?<=[.!?])\s|\n/)[0]
    .replace(/[.!?]+$/, '')
    .trim();
  if (title.length > 60 && title.indexOf(',', 20) > 0) title = title.slice(0, title.indexOf(',', 20));
  if (title.length > 80) title = `${title.slice(0, 77).replace(/\s+\S*$/, '')}…`;
  title = title ? title.charAt(0).toUpperCase() + title.slice(1) : 'Công việc mới';
  const dueDate = parseDueDate(raw, now);
  const evaluation = evaluateTask({ title, description: raw, issueType, status: 'To Do', priority: 'Medium', dueDate }, { now });
  return {
    title,
    description: raw,
    issueType,
    priority: evaluation.priority,
    dueDate,
    reasons: evaluation.reasons.map((reason) => ({ ...reason, label: PILLAR_LABEL[reason.pillar] }))
  };
}

export { ISSUE_TYPES };
