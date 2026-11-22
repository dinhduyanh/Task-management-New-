// AI Project Assistant: reads a project's work items from SQLite and builds reviews,
// plans, risk lists and task suggestions with the rules engine. Replies are written in
// Vietnamese. An LLM (see llm.js) may rewrite the explanation; numbers and priority
// proposals always come from here.
import { db, parseJson } from '../db.js';
import { DONE_STATUSES, LEVEL, dependencyMap, evaluateTask, foldAccents, normalizePriority } from './priorityEngine.js';

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
// Matched on accent-free text, so "ke hoach" works as well as "kế hoạch".
const INTENT_RULES = [
  ['suggest', /(tao|de xuat|goi y|soan|viet)( (mot|1))? (task|cong viec|viec|issue|ticket)\b|suggest.{0,10}task|create.{0,10}task|tu mo ta/],
  ['help', /(ban|tro ly|ai) (co the|lam duoc|giup duoc)|lam duoc (nhung )?gi|huong dan( su dung)?|\bhelp\b|tro giup|cach dung/],
  ['plan', /ke hoach|\bplan\b|lo trinh|thu tu (lam|thuc hien)|roadmap|sap xep cong viec|nen lam (gi|viec nao|cai nao) truoc/],
  ['risks', /rui ro|\brisks?\b|canh bao|tre han|qua han|overdue|nguy co|cham tien do/],
  ['workload', /qua tai|phan bo|khoi luong|workload|ai dang (lam|giu|phu trach)|theo (nguoi|thanh vien)|moi nguoi|nhan su|capacity/],
  ['review', /priority|uu tien|danh gia|ra soat|review|triage|muc do/]
];
const MINE_RULE = /(cua|danh cho|giao cho) (toi|minh|em)\b|toi (can|phai|nen) lam|\bmy (tasks?|work)\b|assigned to me/;

export function detectIntent(message) {
  const text = foldAccents(message);
  const match = INTENT_RULES.find(([, pattern]) => pattern.test(text));
  if (match) return match[0];
  return MINE_RULE.test(text) ? 'mine' : 'overview';
}

/** "việc của tôi …": limit the analysis to work assigned to the signed-in user. */
export function mentionsMine(message) {
  return MINE_RULE.test(foldAccents(message));
}

/** Work item keys written in the message (e.g. "SHOP-12"), upper-cased. */
export function mentionedKeys(message) {
  return [...new Set((String(message || '').match(/\b[A-Za-z][A-Za-z0-9]{0,9}-\d{1,6}\b/g) || []).map((key) => key.toUpperCase()))];
}

/** "cập nhật / áp dụng / apply ... priority" in the message = apply the proposals directly. */
export function wantsApply(message) {
  const text = foldAccents(message);
  return /(cap nhat|ap dung|apply|update|sua|doi|thay doi).{0,40}(priority|uu tien)/.test(text)
    && !/(dung|khong duoc|khong can|do not|don't|dont)\s+(cap nhat|ap dung|apply|update)/.test(text);
}

// ---- workload, my work, single work item --------------------------------------------
/** Open work per assignee: counts, urgent work, overdue, due within a week; flags overload. */
export function workloadFrom(evaluations, now = Date.now()) {
  const open = evaluations.filter(({ item }) => !DONE_STATUSES.has(item.status));
  const people = new Map();
  for (const { item, evaluation } of open) {
    const id = item.assigneeId || 'unassigned';
    if (!people.has(id)) people.set(id, { assigneeId: item.assigneeId || null, name: item.assignee || (item.assigneeId ? 'Không rõ tên' : 'Chưa giao'), open: 0, urgent: 0, overdue: 0, dueThisWeek: 0, keys: [] });
    const person = people.get(id);
    person.open += 1;
    if (evaluation.level >= 4) person.urgent += 1;
    if (evaluation.time.state === 'overdue') person.overdue += 1;
    const due = item.dueDate ? new Date(`${item.dueDate}T23:59:59`).getTime() : null;
    if (due && due >= now && due - now <= 7 * DAY) person.dueThisWeek += 1;
    person.keys.push(item.key);
  }
  const assigned = [...people.values()].filter((person) => person.assigneeId);
  const average = assigned.length ? assigned.reduce((sum, person) => sum + person.open, 0) / assigned.length : 0;
  return [...people.values()]
    .map((person) => ({
      ...person,
      overloaded: Boolean(person.assigneeId) && (person.open >= Math.max(3, Math.ceil(average * 1.5)) || person.urgent >= 3 || person.overdue >= 2)
    }))
    .sort((a, b) => (Number(!a.assigneeId) - Number(!b.assigneeId)) || (b.urgent - a.urgent) || (b.open - a.open));
}

// ---- follow-up suggestions -------------------------------------------------------------
const FOLLOW_UPS = {
  review: ['plan', 'risks', 'workload'],
  plan: ['risks', 'review', 'mine'],
  risks: ['plan', 'review', 'workload'],
  workload: ['risks', 'plan', 'review'],
  mine: ['plan', 'risks', 'review'],
  task: ['review', 'plan', 'risks'],
  suggest: ['suggest', 'review'],
  overview: ['review', 'plan', 'risks', 'mine'],
  help: ['review', 'plan', 'risks', 'workload']
};
const FOLLOW_UP_LABELS = {
  review: 'Đánh giá Priority',
  plan: 'Lập kế hoạch',
  risks: 'Cảnh báo rủi ro',
  workload: 'Phân bổ công việc',
  mine: 'Việc của tôi',
  suggest: 'Đề xuất task khác'
};
export function followUpsFor(intent) {
  return (FOLLOW_UPS[intent] || FOLLOW_UPS.overview).map((id) => ({ intent: id, label: FOLLOW_UP_LABELS[id] }));
}

// ---- task suggestion ---------------------------------------------------------------
// Matched on accent-free text ("loi dang nhap" and "lỗi đăng nhập" both mean a Bug).
const TYPE_RULES = [
  ['Bug', /\bloi\b(?! (ich|nhac|chao|gioi thieu|noi|khuyen|moi))|\bbug\b|crash|\bbi sap\b|(he thong|web(site)?|app|server|trang) (bi )?sap\b|\berror\b|khong hoat dong|khong (the|duoc)\b|\bfail|\bbroken\b|su co|incident/],
  ['Story', /la (mot )?nguoi dung|as an? (user|customer|admin)|user story|toi muon .* de/],
  ['Epic', /\bepic\b|du an lon|nhieu giai doan|toan bo module/],
  ['Improvement', /cai tien|toi uu|\boptimi[sz]|\bimprove|nang cap|\brefactor|y tuong|\bidea\b/],
  ['Feature', /tinh nang moi|chuc nang moi|\bnew feature\b|\bfeature\b|them (chuc nang|tinh nang|man hinh|trang)/]
];

function pad(number) { return String(number).padStart(2, '0'); }
function isoDay(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }

/** Due date in free text: "hôm nay", "ngày mai", "tuần sau", "cuối tuần", "cuối tháng", "20/11", "2026-11-20". */
export function parseDueDate(text, now = Date.now()) {
  const lower = foldAccents(text);
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
  if (/hom nay|\btoday\b|trong ngay|\basap\b|ngay lap tuc/.test(lower)) return plus(0);
  if (/ngay mai|\btomorrow\b/.test(lower)) return plus(1);
  if (/cuoi tuan|end of (the )?week|weekend/.test(lower)) return plus((7 - today.getDay()) % 7 || 7);
  if (/cuoi thang|end of (the )?month/.test(lower)) return isoDay(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  if (/tuan (sau|toi)|next week/.test(lower)) return plus(7);
  const inDays = lower.match(/trong (\d{1,2}) ngay|in (\d{1,2}) days/);
  if (inDays) return plus(Number(inDays[1] || inDays[2]));
  return null;
}

/** Turns a raw description into { title, description, issueType, priority, dueDate, reasons }. */
export function suggestTask(rawDescription, now = Date.now()) {
  const raw = String(rawDescription || '').trim().replace(/\s+/g, ' ');
  const issueType = (TYPE_RULES.find(([, pattern]) => pattern.test(foldAccents(raw))) || ['Task'])[0];
  // Title: the first sentence without request phrases, up to 80 characters.
  let title = raw
    .replace(/^(hãy|hay|vui lòng|vui long|làm ơn|lam on|please)\s+/i, '')
    .replace(/^(tạo|tao|đề xuất|de xuat|gợi ý|goi y|thêm|them|create|add)\s+((một|mot|1)\s+)?(task|công việc|cong viec|việc|viec|issue|ticket)\s*(để|de|về|ve|cho|:)?\s*/i, '')
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
