# Producer CLI and preview artifact

| Command | Behavior |
| --- | --- |
| `node src/cli.mjs build [OUTPUT_DIR]` | Validate retained sources, execute pinned converter, package and verify |
| `node src/cli.mjs verify [ARTIFACT_FILE]` | Offline exact-byte verification against this checkout and adjacent .sha256 |
| `node scripts/import-agency.mjs CHECKOUT FULL_COMMIT EMPTY_DESTINATION` | Retain five reviewed Git blobs and write a source lock |

Build defaults to dist/agency-agents. Verification defaults to its
agency-agents-0.1.0.catsplugin. Exit 0 means success; failures exit nonzero.
A completed output directory may be reused only with identical artifact/sidecar
and a matching receipt. Incomplete or mismatched output is preserved and rejected;
choose a new directory. Linked output directories/ancestors are rejected.

The artifact is a canonical, stored ZIP named .catsplugin with manifest format
`cats-plugin-producer-preview/v1`. This is an internal experiment, not a stable
Plugin SDK. Files are limited to 1 MiB each, 64 entries and 8 MiB total/archive.
Traversal, Windows device paths, aliases, extra files, compression and noncanonical
archive metadata are rejected. The verifier does not extract files or run hooks.

Manifest capabilities are two namespaced skills. Permissions and hooks are empty.
Removal metadata says a clean context is needed if a role was loaded; it does not
implement revocation. hostCompatibility explicitly reports pending integration.

A future persisted host format needs its own compatibility/version and tested
upgrade/recovery contract. This producer creates immutable outputs, not a user
installation database, and performs no migration.
