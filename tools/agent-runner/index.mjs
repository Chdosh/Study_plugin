#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { planTask, evaluateAcceptance } from './codex.mjs';
import { executeWithOpenCode } from './opencode.mjs';
import { runVerification } from './verifier.mjs';
import { captureEvidence } from './capture.mjs';
import { runPreflight } from './doctor.mjs';

const STATUSES = {
  IDLE: 'IDLE',
  PLANNING: 'PLANNING',
  EXECUTING: 'EXECUTING',
  VERIFYING: 'VERIFYING',
  EVALUATING: 'EVALUATING',
  REWORK: 'REWORK',
  PASS: 'PASS',
  BLOCKED: 'BLOCKED'
};

const root = process.cwd();
const statePath = join(root, '.agent', 'state.json');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await readJson(join(root, 'tools', 'agent-runner', 'workflow.config.json'));

  if (args.status) {
    console.log(await readTextIfExists(statePath, JSON.stringify(initialState(config), null, 2)));
    return;
  }

  let request = args.request;
  let images = args.images;
  let pauseAtEnd = false;
  if (args.ui) {
    const ui = promptWithPowerShell();
    request = ui.request;
    images = ui.images;
    pauseAtEnd = ui.pauseAtEnd;
  }

  if (!request || request.trim().length === 0) {
    throw new Error('缺少开发需求。使用 --request "..." 或双击 start-agent-runner.cmd。');
  }

  if (!args.mock) {
    const preflight = await runPreflight(config);
    if (!preflight.ok) {
      await writeBlockedPreflightState(config, preflight);
      console.log('真实模式启动前检查失败，已停止，未调用模型，未发送 OpenCode 开发任务。');
      for (const item of preflight.checks) {
        console.log(`[${item.status}] ${item.name}`);
        if (item.detail) console.log(`  ${item.detail}`);
      }
      console.log('修复建议：先运行 npm run agent:doctor；如 Codex 解析到 WindowsApps，请安装 npm 版 @openai/codex 并设置 CODEX_CLI_PATH。');
      return;
    }
  }

  const result = await runWorkflow({
    request,
    referenceImages: images,
    config,
    mock: args.mock
  });

  console.log(`\n最终状态: ${result.status}`);
  console.log(`运行目录: ${result.runDirectory}`);
  if (pauseAtEnd) {
    spawnSync('cmd', ['/c', 'pause'], { stdio: 'inherit' });
  }
}

export async function runWorkflow({ request, referenceImages = [], config, mock = false }) {
  const startedAt = new Date().toISOString();
  const runId = createRunId();
  const runDirectory = join(root, '.agent', 'runs', runId);
  await mkdir(runDirectory, { recursive: true });
  await mkdir(join(runDirectory, 'references'), { recursive: true });

  const copiedReferences = await copyReferenceImages(referenceImages, runDirectory);
  await writeFile(join(runDirectory, 'request.md'), request);

  const state = {
    runId,
    status: STATUSES.PLANNING,
    iteration: 0,
    maxReworks: config.maxReworks ?? 2,
    openCodeSessionId: null,
    startedAt,
    updatedAt: startedAt,
    lastError: null
  };
  await writeState(state);

  try {
    const task = await withStatus(state, STATUSES.PLANNING, async () => {
      return await planTask({ request, runDirectory, config, mock });
    });

    let verdict = null;
    while (state.iteration <= state.maxReworks) {
      const openCodeResult = await withStatus(state, STATUSES.EXECUTING, async () => {
        return await executeWithOpenCode({
          task,
          runDirectory,
          config,
          mock,
          sessionId: state.openCodeSessionId,
          reworkInstructions: verdict?.reworkInstructions ?? []
        });
      });
      state.openCodeSessionId = openCodeResult.sessionId;
      await writeState(state);

      const verificationResults = await withStatus(state, STATUSES.VERIFYING, async () => {
        return await runVerification({ runDirectory, config });
      });

      const captureResults = await withStatus(state, STATUSES.VERIFYING, async () => {
        return await captureEvidence({
          runDirectory,
          task,
          config,
          referenceImages: copiedReferences
        });
      });

      const execution = {
        iteration: state.iteration,
        opencode: openCodeResult.execution,
        verification: verificationResults,
        capture: captureResults
      };
      await writeFile(join(runDirectory, 'execution.json'), JSON.stringify(execution, null, 2));

      verdict = await withStatus(state, STATUSES.EVALUATING, async () => {
        return await evaluateAcceptance({ runDirectory, config, mock, iteration: state.iteration });
      });

      if (verdict.verdict === STATUSES.PASS || verdict.verdict === STATUSES.BLOCKED) {
        state.status = verdict.verdict;
        state.updatedAt = new Date().toISOString();
        await writeState(state);
        return { status: state.status, runId, runDirectory, verdict };
      }

      if (verdict.verdict !== 'REWORK') {
        throw new Error(`Unknown verdict: ${verdict.verdict}`);
      }

      if (state.iteration >= state.maxReworks) {
        state.status = STATUSES.BLOCKED;
        state.lastError = '达到最大返工次数后仍需返工。';
        state.updatedAt = new Date().toISOString();
        await writeState(state);
        return { status: state.status, runId, runDirectory, verdict };
      }

      state.status = STATUSES.REWORK;
      state.iteration += 1;
      state.updatedAt = new Date().toISOString();
      await writeState(state);
    }
  } catch (error) {
    state.status = STATUSES.BLOCKED;
    state.lastError = String(error.stack || error.message || error);
    state.updatedAt = new Date().toISOString();
    await writeState(state);
    await writeFile(join(runDirectory, 'runner-error.log'), state.lastError);
    return { status: state.status, runId, runDirectory, error };
  }

  state.status = STATUSES.BLOCKED;
  state.lastError = '状态机异常退出。';
  state.updatedAt = new Date().toISOString();
  await writeState(state);
  return { status: state.status, runId, runDirectory };
}

async function withStatus(state, status, fn) {
  state.status = status;
  state.updatedAt = new Date().toISOString();
  await writeState(state);
  return await fn();
}

function parseArgs(args) {
  const parsed = { mock: false, ui: false, status: false, request: '', images: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--mock') parsed.mock = true;
    else if (arg === '--ui') parsed.ui = true;
    else if (arg === '--status') parsed.status = true;
    else if (arg === '--request') parsed.request = args[++index] ?? '';
    else if (arg === '--images') parsed.images = (args[++index] ?? '').split(';').filter(Boolean);
  }
  return parsed;
}

function promptWithPowerShell() {
  const script = [
    'Add-Type -AssemblyName Microsoft.VisualBasic',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$request = [Microsoft.VisualBasic.Interaction]::InputBox("请输入一次开发需求：", "Agent Runner", "")',
    'if ([string]::IsNullOrWhiteSpace($request)) { exit 2 }',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    '$dialog.Title = "选择参考图片（可取消）"',
    '$dialog.Filter = "Images|*.png;*.jpg;*.jpeg;*.webp;*.gif|All files|*.*"',
    '$dialog.Multiselect = $true',
    '$images = ""',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $images = [string]::Join(";", $dialog.FileNames) }',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Write-Output ($request + "`n---IMAGES---`n" + $images)'
  ].join('; ');

  const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: false
  });
  if (result.status === 2) {
    throw new Error('用户取消输入。');
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || 'PowerShell input window failed.');
  }
  const [request, imageText = ''] = result.stdout.split('\n---IMAGES---\n');
  return {
    request: request.trim(),
    images: imageText.trim().split(';').filter(Boolean),
    pauseAtEnd: true
  };
}

async function copyReferenceImages(paths, runDirectory) {
  const copied = [];
  for (const imagePath of paths) {
    const source = resolve(imagePath);
    if (!existsSync(source)) continue;
    const target = join(runDirectory, 'references', basename(source));
    await cp(source, target);
    copied.push(`references/${basename(source)}`);
  }
  return copied;
}

function createRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeState(state) {
  await mkdir(join(root, '.agent'), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

async function writeBlockedPreflightState(config, preflight) {
  const now = new Date().toISOString();
  await writeState({
    runId: null,
    status: STATUSES.BLOCKED,
    iteration: 0,
    maxReworks: config.maxReworks ?? 2,
    openCodeSessionId: null,
    startedAt: now,
    updatedAt: now,
    lastError: preflight.checks
      .filter((item) => item.status === 'FAIL')
      .map((item) => `${item.name}: ${item.detail}`)
      .join('\n')
  });
}

function initialState(config) {
  return {
    runId: null,
    status: STATUSES.IDLE,
    iteration: 0,
    maxReworks: config.maxReworks ?? 2,
    openCodeSessionId: null,
    startedAt: null,
    updatedAt: null,
    lastError: null
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readTextIfExists(path, fallback) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return fallback;
  }
}

if (import.meta.url === `file://${process.argv[1].replaceAll('\\', '/')}` || process.argv[1]?.endsWith('index.mjs')) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}
