# Contributing to Rear

[简体中文](CONTRIBUTING.zh-CN.md)

## Branches and review

Follow Gear's topic-branch workflow: start from the latest `origin/dev`, use a
descriptive branch such as `codex/trace-analysis-workbench`, and target `dev` for
normal pull requests. Keep each branch focused on one feature or fix. Use commit
subjects such as `feat: ...`, `fix: ...`, or `docs: ...`. Review the complete diff
before pushing; remove temporary debugging code and local experiment data.

Describe the concrete problem, resulting behavior, compatibility changes and
validation results. A development push does not publish an npm release. Version
changes and releases require a separate maintenance decision.

## Development and validation

Use Node.js 22.19+ within 22.x, or 24+, and npm:

```sh
npm ci
npm run typecheck
npm run build
npm test
npm pack --dry-run --ignore-scripts
```

Build before running the full suite: the package test inspects `lib/client.js`.
For a focused source check, use `npm test -- tests/plugin/trace-chat.spec.ts`.
`npm run pack:check` builds once and checks the package file list. CI uses the
same checks on `dev`/`main` pushes, pull requests to those branches, and manual
runs. The tests need no model keys or running Gear/Hitch services.

Keep regression tests for evidence ownership, persistence, retries, cancellation
and host integration. Reuse small synthetic fixtures and temporary directories;
avoid duplicate assertions of implementation details and tests for cosmetic copy.
Browser checks are required for native Chat integration, language switching and
layout changes. Check a new conversation and restored history, both languages,
wide/narrow layouts, model/access controls, navigation and console errors. Report
whether a check used a real model; preparing a blank session makes no inference.

## Code, evidence and documentation

Follow nearby TypeScript style: two spaces, single quotes and no semicolons.
Rear uses `.ts`/`.tsx` source imports with TypeScript's import-extension rewrite.
Keep runtime validation, RPC types and callers in agreement. Isolate private
DSH compatibility code in its adapter and verify it against the documented host
version. Update `package-lock.json` with dependency changes.

Gear owns optimization; Hitch owns execution evidence; Rear reads their state.
Preserve exact experiment/run ownership, checksums and source offsets. Keep
analysis snapshots and session history separate from original evidence. Do not
silently truncate exports, rewrite historical results, replay uncertain prompt
admissions, or change a user's model/access settings during recovery.

Update English and Chinese UI dictionaries and both READMEs together. Translate
interface labels, not archived messages or protocol identifiers. Keep current
instructions distinct from design proposals and local debugging notes.

Do not commit `lib/`, `outputs/`, `trace-chats/`, generated dashboard data,
credentials, personal paths or session logs. Check the packed archive: it should
contain runtime assets, declarations, the loader patch, both READMEs and the
license and third-party notices; source tests and local workspaces are not distributed.
