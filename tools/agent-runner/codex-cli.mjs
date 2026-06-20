import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { scrubEnvironment } from './verifier.mjs';

const WINDOWS_APPS_SEGMENT = '\\windowsapps\\';
const WINDOWS_APPS_ERROR = '当前解析到Codex Desktop内置可执行文件，该路径可能因Windows应用包权限导致Access denied。请安装npm版@openai/codex并设置CODEX_CLI_PATH。';

export async function resolveCodexCli() {
  const envPath = process.env.CODEX_CLI_PATH?.trim();
  const candidates = [];
  if (envPath) {
    candidates.push({ path: envPath, source: 'CODEX_CLI_PATH' });
  } else if (process.platform === 'win32') {
    candidates.push(...resolveWindowsCandidates());
  } else {
    candidates.push(...resolvePathCandidates(['codex']));
  }

  for (const candidate of candidates) {
    if (!candidate.path) continue;
    if (!existsSync(candidate.path)) continue;
    const normalized = candidate.path.toLowerCase();
    if (process.platform === 'win32' && normalized.includes(WINDOWS_APPS_SEGMENT)) {
      return {
        ok: false,
        path: candidate.path,
        source: candidate.source,
        reason: WINDOWS_APPS_ERROR
      };
    }
    try {
      await access(candidate.path);
      return {
        ok: true,
        path: candidate.path,
        source: candidate.source,
        reason: null
      };
    } catch {
      // Continue looking for a usable candidate.
    }
  }

  return {
    ok: false,
    path: candidates[0]?.path ?? null,
    source: candidates[0]?.source ?? null,
    reason: envPath
      ? 'CODEX_CLI_PATH 指向的文件不存在或不可执行。'
      : '未找到可用 Codex CLI。请安装 npm 版 @openai/codex，并设置 CODEX_CLI_PATH。'
  };
}

export function runCodexCli({ cliPath, args, cwd, timeoutMs = 30000, logPrefix, input }) {
  return runProcess({
    ...createInvocation(cliPath, args),
    cwd,
    timeoutMs,
    logPrefix,
    input
  });
}

export function createInvocation(cliPath, args) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cliPath)) {
    const serializedArgs = args.map(serializeCmdArg).join(' ');
    const commandLine = `call ${quoteCmdPath(cliPath)}${serializedArgs ? ` ${serializedArgs}` : ''}`;
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', commandLine],
      commandLine
    };
  }
  return { command: cliPath, args };
}

export function serializeCmdArg(value) {
  const text = String(value ?? '');
  if (text.length === 0) return '""';
  if (/^[A-Za-z0-9._:/\\=-]+$/.test(text)) return text;
  const escaped = text
    .replace(/\^/g, '^^')
    .replace(/"/g, '""')
    .replace(/%/g, '^%')
    .replace(/!/g, '^!');
  return `"${escaped}"`;
}

export function redactSensitive(text) {
  return String(text)
    .replace(/(api[_-]?key|token|secret|password)(["'\s:=]+)([^"'\s,}]+)/gi, '$1$2[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
}

function resolveWindowsCandidates() {
  const candidates = [];
  const prefix = getNpmGlobalPrefix();
  if (prefix) {
    candidates.push({ path: join(prefix, 'codex.cmd'), source: 'npm global prefix' });
    candidates.push({ path: join(prefix, 'node_modules', '.bin', 'codex.cmd'), source: 'npm global prefix node_modules/.bin' });
  }
  candidates.push(...resolvePathCandidates(['codex.cmd']));
  candidates.push(...resolvePathCandidates(['codex.exe', 'codex']));
  return candidates;
}

function getNpmGlobalPrefix() {
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm prefix -g'], {
    encoding: 'utf8',
    windowsHide: true,
    env: scrubEnvironment(process.env)
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function resolvePathCandidates(names) {
  const paths = (process.env.PATH || '').split(delimiter).filter(Boolean);
  const candidates = [];
  for (const directory of paths) {
    for (const name of names) {
      candidates.push({
        path: isAbsolute(name) ? name : join(directory, name),
        source: 'PATH'
      });
    }
  }
  return candidates;
}

function quoteCmdPath(value) {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function runProcess({ command, args, cwd, timeoutMs, logPrefix, input }) {
  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let timedOut = false;
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: process.platform === 'win32' && /cmd(?:\.exe)?$/i.test(command),
      env: scrubEnvironment(process.env)
    });
    if (typeof input === 'string') {
      child.stdin?.end(input, 'utf8');
    } else {
      child.stdin?.end();
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on('error', (error) => stderrChunks.push(Buffer.from(String(error.stack || error.message || error))));
    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      const stdout = redactSensitive(Buffer.concat(stdoutChunks).toString('utf8'));
      const stderr = redactSensitive(Buffer.concat(stderrChunks).toString('utf8'));
      const result = {
        exitCode: typeof code === 'number' ? code : null,
        signal,
        timedOut,
        stdout,
        stderr
      };
      if (logPrefix) {
        const { writeFile } = await import('node:fs/promises');
        result.stdoutFile = `${logPrefix}.stdout.log`;
        result.stderrFile = `${logPrefix}.stderr.log`;
        await writeFile(result.stdoutFile, stdout);
        await writeFile(result.stderrFile, stderr);
        await writeFile(`${logPrefix}.result.json`, JSON.stringify({
          exitCode: result.exitCode,
          signal,
          timedOut,
          stdoutFile: result.stdoutFile,
          stderrFile: result.stderrFile
        }, null, 2));
      }
      resolve(result);
    });
  });
}
