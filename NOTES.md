# Trace analysis workbench maintenance notes

## Scope

- Topic branch: `codex/trace-analysis-workbench`, based on `origin/dev`.
- One feature: native trace-scoped Chat beside trajectory and arbitrary block Diff.
- Gear/Hitch evidence remains read-only. Analysis uses a separate frozen export
  and a normal DSH workspace/session; it is not an operating-system sandbox.
- DSH `0.1.1-rc.2` is the verified native Chat baseline. Keep its private renderer
  and history compatibility seams isolated in `DshNativeChatSurface.tsx`.

## Review fixes

- Use the current locale in trajectory metadata, block labels, recoverable
  analysis errors and new workspace titles. Maintain both READMEs and guides.
- Reset Diff sources when the selected experiment/run set changes. Map textarea
  newline normalization back to exact original CRLF/CR offsets before pinning.
- Restore durable history even when the native roster has not synchronized yet.
  Validate session metadata, omit incomplete records from history, and honor
  cancellation before reopening a native session or dispatching a prompt.
- Preserve the existing request identity across language switches and retries;
  retries do not replace the user's later model/access selections.
- Share DSH's `diff` 9.x dependency, retain its third-party license notice, update
  the YAML test dependency to the patched 4.3.2 minimum, and avoid duplicate
  builds during package checks.

## Validation

- Clean `npm ci`; Node 22.22.1 typecheck, build and all 109 tests in 16 files passed.
- Four added test files cover source fidelity, native-pane isolation, durable
  sessions and scope/history races. Removed a duplicate creation-retry test;
  presentation-only changes are checked in the browser.
- `npm audit`: zero reported vulnerabilities. Packed output includes runtime
  assets, both READMEs and license notices; tests/local exports are excluded.
- Browser: English/Chinese switching, existing history/model settings, blank
  native Chat controls, exact-scope selection, draft retention, block comparison,
  and 1440/782/520 px layouts passed with no console errors or page overflow.
  This review's browser checks made no model request and reran no benchmark.

## Maintenance lessons

- Check empty and restored Chat states; model/access controls must exist before
  the first message. Keep analysis beside the evidence and avoid redundant hints.
- Verify an installed archive and browser behavior as well as unit tests.
  Check each deployment step before continuing; local utility versions can differ.
- Follow [Contributing](CONTRIBUTING.md) or [参与开发](CONTRIBUTING.zh-CN.md).
  Keep machine-specific deployment notes and real trace/session data local.
