# Agent Note: Scholar single-lab Token onboarding

Status: implemented

English | [中文](2026-09-04-scholar-single-lab-token-onboarding.zh.md)

## Problem

The [Proxy Hub Access Key workflow](2026-09-03-scholar-proxy-hub-access-keys.md) supports tenant membership, policy, quota, and expiry choices that a single laboratory with one Corpus does not need. Research users need one administrator-issued Token and one first-use DSH action without access to the administrator console or deployment endpoints.

## Decision

The single-lab Proxy Hub presents Token management, Service status, and Audit log behind the existing administrator OIDC login. A Token name identifies an active Token after trim, NFKC normalization, and case folding. New facade Tokens grant all Scholar MCP Tools, have no user quota, and remain valid until rotation or revoke; Proxy Hub retains global concurrency, request-size, timeout, and Scholar Backend circuit protections. The server stores only a digest, displays raw Token material once, and never forwards it to the Scholar Backend.

`@deepseek-ai/dsh-client-ui-scholar-onboarding` registers one `settings.onboarding` step. The step appears when the `academic` preset exists and the writable `SCHOLAR_REMOTE_TOKEN` Managed Credential is absent. The deployment composition supplies a fixed `gatewayUrl`; ordinary users enter only the Token. The controller calls the same-origin `/v1/me` with Bearer authentication and writes the Managed Credential only after a successful response containing a nonempty `name`.

The MCP HTTP transport unsets the provider-managed credential only after an explicit `401` or `403`. Network errors, timeouts, redirects, `5xx` responses, and MCP Tool errors retain it. HTTPS is required unless the DSH composition explicitly enables non-loopback HTTP, and the Proxy Hub deployment separately enables development HTTP. The browser displays a plaintext warning while HTTP is active.

The Token and onboarding state do not enter Session events or model requests.

## Verification

Package tests cover activation, validation ordering, request headers, identity parsing, credential write failures, bilingual dialog states, fixed-endpoint composition, and slot disposal. MCP integration tests cover credential removal after authentication rejection, including an environment value shadowing the managed value, and retention after `5xx`. The shipped web composition and browser replay cover the registered package and first-use dialog.

## Alternatives considered

**Expose tenant, membership, policy, and quota controls to laboratory administrators.** Rejected because those controls do not represent choices in a one-Corpus deployment. Proxy Hub retains their internal compatibility model.

**Let each research user edit the Proxy Hub endpoint.** Rejected because endpoint ownership belongs to deployment composition and an editable endpoint increases phishing and plaintext-transport risk.

**Persist the Token before validating it.** Rejected because a rejected or malformed credential would become durable and force a separate cleanup path.

**Remove credentials after every connection failure.** Rejected because transient Scholar Backend or network failures would destroy valid local configuration and repeatedly reopen onboarding.

**Put the Token in static MCP headers.** Rejected because static sensitive headers can leak through configuration and bypass Managed Credential ownership.

## Consequences

Research users paste one Token on first use and later Scholar sessions reuse the owner-readable Managed Credential. Rotation or revoke causes the next explicit authentication rejection to remove the managed value and makes onboarding eligible to reappear. Administrators operate one Token facade while internal tenant and policy records remain available for compatibility.

Development HTTP allows testing against the current public endpoint but exposes Token and research traffic in plaintext. Only revocable test Tokens are suitable for that composition; long-lived Token distribution requires HTTPS or an encrypted private network.
