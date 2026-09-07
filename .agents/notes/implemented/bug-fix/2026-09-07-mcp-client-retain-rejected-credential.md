# Agent Note: Retain rejected MCP credentials

Status: implemented

English | [中文](2026-09-07-mcp-client-retain-rejected-credential.zh.md)

## Problem

A policy-restricted gateway can return HTTP 403 `tool_denied` for a valid Scholar Token. Treating that response as authentication rejection deleted the valid credential and left later requests with an opaque “credential is not configured” failure.

## Decision

Only HTTP 401 is an authentication rejection. The MCP client retains the configured credential, emits `mcp-client/authentication-rejected` with the server name and credential reference, stops the current connection outage, and resumes after a configured replacement credential update. The Scholar onboarding controller displays replacement-token guidance independently of configured-credential state.

## Alternatives considered

**Keep unset-on-401.** Rejected because it causes silent data loss and provides no explanation of which credential needs replacement.

**Distinguish authentication failures by server error code.** Rejected because gateway-specific error codes do not define the transport-level authentication contract.

## Consequences

HTTP 403 remains a failed authorization request while the credential stays configured. HTTP 401 gives the browser enough identity to show a replacement prompt without requiring the user to re-enter a value before the system can explain the failure.
