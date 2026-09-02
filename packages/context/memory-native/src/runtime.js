/**
 * Mandatory MemoryCore session initialization for headless DSH agents.
 *
 * Enabled sessions authenticate through `ctx.credentials`, select their team
 * context through `ctx.userQuestions`, durably write and read back the result,
 * then append the model-visible snapshot to the DSH session log. Any enabled
 * authentication or persistence failure rejects prompt assembly.
 */
import { randomUUID } from 'node:crypto';
import z from '@deepseek-ai/schemastery';
import { createMemoryClient, validateServiceEndpoint } from './client.js';

export const name = 'memory-native';
export const inject = ['credentials', 'userQuestions'];
export const Config = z.object({
  enabled: z.boolean(),
  memoryEndpoint: z.string(),
  proxyEndpoint: z.string(),
  serviceId: z.string(),
  userKeyEnv: z.string(),
  proxyBearerTokenEnv: z.string(),
  proxyWritePath: z.string(),
  proxyReadPath: z.string(),
  requestTimeoutMs: z.number(),
  contextMaxBytes: z.number(),
});

const SKIP = Symbol('skip');

function positiveInteger(value, fallback, label) {
  const resolved = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`memory-native: ${label} must be a positive integer`);
  }
  return resolved;
}

function credentialReference(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`memory-native: ${label} must be a credential reference`);
  }
  return value;
}

function endpointPath(value, label) {
  if (
    typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('?')
    || value.includes('#')
  ) {
    throw new Error(`memory-native: ${label} must be an absolute URL path`);
  }
  return value;
}

function boundedText(value, limit) {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function combineSignals(...signals) {
  const active = signals.filter(Boolean);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

function questionOptions(items, nameOf) {
  const seen = new Map();
  return items.map((item, index) => {
    const base = nameOf(item) || `Option ${index + 1}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return {
      label: occurrence === 1 ? base : `${base} (${occurrence})`,
      value: item,
    };
  });
}

async function askOne(ctx, agent, signal, stage, question, options) {
  const rendered = options.map(option => ({ label: option.label }));
  const answer = await ctx.userQuestions.ask({
    questions: [{
      id: `memory:${agent.id}:${stage}`,
      question,
      options: rendered,
    }],
    agent,
    signal,
  });
  const selected = answer.answers[0]?.selected?.[0];
  const match = options.find(option => option.label === selected);
  if (match === undefined) throw new Error('memory initialization received an invalid answer');
  return match.value;
}

function existingSnapshot(agent) {
  return agent.session.events.findLast(event => (
    event.type === 'user/message'
    && event.data?.source?.kind === 'plugin'
    && event.data?.source?.plugin === name
  ));
}

function contextBlock(agentDetail, taskDetail, maxChars) {
  const sections = [];
  if (agentDetail !== null) {
    const lines = ['[Agent]'];
    const name = boundedText(agentDetail.name, 256);
    const description = boundedText(agentDetail.description, 2_000);
    const prompt = boundedText(agentDetail.prompt, 4_000);
    if (name !== undefined) lines.push(`name: ${name}`);
    if (description !== undefined) lines.push(`description: ${description}`);
    if (prompt !== undefined) lines.push(`prompt: ${prompt}`);
    sections.push({ name: 'Agent', text: lines.join('\n') });
  }
  if (taskDetail !== null) {
    const lines = ['[Task]'];
    const name = boundedText(taskDetail.name, 256);
    const description = boundedText(taskDetail.description, 2_000);
    if (name !== undefined) lines.push(`name: ${name}`);
    if (description !== undefined) lines.push(`description: ${description}`);
    sections.push({ name: 'Task', text: lines.join('\n') });
  }
  const text = sections.length === 0
    ? '<session_context>\nNo external memory context is associated with this session.\n</session_context>'
    : `<session_context>\n${sections.map(section => section.text).join('\n')}\n</session_context>`;
  if (Buffer.byteLength(text, 'utf8') > maxChars) {
    throw new Error('memory session context exceeds the configured limit');
  }
  return { text, sections };
}

function appendSnapshot(agent, snapshot) {
  agent.session.append('user/message', {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: snapshot.text }],
    source: {
      kind: 'plugin',
      plugin: name,
      form: 'snapshot',
      sections: snapshot.sections,
    },
  }, { surfaceOp: 'append' });
}

function createProxyClient(ctx, config) {
  const endpoint = validateServiceEndpoint(config.proxyEndpoint);
  async function resolveBearer() {
    const resolved = await ctx.credentials.resolve(config.proxyBearerTokenEnv);
    if (resolved === undefined || resolved.value.length === 0) {
      throw new Error('memory proxy credential is unavailable');
    }
    return resolved.value;
  }
  async function post(path, body, signal) {
    const bearer = await resolveBearer();
    const timeout = AbortSignal.timeout(config.requestTimeoutMs);
    const requestAbort = combineSignals(signal, timeout);
    let response;
    try {
      const basePath = endpoint.pathname === '/' ? '' : endpoint.pathname;
      response = await fetch(new URL(`${basePath}${path}`, endpoint), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: requestAbort,
      });
    } catch (error) {
      if (signal?.aborted) throw new Error('memory persistence was cancelled', { cause: error });
      if (timeout.aborted) throw new Error('memory persistence request timed out', { cause: error });
      throw new Error('memory persistence request failed', { cause: error });
    }
    if (!response.ok) throw new Error('memory persistence was rejected');
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('memory persistence returned an invalid response');
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('memory persistence returned an invalid response');
    }
    return payload.data;
  }
  return {
    write(payload, signal) {
      return post(config.proxyWritePath, payload, signal);
    },
    read(sessionId, signal) {
      return post(config.proxyReadPath, { session_key: sessionId }, signal);
    },
  };
}

async function initializeSession(ctx, config, agent, signal, questionSignal) {
  const resolveUserKey = async () => {
    const resolved = await ctx.credentials.resolve(config.userKeyEnv);
    if (resolved === undefined || resolved.value.length === 0) {
      throw new Error('memory credential is unavailable');
    }
    return resolved.value;
  };
  const client = createMemoryClient({
    endpoint: config.memoryEndpoint,
    serviceId: config.serviceId,
    timeoutMs: config.requestTimeoutMs,
    resolveUserKey,
  });
  const proxy = createProxyClient(ctx, config);
  const requestOptions = { signal };

  const auth = await client.verifyAuth(requestOptions);
  if (auth?.valid !== true || typeof auth.user?.user_id !== 'string') {
    throw new Error('memory authentication failed');
  }
  const userId = auth.user.user_id;
  const teams = await client.listTeams(requestOptions);
  if (teams.length === 0) {
    appendSnapshot(agent, contextBlock(null, null, config.contextMaxBytes));
    return;
  }

  const teamChoices = questionOptions(teams, team => team.name);
  teamChoices.push({ label: 'Do not associate team memory', value: SKIP });
  const team = teams.length === 1
    ? teams[0]
    : await askOne(ctx, agent, questionSignal, 'team', 'Choose a team memory context', teamChoices);
  if (team === SKIP) {
    appendSnapshot(agent, contextBlock(null, null, config.contextMaxBytes));
    return;
  }

  const agents = await client.listAgents(team.team_id, requestOptions);
  if (agents.length === 0) throw new Error('memory team has no available agents');
  const association = await askOne(ctx, agent, questionSignal, 'association', 'Associate team memory?', [
    { label: 'Associate team memory', value: true },
    { label: 'Do not associate team memory', value: false },
  ]);
  if (!association) {
    appendSnapshot(agent, contextBlock(null, null, config.contextMaxBytes));
    return;
  }

  const agentChoices = questionOptions(agents, item => item.name);
  const selectedAgent = agents.length === 1
    ? agents[0]
    : await askOne(ctx, agent, questionSignal, 'agent', 'Choose an agent context', agentChoices);
  const tasks = await client.listTasks(team.team_id, requestOptions);
  const taskChoices = questionOptions(tasks, item => item.title);
  taskChoices.push({ label: 'No task context', value: null });
  const selectedTask = tasks.length === 0
    ? null
    : tasks.length === 1
      ? tasks[0]
      : await askOne(ctx, agent, questionSignal, 'task', 'Choose a task context', taskChoices);

  const [agentEntity, taskEntity] = await Promise.all([
    client.getAgent(selectedAgent.agent_id, requestOptions),
    selectedTask === null
      ? Promise.resolve(null)
      : client.getTask(selectedTask.task_id, requestOptions),
  ]);
  const agentDetail = {
    id: agentEntity.agent_id,
    name: agentEntity.name,
    description: agentEntity.description,
    prompt: agentEntity.prompt,
  };
  const taskDetail = taskEntity === null ? null : {
    id: taskEntity.task_id,
    name: taskEntity.title,
    description: taskEntity.description,
  };

  if (selectedTask !== null) {
    await client.appendParticipationLog({
      team_id: team.team_id,
      task_id: selectedTask.task_id,
      agent_id: selectedAgent.agent_id,
      user_id: userId,
      source: 'native-plugin:dsh',
    }, requestOptions);
  }

  const sessionInfo = {
    session_id: agent.id,
    team_id: team.team_id,
    agent_id: selectedAgent.agent_id,
    user_id: userId,
    task_id: selectedTask?.task_id,
    space_id: client.serviceId,
    created_at: new Date().toISOString(),
  };
  await proxy.write({
    session_key: agent.id,
    agent_source: 'dsh',
    space_id: client.serviceId,
    user_id: userId,
    session_info: sessionInfo,
    agent_detail: agentDetail,
    task_detail: taskDetail,
  }, signal);
  const persisted = await proxy.read(agent.id, signal);
  if (
    persisted?.session_info?.session_id !== agent.id
    || persisted?.agent_detail?.id !== agentDetail.id
    || persisted?.session_info?.user_key !== undefined
  ) {
    throw new Error('memory persistence readback did not match the committed session');
  }
  appendSnapshot(agent, contextBlock(agentDetail, taskDetail, config.contextMaxBytes));
}

function resolveConfig(config) {
  return {
    enabled: config.enabled ?? true,
    memoryEndpoint: validateServiceEndpoint(
      config.memoryEndpoint ?? process.env.MEMORY_ENDPOINT ?? 'http://127.0.0.1:8420',
    ).toString(),
    proxyEndpoint: validateServiceEndpoint(
      config.proxyEndpoint ?? process.env.PROXY_ENDPOINT ?? 'http://127.0.0.1:8096',
    ).toString(),
    serviceId: config.serviceId ?? process.env.MEMORY_SERVICE_ID ?? 'default',
    userKeyEnv: credentialReference(
      config.userKeyEnv ?? process.env.MEMORY_USER_KEY_ENV ?? 'PROXY_USER_KEY',
      'userKeyEnv',
    ),
    proxyBearerTokenEnv: credentialReference(
      config.proxyBearerTokenEnv ?? process.env.MEMORY_PROXY_TOKEN_ENV ?? 'PROXY_USER_KEY',
      'proxyBearerTokenEnv',
    ),
    proxyWritePath: endpointPath(
      config.proxyWritePath ?? '/v3/session/native-init',
      'proxyWritePath',
    ),
    proxyReadPath: endpointPath(
      config.proxyReadPath ?? '/v3/session/native-get',
      'proxyReadPath',
    ),
    requestTimeoutMs: positiveInteger(config.requestTimeoutMs, 15_000, 'requestTimeoutMs'),
    contextMaxBytes: positiveInteger(config.contextMaxBytes, 8_192, 'contextMaxBytes'),
  };
}

/**
 * Install mandatory session-memory initialization.
 * @param {object} ctx - DSH plugin context.
 * @param {object} config - endpoints, credential references, limits, and enable flag.
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config);
  if (!resolved.enabled) return;
  const lifetime = new AbortController();
  const active = new Set();
  const initializing = new WeakMap();

  function track(promise) {
    active.add(promise);
    void promise.then(
      () => active.delete(promise),
      () => active.delete(promise),
    );
    return promise;
  }

  async function ensureInitialized(agent, signal) {
    if (existingSnapshot(agent) !== undefined) return;
    const current = initializing.get(agent);
    if (current !== undefined) return current;
    const operation = track(initializeSession(
      ctx,
      resolved,
      agent,
      combineSignals(signal, lifetime.signal),
      signal ?? lifetime.signal,
    )).finally(() => initializing.delete(agent));
    initializing.set(agent, operation);
    return operation;
  }

  const disposeAssembly = ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const transformed = await next();
    if (context.agent !== undefined) {
      await ensureInitialized(context.agent, context.signal);
    }
    return transformed;
  });

  ctx.effect(() => async () => {
    disposeAssembly();
    lifetime.abort(new Error('memory-native plugin disposed'));
    await Promise.allSettled([...active]);
  }, 'memory-native: cancel and drain initialization');
}
