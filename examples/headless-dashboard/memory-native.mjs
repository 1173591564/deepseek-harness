/**
 * memory-native.mjs — dsh 原生 session-init 状态机 + 上下文注入插件。
 *
 * 在 agent/session-start 跑完整三元组状态机（asset_confirm → team → agent → task，
 * 含 auto-select / bypass 分支），选完经 proxy /v3/session/native-init 持久化；
 * 在 agent/pre-step 注入 <session_context> [Agent]/[Task] 段到 system prompt。
 *
 * 依赖：dashboard-provider（已在 P0-P3 验证）提供 userQuestions provider。
 * 数据：memory-client.mjs → Gateway(:8420)；持久化 → proxy(:8096)。
 *
 * 挂载：headless profile cordis.patch.yml 加一行 name: file:///<path>/memory-native.mjs
 *
 * env：
 *   PROXY_USER_KEY (或 user_key) — 用户 key（从 ~/.dsh/.credentials.yaml 读）
 *   MEMORY_ENDPOINT (默认 http://127.0.0.1:8420)
 *   MEMORY_SERVICE_ID (默认 default)
 *   PROXY_ENDPOINT (默认 http://127.0.0.1:8096)
 */
import { createMemoryClient, loadUserKey } from './memory-client.mjs';

export const name = 'memory-native';
export const inject = ['userQuestions', 'systemPrompt'];

const PROXY_ENDPOINT = process.env.PROXY_ENDPOINT || 'http://127.0.0.1:8096';
const SESSION_CTX_TAG_OPEN = '<session_context>';
const SESSION_CTX_TAG_CLOSE = '</session_context>';

// 每个 agent 的 session-scoped 状态（agent.id → { sessionInfo, agentDetail, taskDetail, done }）
const sessions = new Map();

function log(...a) { console.log('[memory-native]', ...a); }
function warn(...a) { console.warn('[memory-native]', ...a); }

// ── Gateway helpers ────────────────────────────────────────────────────────

function getClient() {
  const userKey = loadUserKey();
  return createMemoryClient({
    userKey,
    endpoint: process.env.MEMORY_ENDPOINT,
    serviceId: process.env.MEMORY_SERVICE_ID,
  });
}

// ── 仪表盘问答 helper ─────────────────────────────────────────────────────

/** 弹一道单选题，等仪表盘答完返回 selected label；取消/超时抛错。 */
async function askOne(ctx, agent, question, header, options, detail) {
  const q = {
    id: header.replace(/\s+/g, '_').toLowerCase(),
    question,
    header,
    options: options.map(o => (typeof o === 'string' ? { label: o } : o)),
  };
  if (detail) q.detail = detail;
  // dsh ask_user_question 不支持 multiSelect 默认；这里单选
  const ans = await ctx.userQuestions.ask({ questions: [q], agent, signal: undefined });
  const sel = ans.answers[0]?.selected?.[0];
  if (!sel) throw new Error(`no answer for ${header}`);
  return sel;
}

const SKIP_LABEL = '本次不关联（跳过注入，直接放行）';
const YES_LABEL = '是，关联团队资产';
const NO_LABEL = '否，跳过';

// ── 状态机 ─────────────────────────────────────────────────────────────────

async function runSessionInit(ctx, agent) {
  const sessionId = agent.id;
  if (sessions.has(sessionId)) return sessions.get(sessionId);

  const client = getClient();

  // 1. verifyAuth → user_id
  log('verifying user_key…');
  const auth = await client.verifyAuth();
  if (!auth.valid || !auth.user) {
    warn('user_key invalid, skipping session-init');
    return null;
  }
  const userId = auth.user.user_id;
  log('verified user_id=' + userId);

  // 2. 拉 teams / agents / tasks
  log('listing teams…');
  const teams = await client.listTeams();
  if (teams.length === 0) {
    warn('no teams, bypass');
    return null;
  }

  // 选 team（auto-select if 1）
  let teamId;
  if (teams.length === 1) {
    teamId = teams[0].team_id;
    log('auto-select single team=' + teamId);
  } else {
    const choice = await askOne(ctx, agent, '选择 Team', 'Team Select',
      [...teams.map(t => ({ label: t.name || t.team_id, description: t.team_id })), { label: SKIP_LABEL }]);
    if (choice === SKIP_LABEL) { log('user skipped team select'); return null; }
    const t = teams.find(t => (t.name || t.team_id) === choice);
    teamId = t?.team_id;
    if (!teamId) { warn('team choice not recognized: ' + choice); return null; }
  }

  // 拉 agents
  log('listing agents for team=' + teamId);
  const agents = await client.listAgents(teamId);
  if (agents.length === 0) {
    warn('no agents in team, bypass');
    return null;
  }

  // 3. asset_confirm（对齐 proxy：先问是否关联）
  const assetChoice = await askOne(ctx, agent, '是否关联团队资产？', 'Asset Confirm',
    [{ label: YES_LABEL, description: '选择 team 下的 agent/task 进行身份注册' },
     { label: NO_LABEL, description: '跳过注入，直接放行' }]);
  if (assetChoice === NO_LABEL) {
    log('user declined asset confirm, bypass');
    return null;
  }

  // 选 agent（auto-select if 1）
  let agentId;
  if (agents.length === 1) {
    agentId = agents[0].agent_id;
    log('auto-select single agent=' + agentId);
  } else {
    const choice = await askOne(ctx, agent, '选择 Agent', 'Agent Select',
      [...agents.map(a => ({ label: a.name || a.agent_id, description: a.agent_id })), { label: SKIP_LABEL }]);
    if (choice === SKIP_LABEL) { log('user skipped agent select'); return null; }
    const a = agents.find(a => (a.name || a.agent_id) === choice);
    agentId = a?.agent_id;
    if (!agentId) { warn('agent choice not recognized: ' + choice); return null; }
  }

  // 拉 tasks
  log('listing tasks for team=' + teamId);
  const tasks = await client.listTasks(teamId);

  // 选 task（auto-select if 1, bypass if 0）
  let taskId = undefined;
  if (tasks.length === 0) {
    log('no tasks, agent-only registration');
  } else if (tasks.length === 1) {
    taskId = tasks[0].task_id;
    log('auto-select single task=' + taskId);
  } else {
    const choice = await askOne(ctx, agent, '选择 Task', 'Task Select',
      [...tasks.map(t => ({ label: t.title || t.task_id, description: t.task_id })), { label: SKIP_LABEL }]);
    if (choice === SKIP_LABEL) { log('user skipped task select'); }
    else {
      const t = tasks.find(t => (t.title || t.task_id) === choice);
      taskId = t?.task_id;
      if (!taskId) { warn('task choice not recognized: ' + choice); }
    }
  }

  // 4. getAgent + getTask 详情
  log('fetching agent/task details…');
  const agentEntity = await client.getAgent(agentId);
  const taskEntity = taskId ? await client.getTask(taskId) : null;

  const agentDetail = {
    id: agentEntity.agent_id,
    name: agentEntity.name,
    description: agentEntity.description ?? undefined,
    prompt: agentEntity.prompt ?? undefined,
  };
  const taskDetail = taskEntity ? {
    id: taskEntity.task_id,
    name: taskEntity.title,
    description: taskEntity.description ?? undefined,
    goal: undefined, // TaskEntity 无 goal 字段（对齐 proxy 的死代码现状）
  } : null;

  // 5. buildSessionInfo
  const sessionInfo = {
    session_id: sessionId,
    team_id: teamId,
    agent_id: agentId,
    user_id: userId,
    task_id: taskId,
    user_key: client.userKey,
    space_id: client.serviceId,
    created_at: new Date().toISOString(),
  };

  // 6. appendParticipationLog（fire-and-forget，失败只 warn）
  if (taskId) {
    client.appendParticipationLog({
      team_id: teamId, task_id: taskId, agent_id: agentId,
      user_id: userId, source: 'native-plugin:dsh',
    }).catch(e => warn('participation log failed: ' + e.message));
  }

  // 7. 持久化到 proxy SessionStore
  log('persisting to proxy…');
  try {
    const r = await fetch(`${PROXY_ENDPOINT}/v3/session/native-init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_key: sessionId,
        agent_source: 'dsh',
        space_id: client.serviceId,
        user_id: userId,
        session_info: sessionInfo,
        agent_detail: agentDetail,
        task_detail: taskDetail,
      }),
    });
    if (!r.ok) warn('proxy native-init HTTP ' + r.status + ': ' + await r.text());
    else log('persisted to proxy: ' + (await r.json()).data?.composite_key);
  } catch (e) {
    warn('proxy persist failed: ' + e.message);
  }

  const result = { sessionInfo, agentDetail, taskDetail, done: true };
  sessions.set(sessionId, result);
  log('session-init complete: team=' + teamId + ' agent=' + agentId + ' task=' + (taskId ?? '-'));
  return result;
}

// ── 注入 ───────────────────────────────────────────────────────────────────

function buildContextBlock({ agentDetail, taskDetail }) {
  const lines = [SESSION_CTX_TAG_OPEN];
  if (agentDetail) {
    lines.push('[Agent]');
    lines.push('id: ' + agentDetail.id);
    if (agentDetail.name) lines.push('name: ' + agentDetail.name);
    if (agentDetail.description) lines.push('description: ' + agentDetail.description);
    if (agentDetail.prompt) lines.push('prompt: ' + agentDetail.prompt);
  }
  if (taskDetail) {
    lines.push('[Task]');
    lines.push('id: ' + taskDetail.id);
    if (taskDetail.name) lines.push('name: ' + taskDetail.name);
    if (taskDetail.description) lines.push('description: ' + taskDetail.description);
    // goal 省略（TaskEntity 无 goal 字段）
  }
  lines.push(SESSION_CTX_TAG_CLOSE);
  return lines.join('\n');
}

/** 把 context block 追加到 messages 的第一条 system 消息末尾；无 system 则头插一条。 */
function injectIntoMessages(messages, contextBlock) {
  if (!messages || !Array.isArray(messages)) return messages;
  const idx = messages.findIndex(m => m.role === 'system');
  if (idx >= 0) {
    const sys = messages[idx];
    const sep = sys.content && sys.content.length > 0 ? '\n\n' : '';
    return [
      ...messages.slice(0, idx),
      { ...sys, content: (sys.content ?? '') + sep + contextBlock },
      ...messages.slice(idx + 1),
    ];
  }
  return [{ role: 'system', content: contextBlock }, ...messages];
}

// ── apply ──────────────────────────────────────────────────────────────────

export function apply(ctx) {
  if (!ctx.userQuestions) {
    warn('ctx.userQuestions unavailable — plugin inert');
    return;
  }

  // agent/pre-step（waterfall，阻塞 LLM 请求）：
  //   第一次调用 → 跑状态机（弹 form 选三元组）→ 持久化 → 注册 systemPrompt section → 放行
  //   后续调用 → section 已注册，直接放行
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next();
    if (decision.kind !== 'enter') return decision;

    // 第一次：跑状态机（阻塞，弹 form 等用户答）
    if (!sessions.has(agent.id)) {
      try {
        log('pre-step: running session-init for agent=' + agent.id);
        const sess = await runSessionInit(ctx, agent);
        // 状态机完成后：注册 systemPrompt section（动态 text，每次 assemble 时取最新 session 状态）
        if (sess && ctx.systemPrompt) {
          const agentId = agent.id;
          ctx.systemPrompt.section({
            name: 'memory-native-session-context',
            order: 50, // 在 persona(0) 之后、tool guidance(100-199) 之前
            text: () => {
              const s = sessions.get(agentId);
              return s ? buildContextBlock(s) : '';
            },
          });
          log('registered systemPrompt section "memory-native-session-context"');
        }
      } catch (e) {
        warn('session-init failed in pre-step: ' + e.message);
      }
    }

    return decision;
  });

  log('plugin mounted (pre-step hook: session-init + systemPrompt section injection)');
}
