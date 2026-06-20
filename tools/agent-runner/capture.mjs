import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { request } from 'node:http';
import { scrubEnvironment } from './verifier.mjs';

export async function captureEvidence({ runDirectory, task, config, referenceImages = [] }) {
  const captureDirectory = join(runDirectory, 'capture');
  const screenshotDirectory = join(runDirectory, 'screenshots');
  await mkdir(captureDirectory, { recursive: true });
  await mkdir(screenshotDirectory, { recursive: true });

  const result = {
    projectType: config.projectType ?? 'unknown',
    taskTitle: task.title,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    supported: true,
    referenceImages,
    screenshots: [],
    runtimeLogs: {
      stdout: 'capture/app.stdout.log',
      stderr: 'capture/app.stderr.log'
    },
    runtimeErrors: [],
    unsupportedSteps: [],
    notes: []
  };

  if (config.capture?.enabled === false) {
    result.supported = false;
    result.unsupportedSteps.push('capture disabled by workflow.config.json');
    result.finishedAt = new Date().toISOString();
    await writeCaptureResults(runDirectory, result);
    return result;
  }

  const port = config.capture?.port ?? 9229;
  const commandTemplate = config.commands?.start;
  if (!commandTemplate) {
    result.supported = false;
    result.unsupportedSteps.push('missing commands.start');
    result.finishedAt = new Date().toISOString();
    await writeCaptureResults(runDirectory, result);
    return result;
  }

  const command = commandTemplate.replaceAll('{port}', String(port));
  const stdoutChunks = [];
  const stderrChunks = [];
  const child = spawn(command, {
    cwd: process.cwd(),
    shell: true,
    windowsHide: true,
    env: scrubEnvironment(process.env)
  });

  child.stdout?.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
  child.on('error', (error) => stderrChunks.push(Buffer.from(String(error.stack || error.message || error))));

  try {
    await delay(config.capture?.startupDelayMs ?? 5000);
    const targets = await pollTargets(port, config.timeouts?.captureMs ?? 45000);
    const page = targets.find((target) => target.webSocketDebuggerUrl && target.type === 'page') ?? targets[0];
    if (!page?.webSocketDebuggerUrl) {
      result.supported = false;
      result.unsupportedSteps.push('remote debugging target not found');
    } else if (typeof WebSocket !== 'function') {
      result.supported = false;
      result.unsupportedSteps.push('Node runtime does not provide global WebSocket for CDP capture');
    } else {
      const screenshotPath = join('screenshots', config.capture?.screenshotName ?? 'main-window.png');
      const cdp = new CdpClient(page.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send('Page.enable');
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      await cdp.close();
      await writeFile(join(runDirectory, screenshotPath), Buffer.from(screenshot.data, 'base64'));
      result.screenshots.push(screenshotPath);
    }
  } catch (error) {
    result.supported = false;
    result.runtimeErrors.push(String(error.stack || error.message || error));
  } finally {
    stopProcessTree(child);
    await delay(1000);
    await writeFile(join(captureDirectory, 'app.stdout.log'), Buffer.concat(stdoutChunks).toString('utf8'));
    await writeFile(join(captureDirectory, 'app.stderr.log'), Buffer.concat(stderrChunks).toString('utf8'));
    result.finishedAt = new Date().toISOString();
    await writeCaptureResults(runDirectory, result);
  }

  return result;
}

function stopProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });
    return;
  }
  child.kill('SIGTERM');
}

async function writeCaptureResults(runDirectory, result) {
  const interaction = {
    status: result.supported ? 'captured' : 'partial',
    screenshots: result.screenshots,
    unsupportedSteps: result.unsupportedSteps,
    runtimeErrors: result.runtimeErrors,
    notes: result.notes
  };
  await writeFile(join(runDirectory, 'capture-results.json'), JSON.stringify(result, null, 2));
  await writeFile(join(runDirectory, 'interaction-results.json'), JSON.stringify(interaction, null, 2));
}

async function pollTargets(port, timeoutMs) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const targets = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json/list`));
      if (Array.isArray(targets) && targets.length > 0) return targets;
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  }
  throw lastError ?? new Error('Timed out waiting for Electron remote debugging target');
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.end();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  open() {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', () => resolve());
      this.socket.addEventListener('error', (event) => reject(new Error(`CDP websocket error: ${event.message ?? 'unknown'}`)));
      this.socket.addEventListener('message', (event) => this.onMessage(event.data));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(payload);
    });
  }

  onMessage(data) {
    const message = JSON.parse(data);
    if (!message.id || !this.pending.has(message.id)) return;
    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    } else {
      pending.resolve(message.result ?? {});
    }
  }

  close() {
    this.socket?.close();
  }
}
