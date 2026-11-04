#!/usr/bin/env node

const { spawn } = require('node:child_process');
const path = require('node:path');

const exampleRoot = path.resolve(__dirname, '..');
const metroPort = process.env.MUX_RN_EXAMPLE_METRO_PORT || '8081';
const appPath = path.join(
  exampleRoot,
  'build/DerivedData/Build/Products/Debug-iphonesimulator/MuxReactNativePlayerExample.app'
);
const expoBin = path.join(
  path.dirname(require.resolve('expo/package.json')),
  'bin',
  'cli'
);

async function main() {
  await run('npm', ['run', 'ios:build'], { cwd: exampleRoot });

  await run(
    process.execPath,
    [expoBin, 'run:ios', '--binary', appPath, '--port', metroPort],
    { cwd: exampleRoot }
  );
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} failed with ${signal || code}`));
    });
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
