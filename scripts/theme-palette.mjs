#!/usr/bin/env node
/**
 * Theme palette generator.
 *
 * 1. Rewrites hard-coded colours in src/**\/*.css into CSS variables, grouped by
 *    role: --tf-bg-<hex> (backgrounds), --tf-fg-<hex> (text / icons) and
 *    --tf-bd-<hex> (borders, outlines, shadows).
 * 2. Regenerates src/theme/palette.css: in the light theme every variable keeps
 *    its original colour (so the light UI is unchanged); in the dark theme the
 *    colour is remapped by role (light surfaces become dark, dark text becomes
 *    light, saturated accents are kept).
 *
 * Idempotent: run `npm run theme:palette` again after adding new colours.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const OUTPUT = join(SRC, 'theme', 'palette.css');
const SKIP = new Set([join(SRC, 'theme.css'), OUTPUT]);

const ROLE_BY_PROPERTY = {
  background: 'bg',
  'background-color': 'bg',
  'background-image': 'bg',
  color: 'fg',
  fill: 'fg',
  stroke: 'fg',
  'caret-color': 'fg',
  'accent-color': 'fg',
  'text-decoration-color': 'fg',
  '-webkit-text-fill-color': 'fg'
};

function roleOf(property) {
  if (ROLE_BY_PROPERTY[property]) return ROLE_BY_PROPERTY[property];
  if (/^(border|outline|column-rule)(-|$)/.test(property) || property === 'box-shadow') return 'bd';
  return null;
}

const NAMED = { white: 'ffffff', black: '000000' };

function normalizeHex(raw) {
  let hex = raw.replace('#', '').toLowerCase();
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
  return hex;
}

// ---- colour maths -----------------------------------------------------------
function hexToRgb(hex) {
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex([h, s, l]) {
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let rgb;
  if (s === 0) rgb = [l, l, l];
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rgb = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  }
  return rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}

function darkVariant(role, hex) {
  const alpha = hex.slice(6);
  let [h, s, l] = rgbToHsl(hexToRgb(hex.slice(0, 6)));
  // Pure greys/white surfaces take the app's cool slate hue in the dark theme
  // so they match the rest of the dark UI instead of looking flat grey.
  if (role !== 'fg' && s < 0.08) [h, s] = [0.6, 0.3];
  let next = [h, s, l];

  if (role === 'bg') {
    // Light surfaces and tints become dark surfaces; greys become mid-dark;
    // saturated or already dark fills (buttons, badges, tooltips) are kept.
    if (l >= 0.8) next = [h, s * 0.45, 0.11 + (1 - l) * 0.55];
    else if (l >= 0.55 && s < 0.3) next = [h, s, 0.3 + (0.8 - l) * 0.5];
  } else if (role === 'fg') {
    // Dark text becomes light text; mid tones are lifted; light text is kept.
    if (l < 0.35) next = [h, s, 0.93 - l * 0.6];
    else if (l < 0.6) next = [h, s, Math.max(l, 0.62 + (0.6 - l) * 0.3)];
  } else if (role === 'bd') {
    // Light hairlines become dark hairlines; accent borders are kept.
    if (l >= 0.75) next = [h, s * 0.5, 0.2 + (1 - l) * 0.5];
  }
  return hslToHex(next) + alpha;
}

// ---- rewrite ----------------------------------------------------------------
function listCss(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listCss(path);
    return path.endsWith('.css') && !SKIP.has(path) ? [path] : [];
  });
}

const DECLARATION = /(?<![\w-])([a-z-]+)(\s*:\s*)([^;{}]+)/g;
const COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:white|black)\b/g;
const TOKEN = /var\(--tf-(bg|fg|bd)-([0-9a-f]{6}(?:[0-9a-f]{2})?)\)/g;

let rewritten = 0;
const tokens = new Map();

for (const file of listCss(SRC)) {
  const source = readFileSync(file, 'utf8');
  const output = source.replace(DECLARATION, (match, property, separator, value) => {
    const role = roleOf(property);
    if (!role) return match;
    const nextValue = value.replace(COLOR, (color) => {
      const hex = NAMED[color] || normalizeHex(color);
      return `var(--tf-${role}-${hex})`;
    });
    return property + separator + nextValue;
  });
  if (output !== source) {
    writeFileSync(file, output);
    rewritten += 1;
    console.log(`tokenized ${relative(ROOT, file)}`);
  }
  for (const [, role, hex] of output.matchAll(TOKEN)) tokens.set(`${role}-${hex}`, { role, hex });
}

const sorted = [...tokens.values()].sort((a, b) =>
  a.role.localeCompare(b.role) || a.hex.localeCompare(b.hex));
const lines = (pick) => sorted.map(({ role, hex }) => `  --tf-${role}-${hex}: #${pick(role, hex)};`).join('\n');

writeFileSync(OUTPUT, `/*
 * GENERATED by scripts/theme-palette.mjs — do not edit by hand.
 * Run \`npm run theme:palette\` after adding colours to component CSS.
 * Light values are the original design colours; dark values are derived by role.
 */
:root {
${lines((_role, hex) => hex)}
}

:root[data-theme="dark"] {
${lines(darkVariant)}
}
`);

console.log(`\n${rewritten} file(s) rewritten, ${sorted.length} palette token(s) written to ${relative(ROOT, OUTPUT)}`);
