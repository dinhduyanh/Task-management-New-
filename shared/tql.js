// TQL - Taskflow Query Language. Shared by the frontend (highlighting, auto-complete,
// validation, Default <-> TQL sync) and the backend (which compiles the parsed query
// into parameterised SQL). This module only parses; it never builds SQL.
//
//   project = "PRJ-01" AND assignee = currentUser() AND status IN ("To Do", "In Progress")
//   ORDER BY dueDate ASC

export class TqlError extends Error {
  constructor(message, start = 0, end = start + 1) {
    super(message);
    this.name = 'TqlError';
    this.start = start;
    this.end = Math.max(end, start + 1);
  }
}

export const MAX_QUERY_LENGTH = 4000;
const MAX_LIST_SIZE = 200;
const MAX_DEPTH = 24;

/* ---------------------------------------------------------------- fields */

// kind: text (contains), enum (exact value list), user, date (day), datetime (instant)
export const FIELDS = [
  { name: 'project', kind: 'enum', aliases: ['space'], label: 'Project' },
  { name: 'key', kind: 'text', aliases: ['issuekey', 'id'], label: 'Issue key' },
  { name: 'summary', kind: 'text', aliases: ['title', 'text'], label: 'Summary' },
  { name: 'description', kind: 'text', aliases: [], label: 'Description' },
  { name: 'status', kind: 'enum', aliases: [], label: 'Status' },
  { name: 'statusCategory', kind: 'enum', aliases: ['category'], label: 'Status category' },
  { name: 'priority', kind: 'enum', aliases: [], label: 'Priority', ordered: true },
  { name: 'type', kind: 'enum', aliases: ['issuetype'], label: 'Issue type' },
  { name: 'assignee', kind: 'user', aliases: [], label: 'Assignee' },
  { name: 'creator', kind: 'user', aliases: ['reporter'], label: 'Creator' },
  { name: 'sprint', kind: 'enum', aliases: [], label: 'Sprint' },
  { name: 'labels', kind: 'enum', aliases: ['label'], label: 'Labels' },
  { name: 'created', kind: 'datetime', aliases: ['createddate', 'createdat'], label: 'Created' },
  { name: 'updated', kind: 'datetime', aliases: ['updateddate', 'updatedat'], label: 'Updated' },
  { name: 'startDate', kind: 'date', aliases: ['start'], label: 'Start date' },
  { name: 'dueDate', kind: 'date', aliases: ['due', 'enddate', 'end'], label: 'Due date' }
];

const FIELD_INDEX = new Map();
for (const field of FIELDS) [field.name, ...field.aliases].forEach((name) => FIELD_INDEX.set(name.toLowerCase(), field));

export function fieldByName(name) {
  return FIELD_INDEX.get(String(name || '').toLowerCase()) || null;
}

const OPERATORS_BY_KIND = {
  text: ['=', '!=', '~', '!~', 'IN', 'NOT IN', 'IS EMPTY', 'IS NOT EMPTY'],
  enum: ['=', '!=', 'IN', 'NOT IN', 'IS EMPTY', 'IS NOT EMPTY'],
  user: ['=', '!=', 'IN', 'NOT IN', 'IS EMPTY', 'IS NOT EMPTY'],
  date: ['=', '!=', '>', '>=', '<', '<=', 'IS EMPTY', 'IS NOT EMPTY'],
  datetime: ['=', '!=', '>', '>=', '<', '<=', 'IS EMPTY', 'IS NOT EMPTY']
};
// priority can also be compared: priority >= High
OPERATORS_BY_KIND.ordered = [...OPERATORS_BY_KIND.enum, '>', '>=', '<', '<='];
// labels ~ "ui" (a label containing the text)
const LABEL_OPERATORS = [...OPERATORS_BY_KIND.enum, '~'];

export function operatorsFor(field) {
  if (!field) return [];
  if (field.name === 'labels') return LABEL_OPERATORS;
  if (field.ordered) return OPERATORS_BY_KIND.ordered;
  return OPERATORS_BY_KIND[field.kind];
}

export const FUNCTIONS = {
  currentuser: { name: 'currentUser', kinds: ['user'], args: 0, description: 'The signed-in user' },
  now: { name: 'now', kinds: ['date', 'datetime'], args: 1, description: 'The current time' },
  startofday: { name: 'startOfDay', kinds: ['date', 'datetime'], args: 1, description: 'Start of today (optional offset, e.g. startOfDay(-1))' },
  endofday: { name: 'endOfDay', kinds: ['date', 'datetime'], args: 1, description: 'End of today' },
  startofweek: { name: 'startOfWeek', kinds: ['date', 'datetime'], args: 1, description: 'Monday of this week' },
  endofweek: { name: 'endOfWeek', kinds: ['date', 'datetime'], args: 1, description: 'Sunday of this week' },
  startofmonth: { name: 'startOfMonth', kinds: ['date', 'datetime'], args: 1, description: 'First day of this month' },
  endofmonth: { name: 'endOfMonth', kinds: ['date', 'datetime'], args: 1, description: 'Last day of this month' }
};

export const KEYWORDS = ['AND', 'OR', 'NOT', 'IN', 'IS', 'EMPTY', 'NULL', 'ORDER', 'BY', 'ASC', 'DESC'];
const KEYWORD_SET = new Set(KEYWORDS);

// Dates: 2026-11-19, 2026-11-19 14:30, or relative: -7d, +2w, -3h, 30m (minutes)
const DATE_LITERAL = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/;
const RELATIVE_LITERAL = /^[-+]?\d+[mhdw]$/i;
// Function offsets: startOfDay(-1) (days) or startOfDay("-1w")
const OFFSET_LITERAL = /^[-+]?\d+[mhdw]?$/i;

export function isDateLiteral(value) {
  const text = String(value);
  if (RELATIVE_LITERAL.test(text)) return true;
  if (!DATE_LITERAL.test(text)) return false;
  const [y, m, d] = text.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/* ------------------------------------------------------------- tokenizer */

const WORD = /[\p{L}\p{N}_@][\p{L}\p{N}_@.\-/]*/uy;
const SIGNED = /[-+]\d+[\p{L}]?/uy;

/**
 * Splits a query into tokens: { type, value, start, end }.
 * type: string | word | op | lparen | rparen | comma
 * With { tolerant: true } an unterminated string becomes a token (used while typing).
 */
export function tokenize(input, { tolerant = false } = {}) {
  const text = String(input ?? '');
  if (text.length > MAX_QUERY_LENGTH) throw new TqlError(`The query is too long (max ${MAX_QUERY_LENGTH} characters).`, MAX_QUERY_LENGTH, text.length);
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (/\s/.test(char)) { i += 1; continue; }
    const start = i;
    if (char === '"' || char === "'") {
      let value = '';
      i += 1;
      let closed = false;
      while (i < text.length) {
        if (text[i] === '\\' && i + 1 < text.length) { value += text[i + 1]; i += 2; continue; }
        if (text[i] === char) { closed = true; i += 1; break; }
        value += text[i];
        i += 1;
      }
      if (!closed && !tolerant) throw new TqlError(`Missing closing quote ${char}.`, start, text.length);
      tokens.push({ type: 'string', value, start, end: i, quote: char, closed });
      continue;
    }
    if (char === '(') { tokens.push({ type: 'lparen', value: '(', start, end: ++i }); continue; }
    if (char === ')') { tokens.push({ type: 'rparen', value: ')', start, end: ++i }); continue; }
    if (char === ',') { tokens.push({ type: 'comma', value: ',', start, end: ++i }); continue; }
    const two = text.slice(i, i + 2);
    if (['!=', '!~', '>=', '<=', '<>'].includes(two)) {
      tokens.push({ type: 'op', value: two === '<>' ? '!=' : two, start, end: i + 2 });
      i += 2;
      continue;
    }
    if ('=~><'.includes(char)) { tokens.push({ type: 'op', value: char, start, end: ++i }); continue; }
    SIGNED.lastIndex = i;
    const signed = (char === '-' || char === '+') && SIGNED.exec(text);
    if (signed) { i = SIGNED.lastIndex; tokens.push({ type: 'word', value: signed[0], start, end: i }); continue; }
    WORD.lastIndex = i;
    const word = WORD.exec(text);
    if (word) { i = WORD.lastIndex; tokens.push({ type: 'word', value: word[0], start, end: i }); continue; }
    if (tolerant) { tokens.push({ type: 'unknown', value: char, start, end: ++i }); continue; }
    throw new TqlError(`Unexpected character "${char}".`, start, start + 1);
  }
  return tokens;
}

const isKeyword = (token, word) => token?.type === 'word' && token.value.toUpperCase() === word;

/* ---------------------------------------------------------------- parser */

/**
 * Parses a query into { where, orderBy } where `where` is null (everything) or a node:
 *   { type: 'and' | 'or', left, right } | { type: 'not', expr }
 *   { type: 'clause', field, op, value, start, end }
 * value: { kind: 'literal', value } | { kind: 'list', values: [value] }
 *        | { kind: 'function', name, args: [string] } | { kind: 'empty' }
 * orderBy: [{ field, direction: 'ASC' | 'DESC' }]
 * Throws TqlError with the position of the problem.
 */
export function parse(input) {
  const text = String(input ?? '');
  const tokens = tokenize(text);
  let index = 0;
  const peek = () => tokens[index];
  const next = () => tokens[index++];
  const endPos = text.length;
  const where = (token) => token ? [token.start, token.end] : [endPos, endPos + 1];

  function expectError(message, token = peek()) {
    return new TqlError(message, ...where(token));
  }

  function parseValue(field, { allowList = false } = {}) {
    const token = peek();
    if (!token) throw expectError(`Missing a value for ${field.name}.`);
    if (token.type === 'lparen') {
      if (!allowList) throw expectError('A list ( ... ) can only follow IN or NOT IN.');
      next();
      const values = [];
      for (;;) {
        values.push(parseValue(field));
        if (values.length > MAX_LIST_SIZE) throw expectError(`A list can have at most ${MAX_LIST_SIZE} values.`);
        const separator = next();
        if (separator?.type === 'comma') continue;
        if (separator?.type === 'rparen') break;
        throw expectError('Expected "," or ")" in the list.', separator);
      }
      return { kind: 'list', values };
    }
    if (token.type === 'string') { next(); return checkLiteral(field, token.value, token); }
    if (token.type === 'word') {
      const upper = token.value.toUpperCase();
      if (KEYWORD_SET.has(upper) && upper !== 'EMPTY' && upper !== 'NULL') throw expectError(`Missing a value for ${field.name} before ${token.value}.`);
      if (tokens[index + 1]?.type === 'lparen') return parseFunction(field);
      next();
      return checkLiteral(field, token.value, token);
    }
    throw expectError(`Expected a value for ${field.name}.`);
  }

  function checkLiteral(field, value, token) {
    if ((field.kind === 'date' || field.kind === 'datetime') && !isDateLiteral(value)) {
      throw new TqlError(`"${value}" is not a date. Use "2026-11-19", "2026-11-19 14:30", a relative date such as -7d / +1w, or a function such as startOfDay().`, token.start, token.end);
    }
    if (field.kind === 'text' || field.kind === 'enum' || field.kind === 'user') {
      if (!String(value).trim()) throw new TqlError(`An empty value is not allowed for ${field.name}; use IS EMPTY.`, token.start, token.end);
    }
    return { kind: 'literal', value: String(value) };
  }

  function parseFunction(field) {
    const nameToken = next();
    const spec = FUNCTIONS[nameToken.value.toLowerCase()];
    if (!spec) throw new TqlError(`Unknown function ${nameToken.value}(). Functions: ${Object.values(FUNCTIONS).map((f) => `${f.name}()`).join(', ')}.`, nameToken.start, nameToken.end);
    if (!spec.kinds.includes(field.kind)) {
      throw new TqlError(`${spec.name}() cannot be used with ${field.name}.`, nameToken.start, nameToken.end);
    }
    next(); // (
    const args = [];
    while (peek() && peek().type !== 'rparen') {
      const arg = next();
      if (arg.type !== 'word' && arg.type !== 'string') throw expectError(`Unexpected ${arg.value} in ${spec.name}().`, arg);
      if (!OFFSET_LITERAL.test(arg.value)) throw new TqlError(`${spec.name}() takes an offset such as -1, +2d or -1w.`, arg.start, arg.end);
      args.push(arg.value);
      if (peek()?.type === 'comma') next();
    }
    const close = next();
    if (close?.type !== 'rparen') throw expectError(`Missing ")" after ${spec.name}(.`, close);
    if (args.length > spec.args) throw new TqlError(`${spec.name}() takes ${spec.args ? 'at most one argument' : 'no arguments'}.`, nameToken.start, close.end);
    return { kind: 'function', name: spec.name, args };
  }

  function parseClause() {
    const fieldToken = next();
    if (!fieldToken || fieldToken.type !== 'word') throw expectError('Expected a field name, e.g. status, assignee, project.', fieldToken);
    const field = fieldByName(fieldToken.value);
    if (!field) {
      throw new TqlError(`Unknown field "${fieldToken.value}". Fields: ${FIELDS.map((f) => f.name).join(', ')}.`, fieldToken.start, fieldToken.end);
    }
    const opToken = next();
    let op;
    if (opToken?.type === 'op') op = opToken.value;
    else if (isKeyword(opToken, 'IN')) op = 'IN';
    else if (isKeyword(opToken, 'NOT') && isKeyword(peek(), 'IN')) { next(); op = 'NOT IN'; }
    else if (isKeyword(opToken, 'IS')) {
      let negate = false;
      if (isKeyword(peek(), 'NOT')) { next(); negate = true; }
      const emptyToken = next();
      if (!isKeyword(emptyToken, 'EMPTY') && !isKeyword(emptyToken, 'NULL')) throw expectError('Expected EMPTY after IS / IS NOT.', emptyToken);
      op = negate ? 'IS NOT EMPTY' : 'IS EMPTY';
    } else {
      throw expectError(`Expected an operator after ${field.name}: ${operatorsFor(field).join(', ')}.`, opToken);
    }
    if (!operatorsFor(field).includes(op)) {
      throw new TqlError(`${field.name} does not support "${op}". Use ${operatorsFor(field).join(', ')}.`, opToken.start, (tokens[index - 1] || opToken).end);
    }
    let value;
    if (op === 'IS EMPTY' || op === 'IS NOT EMPTY') value = { kind: 'empty' };
    else if (op === 'IN' || op === 'NOT IN') {
      if (peek()?.type !== 'lparen') throw expectError(`${op} needs a list in brackets, e.g. ${field.name} ${op} ("A", "B").`);
      value = parseValue(field, { allowList: true });
    } else {
      value = parseValue(field);
      if (value.kind === 'literal' && (field.kind === 'enum' || field.kind === 'user') && isKeyword({ type: 'word', value: value.value }, 'EMPTY')) {
        value = { kind: 'empty' };
        op = op === '=' ? 'IS EMPTY' : 'IS NOT EMPTY';
      }
    }
    return { type: 'clause', field: field.name, op, value, start: fieldToken.start, end: (tokens[index - 1] || fieldToken).end };
  }

  function parseUnary(depth) {
    if (depth > MAX_DEPTH) throw expectError('The query is nested too deeply.');
    const token = peek();
    if (isKeyword(token, 'NOT')) { next(); return { type: 'not', expr: parseUnary(depth + 1) }; }
    if (token?.type === 'lparen') {
      next();
      const expr = parseOr(depth + 1);
      const close = next();
      if (close?.type !== 'rparen') throw expectError('Missing closing bracket ")".', close);
      return expr;
    }
    return parseClause();
  }

  function parseAnd(depth) {
    let left = parseUnary(depth);
    while (isKeyword(peek(), 'AND')) { next(); left = { type: 'and', left, right: parseUnary(depth) }; }
    return left;
  }

  function parseOr(depth) {
    let left = parseAnd(depth);
    while (isKeyword(peek(), 'OR')) { next(); left = { type: 'or', left, right: parseAnd(depth) }; }
    return left;
  }

  let whereNode = null;
  if (peek() && !isKeyword(peek(), 'ORDER')) whereNode = parseOr(0);
  const orderBy = [];
  if (isKeyword(peek(), 'ORDER')) {
    next();
    if (!isKeyword(next(), 'BY')) throw expectError('Expected BY after ORDER.', tokens[index - 1]);
    for (;;) {
      const fieldToken = next();
      const field = fieldToken?.type === 'word' ? fieldByName(fieldToken.value) : null;
      if (!field) throw expectError(fieldToken ? `Cannot sort by "${fieldToken.value}".` : 'Expected a field after ORDER BY.', fieldToken);
      let direction = 'ASC';
      if (isKeyword(peek(), 'ASC') || isKeyword(peek(), 'DESC')) direction = next().value.toUpperCase();
      orderBy.push({ field: field.name, direction });
      if (peek()?.type === 'comma') { next(); continue; }
      break;
    }
  }
  const rest = peek();
  if (rest) {
    if (rest.type === 'rparen') throw expectError('Unexpected ")" - is there an opening "(" for it?', rest);
    throw expectError(`Unexpected "${rest.value}". Join conditions with AND / OR.`, rest);
  }
  return { where: whereNode, orderBy };
}

/** { ok: true, ast } or { ok: false, error: { message, start, end } } */
export function validate(input) {
  try {
    return { ok: true, ast: parse(input) };
  } catch (error) {
    if (error instanceof TqlError) return { ok: false, error: { message: error.message, start: error.start, end: error.end } };
    throw error;
  }
}

/* ----------------------------------------------- highlighting & context */

/**
 * Tokens with a role for syntax highlighting: field | operator | keyword | function |
 * value | paren | comma | unknown. Works on incomplete queries.
 */
export function classifyTokens(input) {
  let tokens;
  try { tokens = tokenize(input, { tolerant: true }); } catch { return []; }
  let state = 'field'; // field -> operator -> value -> logic
  let inOrder = false;
  let listDepth = 0;
  let inFunction = 0; // 1 = function name seen, 2 = inside its brackets
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const upper = token.type === 'word' ? token.value.toUpperCase() : '';
    let role = 'unknown';
    if (inFunction === 1 && token.type === 'lparen') { role = 'function'; inFunction = 2; }
    else if (inFunction === 2 && token.type === 'rparen') { role = 'function'; inFunction = 0; if (!listDepth) state = 'logic'; }
    else if (inFunction === 2) role = 'value';
    else if (token.type === 'lparen') { role = 'paren'; if (state === 'value') listDepth += 1; }
    else if (token.type === 'rparen') { role = 'paren'; if (listDepth) { listDepth -= 1; if (!listDepth) state = 'logic'; } }
    else if (token.type === 'comma') role = 'comma';
    else if (token.type === 'op') { role = 'operator'; state = 'value'; }
    else if (token.type === 'string') { role = 'value'; if (!listDepth) state = 'logic'; }
    else if (inOrder) role = ['ASC', 'DESC', 'BY'].includes(upper) ? 'keyword' : fieldByName(token.value) ? 'field' : 'unknown';
    else if (upper === 'ORDER') { role = 'keyword'; inOrder = true; }
    else if ((upper === 'AND' || upper === 'OR') && state !== 'value') { role = 'keyword'; state = 'field'; }
    else if (upper === 'NOT' && state === 'field') role = 'keyword';
    else if (state === 'operator' && ['IN', 'NOT', 'IS', 'EMPTY', 'NULL'].includes(upper)) {
      role = 'operator';
      if (upper === 'IN') state = 'value';
      if (upper === 'EMPTY' || upper === 'NULL') state = 'logic';
    } else if (state === 'value' && (upper === 'EMPTY' || upper === 'NULL')) { role = 'operator'; state = 'logic'; }
    else if (state === 'field') { role = fieldByName(token.value) ? 'field' : 'unknown'; state = 'operator'; }
    else if (state === 'value') {
      if (tokens[i + 1]?.type === 'lparen' && FUNCTIONS[token.value.toLowerCase()]) { role = 'function'; inFunction = 1; }
      else { role = 'value'; if (!listDepth) state = 'logic'; }
    }
    out.push({ ...token, role });
  }
  return out;
}

/**
 * What the user can type at `cursor`: { expect, field, partial, from, to, used }.
 * expect: field | operator | value | logic | orderField | orderDirection
 */
export function contextAt(input, cursor = String(input ?? '').length) {
  const text = String(input ?? '').slice(0, cursor);
  let tokens;
  try { tokens = tokenize(text, { tolerant: true }); } catch { return { expect: 'none', partial: '', from: cursor, to: cursor }; }
  const last = tokens[tokens.length - 1];
  const typing = last && last.end === text.length && (last.type === 'word' || (last.type === 'string' && !last.closed));
  const partial = typing ? last.value : '';
  const from = typing ? last.start : cursor;
  const done = typing ? tokens.slice(0, -1) : tokens;

  let state = 'field';
  let field = null;
  let inOrder = false;
  let listOpen = false;
  let depth = 0;
  let afterIs = false;
  for (let i = 0; i < done.length; i += 1) {
    const token = done[i];
    const upper = token.type === 'word' ? token.value.toUpperCase() : '';
    if (inOrder) {
      if (upper === 'BY' || token.type === 'comma') state = 'orderField';
      else if (fieldByName(token.value)) state = 'orderDirection';
      else if (upper === 'ASC' || upper === 'DESC') state = 'orderNext';
      continue;
    }
    if (upper === 'ORDER') { inOrder = true; state = 'orderBy'; field = null; continue; }
    if (state === 'field') {
      if (token.type === 'lparen') { depth += 1; continue; }
      if (upper === 'NOT') continue;
      field = fieldByName(token.value);
      state = 'operator';
      continue;
    }
    if (state === 'operator') {
      if (token.type === 'op') { state = 'value'; continue; }
      if (upper === 'IN') { state = 'listStart'; continue; }
      if (upper === 'NOT') continue;
      if (upper === 'IS') { afterIs = true; continue; }
      if (afterIs && (upper === 'EMPTY' || upper === 'NULL')) { afterIs = false; state = 'logic'; continue; }
      continue;
    }
    if (state === 'listStart') { if (token.type === 'lparen') { listOpen = true; state = 'value'; } continue; }
    if (state === 'value') {
      if (token.type === 'word' && FUNCTIONS[token.value.toLowerCase()] && done[i + 1]?.type === 'lparen') {
        const close = done.slice(i + 1).findIndex((t) => t.type === 'rparen');
        if (close < 0) { state = 'functionArgs'; break; }
        i += 1 + close;
      }
      state = listOpen ? 'listNext' : 'logic';
      continue;
    }
    if (state === 'listNext') {
      if (token.type === 'comma') state = 'value';
      else if (token.type === 'rparen') { listOpen = false; state = 'logic'; }
      continue;
    }
    if (state === 'logic') {
      if (upper === 'AND' || upper === 'OR') { state = 'field'; field = null; continue; }
      if (token.type === 'rparen') { depth = Math.max(0, depth - 1); continue; }
    }
  }
  const map = {
    field: 'field', operator: afterIs ? 'isEmpty' : 'operator', value: 'value', listStart: 'listStart', listNext: 'listNext',
    logic: 'logic', orderBy: 'orderBy', orderField: 'orderField', orderDirection: 'orderDirection', orderNext: 'orderNext', functionArgs: 'none'
  };
  return { expect: map[state] || 'none', field: field?.name || null, fieldKind: field?.kind || null, partial, from, to: cursor, inString: typing && last.type === 'string', inList: listOpen, depth };
}

/* ------------------------------------------------------- query writing */

export function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** A value as TQL text: functions such as currentUser() stay bare, the rest is quoted. */
export function formatValue(value) {
  const text = String(value);
  if (/^[A-Za-z]+\([^()"']*\)$/.test(text) && FUNCTIONS[text.slice(0, text.indexOf('(')).toLowerCase()]) return text;
  return quote(text);
}

function valueText(value) {
  if (value.kind === 'function') return `${value.name}(${value.args.join(', ')})`;
  if (value.kind === 'list') return `(${value.values.map(valueText).join(', ')})`;
  if (value.kind === 'empty') return '';
  return quote(value.value);
}

/** Writes an AST back as TQL (normalised spacing and quoting). */
export function stringify({ where, orderBy = [] }) {
  const node = (n, parent) => {
    if (!n) return '';
    if (n.type === 'clause') return n.op.startsWith('IS') ? `${n.field} ${n.op}` : `${n.field} ${n.op} ${valueText(n.value)}`;
    if (n.type === 'not') return `NOT ${node(n.expr, 'not')}`;
    const text = `${node(n.left, n.type)} ${n.type.toUpperCase()} ${node(n.right, n.type)}`;
    return parent && parent !== n.type ? `(${text})` : text;
  };
  const order = orderBy.length ? `ORDER BY ${orderBy.map((o) => `${o.field} ${o.direction}`).join(', ')}` : '';
  return [node(where, null), order].filter(Boolean).join(' ');
}

/* ------------------------------------------------ Default mode <-> TQL */

// Default mode ("filter config"): what the dropdowns and inputs hold.
export const LIST_FIELDS = ['project', 'type', 'status', 'priority', 'assignee', 'creator', 'sprint', 'labels'];
export const TEXT_FIELDS = ['key', 'summary'];
export const DATE_FIELDS = ['startDate', 'dueDate', 'created', 'updated'];
export const EMPTY_VALUE = '__EMPTY__'; // "Unassigned", "No sprint" ...

export const ORDER_OPTIONS = [
  { id: 'created DESC', label: 'Newest created' },
  { id: 'created ASC', label: 'Oldest created' },
  { id: 'updated DESC', label: 'Recently updated' },
  { id: 'updated ASC', label: 'Least recently updated' },
  { id: 'priority DESC', label: 'Priority high to low' },
  { id: 'priority ASC', label: 'Priority low to high' },
  { id: 'dueDate ASC', label: 'Due date nearest' },
  { id: 'dueDate DESC', label: 'Due date latest' },
  { id: 'startDate ASC', label: 'Start date earliest' },
  { id: 'key ASC', label: 'Issue key' }
];
export const DEFAULT_ORDER = 'created DESC';

export function emptyConfig() {
  return {
    key: '', summary: '',
    ...Object.fromEntries(LIST_FIELDS.map((name) => [name, []])),
    dates: {},
    orderBy: DEFAULT_ORDER
  };
}

/** Label of a sort ("priority DESC" -> "Priority high to low", "status ASC" -> "Status ↑"). */
export function orderLabel(id) {
  const known = ORDER_OPTIONS.find((option) => option.id === id);
  if (known) return known.label;
  const [name, direction] = String(id).split(' ');
  const field = fieldByName(name);
  return field ? `${field.label} ${direction === 'DESC' ? '↓' : '↑'}` : String(id);
}

/** Default mode values -> TQL text. */
export function configToTql(config = {}) {
  const parts = [];
  for (const name of TEXT_FIELDS) {
    const text = String(config[name] || '').trim();
    if (text) parts.push(`${name} ~ ${quote(text)}`);
  }
  for (const name of LIST_FIELDS) {
    const values = Array.isArray(config[name]) ? config[name] : [];
    const real = values.filter((value) => value !== EMPTY_VALUE);
    const empty = values.includes(EMPTY_VALUE);
    let clause = '';
    if (real.length === 1) clause = `${name} = ${formatValue(real[0])}`;
    else if (real.length > 1) clause = `${name} IN (${real.map(formatValue).join(', ')})`;
    if (empty) clause = clause ? `(${clause} OR ${name} IS EMPTY)` : `${name} IS EMPTY`;
    if (clause) parts.push(clause);
  }
  for (const name of DATE_FIELDS) {
    const range = config.dates?.[name] || {};
    if (range.from && range.to && range.from === range.to) parts.push(`${name} = ${quote(range.from)}`);
    else {
      if (range.from) parts.push(`${name} >= ${quote(range.from)}`);
      if (range.to) parts.push(`${name} <= ${quote(range.to)}`);
    }
  }
  const order = config.orderBy && config.orderBy !== DEFAULT_ORDER ? `ORDER BY ${config.orderBy}` : '';
  return [parts.join(' AND '), order].filter(Boolean).join(' ');
}

function literalValue(value) {
  if (value.kind === 'function') return `${value.name}(${value.args.join(', ')})`;
  return value.value;
}

/**
 * TQL text -> Default mode values, or { error } when the query cannot be shown with the
 * dropdowns (OR between different fields, NOT, !=, functions on dates, several sorts...).
 */
export function tqlToConfig(input) {
  const result = validate(input);
  if (!result.ok) return { error: `The query has an error: ${result.error.message}` };
  const { where, orderBy } = result.ast;
  const config = emptyConfig();
  const seen = new Set();
  const unsupported = (why) => ({ error: `This query uses ${why}, which the Default filters cannot show. It stays in TQL mode.` });

  const clauses = [];
  const collect = (node) => {
    if (!node) return null;
    if (node.type === 'and') return collect(node.left) || collect(node.right);
    if (node.type === 'or') {
      // (field IN (...) OR field IS EMPTY) is the "include empty" option of a dropdown.
      const sides = [node.left, node.right];
      const empty = sides.find((side) => side.type === 'clause' && side.op === 'IS EMPTY');
      const other = sides.find((side) => side !== empty);
      if (empty && other?.type === 'clause' && other.field === empty.field && ['=', 'IN'].includes(other.op) && LIST_FIELDS.includes(other.field)) {
        clauses.push({ ...other, includeEmpty: true });
        return null;
      }
      return unsupported('OR between different conditions');
    }
    if (node.type === 'not') return unsupported('NOT');
    clauses.push(node);
    return null;
  };
  const problem = collect(where);
  if (problem) return problem;

  for (const clause of clauses) {
    const { field, op, value } = clause;
    const isDate = DATE_FIELDS.includes(field);
    const key = isDate ? `${field}${op}` : field;
    if (seen.has(key)) return unsupported(`${field} more than once`);
    seen.add(key);
    if (TEXT_FIELDS.includes(field)) {
      if (op !== '~' || value.kind !== 'literal') return unsupported(`"${field} ${op}"`);
      config[field] = value.value;
    } else if (LIST_FIELDS.includes(field)) {
      if (op === 'IS EMPTY') { config[field] = [EMPTY_VALUE]; continue; }
      if (op !== '=' && op !== 'IN') return unsupported(`"${field} ${op}"`);
      const values = (value.kind === 'list' ? value.values : [value]).map(literalValue);
      config[field] = clause.includeEmpty ? [...values, EMPTY_VALUE] : values;
    } else if (isDate) {
      if (value.kind !== 'literal' || !DATE_LITERAL.test(value.value) || value.value.length !== 10) return unsupported(`"${field} ${op} ${literalValue(value)}" (Default filters take calendar dates)`);
      const range = config.dates[field] || {};
      if (op === '>=') range.from = value.value;
      else if (op === '<=') range.to = value.value;
      else if (op === '=') { range.from = value.value; range.to = value.value; }
      else return unsupported(`"${field} ${op}"`);
      config.dates[field] = range;
    } else {
      return unsupported(`the ${field} field`);
    }
  }
  if (orderBy.length > 1) return unsupported('more than one sort field');
  if (orderBy.length === 1) config.orderBy = `${orderBy[0].field} ${orderBy[0].direction}`;
  return { config };
}
