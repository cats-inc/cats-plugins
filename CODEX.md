# Codex-Specific Instructions

Read `AGENTS.md` first and `docs/AGENT-GUIDE.md` next. Only Codex maintains this
file; other agents should ignore it.

- Prefer `rg` for text search.
- Preserve user edits and respect `.editorconfig`.
- Use the project's verified commands in `docs/testing.md` and its manifests.
- Follow an assigned Conductor. Do not substitute author-run tests for independent
  code review.
- For `dyu`, reply exactly “I am Codex, and I understand.” after reading both files.

## Skills

The canonical source is `skills/`. Codex discovers `.agents/skills/<name>/SKILL.md`.
After skill changes, run `scripts/windows/Sync-AgentSkills.ps1`; keep referenced
resources inside the skill directory so sync preserves them. Optional skills and
scripts are documented in `skills/README.md`; do not assume they are installed.

## Project Context

- The initial producer implementation is authorized for direct commit/push to
  `main` (2026-09-28). Releases and host integration require separate scope.
- Keep dependent Git mutations sequential and inspect state between them.
