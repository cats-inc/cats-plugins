# Agent Guide

Read AGENTS.md and only your own agent-specific file. This repository owns
producer recipes and artifacts. Platform owns install state/UI; Runtime owns
execution and session delivery. Follow [ADR-001](decisions/001-pinned-upstream-producer.md).

For source changes, read [sourcing](sourcing.md), compare the full commit and
retained blobs, review executable converter changes before running them, and
update license evidence. Do not run upstream install.sh. Do not move product
payloads into developer skill discovery or overwrite Runtime's built-in skills.

For packaging changes, run the affected tests and `npm run check` using a fresh
output directory when existing output belongs to an older recipe/toolchain.
Never silently overwrite a mismatched artifact. Obtain independent review.

The bootstrap's scripts/windows, scripts/linux and scripts/macos maintenance
helpers are retained. They are not plugin lifecycle hooks or build entrypoints.
No services, credentials, production state or live sessions are needed.

Initial user authorization (2026-09-28): create this repository, implement Agency
Agents as the first producer MVP, commit/push directly to main. It does not
authorize npm publication, GitHub releases or host integration changes.
