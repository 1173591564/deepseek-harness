/**
 * Install or remove the headless Dashboard and Memory patch without replacing user settings.
 */
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const home = process.env.USERPROFILE ?? process.env.HOME;
if (home === undefined || home.length === 0) {
  throw new Error('setup: HOME or USERPROFILE is required');
}

const dshHome = process.env.DSH_HOME ?? join(home, '.dsh');
const headlessDir = join(dshHome, 'profiles', 'headless');
const patchPath = join(headlessDir, 'cordis.patch.yml');
const marker = '# >>> scholar-phase-one-dashboard';
const endMarker = '# <<< scholar-phase-one-dashboard';
const block = `${marker}
- insert:
    - id: user-questions
      name: '@deepseek-ai/dsh-user-questions'
    - id: tool-ask-user
      name: '@deepseek-ai/dsh-tool-ask-user'
    - id: dashboard-provider
      name: '@deepseek-ai/dsh-user-questions-dashboard'
    - id: memory-native
      name: '@deepseek-ai/dsh-memory-native'
      config:
        userKeyEnv: PROXY_USER_KEY
        proxyBearerTokenEnv: PROXY_USER_KEY
${endMarker}`;

function atomicWrite(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, content, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') {
        throw new AggregateError([error, cleanupError], 'setup: write and cleanup failed');
      }
    }
    throw error;
  }
}

function withoutManagedBlock(content) {
  if (!content.includes(marker)) return content;
  const expression = new RegExp(`\\n?${marker}[\\s\\S]*?${endMarker}\\n?`, 'm');
  const unmanaged = content.replace(expression, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  return unmanaged.length === 0 ? '' : unmanaged.replace(/\n+$/, '\n');
}

function install() {
  mkdirSync(headlessDir, { recursive: true, mode: 0o700 });
  const previous = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
  const unmanaged = withoutManagedBlock(previous)
    .replace(/^\s*\[\]\s*\n?/m, '')
    .replace(/\s+$/, '');
  const next = unmanaged.length === 0 ? `${block}\n` : `${unmanaged}\n\n${block}\n`;
  if (next === previous) return;
  atomicWrite(patchPath, next);
  console.log('[setup] installed Dashboard and Memory patch; existing settings were preserved');
}

function uninstall() {
  if (!existsSync(patchPath)) return;
  const previous = readFileSync(patchPath, 'utf8');
  const next = withoutManagedBlock(previous);
  if (next === previous) return;
  atomicWrite(patchPath, next);
  console.log('[setup] removed Dashboard and Memory patch; existing settings were preserved');
}

if (process.argv[2] === 'uninstall') uninstall();
else install();
