#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const memoryPath = resolve(root, 'docs', 'PROJECT_MEMORY.md');
const validKinds = new Set(['step', 'decision', 'blocker', 'risk', 'note']);

const [, , kind = '', ...messageParts] = process.argv;
const message = messageParts.join(' ').trim();

if (!validKinds.has(kind) || !message) {
  console.error('Usage: npm run devlog -- <step|decision|blocker|risk|note> "message"');
  process.exit(1);
}

if (!existsSync(memoryPath)) {
  writeFileSync(
    memoryPath,
    '# Project Memory\n\n## Current State\n- Project memory initialized.\n\n## Recent Work Log\n',
    'utf8'
  );
}

const now = new Date().toISOString();
const label = kind.toUpperCase();
const entry = `- ${now} [${label}] ${message}\n`;
const current = readFileSync(memoryPath, 'utf8');

if (current.includes('## Recent Work Log')) {
  const updated = current.replace('## Recent Work Log\n', `## Recent Work Log\n${entry}`);
  writeFileSync(memoryPath, updated, 'utf8');
} else {
  appendFileSync(memoryPath, `\n## Recent Work Log\n${entry}`, 'utf8');
}

console.log(`Logged ${kind}: ${message}`);
