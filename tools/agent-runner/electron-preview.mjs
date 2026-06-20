import { spawn } from 'node:child_process';
import electronPath from 'electron';

const port = process.argv[2] || '9229';
const child = spawn(electronPath, [`--remote-debugging-port=${port}`, 'out/main/index.js'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  windowsHide: true
});

const stop = () => {
  child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1000).unref();
};

process.on('SIGTERM', stop);
process.on('SIGINT', stop);

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
