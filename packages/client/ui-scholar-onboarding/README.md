# @deepseek-ai/dsh-client-ui-scholar-onboarding

English | [中文](README.zh.md)

Scholar mode first-use Token onboarding. The step activates only when the Host roster contains the `academic` agent preset and the writable `SCHOLAR_REMOTE_TOKEN` Managed Credential is not configured.

The dialog accepts a password-style Token, validates it with the configured Proxy Hub `/v1/me` endpoint, and writes it through `credentials.set` only after a successful identity response containing a nonempty `name`. `401` and `403` are invalid credentials. Network errors, timeouts, redirects, and other non-success responses leave the Managed Credential unchanged and offer retry.

## Configuration

| Field | Required | Meaning |
|---|---|---|
| `gatewayUrl` | yes | Fixed Proxy Hub Scholar MCP endpoint; the browser derives `/v1/me` on the same origin |
| `allowInsecureHttp` | no | Development-only allowance for a non-loopback HTTP endpoint; default `false` |
| `validationTimeoutMs` | no | Identity validation timeout in milliseconds; default `20000` |

The shipped web bundle composes the current development HTTP gateway with `allowInsecureHttp: true`, so the dialog displays a plaintext transport warning. HTTP exposes the Token and research requests; use only revocable test Tokens. Production composition must use HTTPS.

## Model Experience

None, as the package renders browser credential onboarding; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The package recognizes the `academic` preset ID. Deployments that rename the Scholar preset must update the composition and this package together.
