import fs from 'node:fs';

const cssPath = process.argv[2] ?? 'src/renderer/src/styles.css';
const tsxPath = process.argv[3] ?? 'src/renderer/src/main.tsx';

const css = fs.readFileSync(cssPath, 'utf8');
const tsx = fs.readFileSync(tsxPath, 'utf8');

const classSelectorPattern = /\.([a-zA-Z_][a-zA-Z0-9_-]*)/g;
const cssMatches = [...css.matchAll(classSelectorPattern)];
const cssClassMap = new Map();
cssMatches.forEach((m) => {
  const name = m[1];
  const line = css.slice(0, m.index).split('\n').length;
  if (!cssClassMap.has(name)) cssClassMap.set(name, []);
  cssClassMap.get(name).push(line);
});

const classNamePattern = /className=(?:\{[^}]*\}|"([^"]*)"|'([^']*)')/g;
const tsxMatches = [...tsx.matchAll(classNamePattern)];
const jsxClasses = new Set();

const ignoreWords = new Set(['className', 'true', 'false', 'todayGuide', 'guide', 'view', 'current', 'active', 'done', 'paused', 'pending', 'type', 'item', 'status', 'isCurrentTask', 'primary', 'full', 'hidden', 'undefined', 'null', 'number', 'string', 'boolean', 'return', 'const', 'let', 'var', 'function', 'prototype-shell', 'collapsed', 'workspace', 'today-workspace', 'nav-item', 'sidebar', 'label']);

tsxMatches.forEach((m) => {
  const raw = m[1] ?? m[2] ?? m[0];
  const candidates = raw.match(/[a-zA-Z_][a-zA-Z0-9_-]*/g) ?? [];
  candidates.forEach((c) => {
    if (ignoreWords.has(c)) return;
    jsxClasses.add(c);
  });
});

const duplicates = [...cssClassMap.entries()].filter(([, lines]) => lines.length > 1).sort((a, b) => b[1].length - a[1].length);
console.log(`\n=== CSS analysis for ${cssPath} ===\n`);
console.log(`Total CSS class declarations: ${cssMatches.length}`);
console.log(`Unique CSS classes: ${cssClassMap.size}`);
console.log(`\nTop duplicated classes:`);
duplicates.slice(0, 80).forEach(([name, lines]) => {
  console.log(`  .${name}: ${lines.length} times (lines: ${lines.slice(0, 6).join(', ')}${lines.length > 6 ? '...' : ''})`);
});

const unusedInJsx = [...cssClassMap.keys()].filter((c) => !jsxClasses.has(c)).sort();
console.log(`\n=== CSS classes NOT referenced in main.tsx className (count: ${unusedInJsx.length}) ===`);
console.log(unusedInJsx.slice(0, 200).join(', '));

const missingInCss = [...jsxClasses].filter((c) => !cssClassMap.has(c)).sort();
console.log(`\n=== JSX classes NOT found in CSS (count: ${missingInCss.length}) ===`);
console.log(missingInCss.join(', '));

const lines = css.split('\n').length;
console.log(`\n=== File stats ===`);
console.log(`Lines: ${lines}`);
console.log(`Size: ${(fs.statSync(cssPath).size / 1024).toFixed(2)} KB`);

const ruleBlocks = css.match(/[^{]+\{[^}]*\}/g) ?? [];
console.log(`Approximate rule blocks: ${ruleBlocks.length}`);

// Find class definitions that appear near the end of file (most likely overrides)
console.log(`\n=== Last duplicate definitions (likely overrides causing edits not to take effect) ===`);
const problemChildren = duplicates.slice(0, 30).map(([name, lines]) => {
  const last = lines[lines.length - 1];
  return { name, count: lines.length, last, lines };
}).sort((a, b) => b.last - a.last);

problemChildren.forEach((p) => {
  console.log(`  .${p.name}: last def at line ${p.last}, ${p.count} defs total`);
});
