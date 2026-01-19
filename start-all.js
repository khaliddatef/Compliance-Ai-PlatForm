const { spawn } = require('child_process');
const path = require('path');

const npmCmd = 'npm';
const rootDir = __dirname;
const frontend = spawn(npmCmd, ['run', 'dev'], { stdio: 'inherit', shell: true, cwd: rootDir });
const backend = spawn(npmCmd, ['--prefix', 'backend', 'run', 'dev'], {
  stdio: 'inherit',
  shell: true,
  cwd: rootDir,
});

const shutdown = (code) => {
  if (frontend && !frontend.killed) frontend.kill();
  if (backend && !backend.killed) backend.kill();
  process.exit(code ?? 0);
};

frontend.on('exit', (code) => shutdown(code));
backend.on('exit', (code) => shutdown(code));

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
