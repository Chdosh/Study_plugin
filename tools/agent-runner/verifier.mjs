import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function runVerification({ runDirectory, config }) {
  const logsDirectory = join(runDirectory, 'logs');
  await mkdir(logsDirectory, { recursive: true });

  const commands = [
    ['typecheck', config.commands?.typecheck],
    ['test', config.commands?.test],
    ['build', config.commands?.build]
  ].filter(([, command]) => typeof command === 'string' && command.trim().length > 0);

  const results = [];
  for (const [name, command] of commands) {
    const result = await runLoggedCommand({
      name,
      command,
      cwd: process.cwd(),
      logsDirectory,
      timeoutMs: config.timeouts?.commandMs ?? 120000
    });
    results.push(result);
  }

  await writeFile(join(runDirectory, 'verification-results.json'), JSON.stringify(results, null, 2));
  return results;
}

export function runLoggedCommand({ name, command, cwd, logsDirectory, timeoutMs }) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const stdoutChunks = [];
    const stderrChunks = [];
    let timedOut = false;

    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: scrubEnvironment(process.env)
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));

    child.on('error', (error) => {
      stderrChunks.push(Buffer.from(String(error.stack || error.message || error)));
    });

    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      const finishedAt = new Date().toISOString();
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      const result = {
        name,
        command,
        startedAt,
        finishedAt,
        exitCode: typeof code === 'number' ? code : null,
        signal,
        timedOut,
        stdoutFile: `logs/${name}.stdout.log`,
        stderrFile: `logs/${name}.stderr.log`
      };

      await writeFile(join(logsDirectory, `${name}.stdout.log`), stdout);
      await writeFile(join(logsDirectory, `${name}.stderr.log`), stderr);
      await writeFile(join(logsDirectory, `${name}.result.json`), JSON.stringify(result, null, 2));
      resolve(result);
    });
  });
}

export function scrubEnvironment(source) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD/i.test(key)) {
      delete env[key];
    }
  }
  return env;
}
