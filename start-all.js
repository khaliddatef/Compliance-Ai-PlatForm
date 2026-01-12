const { spawn } = require('child_process');

const npmCmd = 'npm';
const frontend = spawn(npmCmd, ['run', 'dev'], { stdio: 'inherit', shell: true });
const backend = spawn(npmCmd, ['--prefix', 'backend', 'run', 'dev'], {
  stdio: 'inherit',
  shell: true,
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
