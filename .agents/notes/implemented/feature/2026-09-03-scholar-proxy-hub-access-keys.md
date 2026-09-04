# Agent Note: Scholar Proxy Hub Access Keys

Status: implemented

English | [中文](2026-09-03-scholar-proxy-hub-access-keys.zh.md)

## Problem

The [direct Scholar composition](2026-09-02-scholar-phase-one-composition.md) accepts a managed Bearer credential, but a small lab needs an administrator-controlled identity lifecycle without requiring each research user to understand OIDC principals, tenant membership, one-time enrolment, or capability exchange.

## Decision

Proxy Hub administrators issue a separate `sk_scholar_v1_...` Access Key for each research user or device. Each key names one managed researcher and tenant, limits Scholar tools, may carry a request quota and expiry, and can be rotated or revoked independently. Proxy Hub validates the key on every MCP request and injects its own Scholar backend credential; the client key is never forwarded upstream.

The Scholar installer reads the Access Key without echo and sends it to `scholar gateway-login --api-key-stdin`. The command validates the versioned prefix, stores the key in DSH managed credentials, and writes only the credential reference into the Scholar composition. It does not call the enrolment session endpoint. `--code` and `--code-stdin` retain the one-time enrolment and short-lived capability path during migration.

SSH port forwarding may expose a loopback HTTP gateway when a lab has no public TLS endpoint. The tunnel supplies encrypted transport and server network admission; Proxy Hub still owns identity, tenant, tool, quota, expiry, revocation, routing, and audit decisions.

## Verification

The installer scenario asserts that the Access Key travels only over standard input and is absent from process arguments. Scholar CLI tests assert direct key storage without a session exchange, reject an invalid prefix, preserve the credential-reference configuration, and retain the legacy enrolment exchange.

## Alternatives considered

**Require every research user to authenticate through Dex.** Rejected because console identity administration and DSH data access have different users and lifecycles. Dex remains the administrator login rather than a prerequisite for research clients.

**Issue only one-time enrolment codes and short-lived capabilities.** Rejected as the primary lab workflow because every expiry requires another administrator-mediated exchange. The flow remains available for compatibility.

**Forward the client Access Key to Scholar.** Rejected because it would couple the data plane to Proxy Hub credentials and expose a user secret beyond the component that owns authorization.

**Treat an SSH account as the Scholar identity.** Rejected because a tunnel controls network admission but cannot express tenant membership, Scholar tool permissions, application quotas, or application audit identity.

## Consequences

Research users complete one hidden-key login and can use the generated Scholar preset until the key expires, rotates, or is revoked. Administrators gain per-user and per-device control without provisioning Dex accounts. Long-lived credentials increase the importance of one-time display, digest-only server storage, owner-only client storage, and independent rotation. The legacy capability path adds temporary implementation and test cost until migration support is removed.
