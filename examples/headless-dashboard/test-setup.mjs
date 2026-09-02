import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'setup.mjs');
const home = mkdtempSync(join(tmpdir(), 'dsh-dashboard-setup-'));
const dshHome = join(home, '.dsh');
const profile = join(dshHome, 'profiles', 'headless');
const settings = join(dshHome, 'settings.yaml');
const patch = join(profile, 'cordis.patch.yml');
mkdirSync(profile, { recursive: true });
writeFileSync(settings, 'existing: settings\n', { mode: 0o600 });
writeFileSync(patch, '- existing: plugin\n', { mode: 0o600 });

const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  DSH_HOME: dshHome,
};

execFileSync(process.execPath, [script], { env });
const installed = readFileSync(patch, 'utf8');
if (!installed.includes('- existing: plugin')) throw new Error('setup replaced existing patch entries');
if (!installed.includes('@deepseek-ai/dsh-user-questions-dashboard')) {
  throw new Error('setup omitted dashboard package');
}
if (readFileSync(settings, 'utf8') !== 'existing: settings\n') {
  throw new Error('setup replaced existing settings');
}
if ((statSync(patch).mode & 0o777) !== 0o600) throw new Error('setup patch is not owner-only');

execFileSync(process.execPath, [script], { env });
if (readFileSync(patch, 'utf8') !== installed) throw new Error('setup is not idempotent');

execFileSync(process.execPath, [script, 'uninstall'], { env });
if (readFileSync(patch, 'utf8') !== '- existing: plugin\n') {
  throw new Error('uninstall did not preserve the prior patch');
}
if (readFileSync(settings, 'utf8') !== 'existing: settings\n') {
  throw new Error('uninstall changed existing settings');
}

console.log('Dashboard setup: 6/6 passed');
