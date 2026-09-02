# @deepseek-ai/dsh-scholar-native

English | [中文](README.zh.md)

Adds owner-scoped Scholar Studio literature context to DSH prompt assembly and audits completed academic file writes for unresolved citation keys.

## Config

```yaml
- id: scholar-native
  name: '@deepseek-ai/dsh-scholar-native'
  config:
    scholarHome: /path/to/.scholar
```

`scholarHome` is required while the plugin is enabled. The directory contains local rules, user interests, and the optional local corpus data pack. Index files are derived caches and are atomically rebuilt when corpus file metadata changes.

The plugin refreshes literature before system-prompt assembly for the exact agent that owns the request. It derives session topics only from durable user messages and renders each prompt section with that agent's state. Another concurrent agent cannot provide or replace those sections.

Completed `write` and `str_replace_editor` calls trigger a citation audit only when the written target remains inside the Scholar output directory. Audit findings return as model-visible additional context. A failed audit blocks completion guidance without exposing filesystem paths or parser details.

## Model Experience

### Scholar literature context

#### What the model sees

The request contains bounded Scholar persona, research-interest, and ranked literature context derived from the current agent's durable user messages and local Scholar assets.

#### Token effect

Persona and interests add bounded stable text. Literature adds at most `literatureMaxBytes`; each topic change replaces the request-local section instead of accumulating another copy.

#### KV Cache effect

Stable persona and interests preserve their request prefix. A changed literature topic invalidates reuse from the first changed literature token.

### Citation audit feedback

#### What the model sees

After a successful academic file write, unresolved citation keys appear as additional tool context that asks the model to re-read and correct the file before finishing.

#### Token effect

The bounded citation-key list adds context only after an eligible write and does not enter later requests unless the ordinary Session log retains the tool result.

#### KV Cache effect

Append-only tool context follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- Remote MCP search and the central corpus are provided by the Scholar server; this package does not download or synchronize corpus data.
- Local ranking is lexical and operates only when a local data pack is present.
- Team policy, quotas, centralized auditing, and multi-tenant corpus isolation require the planned Proxy Hub rather than this direct-client plugin.
