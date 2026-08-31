/**
 * setup.mjs — 把 dashboard-provider 实验挂进 headless profile（幂等、可回滚）。
 *
 * 做两件事：
 *   1. 备份 ~/.dsh/settings.yaml → settings.yaml.bak-exp（若已存在则跳过）
 *   2. 写入实验 settings（llm-deepseek 直连公共 API + DEEPSEEK_API_KEY）
 *   3. 在 ~/.dsh/profiles/headless/cordis.patch.yml 追加两行：
 *        - tool-ask-user（官方包，注册 ask_user_question 工具）
 *        - dashboard-provider（file:// 指向本目录的 .mjs，注册答题 provider）
 *
 * 用法：
 *   node examples/headless-dashboard/setup.mjs          # 安装
 *   node examples/headless-dashboard/setup.mjs uninstall # 卸载（恢复 settings + 删补丁行）
 *
 * 幂等：重复跑不叠加补丁行。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DSH_HOME = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME, '.dsh');
const SETTINGS = join(DSH_HOME, 'settings.yaml');
const SETTINGS_BAK = join(DSH_HOME, 'settings.yaml.bak-exp');
const HEADLESS_DIR = join(DSH_HOME, 'profiles', 'headless');
const PATCH = join(HEADLESS_DIR, 'cordis.patch.yml');

const PROVIDER_URL = pathToFileURL(join(HERE, 'dashboard-provider.mjs')).href;
const MARKER = '# >>> experiment/dashboard-provider';
const END_MARKER = '# <<< experiment/dashboard-provider';

const EXP_SETTINGS = `ui-onboarding:
  welcomeNoticeVersion: 2026-08-13.1
ui-theme:
  preference: light
agent-presets:
  default: standard

# experiment/dashboard-provider — 直连 DeepSeek 公共 API（实验期间，原配置在 settings.yaml.bak-exp）
llm-deepseek:
  apiKeyEnv: DEEPSEEK_API_KEY
  baseURL: https://api.deepseek.com
  reasoningEffort: low
`;

const PATCH_BLOCK = `${MARKER}
- insert:
    - id: tool-ask-user
      name: '@deepseek-ai/dsh-tool-ask-user'
    - id: dashboard-provider
      name: ${PROVIDER_URL}
    - id: memory-native
      name: ${pathToFileURL(join(HERE, 'memory-native.mjs')).href}
${END_MARKER}`;

function ensureProfile() {
  // headless profile 首次使用时由 dsh 自动初始化；这里保证目录存在以写补丁
  if (!existsSync(HEADLESS_DIR)) {
    mkdirSync(HEADLESS_DIR, { recursive: true });
  }
}

function install() {
  // 1. settings 备份 + 切实验配置
  if (!existsSync(SETTINGS_BAK)) {
    if (existsSync(SETTINGS)) copyFileSync(SETTINGS, SETTINGS_BAK);
    console.log(`[setup] backed up settings → ${SETTINGS_BAK}`);
  } else {
    console.log(`[setup] backup already exists, skip backup`);
  }
  writeFileSync(SETTINGS, EXP_SETTINGS, 'utf8');
  console.log(`[setup] wrote experiment settings (direct DeepSeek API)`);

  // 2. profile 补丁（幂等：去重写）
  ensureProfile();
  let prev = '';
  if (existsSync(PATCH)) prev = readFileSync(PATCH, 'utf8');
  if (prev.includes(MARKER)) {
    // 替换已有块
    const re = new RegExp(`${MARKER}[\\s\\S]*?${END_MARKER}`, 'm');
    prev = prev.replace(re, PATCH_BLOCK.trim());
    writeFileSync(PATCH, prev, 'utf8');
    console.log(`[setup] refreshed experiment block in ${PATCH}`);
  } else {
    // 去掉空数组占位 `[]`（dsh 初始化的空 patch），再追加实验块
    const stripped = prev.replace(/^\s*\[\]\s*\n?/m, '').replace(/\s+$/, '');
    const next = stripped ? `${stripped}\n\n${PATCH_BLOCK}\n` : `${PATCH_BLOCK}\n`;
    writeFileSync(PATCH, next, 'utf8');
    console.log(`[setup] appended experiment block to ${PATCH}`);
  }

  console.log(`\n[setup] done. run:`);
  console.log(`  pnpm dsh --profile headless "先问用户要 MySQL/PostgreSQL/Redis 哪个数据库，等用户在仪表盘回答后再给该库的第一条维护建议"`);
  console.log(`  # 然后浏览器打开 http://127.0.0.1:8790`);
  console.log(`\n[setup] uninstall: node examples/headless-dashboard/setup.mjs uninstall`);
}

function uninstall() {
  // 1. 恢复 settings
  if (existsSync(SETTINGS_BAK)) {
    copyFileSync(SETTINGS_BAK, SETTINGS);
    unlinkSync(SETTINGS_BAK);
    console.log(`[uninstall] restored settings from backup`);
  } else {
    console.log(`[uninstall] no backup found, settings left as-is`);
  }
  // 2. 删补丁块
  if (existsSync(PATCH)) {
    let prev = readFileSync(PATCH, 'utf8');
    if (prev.includes(MARKER)) {
      const re = new RegExp(`\\n?${MARKER}[\\s\\S]*?${END_MARKER}\\n?`, 'm');
      prev = prev.replace(re, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
      writeFileSync(PATCH, prev, 'utf8');
      console.log(`[uninstall] removed experiment block from ${PATCH}`);
    } else {
      console.log(`[uninstall] no experiment block in patch, skip`);
    }
  }
  console.log(`[uninstall] done.`);
}

const cmd = process.argv[2];
if (cmd === 'uninstall') uninstall();
else install();
