import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_CSS = path.join(ROOT, 'src/renderer/src/styles.css.original');
const ENTRY_CSS = path.join(ROOT, 'src/renderer/src/styles.css');
const OUT_DIR = path.join(ROOT, 'src/renderer/src/styles');
const JSX_CLASSES_PATH = path.join(ROOT, 'scripts/jsx-classes.txt');

if (!fs.existsSync(SRC_CSS)) {
  throw new Error(`Backup CSS not found: ${SRC_CSS}. Run: copy src\\renderer\\src\\styles.css src\\renderer\\src\\styles.css.original`);
}

const css = fs.readFileSync(SRC_CSS, 'utf8');
const jsxClasses = new Set(
  fs.existsSync(JSX_CLASSES_PATH)
    ? fs.readFileSync(JSX_CLASSES_PATH, 'utf8').split(/\r?\n/).filter(Boolean)
    : []
);

// Always keep structural / dynamic state classes that may be applied conditionally
[
  'active', 'paused', 'done', 'current', 'pending', 'planned', 'loading', 'empty', 'error', 'ai-unavailable',
  'completed', 'partial', 'accepted', 'rejected', 'confirmed', 'draft', 'archived', 'skipped', 'primary', 'danger',
  'success', 'warning', 'info', 'muted', 'user', 'assistant', 'expanded', 'rotated', 'inline', 'open', 'choice',
  'today', 'study', 'review', 'settings', 'settlement', 'redesigned', 'prototype-shell', 'sidebar', 'workspace',
  'nav-item', 'nav-label', 'nav-list', 'brand', 'brand-mark', 'topbar', 'topbar-actions', 'topbar-subtitle'
].forEach((c) => jsxClasses.add(c));

function removeComments(input) {
  return input.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseBlocks(input, start = 0, end = input.length) {
  const blocks = [];
  let i = start;
  while (i < end) {
    while (i < end && /\s/.test(input[i])) i++;
    if (i >= end) break;

    if (input[i] === '/' && input[i + 1] === '*') {
      const close = input.indexOf('*/', i + 2);
      i = close === -1 ? end : close + 2;
      continue;
    }

    if (input[i] === '@') {
      const atKeyword = input.slice(i).match(/^@[\w-]+/)[0];
      const preBraceStart = i + atKeyword.length;
      const braceOpen = input.indexOf('{', preBraceStart);
      if (braceOpen === -1 || braceOpen > end) break;
      let depth = 1;
      let j = braceOpen + 1;
      while (j < end && depth > 0) {
        if (input[j] === '{') depth++;
        else if (input[j] === '}') depth--;
        j++;
      }
      const body = input.slice(braceOpen + 1, j - 1);
      if (atKeyword === '@media') {
        const query = input.slice(preBraceStart, braceOpen).trim();
        blocks.push({ type: 'media', query, blocks: parseBlocks(body, 0, body.length) });
      } else {
        blocks.push({ type: 'at-rule', name: atKeyword, body });
      }
      i = j;
      continue;
    }

    const braceOpen = input.indexOf('{', i);
    if (braceOpen === -1 || braceOpen > end) break;
    const selector = input.slice(i, braceOpen).trim();
    let depth = 1;
    let j = braceOpen + 1;
    while (j < end && depth > 0) {
      if (input[j] === '{') depth++;
      else if (input[j] === '}') depth--;
      j++;
    }
    const declarations = input.slice(braceOpen + 1, j - 1).trim();
    blocks.push({ type: 'rule', selector, declarations });
    i = j;
  }
  return blocks;
}

function extractClassNames(selector) {
  return [...selector.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)].map((m) => m[1]);
}

function isUsed(selector) {
  const classes = extractClassNames(selector);
  if (classes.length === 0) return true;
  return classes.some((c) => jsxClasses.has(c));
}

function collectRules(blocks, media = '', collector) {
  for (const block of blocks) {
    if (block.type === 'media') {
      collectRules(block.blocks, block.query, collector);
    } else if (block.type === 'rule') {
      const selectors = block.selector.split(',').map((s) => s.trim()).filter(Boolean);
      for (const selector of selectors) {
        if (!isUsed(selector)) continue;
        const key = `${media}|${selector}`;
        if (!collector.has(key)) collector.set(key, new Map());
        const props = collector.get(key);
        for (const line of block.declarations.split(';')) {
          const decl = line.trim();
          if (!decl) continue;
          const colon = decl.indexOf(':');
          if (colon === -1) continue;
          const prop = decl.slice(0, colon).trim();
          const value = decl.slice(colon + 1).trim();
          if (!prop || !value) continue;
          props.set(prop, value);
        }
      }
    }
  }
}

function renderRule(selector, props) {
  const decls = [...props.entries()]
    .map(([p, v]) => `  ${p}: ${v};`)
    .join('\n');
  if (!decls) return '';
  return `${selector} {\n${decls}\n}`;
}

function classify(selector) {
  const s = selector.toLowerCase();
  if (s.includes(':root')) return 'tokens';
  if (s.includes('intake-') || s.includes('goal-brief-editor') || s.includes('brief-summary-list') || s.includes('generation-path')) return 'intake';
  if (s.includes('today-') || s.includes('goal-strip-') || s.includes('task-summary-') || s.includes('progress-ring-widget') || s.includes('progress-ring-stats') || s.includes('progress-ring-card')) return 'today';
  if (s.includes('study-') || s.includes('step-outline-') || s.includes('session-') || s.includes('focus-execution') || s.includes('focus-work') || s.includes('focus-help') || s.includes('focus-state') || s.includes('focus-eyebrow') || s.includes('back-today') || s.includes('end-study')) return 'study';
  if (s.includes('review-') || s.includes('mini-bar-chart') || s.includes('bar-column') || s.includes('bar-fill') || s.includes('bar-track') || s.includes('timeline-') || s.includes('advice-list') || s.includes('adjustment-choice') || s.includes('settlement-options') || s.includes('issue-') || s.includes('history-')) return 'review';
  if (s.includes('settings-') || s.includes('compact-form') || s.includes('form-grid') || s.includes('toggle-row') || s.includes('prompt-editor-card')) return 'settings';
  if (s.includes('prototype-shell') || s.includes('sidebar') || s.includes('workspace') || s.includes('topbar') || s.includes('nav-') || s.includes('brand') || s.includes('main') || s.includes('header') || s.includes('footer')) return 'layout';
  if (s.includes('primary-action') || s.includes('secondary-action') || s.includes('text-action') || s.includes('icon-button') || s.includes('state-panel') || s.includes('modal-') || s.includes('surface') || s.includes('context-card') || s.includes('context-section') || s.includes('message-content') || s.includes('progress-ring') || s.includes('ai-drawer') || s.includes('assistant-message') || s.includes('assistant-tabs') || s.includes('notification-button') || s.includes('date-chip') || s.includes('micro-hint') || s.includes('section-heading') || s.includes('upload-dropzone') || s.includes('help-button')) return 'components';
  if (/^\s*(html|body|\*|button|select|textarea|input|h[1-6]|p|ul|ol|li|code|pre|strong|small|hr|a|label|fieldset|legend|details|summary)\b/.test(s)) return 'base';
  return 'utilities';
}

const allRules = new Map();
const plainCss = removeComments(css);
const blocks = parseBlocks(plainCss);

collectRules(blocks, '', allRules);

const atRules = [];
for (const block of blocks) {
  if (block.type === 'at-rule' && !block.name.startsWith('@media')) {
    atRules.push(block);
  }
}

const categories = {
  tokens: [],
  base: [],
  layout: [],
  components: [],
  intake: [],
  today: [],
  study: [],
  review: [],
  settings: [],
  utilities: []
};

const order = ['tokens', 'base', 'layout', 'components', 'intake', 'today', 'study', 'review', 'settings', 'utilities'];

for (const [key, props] of allRules.entries()) {
  const [media, selector] = key.split('|');
  const cat = classify(selector);
  categories[cat].push({ media, selector, props });
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Ensure :root comes first in tokens
if (categories.tokens.length > 0) {
  const rootIdx = categories.tokens.findIndex((r) => r.selector.includes(':root'));
  if (rootIdx > 0) {
    const [root] = categories.tokens.splice(rootIdx, 1);
    categories.tokens.unshift(root);
  }
}

function renderGroup(items) {
  const mediaMap = new Map();
  const plain = [];
  for (const item of items) {
    if (item.media) {
      if (!mediaMap.has(item.media)) mediaMap.set(item.media, []);
      mediaMap.get(item.media).push(item);
    } else {
      plain.push(item);
    }
  }
  const parts = [];
  if (plain.length) {
    parts.push(plain.map((r) => renderRule(r.selector, r.props)).filter(Boolean).join('\n\n'));
  }
  for (const [query, rules] of mediaMap.entries()) {
    const body = rules.map((r) => renderRule(r.selector, r.props)).filter(Boolean).join('\n\n');
    if (body) parts.push(`@media ${query} {\n${indent(body)}\n}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

function indent(text) {
  return text.split('\n').map((line) => (line.trim() ? `  ${line}` : line)).join('\n');
}

for (const cat of order) {
  const content = renderGroup(categories[cat]);
  if (!content && cat !== 'utilities') continue;
  if (cat === 'utilities') {
    const atRuleContent = atRules.map((r) => `${r.name} {\n${indent(r.body)}\n}`).join('\n\n');
    const combined = [content, atRuleContent].filter(Boolean).join('\n\n');
    if (!combined) continue;
    fs.writeFileSync(path.join(OUT_DIR, `${cat}.css`), `/* ${cat.toUpperCase()} */\n\n${combined}\n`);
  } else {
    fs.writeFileSync(path.join(OUT_DIR, `${cat}.css`), `/* ${cat.toUpperCase()} */\n\n${content}\n`);
  }
}

const existingFiles = order.filter((cat) => fs.existsSync(path.join(OUT_DIR, `${cat}.css`)));
const entryContent = `/* Study Supervisor styles — split by domain */\n${existingFiles.map((cat) => `@import './styles/${cat}.css';`).join('\n')}\n`;
fs.writeFileSync(ENTRY_CSS, entryContent);

console.log(`Wrote ${existingFiles.length} files to ${OUT_DIR}`);
console.log(`Entry: ${ENTRY_CSS}`);

const totalLines = existingFiles.reduce((sum, cat) => {
  const file = path.join(OUT_DIR, `${cat}.css`);
  return sum + fs.readFileSync(file, 'utf8').split('\n').length;
}, 0);
console.log(`Original: ${css.split('\n').length} lines, ${(fs.statSync(SRC_CSS).size / 1024).toFixed(2)} KB`);
console.log(`New total: ${totalLines} lines`);

const allClasses = new Set([...css.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
const usedClasses = new Set([...allRules.keys()].flatMap((k) => extractClassNames(k.split('|')[1])));
const removed = [...allClasses].filter((c) => !usedClasses.has(c)).sort();
console.log(`Removed ~${removed.length} unused CSS classes`);
if (removed.length > 0) {
  console.log('Sample removed:', removed.slice(0, 40).join(', '));
}
