# Cats Plugins

Pinned upstream capabilities, packaged for the Cats ecosystem.

## Current status

The first producer MVP packages Agency Agents' **Code Reviewer** and **UX Researcher**
as namespaced instruction skills. It retains the reviewed upstream commit, reuses
the upstream converter, adds Cats metadata, and creates a deterministic preview ZIP.

This is a producer preview, not a Desktop-installable release. Runtime managed
discovery, Desktop installation/removal, lifecycle execution and a marketplace
catalog remain host integration work. No new provider is registered.

```sh
npm ci --ignore-scripts
npm run check
```

Requires Node.js 24 and Bash with standard Unix tools (Git Bash on Windows).
The build is offline after dependency installation.

Output: `dist/agency-agents/agency-agents-0.1.0.catsplugin`, its SHA-256 sidecar,
and a build receipt. This preview extension/manifest is not a frozen host SDK.
Downloadable CI artifacts are test outputs, not releases.

## Layout

| Path | Responsibility |
| --- | --- |
| `plugins/agency-agents/recipe.json` | Selected roles and Cats metadata |
| `plugins/agency-agents/source-lock.json` | Full upstream commit, file sizes and hashes |
| `plugins/agency-agents/upstream/` | Five original Git blobs retained for offline builds |
| `src/` | Converter bridge, preview packaging and verification |
| `scripts/import-agency.mjs` | Explicit maintainer import from a reviewed Git checkout |
| `tests/` | Isolated packaging, tamper and boundary checks |
| `skills/` | Developer workflows only; never packaged product roles |

See [setup](docs/setup-guide.md), [architecture](docs/architecture.md),
[sourcing](docs/sourcing.md), [producer spec](docs/specs/SPEC-001-agency-producer.md)
and [progress](PROGRESS.md).

## Attribution

Agency Agents is MIT-licensed, Copyright (c) 2025 AgentLand Contributors.
The [original license](plugins/agency-agents/upstream/LICENSE) and selected original
documents ship inside every artifact. See [NOTICE](NOTICE.md).
Cats packaging code is MIT-licensed under [LICENSE](LICENSE).
