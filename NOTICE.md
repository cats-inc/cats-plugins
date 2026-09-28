# Third-party source notices

Agency Agents: https://github.com/msitarzewski/agency-agents
Commit: `479193dcce1cf6432ce0f5aa230ab8cc739a8c6b`
Copyright (c) 2025 AgentLand Contributors. License: MIT.

The retained snapshot contains two role documents, LICENSE, scripts/convert.sh and
scripts/lib.sh, unchanged from Git blobs. Packaging calls the upstream converter's
antigravity format, then adds Cats metadata. No upstream installer is invoked.
The converter removes standalone horizontal-rule lines and trailing blank lines;
all other role body text is checked for preservation. Original role bytes and the
complete upstream license are also included in the artifact.

Build-only dependencies are fflate (MIT) and yaml (ISC), pinned by package-lock.json.
Their implementations are not bundled into the instruction-skill artifact.

The scaffold came from sammykenny2/project-bootstrap at
`21f97d74031c53854093bdf63deb0ab01aabad53`, minimal preset. Its MIT notice is retained
in [licenses/project-bootstrap-MIT.txt](licenses/project-bootstrap-MIT.txt).
