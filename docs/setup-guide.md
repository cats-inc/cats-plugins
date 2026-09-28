# Setup

Use Node.js 24 and npm. Windows needs Git for Windows Bash; Unix needs Bash,
awk, sed, tr, find, sort, head, date, mkdir, cp and mktemp. These are build tools,
not installed Plugin prerequisites. Set `CATS_PLUGINS_BASH` to an absolute
Bash executable path for nonstandard installations; on Windows use Git Bash,
not WSL. No credentials, accounts or ports are required.

```sh
npm ci --ignore-scripts
npm run check
```

The retained source snapshot makes builds offline after dependency installation.
The npm lockfile pins build libraries and integrity. The default output is
`dist/agency-agents/`. Changed inputs require a new directory:

```sh
node src/cli.mjs build dist/agency-next
node src/cli.mjs verify dist/agency-next/agency-agents-0.1.0.catsplugin
```

Verification uses this checkout's approved recipe/source/tooling, compares every
payload byte and canonical ZIP bytes, and checks the sidecar. Keep the matching
producer checkout to verify an older artifact. There is no install command.

Scaffold provenance: [config/bootstrap.json](../config/bootstrap.json).
Only the minimal preset was applied; Node packaging and CI were added here.
