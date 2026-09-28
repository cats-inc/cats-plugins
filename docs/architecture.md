# Producer architecture

`Git commit → reviewed retained snapshot + source lock → upstream converter →
Cats metadata envelope → canonical preview ZIP + receipt`

The Agency recipe selects two roles. The builder verifies the complete retained
file set and SHA-256 values before copying it into a temporary directory. It runs
the original converter with `--tool antigravity --out converted`, validates the
selected outputs, and enriches only frontmatter. Namespaced agency slugs avoid
replacing Cats' built-in code-reviewer or UX skills.

The ZIP contains plugin.json, two SKILL.md files, the upstream license, notice,
original role documents, source lock, recipe, build input hashes and integrity.json.
Converter executables are retained in the producer checkout, not exposed as
Plugin executables. Files are stored uncompressed with a fixed timestamp and
sorted paths. Build receipt platform/tool versions stay outside the deterministic
artifact. CI compares hashes from Windows, Linux and macOS.

This preview format is deliberately scoped to one producer. The verifier expects
the exact current approved payload and canonical archive, rather than accepting
arbitrary third-party Plugin formats. Hashes provide integrity relative to that
checkout; they are not publisher signatures or trust approval.

Platform's [ADR-122](https://github.com/cats-inc/cats-platform/blob/main/docs/decisions/122-adopt-managed-plugins-for-upstream-capabilities.md)
and [SPEC-121](https://github.com/cats-inc/cats-platform/blob/main/docs/specs/SPEC-121-managed-plugin-capabilities.md)
own the proposed host contract. Host hooks, operation receipts, admission fences,
loaded-context provenance and lifecycle recovery are not implemented here.
Pure instruction content requires no executable install/uninstall hooks.

The existing Runtime skill envelope informed metadata fields; this is not proof
of managed Runtime discovery or model quality. There are no Runtime imports,
provider adapters, sessions, services or Desktop mutations.
