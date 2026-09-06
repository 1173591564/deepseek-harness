# Scholar phase-one composition

English | [中文](README.zh.md)

This example composes Scholar Studio with DSH through published Cordis packages. Reusable prompt, citation, lifecycle, and security behavior lives in [`@deepseek-ai/dsh-scholar-native`](../../packages/context/scholar-native/README.md) and [`@deepseek-ai/dsh-mcp-client`](../../packages/mcp/mcp-client/README.md).

## Topology

- Local mode starts `python -m scholar_mcp` over stdio and may read an independently installed local corpus data pack.
- Remote mode connects to Scholar through Proxy Hub. The server owns the central corpus, embeddings, and vector indexes; Proxy Hub enforces user, tenant, tool, quota, routing, and audit policy.
- Fifteen fixed Scholar skills remain client assets in both modes.
- Local stdio treats Scholar startup failure as fatal. Remote Proxy Hub mode keeps the academic composition loaded after an initial failure and reconnects in the background.

## Local development setup

Install Scholar Studio 0.2.7 and initialize its local assets before mounting the example:

```sh
python -m pip install scholar-studio==0.2.7
scholar init
node examples/scholar/setup.mjs
```

The setup script preserves unrelated profile content and installs the stdio MCP client, the isolated Scholar skill provider, and the native Scholar context package. Remove only its managed block with:

```sh
node examples/scholar/setup.mjs uninstall
```

## Release installation

The release bundle contains `scholar_studio-0.2.7-py3-none-any.whl`, `install.sh`, and `install.ps1`. Both installers initialize the 15 local skills and the academic preset without storing a Token.

```sh
bash install.sh
```

Run `dsh web` and select the academic preset. The onboarding step asks only for the administrator-issued Scholar Token, validates it through Proxy Hub `/v1/me`, and stores it as an owner-only Managed Credential after validation succeeds. Later sessions reuse the credential.

Explicit `401` and `403` responses require a replacement Token. Network failures, timeouts, and `5xx` responses retain an existing Managed Credential.

An initial remote outage does not roll back the academic preset. DSH retries in the background, and storing a configured replacement Token wakes a stopped connection supervisor without restarting DSH.

This development release uses the fixed `http://47.108.198.147:8081/v1/mcp/scholar` endpoint and displays a plaintext-transmission warning. Use only revocable test Tokens. A production release must use a fixed HTTPS endpoint.

## Verification

Run the example verification suite:

```sh
pnpm exec vitest run --config vitest.e2e.config.ts \
  examples/scholar/tests/scholar.e2e.ts
```

The keyless case boots the real Loader configuration. With `DEEPSEEK_API_KEY`, a real model must call the Scholar MCP tool and the test verifies the fixture server audit record rather than model prose. The Scholar server protocol suite separately covers missing, wrong, and valid Bearer authentication, MCP initialization, the exact 16-tool catalog, lexical search, and semantic search. The wheel and corpus data remain separate artifacts.

## Known limitations

- Remote operation requires an available Scholar service and credential reference.
- Local literature ranking requires a separately installed data pack.
- The repository with-key smoke uses a local MCP fixture. A deployment release still needs the same protocol checks against its externally hosted endpoint.
