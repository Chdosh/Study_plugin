import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function executeWithOpenCode({ task, runDirectory, config, mock, sessionId, reworkInstructions = [] }) {
  if (mock) {
    const result = {
      sessionId: sessionId ?? `mock-session-${Date.now()}`,
      execution: {
        status: 'completed',
        summary: reworkInstructions.length > 0
          ? 'mock OpenCode 已接收返工指令并完成模拟返工。'
          : 'mock OpenCode 已接收开发任务并完成模拟执行。',
        changedAreas: ['tools/agent-runner'],
        commandsRun: [],
        knownIssues: [],
        suggestedEvidenceStates: ['verification-results.json', 'capture-results.json']
      }
    };
    await writeFile(join(runDirectory, `opencode-execution-${Date.now()}.json`), JSON.stringify(result, null, 2));
    return result;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeouts?.opencodeMs ?? 300000);
  let opencode;
  try {
    opencode = await createOpenCodeInstance(config, controller.signal);
    const client = opencode.client;
    const activeSessionId = sessionId ?? await createSession(client, task);
    const execution = await promptForExecution({
      client,
      sessionId: activeSessionId,
      task,
      config,
      reworkInstructions
    });
    const result = { sessionId: activeSessionId, execution };
    await writeFile(join(runDirectory, `opencode-execution-${Date.now()}.json`), JSON.stringify(result, null, 2));
    return result;
  } finally {
    clearTimeout(timeout);
    opencode?.server?.close?.();
  }
}

export async function checkOpenCodeLocal(config) {
  const opencode = await createOpenCodeInstance(config);
  try {
    await opencode.client.path.get();
    const providers = await opencode.client.config.providers();
    const providerData = unwrapData(providers);
    return {
      healthy: true,
      providers: providerData,
      hasMimo: hasMimoProvider(providerData)
    };
  } finally {
    opencode?.server?.close?.();
  }
}

export async function checkOpenCodeOnline(config) {
  const opencode = await createOpenCodeInstance(config);
  try {
    const client = opencode.client;
    const session = await client.session.create({
      body: { title: 'Agent Runner doctor online check' }
    });
    const sessionId = unwrapData(session)?.id;
    if (!sessionId) throw new Error('OpenCode did not return a session id');

    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'message'],
      properties: {
        ok: { type: 'boolean' },
        message: { type: 'string' }
      }
    };
    const body = {
      parts: [{
        type: 'text',
        text: '请只返回结构化 JSON：{"ok":true,"message":"mimo online"}。不要读取或修改项目文件。'
      }],
      format: { type: 'json_schema', schema, retryCount: 1 },
      outputFormat: { type: 'json_schema', schema, retryCount: 1 }
    };
    if (config.opencode?.model) body.model = config.opencode.model;
    const response = await client.session.prompt({
      path: { id: sessionId },
      body
    });
    return extractExecution(unwrapData(response));
  } finally {
    opencode?.server?.close?.();
  }
}

async function createOpenCodeInstance(config, signal) {
  const sdk = await import('@opencode-ai/sdk');
  const createOpencode = sdk.createOpencode;
  if (typeof createOpencode !== 'function') {
    throw new Error('@opencode-ai/sdk does not export createOpencode');
  }
  return await createOpencode({
    hostname: config.opencode?.hostname ?? '127.0.0.1',
    port: config.opencode?.port ?? 4096,
    timeout: config.opencode?.timeout ?? 15000,
    signal,
    config: config.opencode?.config ?? {}
  });
}

async function createSession(client, task) {
  const response = await client.session.create({
    body: {
      title: `Agent Runner: ${task.title}`
    }
  });
  const data = unwrapData(response);
  if (!data?.id) {
    throw new Error('OpenCode did not return a session id');
  }
  return data.id;
}

async function promptForExecution({ client, sessionId, task, config, reworkInstructions }) {
  const schema = JSON.parse(await readFile('tools/agent-runner/schemas/execution.schema.json', 'utf8'));
  const prompt = buildPrompt(task, reworkInstructions);
  const body = {
    parts: [{ type: 'text', text: prompt }],
    format: {
      type: 'json_schema',
      schema,
      retryCount: 2
    },
    outputFormat: {
      type: 'json_schema',
      schema,
      retryCount: 2
    }
  };
  if (config.opencode?.model) {
    body.model = config.opencode.model;
  }

  const response = await client.session.prompt({
    path: { id: sessionId },
    body
  });
  return extractExecution(unwrapData(response));
}

function buildPrompt(task, reworkInstructions) {
  const base = [
    '你是 OpenCode 执行开发 Agent。请阅读项目，按任务规格实现最小必要变更。',
    '不要自动 git commit，不要 git push，不要执行 git reset --hard 或 git clean。',
    '完成后必须返回符合 execution.schema.json 的 JSON。',
    '',
    `任务规格：\n${JSON.stringify(task, null, 2)}`
  ];
  if (reworkInstructions.length > 0) {
    base.push('', `返工指令：\n${reworkInstructions.map((item, index) => `${index + 1}. ${item}`).join('\n')}`);
  }
  return base.join('\n');
}

function extractExecution(data) {
  const structured = data?.info?.structured_output ?? data?.structured_output ?? data?.output;
  if (structured && typeof structured === 'object') return structured;
  const text = collectText(data);
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return {
        status: 'partial',
        summary: text.slice(0, 2000),
        changedAreas: [],
        commandsRun: [],
        knownIssues: ['OpenCode response was not valid execution JSON.'],
        suggestedEvidenceStates: []
      };
    }
  }
  return {
    status: 'partial',
    summary: 'OpenCode returned no structured execution payload.',
    changedAreas: [],
    commandsRun: [],
    knownIssues: ['Missing structured output.'],
    suggestedEvidenceStates: []
  };
}

function collectText(data) {
  const parts = Array.isArray(data?.parts) ? data.parts : [];
  return parts
    .map((part) => part.text ?? part.content ?? '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function unwrapData(response) {
  return response?.data ?? response;
}

function hasMimoProvider(providerData) {
  const text = JSON.stringify(providerData ?? {}).toLowerCase();
  return /mimo|xiaomi|mi[-_ ]?mo/.test(text);
}
