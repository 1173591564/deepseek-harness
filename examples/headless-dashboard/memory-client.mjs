/**
 * memory-client.mjs — MemoryCore Gateway 的最小 HTTP client。
 *
 * 直连 Gateway(:8420)，覆盖 session-init 所需的 7 个方法：
 *   verifyAuth / listTeams / listAgents / listTasks / getAgent / getTask / appendParticipationLog
 *
 * 鉴权：x-tdai-service-id + x-tdai-user-key（header）+ user_key in body（listTeams/listAgents/listTasks 需要）
 * 协议：POST /v3/meta/* + JSON body + JSON envelope {code,message,data}
 *
 * 零依赖（仅 node:fs 读 credentials）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_ENDPOINT = process.env.MEMORY_ENDPOINT || 'http://127.0.0.1:8420';
const DEFAULT_SERVICE_ID = process.env.MEMORY_SERVICE_ID || 'default';

export function createMemoryClient(opts = {}) {
  const endpoint = (opts.endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '');
  const serviceId = opts.serviceId || DEFAULT_SERVICE_ID;
  const userKey = opts.userKey;
  const timeoutMs = opts.timeoutMs || 15000;

  if (!userKey) throw new Error('memory-client: userKey is required');

  async function post(path, body = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        'Content-Type': 'application/json',
        'x-tdai-service-id': serviceId,
        'x-tdai-user-key': userKey,
      };
      const r = await fetch(`${endpoint}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, user_key: body.user_key ?? userKey }),
        signal: controller.signal,
      });
      const text = await r.text();
      let json;
      try { json = JSON.parse(text); } catch { throw new Error(`Gateway ${path} returned non-JSON (HTTP ${r.status}): ${text.slice(0, 200)}`); }
      if (json.code !== 0) {
        throw new Error(`Gateway ${path} error: code=${json.code} message=${json.message}`);
      }
      return json.data;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    endpoint,
    serviceId,
    userKey,

    /** POST /v3/meta/auth/verify → { valid, user: { user_id, user_type, ... } } */
    async verifyAuth() {
      // auth/verify 不走 user-key header，user_key 在 body
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const r = await fetch(`${endpoint}/v3/meta/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tdai-service-id': serviceId },
          body: JSON.stringify({ user_key: userKey }),
          signal: controller.signal,
        });
        const j = await r.json();
        if (j.code !== 0) throw new Error(`auth/verify error: code=${j.code} message=${j.message}`);
        return j.data; // { valid, user: { user_id, user_type, username, ... } | null }
      } finally { clearTimeout(timer); }
    },

    /** POST /v3/meta/team/list → { items: TeamEntity[], ... } */
    async listTeams(pagination = {}) {
      const data = await post('/v3/meta/team/list', pagination);
      return data.items || [];
    },

    /** POST /v3/meta/agent/list → { items: AgentEntity[] }（需 team_id） */
    async listAgents(teamId, pagination = {}) {
      const data = await post('/v3/meta/agent/list', { team_id: teamId, ...pagination });
      return data.items || [];
    },

    /** POST /v3/meta/task/list → { items: TaskEntity[] }（需 team_id） */
    async listTasks(teamId, pagination = {}) {
      const data = await post('/v3/meta/task/list', { team_id: teamId, ...pagination });
      return data.items || [];
    },

    /** POST /v3/meta/agent/get → AgentEntity */
    async getAgent(agentId) {
      return post('/v3/meta/agent/get', { agent_id: agentId });
    },

    /** POST /v3/meta/task/get → TaskEntity */
    async getTask(taskId) {
      return post('/v3/meta/task/get', { task_id: taskId });
    },

    /** POST /v3/meta/participation-log/append → ParticipationLogEntity */
    async appendParticipationLog(p) {
      return post('/v3/meta/participation-log/append', p);
    },
  };
}

/** 从 ~/.dsh/.credentials.yaml 读 PROXY_USER_KEY（或自定义 envKey）。 */
export function loadUserKey(envKey = 'PROXY_USER_KEY') {
  if (process.env[envKey]) return process.env[envKey];
  const home = process.env.USERPROFILE || process.env.HOME;
  const credsPath = join(home, '.dsh', '.credentials.yaml');
  try {
    const creds = readFileSync(credsPath, 'utf8');
    const m = creds.match(new RegExp(`^${envKey}:\\s*(\\S+)`, 'm'));
    if (!m) throw new Error(`${envKey} not found in ${credsPath}`);
    return m[1];
  } catch (e) {
    throw new Error(`cannot load ${envKey}: ${e.message}`);
  }
}
