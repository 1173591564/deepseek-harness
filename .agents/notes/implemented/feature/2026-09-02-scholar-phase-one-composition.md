# Agent Note: Scholar phase-one composition

Status: implemented

English | [中文](2026-09-02-scholar-phase-one-composition.zh.md)

## Problem

The Scholar experiment combined example-local plugins, optional startup, literal HTTP authentication, process-global agent state, and browser access without one owned security policy. That topology could demonstrate individual features but could not provide reproducible installation, mandatory academic tools, reconstructable model context, or safe concurrent sessions.

## Decision

Phase one uses a direct DSH client-to-Scholar-server topology. `@deepseek-ai/dsh-mcp-client` provides mandatory stdio or Streamable HTTP tools, `@deepseek-ai/dsh-scholar-native` provides owner-scoped literature and citation context, `@deepseek-ai/dsh-user-questions-dashboard` provides loopback interaction, and `@deepseek-ai/dsh-memory-native` initializes externally persisted participation context when enabled. The example tree contains Loader wiring and validation scenarios; reusable behavior belongs to those packages.

Team deployments extend the remote transport through [Proxy Hub Access Keys](2026-09-03-scholar-proxy-hub-access-keys.md); local and direct authenticated Scholar operation retain this composition.

Scholar activation uses `failOnStartupError: true`. Remote authentication names a credential reference and resolves it for every request; static sensitive headers are rejected. HTTP is limited to HTTPS or explicit loopback development endpoints, and redirects are rejected. Release installers require an explicit gateway and pass hidden enrolment input to `gateway-login` over standard input rather than process arguments. The Scholar server owns the remote corpus, embeddings, and vector indexes. Local stdio installations may use a separately installed data pack; the Scholar wheel carries code and fixed local skills rather than corpus data.

Scholar literature state is keyed by the requesting agent. Prompt assembly refreshes from durable user messages before rendering, and citation audits observe successful writes inside the configured Scholar output directory. Memory publishes context only after authentication, persistence, authoritative readback, and Session-log recording succeed. The dashboard binds loopback, validates exact Host and same-origin Origin, and applies one random capability cookie to page, API, and SSE access.

## Verification

Package tests cover authentication policy, credential rotation, path containment, concurrent agent isolation, cancellation, persistence readback, question validation, and disposal. Package-owned Loader fixtures boot Scholar, Dashboard, and Memory through the real app composition and assert model-visible, durable, or user-visible output. The Scholar example with-key smoke requires a real model to invoke the MCP tool and verifies the fixture server audit record independently of model prose. Scholar protocol coverage exercises missing, wrong, and valid authentication, MCP initialization, the exact 16-tool set, lexical search, and semantic search.

## Alternatives considered

**Keep example-local plugin implementations.** Rejected because examples cannot own reusable lifecycle, security, configuration, and publication contracts or receive package-level coverage and documentation gates.

**Allow Scholar startup to degrade silently.** Rejected because an academic preset without its declared research tools gives the model a misleading operating environment. Operators may disable the composition explicitly instead.

**Synchronize skills and vector indexes from the remote server.** Rejected because skills are fixed client assets while corpus and derived retrieval state are server-owned. Mixing those lifecycles makes installation non-reproducible and expands the credentialed data surface.

**Make Proxy Hub part of the base composition.** Rejected because local and direct authenticated Scholar operation do not require the separate team service and deployment model. Team deployments add Proxy Hub at the remote transport.

## Consequences

Phase-one availability depends on the selected Scholar transport and, when enabled, the configured Memory services. Failures are explicit rather than replaced with local shadow state. Remote clients do not need corpus, database, embedding, or vector-index credentials. Direct-client security policy does not imply Proxy Hub team controls; deployments select that extension explicitly.
