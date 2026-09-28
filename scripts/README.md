# Scripts

`import-agency.mjs` imports five original blobs from a reviewed, exact Git commit
into an empty candidate directory. See [sourcing](../docs/sourcing.md).
Build and verification entrypoints are `../src/cli.mjs` via npm scripts.

The bootstrap-supplied windows/linux/macos helpers maintain developer skill
discovery and explicitly requested branch cleanup. They are not Plugin lifecycle
hooks and are not run by packaging. Follow docs/SCRIPT-STANDARDS.md for new scripts.
