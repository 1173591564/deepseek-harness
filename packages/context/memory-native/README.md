# @deepseek-ai/dsh-memory-native

English | [中文](README.zh.md)

Initializes a DSH session from credentialed MemoryCore metadata, obtains missing selections through `ctx.userQuestions`, persists the selected participation state, reads it back authoritatively, and then appends bounded model context to the durable Session log.

## Config

```yaml
- id: memory-native
  name: '@deepseek-ai/dsh-memory-native'
  config:
    enabled: true
    memoryEndpoint: https://memory.example
    proxyEndpoint: https://proxy.example
    userKeyEnv: MEMORY_USER_KEY
    proxyBearerTokenEnv: MEMORY_PROXY_TOKEN
```

Credential fields are environment-style references resolved through `ctx.credentials` for every operation. Literal keys are not stored in config, Session metadata, or public plugin state. HTTPS is required except for explicit loopback development endpoints, and redirects are rejected.

When enabled, authentication and persistence are mandatory. Initialization does not publish model context until participation persistence succeeds and the proxy returns an authoritative readback. Caller cancellation is forwarded to user questions and network operations; the client reports cancellation separately from its internal request timeout.

## Model Experience

### Durable participation context

#### What the model sees

The request contains a bounded user, team, agent, and task snapshot only after the same selection exists in authoritative external persistence and the Session log.

#### Token effect

The context adds at most `contextMaxBytes` to each assembled request after initialization and does not grow with repeated assembly.

#### KV Cache effect

An unchanged participation snapshot preserves its request prefix. A changed externally persisted selection invalidates reuse from the first changed context token.

## Known Limitations and Deferred Work

- Deployments must provide compatible MemoryCore and proxy endpoints.
- The plugin does not implement team administration, quotas, or centralized authorization policy.
- Availability of enabled sessions follows the configured MemoryCore and proxy services; there is no silent local fallback.
