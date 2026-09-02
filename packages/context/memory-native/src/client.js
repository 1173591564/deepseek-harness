/**
 * Authenticated MemoryCore Gateway client used by the native memory plugin.
 *
 * Credential values are resolved for each request and are never exposed on
 * the returned client. Gateway failures use stable diagnostics that do not
 * include response bodies, endpoint URLs, or credential values.
 */

/**
 * Validate a credential-bearing service base URL.
 * @param {string} value - absolute HTTPS or numeric-loopback HTTP URL.
 * @returns {URL} normalized URL without a trailing slash.
 */
export function validateServiceEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('memory-client: endpoint must be an absolute URL');
  }
  if (url.username || url.password || url.hash || url.search) {
    throw new Error('memory-client: endpoint cannot contain userinfo, query, or fragment');
  }
  const numericLoopback = (
    url.hostname === '127.0.0.1'
    || url.hostname === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(url.hostname)
  );
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && numericLoopback)) {
    throw new Error('memory-client: endpoint must use HTTPS or numeric loopback HTTP');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

function positiveInteger(value, fallback, label) {
  const resolved = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`memory-client: ${label} must be a positive integer`);
  }
  return resolved;
}

function requestSignal(callerSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(callerSignal.reason);
  if (callerSignal?.aborted) onAbort();
  else callerSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('memory request timed out'));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onAbort);
    },
  };
}

function validateEnvelope(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('memory gateway returned an invalid response');
  }
  if (value.code !== 0) throw new Error('memory gateway rejected the request');
  if (!Object.hasOwn(value, 'data')) throw new Error('memory gateway returned an invalid response');
  return value.data;
}

/**
 * Create a Gateway client with per-operation credential resolution.
 * @param {object} opts - endpoint, service id, timeout, and credential resolver.
 * @returns {object} the seven session-initialization operations.
 */
export function createMemoryClient(opts = {}) {
  const endpoint = validateServiceEndpoint(opts.endpoint ?? 'http://127.0.0.1:8420');
  const serviceId = opts.serviceId ?? 'default';
  const timeoutMs = positiveInteger(opts.timeoutMs, 15_000, 'timeoutMs');
  const resolveUserKey = opts.resolveUserKey;
  const fetchImpl = opts.fetch ?? fetch;
  if (typeof serviceId !== 'string' || serviceId.length === 0) {
    throw new Error('memory-client: serviceId must be non-empty');
  }
  if (typeof resolveUserKey !== 'function') {
    throw new Error('memory-client: resolveUserKey is required');
  }

  async function post(path, body = {}, options = {}) {
    const userKey = await resolveUserKey();
    if (typeof userKey !== 'string' || userKey.length === 0) {
      throw new Error('memory credential is unavailable');
    }
    const control = requestSignal(options.signal, timeoutMs);
    try {
      const basePath = endpoint.pathname === '/' ? '' : endpoint.pathname;
      const response = await fetchImpl(new URL(`${basePath}${path}`, endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tdai-service-id': serviceId,
          'x-tdai-user-key': userKey,
        },
        body: JSON.stringify({ ...body, user_key: userKey }),
        redirect: 'error',
        signal: control.signal,
      });
      if (!response.ok) throw new Error('memory gateway rejected the request');
      let envelope;
      try {
        envelope = await response.json();
      } catch {
        throw new Error('memory gateway returned an invalid response');
      }
      return validateEnvelope(envelope);
    } catch (error) {
      if (options.signal?.aborted) {
        throw new Error('memory request was cancelled', { cause: error });
      }
      if (control.timedOut()) {
        throw new Error('memory request timed out', { cause: error });
      }
      if (
        error instanceof Error
        && (
          error.message === 'memory gateway rejected the request'
          || error.message === 'memory gateway returned an invalid response'
        )
      ) {
        throw error;
      }
      throw new Error('memory gateway request failed', { cause: error });
    } finally {
      control.cleanup();
    }
  }

  return {
    endpoint: endpoint.origin + endpoint.pathname,
    serviceId,

    async verifyAuth(options = {}) {
      return post('/v3/meta/auth/verify', {}, options);
    },

    async listTeams(options = {}) {
      const data = await post('/v3/meta/team/list', {}, options);
      if (!Array.isArray(data?.items)) throw new Error('memory gateway returned an invalid response');
      return data.items;
    },

    async listAgents(teamId, options = {}) {
      const data = await post('/v3/meta/agent/list', { team_id: teamId }, options);
      if (!Array.isArray(data?.items)) throw new Error('memory gateway returned an invalid response');
      return data.items;
    },

    async listTasks(teamId, options = {}) {
      const data = await post('/v3/meta/task/list', { team_id: teamId }, options);
      if (!Array.isArray(data?.items)) throw new Error('memory gateway returned an invalid response');
      return data.items;
    },

    async getAgent(agentId, options = {}) {
      return post('/v3/meta/agent/get', { agent_id: agentId }, options);
    },

    async getTask(taskId, options = {}) {
      return post('/v3/meta/task/get', { task_id: taskId }, options);
    },

    async appendParticipationLog(payload, options = {}) {
      return post('/v3/meta/participation-log/append', payload, options);
    },
  };
}
