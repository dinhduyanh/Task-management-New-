// Rule-based priority evaluation: the "3 pillars" of the AI Project Assistant.
// It is the source of truth for priority proposals (an LLM, when configured, only
// writes the explanation), so results are reproducible and follow the agreed rules.
//
//   1. Impact      - scope and severity (crash, data loss, security, blocker...) and
//                    dependencies (open work items this one is blocking).
//   2. Nature      - issue type and context (production vs test/dev, VIP customer, SLA).
//   3. Time        - current date vs due date and the effort window (due - start).
//
// Scale (only these five values): Highest > High > Medium > Low > Lowest.

export const PRIORITIES = ['Lowest', 'Low', 'Medium', 'High', 'Highest'];
export const LEVEL = { Lowest: 1, Low: 2, Medium: 3, High: 4, Highest: 5 };
export const DONE_STATUSES = new Set(['Done', 'Cancel']);
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export function priorityName(level) {
  return PRIORITIES[Math.min(5, Math.max(1, Math.round(level))) - 1];
}

export function normalizePriority(value) {
  const text = String(value || '').trim().toLowerCase();
  return PRIORITIES.find((name) => name.toLowerCase() === text) || null;
}

// Keyword groups (Vietnamese and English). Matched on title + description + labels.
const RULES = {
  critical: [
    /\bcrash(es|ed)?\b/, /\bsập\b/, /\bdown(time)?\b/, /\boutage\b/, /\bincident\b/, /không (truy cập|vào) được/,
    /mất dữ liệu/, /\bdata loss\b/, /bảo mật/, /\bsecurity\b/, /lỗ hổng/, /\bvulnerab/, /\bhack/, /rò rỉ/, /\bleak/,
    /\bblocker\b/, /chặn (toàn bộ|tất cả|cả nhóm|nhiều người)/, /toàn (bộ )?hệ thống/, /khẩn cấp/, /\burgent\b/, /\bp0\b/, /\bsev ?[01]\b/,
    /\b(http|lỗi|error|status) ?50[0-4]\b/, /\b50[0-4] (error|internal)/, /\bdeadlock\b/, /\bmemory leak\b/, /\bhotfix\b/, /\brollback\b/, /\bcorrupt/, /không ai (dùng|vào|truy cập) được/
  ],
  major: [
    /lỗi nghiêm trọng/, /\bmajor\b/, /\bcritical\b/, /không hoạt động/, /không thể/, /\bcannot\b/, /\bcan't\b/, /\bfail(s|ed|ure)?\b/,
    /thanh toán/, /\bpayment/, /đăng nhập/, /\blogin\b/, /\bcheckout\b/, /cốt lõi/, /\bcore\b/, /doanh thu/, /\brevenue\b/,
    /chặn tiến độ/, /\bblocking\b/, /(?<!không )quan trọng/, /(?<!not )\bimportant\b/,
    /\btimeout\b/, /\bregression\b/, /\bp1\b/, /\bsev ?2\b/, /chậm nghiêm trọng/, /\bbroken\b/
  ],
  customer: [/\bvip\b/, /\bsla\b/, /khách hàng (lớn|quan trọng|vip)/, /hợp đồng/, /\bcontract\b/, /\bkey (customer|account)\b/],
  production: [/\bproduction\b/, /\bprod\b/, /\blive\b/, /môi trường thật/, /người dùng thật/, /\bkhách hàng\b/, /\bcustomers?\b/],
  nonProduction: [/\btest(ing)?\b/, /\bstaging\b/, /\bdev\b/, /môi trường (test|dev|thử)/, /\blocal\b/, /\bsandbox\b/],
  minor: [/\bui\b/, /giao diện/, /\btypo\b/, /chính tả/, /căn lề/, /\bmàu\b/, /\bcolor\b/, /\bicon\b/, /\bcosmetic\b/, /hiển thị (sai|lệch)/, /(?<![\p{L}])nhỏ(?![\p{L}])/u, /\bminor\b/, /\balign/, /không (quan trọng|gấp)/],
  idea: [/ý tưởng/, /\bidea\b/, /nice to have/, /có thể hoãn/, /\bsomeday\b/, /tối ưu (phụ|thêm)/, /\bbrainstorm/, /\bwishlist\b/],
  enhancement: [/cải tiến/, /\benhance/, /\bimprove/, /tối ưu/, /\boptimi[sz]/, /\brefactor/, /nâng cấp/]
};

// The same signals typed without Vietnamese accents ("khong dang nhap duoc"). Only phrases
// that stay unambiguous without accents are listed (e.g. not "sap", which is both
// "sập" = crash and "sắp" = soon). Matched against accent-free text.
const ASCII_RULES = {
  critical: [/khong (truy cap|vao) duoc/, /mat du lieu/, /bao mat/, /lo hong/, /ro ri/, /khan cap/, /toan (bo )?he thong/,
    /\bbi sap\b/, /(he thong|web(site)?|app|server|trang) (bi )?sap\b/, /chan (toan bo|tat ca|ca nhom|nhieu nguoi)/, /\bloi 50[0-4]\b/, /khong ai (dung|vao|truy cap) duoc/],
  major: [/loi nghiem trong/, /khong hoat dong/, /khong the\b/, /thanh toan/, /dang nhap/, /cot loi/, /doanh thu/, /chan tien do/, /(?<!khong )quan trong/, /cham nghiem trong/],
  customer: [/khach hang (lon|quan trong|vip)/, /hop dong/],
  production: [/moi truong that/, /nguoi dung that/, /\bkhach hang\b/],
  nonProduction: [/moi truong (test|dev|thu)/],
  minor: [/giao dien/, /chinh ta/, /can le/, /hien thi (sai|lech)/, /khong (quan trong|gap)/],
  idea: [/y tuong/, /co the hoan/, /toi uu (phu|them)/],
  enhancement: [/cai tien/, /toi uu/, /nang cap/]
};

/** Lower-case text without Vietnamese accents ("Đăng nhập" -> "dang nhap"). */
export function foldAccents(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
}

function matches(text, group, folded = foldAccents(text)) {
  const found = [];
  const collect = (patterns, source) => patterns.forEach((pattern) => {
    const hit = source.match(pattern);
    if (hit && !found.some((item) => foldAccents(item) === foldAccents(hit[0]))) found.push(hit[0]);
  });
  collect(RULES[group], text);
  collect(ASCII_RULES[group] || [], folded);
  // Keep the longest of overlapping matches ("he thong bi sap", not also "bi sap").
  return found.filter((item) => !found.some((other) => other !== item && foldAccents(other).includes(foldAccents(item))));
}

/** End of the due day (local time) for date-only values, or the exact timestamp. */
export function dueMoment(value) {
  if (!value) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    return new Date(year, month - 1, day, 23, 59, 59).getTime();
  }
  const time = new Date(text).getTime();
  return Number.isNaN(time) ? null : time;
}

function startMoment(value) {
  if (!value) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    return new Date(year, month - 1, day, 0, 0, 0).getTime();
  }
  const time = new Date(text).getTime();
  return Number.isNaN(time) ? null : time;
}

// Share of the work already done, by status (used for the remaining effort).
const PROGRESS = { Backlog: 0, 'To Do': 0, Blocked: 0, 'In Progress': 0.5, 'In Review': 0.8 };

function formatDuration(ms) {
  const hours = Math.abs(ms) / HOUR;
  if (hours < 48) return `${Math.max(1, Math.round(hours))} giờ`;
  return `${Math.round(hours / 24)} ngày`;
}

const TYPE_BASE = { Bug: 3, Epic: 3, Feature: 3, Story: 3, Task: 3, 'Sub-task': 3, Improvement: 2 };

/**
 * Evaluates one work item.
 * task: { title, description, labels, issueType, status, priority, startDate, dueDate }
 * context: { now (ms), blocks: [{ key, title }] open items this one blocks, blockedBy: [...] }
 * Returns { priority, level, current, change, reasons: [{ pillar, text }], time: {...}, skipped }
 */
export function evaluateTask(task, { now = Date.now(), blocks = [], blockedBy = [] } = {}) {
  const current = normalizePriority(task.priority) || 'Medium';
  const status = task.status || 'To Do';
  if (DONE_STATUSES.has(status)) {
    return { priority: current, level: LEVEL[current], current, change: false, skipped: 'done', time: { due: task.dueDate || null, start: task.startDate || null, remainingMs: null, effortMs: null, state: 'done' }, reasons: [{ pillar: 'time', text: `Đã ở trạng thái ${status}: không cần đánh giá lại.` }] };
  }
  const text = [task.title, task.description, ...(Array.isArray(task.labels) ? task.labels : [])].filter(Boolean).join(' \n ').toLowerCase();
  const folded = foldAccents(text);
  const signals = (group) => matches(text, group, folded);
  const reasons = [];
  const type = task.issueType || 'Task';

  // ---- Pillar 2: nature (type and context) sets the starting level
  let level = TYPE_BASE[type] ?? 3;
  reasons.push({ pillar: 'nature', text: `Loại ${type}: mức khởi điểm ${priorityName(level)}.` });

  // ---- Pillar 1: impact
  const critical = signals('critical');
  const major = signals('major');
  const minor = signals('minor');
  const idea = signals('idea');
  const enhancement = signals('enhancement');
  let severe = false;
  if (critical.length) {
    level = 5;
    severe = true;
    reasons.push({ pillar: 'impact', text: `Dấu hiệu sự cố nghiêm trọng (${critical.slice(0, 3).join(', ')}): Highest.` });
  } else if (major.length) {
    level = Math.max(level, 4);
    severe = true;
    reasons.push({ pillar: 'impact', text: `Ảnh hưởng lớn tới tính năng/luồng quan trọng (${major.slice(0, 3).join(', ')}): ít nhất High.` });
  } else if (idea.length && type !== 'Bug') {
    level = 1;
    reasons.push({ pillar: 'impact', text: `Mang tính ý tưởng/đề xuất (${idea[0]}), có thể hoãn: Lowest.` });
  } else if (minor.length || (enhancement.length && type !== 'Bug')) {
    level = Math.min(level, 2);
    reasons.push({ pillar: 'impact', text: `Ảnh hưởng nhỏ (${[...minor, ...enhancement].slice(0, 2).join(', ')}): Low.` });
  }

  const openBlocks = blocks.length;
  if (openBlocks >= 3) {
    level = 5;
    severe = true;
    reasons.push({ pillar: 'impact', text: `Đang chặn ${openBlocks} công việc chưa xong (${blocks.slice(0, 3).map((item) => item.key).join(', ')}): blocker, Highest.` });
  } else if (openBlocks > 0) {
    level = Math.max(level, 4);
    severe = true;
    reasons.push({ pillar: 'impact', text: `Đang chặn ${blocks.map((item) => item.key).join(', ')} (dependency): ít nhất High.` });
  }
  if (blockedBy.length) {
    reasons.push({ pillar: 'impact', text: `Đang bị chặn bởi ${blockedBy.map((item) => item.key).join(', ')}: xử lý các việc đó trước.` });
  }

  // Context of pillar 2: environment and customer
  if (type === 'Bug' && signals('production').length && level < 5) {
    level += 1;
    reasons.push({ pillar: 'nature', text: 'Lỗi trên môi trường Production/người dùng thật: nâng 1 bậc.' });
  } else if (signals('nonProduction').length && !critical.length && level > 1) {
    level -= 1;
    reasons.push({ pillar: 'nature', text: 'Chỉ ảnh hưởng môi trường Test/Dev: hạ 1 bậc.' });
  }
  if (signals('customer').length && level < 4) {
    level = 4;
    severe = true;
    reasons.push({ pillar: 'nature', text: 'Liên quan khách hàng VIP/SLA/hợp đồng: ít nhất High.' });
  }

  // ---- Pillar 3: dynamic time pressure
  const due = dueMoment(task.dueDate);
  const start = startMoment(task.startDate);
  const time = { due: task.dueDate || null, start: task.startDate || null, remainingMs: null, effortMs: null, state: 'no-due' };
  if (!due) {
    reasons.push({ pillar: 'time', text: 'Không có Due Date: chỉ đánh giá theo mức ảnh hưởng và tính chất công việc.' });
  } else {
    const remaining = due - now;
    time.remainingMs = remaining;
    const effort = start && start <= due ? Math.max(due - start, DAY / 2) : null;
    time.effortMs = effort;
    const remainingWork = effort ? effort * (1 - (PROGRESS[status] ?? 0)) : null;
    if (remaining < 0) {
      time.state = 'overdue';
      const raised = Math.min(5, Math.max(4, level + 2));
      reasons.push({ pillar: 'time', text: `Đã quá hạn ${formatDuration(remaining)} (Due ${task.dueDate}): nâng lên ${priorityName(raised)}.` });
      level = raised;
    } else if (remaining < DAY) {
      time.state = 'due-24h';
      const raised = Math.min(5, Math.max(4, level + 1));
      reasons.push({ pillar: 'time', text: `Chỉ còn ${formatDuration(remaining)} tới hạn: nâng lên ${priorityName(raised)}.` });
      level = raised;
    } else if (remainingWork && remaining <= 1.5 * remainingWork) {
      time.state = 'at-risk';
      if (level < 4) {
        reasons.push({ pillar: 'time', text: `Còn ${formatDuration(remaining)} nhưng khối lượng còn lại ước tính ${formatDuration(remainingWork)} (≤ 1.5× effort): nâng lên High để cảnh báo trễ hạn.` });
        level = 4;
      } else {
        reasons.push({ pillar: 'time', text: `Còn ${formatDuration(remaining)}, sát với effort ước tính ${formatDuration(remainingWork)}: có nguy cơ trễ hạn.` });
      }
    } else if (remaining > 7 * DAY && !severe) {
      time.state = 'comfortable';
      if (level > 3) {
        level = 3;
        reasons.push({ pillar: 'time', text: `Due Date còn xa (${formatDuration(remaining)}) và không có sự cố nghiêm trọng: giữ Medium.` });
      } else {
        reasons.push({ pillar: 'time', text: `Due Date còn xa (${formatDuration(remaining)}): không có áp lực thời gian.` });
      }
    } else {
      time.state = 'ok';
      reasons.push({ pillar: 'time', text: `Còn ${formatDuration(remaining)} tới hạn${effort ? `, effort ước tính ${formatDuration(effort)}` : ''}: thời gian còn đủ.` });
    }
  }

  const priority = priorityName(level);
  return { priority, level: LEVEL[priority], current, change: priority !== current, reasons, time, skipped: null };
}

/**
 * Dependencies from links: "A Blocks B" and "B Is blocked by A" both mean A blocks B.
 * items: [{ id, key, title, status }]; links: [{ source, target, type }]
 * Returns Map id -> { blocks: [open items], blockedBy: [open items] }.
 */
export function dependencyMap(items, links) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const map = new Map(items.map((item) => [item.id, { blocks: [], blockedBy: [] }]));
  const add = (blocker, blocked) => {
    const a = byId.get(blocker);
    const b = byId.get(blocked);
    if (!a || !b) return;
    if (!DONE_STATUSES.has(b.status) && !map.get(a.id).blocks.some((item) => item.id === b.id)) map.get(a.id).blocks.push({ id: b.id, key: b.key, title: b.title });
    if (!DONE_STATUSES.has(a.status) && !map.get(b.id).blockedBy.some((item) => item.id === a.id)) map.get(b.id).blockedBy.push({ id: a.id, key: a.key, title: a.title });
  };
  for (const link of links) {
    const type = String(link.type || '').toLowerCase();
    if (type === 'blocks') add(link.source, link.target);
    else if (type === 'is blocked by') add(link.target, link.source);
  }
  return map;
}
