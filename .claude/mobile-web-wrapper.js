const { spawn } = require('child_process');

const port = process.env.PORT || '8092';
const child = spawn(
  'pnpm',
  ['--filter', '@workspace/mobile', 'exec', 'expo', 'start', '--web', '--port', port],
  { stdio: 'inherit', shell: true },
);
child.on('exit', (code) => process.exit(code ?? 0));
