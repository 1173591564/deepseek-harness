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

Install Scholar Studio 0.2.5 and initialize its local assets before mounting the example:

```sh
python -m pip install scholar-studio==0.2.5
scholar init
node examples/scholar/setup.mjs
```

The setup script preserves unrelated profile content and installs the stdio MCP client, the isolated Scholar skill provider, and the native Scholar context package. Remove only its managed block with:

```sh
node examples/scholar/setup.mjs uninstall
```

## Release installation

The release bundle contains `scholar_studio-0.2.5-py3-none-any.whl`, `install.sh`, and `install.ps1`. Both installers initialize the 15 local skills before generating credential-referenced DSH configuration. Set the Proxy Hub endpoint explicitly; public endpoints must use HTTPS, while development may use a numeric loopback address.

```sh
SCHOLAR_GATEWAY_URL=https://scholar.example/v1/mcp/scholar bash install.sh
```

The token is read without echo and passed on stdin. It is stored through DSH managed credentials rather than written into YAML or process arguments.

## SSH tunnel without a public domain

An SSH account on the Proxy Hub host can carry the gateway over an encrypted loopback connection without a public HTTPS domain. Start the tunnel in one terminal and leave it running:

```sh
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:9845:127.0.0.1:8081 \
  <ssh-user>@<proxy-host>
```

Verify that the console responds through the tunnel before consuming a one-time enrolment code:

```sh
curl -I http://127.0.0.1:9845/console/
```

In a second terminal, run the installer against the loopback gateway:

```powershell
# Windows PowerShell
.\install.ps1 -Gateway http://127.0.0.1:9845/v1/mcp/scholar
```

```sh
# Linux/macOS
SCHOLAR_GATEWAY_URL=http://127.0.0.1:9845/v1/mcp/scholar bash install.sh
```

Give each user a separate SSH account or authorized key so tunnel access can be revoked independently. SSH only supplies the encrypted transport; Proxy Hub membership, tool policy, quota, and the user's capability still authorize every Scholar request.

Keep the tunnel running while DSH uses Scholar. `Ctrl+C` closes it; start the same SSH command again before the next Scholar session. Each client runs its own tunnel, which binds only `127.0.0.1` and does not expose the forwarded gateway to other computers on the client network.

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
