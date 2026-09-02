# Scholar phase-one composition

English | [中文](README.zh.md)

This example composes Scholar Studio with DSH through published Cordis packages. Reusable prompt, citation, lifecycle, and security behavior lives in [`@deepseek-ai/dsh-scholar-native`](../../packages/context/scholar-native/README.md) and [`@deepseek-ai/dsh-mcp-client`](../../packages/mcp/mcp-client/README.md).

## Topology

- Local mode starts `python -m scholar_mcp` over stdio and may read an independently installed local corpus data pack.
- Remote mode connects directly to a Scholar Streamable HTTP endpoint. The server owns the central corpus, embeddings, and vector indexes.
- Fifteen fixed Scholar skills remain client assets in both modes.
- Scholar connection and tool synchronization are mandatory; the academic composition uses `failOnStartupError: true`.

Team authorization, quotas, centralized audit, and tenant corpus isolation belong to a later Proxy Hub rather than this direct-client composition.

## Local development setup

Install Scholar Studio 0.2.3 and initialize its local assets before mounting the example:

```sh
python -m pip install scholar-studio==0.2.3
scholar init
node examples/scholar/setup.mjs
```

The setup script preserves unrelated profile content and installs the stdio MCP client, the isolated Scholar skill provider, and the native Scholar context package. Remove only its managed block with:

```sh
node examples/scholar/setup.mjs uninstall
```

## Release installation

The release bundle contains `scholar_studio-0.2.3-py3-none-any.whl`, `install.sh`, and `install.ps1`. Both installers initialize the 15 local skills before generating credential-referenced DSH configuration. Their default endpoint is loopback for an SSH tunnel; a public endpoint must be supplied as HTTPS.

```sh
SCHOLAR_REMOTE_URL=https://scholar.example/mcp bash install.sh
```

The token is read without echo and passed on stdin. It is stored through DSH managed credentials rather than written into YAML or process arguments.

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
