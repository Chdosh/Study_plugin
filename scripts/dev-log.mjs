#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const memoryPath = resolve(root, 'docs', 'PROJECT_MEMORY.md');
const validKinds = new Set(['step', 'decision', 'blocker', 'risk', 'note']);
const kindLabels = {
  step: '步骤',
  decision: '决策',
  blocker: '阻塞',
  risk: '风险',
  note: '备注'
};

const [, , kind = '', ...messageParts] = process.argv;
const message = messageParts.join(' ').trim();

if (!validKinds.has(kind) || !message) {
  console.error('用法: npm run devlog -- <step|decision|blocker|risk|note> "中文记录内容"');
  process.exit(1);
}

if (!existsSync(memoryPath)) {
  writeFileSync(
    memoryPath,
    '# 项目记忆\n\n## 当前状态\n- 项目记忆已初始化。\n\n## 近期开发记录\n',
    'utf8'
  );
}

const now = new Date().toISOString();
const label = kindLabels[kind];
const entry = `- ${now} [${label}] ${message}\n`;
const current = readFileSync(memoryPath, 'utf8');

if (current.includes('## 近期开发记录')) {
  const updated = current.replace('## 近期开发记录\n', `## 近期开发记录\n${entry}`);
  writeFileSync(memoryPath, updated, 'utf8');
} else if (current.includes('## Recent Work Log')) {
  const updated = current.replace('## Recent Work Log\n', `## Recent Work Log\n${entry}`);
  writeFileSync(memoryPath, updated, 'utf8');
} else {
  appendFileSync(memoryPath, `\n## 近期开发记录\n${entry}`, 'utf8');
}

console.log(`已记录${label}: ${message}`);
