# @deepseek-ai/dsh-user-questions-dashboard

English | [中文](README.zh.md)

Provides `ctx.userQuestions` through a loopback HTTP dashboard. Each plugin instance creates a random HttpOnly capability, validates the exact loopback `Host` and same-origin `Origin`, and rejects requests without both.

## Config

```yaml
- id: dashboard-provider
  name: '@deepseek-ai/dsh-user-questions-dashboard'
  config:
    port: 8790
    timeoutMs: 120000
    autoOpen: true
```

Questions require unique IDs. Answers must preserve question order, satisfy required fields, and obey single- or multi-select custom-answer semantics. Caller abort, timeout, and plugin disposal reject pending work and remove their timers and listeners.

The provider registration and HTTP server belong to the Cordis plugin lifecycle. Disposal unregisters the provider, rejects pending questions, closes SSE connections, and waits for the loopback server to stop accepting work.

## Model Experience

### Dashboard answers

#### What the model sees

The model-facing consumer receives accepted answers in the original question order after the local dashboard resolves the batch; the `dsh-user-questions` result contains no HTTP capability or validation details.

#### Token effect

Only the consumer's rendered questions and accepted answers contribute tokens. Dashboard transport state adds none.

#### KV Cache effect

Accepted answers are appended after the reusable request prefix and do not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- Only a local same-origin browser is supported; this package is not a shared team dashboard.
- Restarting the plugin invalidates the random capability and pending questions.
- Remote access, tenant identity, quotas, and centralized audit belong to a future Proxy Hub.
