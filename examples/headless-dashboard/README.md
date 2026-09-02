# Headless Dashboard and Memory composition

English | [中文](README.zh.md)

This example composes the native loopback question dashboard with optional mandatory-on-enable Memory initialization. Reusable behavior lives in [`@deepseek-ai/dsh-user-questions-dashboard`](../../packages/interaction/user-questions-dashboard/README.md) and [`@deepseek-ai/dsh-memory-native`](../../packages/context/memory-native/README.md).

## Security and lifecycle

- The dashboard binds `127.0.0.1`, validates the exact Host and same-origin Origin, and requires a random HttpOnly capability cookie for the page, API, and SSE.
- Question IDs must be unique; accepted answers preserve request order and required/custom-answer semantics.
- Disposal rejects pending questions, removes timers and abort listeners, closes SSE clients, unregisters the provider, and awaits server shutdown.
- Memory may be disabled. When enabled, authentication, participation persistence, authoritative readback, and Session-log recording must all succeed before model context is published.
- Memory credentials are references resolved through `ctx.credentials`; keys are not stored in Session metadata or public plugin state.

## Mounting the example

The setup script preserves unrelated headless-profile content and installs only a managed block:

```sh
node examples/headless-dashboard/setup.mjs
node examples/headless-dashboard/setup.mjs uninstall
```

The configured Memory endpoints and credential references must match the deployment before enabled sessions start. Team administration and centralized authorization remain external service responsibilities.

## Verification

Run package behavior checks:

```sh
node examples/headless-dashboard/self-test.mjs
node examples/headless-dashboard/test-memory-client.mjs
node examples/headless-dashboard/test-memory-native.mjs
node examples/headless-dashboard/test-setup.mjs
```

Run the package-owned real Loader fixtures for Dashboard and Memory:

```sh
node --import tsx/esm packages/interaction/user-questions-dashboard/tests/loader-driver.ts \
  examples/headless-dashboard/tests/fixtures/interaction/user-questions-dashboard/cordis.yml
node --import tsx/esm packages/context/memory-native/tests/loader-driver.ts \
  examples/headless-dashboard/tests/fixtures/context/memory-native/cordis.yml
```

`run-e2e-native.mjs` drives a credentialed headless session, answers dashboard forms, discovers the durable session identifier from persisted metadata, and queries the configured proxy for authoritative state.

## Known limitations

- The dashboard is local browser interaction, not a remotely shared team UI.
- Enabled Memory sessions depend on compatible MemoryCore and proxy endpoints.
- Multi-tenant authorization, quotas, centralized audit, and broader corpus isolation belong to a later Proxy Hub.
