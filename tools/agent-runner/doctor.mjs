#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureEvidence } from './capture.mjs';
import { resolveCodexCli, runCodexCli, redactSensitive } from './codex-cli.mjs';
import { checkOpenCodeLocal, checkOpenCodeOnline } from './opencode.mjs';

const root = process.cwd();

export async function runDoctor({ online = false, quiet = false } = {}) {
  const config = await readConfig();
  const results = [];
  const push = async (name, fn, options = {}) => {
    if (options.onlineOnly && !online) {
      results.push({ name, status: 'SKIP', detail: '需要 --online。' });
      return;
    }
    try {
      const detail = await fn();
      results.push({ name, status: 'PASS', detail });
    } catch (error) {
      results.push({ name, status: options.optional ? 'SKIP' : 'FAIL', detail: redactSensitive(error.message || String(error)) });
    }
  };

  await push('Node 和 npm 版本', checkNodeAndNpm);
  await push('当前目录是 Git 仓库', checkGitRepository);
  await push('工作目录可写', checkWritable);
  await push('workflow.config.json 有效', () => checkWorkflowConfig(config));
  await push('验证和 capture 命令存在', () => checkConfiguredCommands(config));
  await push('Codex CLI 路径、版本和登录状态', () => checkCodexLocal(config));
  await push('OpenCode SDK 能启动本地服务', () => checkOpenCodeService(config));
  await push('OpenCode provider 和 MiMo 模型配置', () => checkMimoProvider(config));
  await push('Codex 最小结构化 JSON 请求', () => checkCodexOnline(config), { onlineOnly: true });
  await push('MiMo 最小结构化 JSON 请求', () => checkMimoOnline(config), { onlineOnly: true });
  await push('Electron capture 依赖和输出目录', () => checkCapture(config));

  if (!quiet) printResults(results);
  return results;
}

export async function runPreflight(config) {
  const checks = [];
  const run = async (name, fn) => {
    try {
      const detail = await fn();
      checks.push({ name, status: 'PASS', detail });
    } catch (error) {
      checks.push({ name, status: 'FAIL', detail: redactSensitive(error.message || String(error)) });
    }
  };

  await run('Codex CLI 可执行且已登录', () => checkCodexLocal(config));
  await run('OpenCode 服务能够启动', () => checkOpenCodeService(config));
  await run('MiMo provider/model 配置存在', () => checkMimoProvider(config));
  await run('项目验证命令存在', () => checkConfiguredCommands(config));

  return {
    ok: checks.every((item) => item.status === 'PASS'),
    checks
  };
}

async function checkNodeAndNpm() {
  const npm = runShell('npm --version');
  if (npm.status !== 0) throw new Error(`npm 不可用：${npm.stderr || npm.stdout}`);
  return `node ${process.version}, npm ${npm.stdout.trim()}`;
}

async function checkGitRepository() {
  const result = runShell('git rev-parse --is-inside-work-tree');
  if (result.status !== 0 || result.stdout.trim() !== 'true') {
    throw new Error('当前目录不是 Git 仓库。');
  }
  return 'Git 仓库已识别。';
}

async function checkWritable() {
  const directory = join(root, '.agent');
  await mkdir(directory, { recursive: true });
  const testPath = join(directory, `.doctor-write-${Date.now()}.tmp`);
  await writeFile(testPath, 'ok');
  await rm(testPath, { force: true });
  return '.agent 可写。';
}

async function checkWorkflowConfig(config) {
  const required = ['typecheck', 'test', 'build', 'start'];
  for (const key of required) {
    if (!config.commands?.[key]) throw new Error(`缺少 commands.${key}`);
  }
  if (!config.capture) throw new Error('缺少 capture 配置。');
  if (!config.codex?.planningSchema || !config.codex?.verdictSchema) {
    throw new Error('缺少 Codex schema 配置。');
  }
  return 'workflow.config.json 可解析且关键字段存在。';
}

async function checkConfiguredCommands(config) {
  const keys = ['typecheck', 'test', 'build', 'start'];
  const missing = keys.filter((key) => !config.commands?.[key]);
  if (missing.length > 0) throw new Error(`缺少命令：${missing.join(', ')}`);
  if (config.capture?.enabled === false) throw new Error('capture.enabled 为 false。');
  return keys.map((key) => `${key}=${config.commands[key]}`).join('; ');
}

async function checkCodexLocal(config) {
  const resolved = await resolveCodexCli();
  if (!resolved.ok) throw new Error(`${resolved.reason}${resolved.path ? ` 路径：${resolved.path}` : ''}`);
  const version = await runCodexCli({
    cliPath: resolved.path,
    args: ['--version'],
    cwd: root,
    timeoutMs: 20000
  });
  if (version.exitCode !== 0) {
    throw new Error(`Codex --version 失败：${version.stderr || version.stdout}`);
  }
  const doctor = await runCodexCli({
    cliPath: resolved.path,
    args: ['doctor'],
    cwd: root,
    timeoutMs: 30000
  });
  if (doctor.exitCode !== 0) {
    throw new Error(`Codex doctor 失败，可能未登录或配置不可用：${doctor.stderr || doctor.stdout}`);
  }
  return `${resolved.path} (${version.stdout.trim() || 'version ok'})`;
}

async function checkOpenCodeService(config) {
  const info = await checkOpenCodeLocal(config);
  if (!info.healthy) throw new Error('OpenCode health check 未通过。');
  return 'OpenCode 本地服务启动成功。';
}

async function checkMimoProvider(config) {
  const info = await checkOpenCodeLocal(config);
  if (!info.hasMimo) {
    throw new Error('未在 OpenCode provider/default model 配置中识别到 MiMo/Xiaomi。请先配置 MiMo provider 和模型。');
  }
  return '已识别 MiMo/Xiaomi provider 或模型配置。';
}

async function checkCodexOnline(config) {
  const directory = join(root, '.agent', 'doctor');
  await mkdir(directory, { recursive: true });
  const schemaPath = join(directory, 'codex-minimal.schema.json');
  const outputPath = join(directory, 'codex-minimal.json');
  await writeFile(schemaPath, JSON.stringify({
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'message'],
    properties: {
      ok: { type: 'boolean' },
      message: { type: 'string' }
    }
  }, null, 2));
  const resolved = await resolveCodexCli();
  if (!resolved.ok) throw new Error(resolved.reason);
  const result = await runCodexCli({
    cliPath: resolved.path,
    args: [
      'exec',
      '--sandbox',
      'read-only',
      '--output-schema',
      schemaPath,
      '--output-last-message',
      outputPath,
      '-'
    ],
    cwd: directory,
    timeoutMs: config.timeouts?.codexMs ?? 180000,
    logPrefix: join(directory, 'codex-online'),
    input: '只输出 {"ok":true,"message":"codex online"}，不要读取或修改项目文件。'
  });
  if (result.exitCode !== 0) throw new Error(`Codex online 请求失败：${result.stderr || result.stdout}`);
  const parsed = JSON.parse(await readFile(outputPath, 'utf8'));
  if (parsed.ok !== true) throw new Error('Codex 返回 JSON 不符合预期。');
  return 'Codex 最小 JSON 请求通过。';
}

async function checkMimoOnline(config) {
  const result = await checkOpenCodeOnline(config);
  if (result?.ok === true || result?.status || result?.summary) {
    return 'MiMo 最小 JSON 请求返回。';
  }
  throw new Error('MiMo online 返回内容无法识别。');
}

async function checkCapture(config) {
  await access(resolve('node_modules/electron'));
  const directory = join(root, '.agent', 'doctor', 'capture-check');
  await mkdir(directory, { recursive: true });
  const result = await captureEvidence({
    runDirectory: directory,
    task: { title: 'doctor capture check' },
    config,
    referenceImages: []
  });
  if (!result.supported || result.screenshots.length === 0) {
    throw new Error(`capture 未完成：${result.runtimeErrors?.[0] || result.unsupportedSteps?.[0] || 'no screenshot'}`);
  }
  return `capture 输出 ${result.screenshots[0]}`;
}

function runShell(command) {
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  return {
    status: result.status,
    stdout: redactSensitive(result.stdout || ''),
    stderr: redactSensitive(result.stderr || '')
  };
}

function printResults(results) {
  for (const item of results) {
    console.log(`[${item.status}] ${item.name}`);
    if (item.detail) console.log(`  ${item.detail}`);
  }
}

async function readConfig() {
  return JSON.parse(await readFile(join(root, 'tools', 'agent-runner', 'workflow.config.json'), 'utf8'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runDoctor({ online: process.argv.includes('--online') }).then((results) => {
    process.exitCode = results.some((item) => item.status === 'FAIL') ? 1 : 0;
  }).catch((error) => {
    console.error(redactSensitive(error.stack || error.message || error));
    process.exitCode = 1;
  });
}
