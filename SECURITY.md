# Reporting a vulnerability

If you believe you have found a vulnerability in StemStudio, please report it privately so we can investigate before any public disclosure.

## How to report

Open a [private security advisory](https://github.com/Stem-Studio/Engine/security/advisories/new) with:

- A description of the issue and the impact you observed.
- Steps to reproduce, including any required configuration.
- The affected version (commit SHA or release tag).
- Any suggested fix or mitigation, if you have one.

Please do **not** open a public GitHub issue for vulnerabilities.

## What to expect

- Acknowledgement within 3 business days.
- A first-pass assessment within 10 business days.
- Coordinated disclosure: we aim to release a fix within 90 days of the initial report, and we will credit you in the release notes unless you ask us not to.

## Scope

In scope:

- The Playground, editor, player, and browser-local persistence code.
- BYOK key storage, provider requests, and the optional local AI proxy in
  `server/cmd/ai-server/`.
- The optional local multiplayer sidecar.
- Build, export, and deployment tooling shipped in this repository.

Out of scope:

- Issues in third-party dependencies — please report those upstream.
- Hosted scene, gallery, publishing, collaboration, and share-link services;
  those remote services are not deployed by this repository.
- Vulnerabilities that require a malicious local user with full filesystem access (this project is designed to run on a developer's machine).

Local storage of BYOK keys is expected behavior, but unintended disclosure to
another origin, provider, project, log, or user remains in scope.

## Supported versions

Only the most recent minor release is supported with fixes. We may backport fixes to the previous minor release at maintainer discretion.
