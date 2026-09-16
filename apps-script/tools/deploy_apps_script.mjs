import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestPath = join(root, 'apps-script', 'appsscript.json');
const codePath = join(root, 'apps-script', 'Code.js');
const claspPath = join(root, '.clasp.json');
const settingsPath = join(root, '.apps-script-settings.json');
const claspEntry = join(root, 'node_modules', '@google', 'clasp', 'build', 'src', 'index.js');
const localNode = join(root, 'node_modules', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
const nodeExecutable = Number(process.versions.node.split('.')[0]) >= 20 ? process.execPath : localNode;

if (!existsSync(claspEntry) || !existsSync(nodeExecutable)) {
  throw new Error('Install dependencies first with npm ci. Node.js 20 or newer is required.');
}

function clasp(...args) {
  const result = spawnSync(nodeExecutable, [claspEntry, ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`clasp ${args[0]} failed.`);
}

const originalManifest = readFileSync(manifestPath, 'utf8');
const originalCode = readFileSync(codePath, 'utf8');
const manifest = JSON.parse(originalManifest);
let settings;
if (existsSync(settingsPath)) {
  settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
} else {
  settings = { timeZone: existsSync(claspPath)
    ? manifest.timeZone
    : (process.env.APPS_SCRIPT_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone) };
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}
if (typeof settings.timeZone !== 'string') throw new Error('Invalid timeZone in .apps-script-settings.json.');
new Intl.DateTimeFormat('en-US', { timeZone: settings.timeZone });
manifest.timeZone = settings.timeZone;

try {
  if (!existsSync(claspPath)) {
    try {
      clasp('create-script', '--type', 'standalone', '--title', 'Canvas Assignment Sync', '--rootDir', 'apps-script');
    } finally {
      writeFileSync(manifestPath, originalManifest);
      writeFileSync(codePath, originalCode);
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  clasp('push', '--force');
} finally {
  writeFileSync(manifestPath, originalManifest);
  writeFileSync(codePath, originalCode);
}

const { scriptId } = JSON.parse(readFileSync(claspPath, 'utf8'));
console.log(`Project time zone: ${settings.timeZone}`);
console.log(`Apps Script editor: https://script.google.com/d/${scriptId}/edit`);
