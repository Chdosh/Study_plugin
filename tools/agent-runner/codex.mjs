import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { resolveCodexCli, runCodexCli } from './codex-cli.mjs';

export async function planTask({ request, runDirectory, config, mock }) {
  if (mock) {
    const task = createMockTask(request);
    await writeFile(join(runDirectory, 'task.json'), JSON.stringify(task, null, 2));
    return task;
  }

  const outputPath = join(runDirectory, 'task.json');
  const prompt = [
    '你是产品规划 Agent。根据用户需求生成结构化开发任务。',
    '只输出符合 JSON Schema 的 task.json。',
    '不要修改项目文件。',
    '',
    `用户需求：\n${request}`
  ].join('\n');

  await runCodexExec({
    phase: 'planning',
    prompt,
    outputPath,
    schemaPath: resolve(config.codex?.planningSchema ?? 'tools/agent-runner/schemas/task.schema.json'),
    cwd: process.cwd(),
    runDirectory,
    config
  });

  return JSON.parse(await readFile(outputPath, 'utf8'));
}

export async function evaluateAcceptance({ runDirectory, config, mock, iteration }) {
  if (mock) {
    const verdict = iteration === 0 ? createMockReworkVerdict() : createMockPassVerdict();
    await writeFile(join(runDirectory, `verdict-iteration-${iteration}.json`), JSON.stringify(verdict, null, 2));
    await writeFile(join(runDirectory, 'verdict.json'), JSON.stringify(verdict, null, 2));
    return verdict;
  }

  const outputPath = join(runDirectory, 'verdict.json');
  const images = await collectEvaluationImages(runDirectory);
  const prompt = [
    '你是产品和功能验收 Agent，只做验收，不做常规代码 diff 审查。',
    '当前工作目录是一个验收包，只能基于包内 request.md、task.json、execution.json、日志、交互结果、参考图和实际截图判断。',
    '请判断：功能是否完成、是否达到用户预期、视觉结果与参考目标差距、交互是否正确、报错可能指向哪个模块、下一轮如何返工。',
    '返回 PASS、REWORK 或 BLOCKED，并输出符合 JSON Schema 的 verdict.json。'
  ].join('\n');

  await runCodexExec({
    phase: 'evaluation',
    prompt,
    outputPath,
    schemaPath: resolve(config.codex?.verdictSchema ?? 'tools/agent-runner/schemas/verdict.schema.json'),
    cwd: runDirectory,
    runDirectory,
    config,
    images
  });

  return JSON.parse(await readFile(outputPath, 'utf8'));
}

export async function runCodexExec({ phase, prompt, outputPath, schemaPath, cwd, runDirectory, config, images = [] }) {
  await mkdir(join(runDirectory, 'logs'), { recursive: true });
  const resolved = await resolveCodexCli();
  if (!resolved.ok) {
    throw new Error(resolved.reason);
  }

  const args = [
    'exec',
    '--sandbox',
    'read-only',
    '--output-schema',
    schemaPath,
    '--output-last-message',
    outputPath
  ];
  if (images.length > 0) {
    args.push('--image', images.join(','));
  }
  args.push('-');

  const result = await runCodexCli({
    cliPath: resolved.path,
    args,
    cwd,
    timeoutMs: config.timeouts?.codexMs ?? 180000,
    logPrefix: join(runDirectory, 'logs', `codex-${phase}`),
    input: prompt
  });

  if (result.exitCode !== 0) {
    throw new Error(`Codex ${phase} failed with exit code ${result.exitCode}. See ${result.stderrFile}.`);
  }
}

function createMockTask(request) {
  const now = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    taskId: `mock-task-${now}`,
    title: 'Mock 开发任务',
    userRequest: request,
    summary: '在 mock 模式下生成的结构化任务，用于验证双 Agent 调度状态机。',
    requirements: ['记录用户需求', '模拟 OpenCode 执行', '执行独立验证命令', '生成验收包'],
    acceptanceCriteria: ['状态机能进入 REWORK', '返工后能进入 PASS', '证据文件落盘'],
    implementationHints: ['不要修改业务代码', '优先验证调度器自身流程'],
    verificationPlan: ['运行配置中的 typecheck、test、build', '执行 captureEvidence'],
    constraints: ['不得自动 commit', '不得自动 push', '最多两次返工']
  };
}

function createMockReworkVerdict() {
  return {
    verdict: 'REWORK',
    summary: 'mock 验收：第一轮要求返工，用于验证自动返工通路。',
    completed: false,
    userExpectationFit: '基本任务流已跑通，但 mock 规则要求至少返工一次。',
    visualComparison: 'mock 模式不判断真实视觉差距。',
    interactionResult: 'interaction-results.json 已生成。',
    likelyProblemModules: ['tools/agent-runner/index.mjs'],
    reworkInstructions: ['继续原 OpenCode 会话，确认返工指令能进入同一会话。'],
    blockingReason: null
  };
}

function createMockPassVerdict() {
  return {
    verdict: 'PASS',
    summary: 'mock 验收：返工后通过。',
    completed: true,
    userExpectationFit: '满足 mock 验收条件。',
    visualComparison: 'mock 模式未提供真实参考图比较。',
    interactionResult: '状态机从 REWORK 进入 PASS。',
    likelyProblemModules: [],
    reworkInstructions: [],
    blockingReason: null
  };
}

async function collectEvaluationImages(runDirectory) {
  const manifestPath = join(runDirectory, 'capture-results.json');
  try {
    const capture = JSON.parse(await readFile(manifestPath, 'utf8'));
    return [
      ...(capture.referenceImages ?? []),
      ...(capture.screenshots ?? [])
    ].map((item) => resolve(runDirectory, item));
  } catch {
    return [];
  }
}
