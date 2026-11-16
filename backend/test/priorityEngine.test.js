// Rules of the AI Project Assistant's priority engine (3 pillars). Run: npm test (backend).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTask, dependencyMap } from '../src/ai/priorityEngine.js';

const ok = (condition, message, result) => test(message, () => assert.ok(condition, `${message}: got ${JSON.stringify(result?.priority)} ${JSON.stringify(result?.reasons || '')}`));
const now = new Date(2026, 10, 16, 10, 0, 0).getTime(); // 16 Nov 2026 10:00
const iso = (d) => { const x = new Date(now + d * 864e5); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const ev = (t, ctx = {}) => evaluateTask({ status: 'To Do', priority: 'Medium', issueType: 'Task', ...t }, { now, ...ctx });
let r;
r = ev({ title: 'Website sập khi thanh toán', issueType: 'Bug' }); ok(r.priority === 'Highest', 'crash → Highest', r);
r = ev({ title: 'Security vulnerability in login', issueType: 'Bug' }); ok(r.priority === 'Highest', 'security → Highest', r);
r = ev({ title: 'Không thể đăng nhập bằng Google, có cách tạm thời', issueType: 'Bug' }); ok(r.priority === 'High', 'major core bug → High', r);
r = ev({ title: 'Thêm bộ lọc báo cáo', issueType: 'Story' }); ok(r.priority === 'Medium', 'normal story → Medium', r);
r = ev({ title: 'Sửa lỗi chính tả ở footer', issueType: 'Bug' }); ok(r.priority === 'Low', 'typo → Low', r);
r = ev({ title: 'Lỗi màu nút nhỏ', issueType: 'Bug' }); ok(r.priority === 'Low', 'small UI (nhỏ) → Low', r);
r = ev({ title: 'Ý tưởng: thêm dark mode cho email', issueType: 'Improvement' }); ok(r.priority === 'Lowest', 'idea → Lowest', r);
r = ev({ title: 'Cải tiến tốc độ trang', issueType: 'Improvement' }); ok(r.priority === 'Low', 'enhancement → Low', r);
r = ev({ title: 'Viết tài liệu', dueDate: iso(-2) }); ok(r.priority === 'Highest' && r.time.state === 'overdue', 'Medium overdue → +2 = Highest', r);
r = ev({ title: 'Sửa căn lề', issueType: 'Bug', dueDate: iso(-1) }); ok(r.priority === 'High', 'Low overdue → High', r);
r = ev({ title: 'Viết tài liệu', dueDate: iso(0) }); ok(r.priority === 'High' && r.time.state === 'due-24h', 'due in < 24h → +1 (High)', r);
r = ev({ title: 'Làm tính năng', startDate: iso(-6), dueDate: iso(3) }); ok(r.priority === 'High' && r.time.state === 'at-risk', 'not started, 3 days left of 10-day window → High', r);
r = ev({ title: 'Làm tính năng', status: 'In Review', startDate: iso(-6), dueDate: iso(3) }); ok(r.priority === 'Medium', 'in review, enough time → Medium', r);
r = ev({ title: 'Làm tính năng', priority: 'High', dueDate: iso(20) }); ok(r.priority === 'Medium' && r.change, 'High but due far (>1 week) and not severe → Medium', r);
r = ev({ title: 'Website sập', issueType: 'Bug', dueDate: iso(20) }); ok(r.priority === 'Highest', 'far due but crash stays Highest', r);
r = ev({ title: 'Lỗi trên production: nút lưu không phản hồi', issueType: 'Bug' }); ok(r.priority === 'High', 'production bug +1', r);
r = ev({ title: 'Lỗi trên môi trường test: nút lưu không phản hồi', issueType: 'Bug' }); ok(r.priority === 'Low', 'test env bug -1', r);
r = ev({ title: 'Báo cáo cho khách hàng VIP', issueType: 'Task' }); ok(r.priority === 'High', 'VIP → High', r);
r = ev({ title: 'Việc không quan trọng', issueType: 'Task' }); ok(r.priority === 'Low', '"không quan trọng" → Low', r);
r = ev({ title: 'Đã xong', status: 'Done', priority: 'Low', dueDate: iso(-5) }); ok(r.priority === 'Low' && !r.change && r.skipped === 'done', 'done items unchanged', r);
const items = [{ id: 'a', key: 'P-1', status: 'To Do' }, { id: 'b', key: 'P-2', status: 'To Do' }, { id: 'c', key: 'P-3', status: 'Done' }, { id: 'd', key: 'P-4', status: 'In Progress' }, { id: 'e', key: 'P-5', status: 'To Do' }, { id: 'f', key: 'P-6', status: 'To Do' }];
// a blocks b, e and f (f says "is blocked by a"); d (open) blocks a; c (done) blocks a -> ignored
const deps = dependencyMap(items, [{ source: 'a', target: 'b', type: 'Blocks' }, { source: 'a', target: 'e', type: 'Blocks' }, { source: 'f', target: 'a', type: 'Is blocked by' }, { source: 'a', target: 'd', type: 'Is blocked by' }, { source: 'c', target: 'a', type: 'Blocks' }, { source: 'a', target: 'b', type: 'Relates to' }]);
ok(deps.get('a').blocks.map((x) => x.key).join() === 'P-2,P-5,P-6' && deps.get('a').blockedBy.map((x) => x.key).join() === 'P-4', 'dependency map (both link directions, done blockers ignored)', { priority: '-' });
r = ev({ title: 'Setup', priority: 'Low' }, deps.get('a')); ok(r.priority === 'Highest', 'blocks 3 open items → Highest', r);
r = ev({ title: 'Setup' }, { blocks: [{ key: 'P-9' }] }); ok(r.priority === 'High', 'blocks 1 item → High', r);
