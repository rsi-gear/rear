# dsh-plugin-rear

[简体中文](README.zh-CN.md)

Rear is a DeepSeek Harness workbench with read-only access to Gear experiments and Hitch trajectories, plus dedicated local agent workspaces for trace analysis.

Gear is the only refinement control plane. It owns `/refine`, candidate generation, evaluation scheduling, promotion, and experiment state. Rear does not register `/refine`, inspect its command return value, persist a refinement sidecar, cancel experiments, or modify Gear state.

## Compatibility

The development and test baseline is DSH `0.1.1-rc.2`. Rear feature-detects Hitch's daemon artifacts, so legacy CLI evals and daemon-submitted evals remain readable without relying on a Hitch package version. Rear also recognizes the legacy `refinement/created` Session event written by pre-Gear Rear releases, so historical sessions containing that event remain readable. The current Gear-backed runtime never writes or consumes the event, and new refinement views do not depend on it.

The evidence readers support Gear dev `aa460e3` and Hitch dev `7ee8908`: partial evaluations with invalid trials, reused seed/held-out baselines, verifier-only regrades, native phase groups, and standardized verifier score channels. Legacy reward-only results remain readable; an absent process score stays absent.

## Data flow

```text
Gear registry + round state
  evolutionId / roundId / evalId / runId
                    │
                    ▼
Hitch submission.json + control.json
                    │ lifecycle/phase only
Hitch progress.json or result.json
                    │ authoritative run membership
                    ▼
Hitch runs/<runId>/manifest.json
      │             └─ bundle.index.json + eval/publication.json
      ├─ trajectory_ref
      └─ interactions/interaction.ref.json
                    ▼
Canonical trajectory / provider evidence / model interactions
```

Rear reads `gear.root/registry.json` and `gear.root/evolutions/<evolutionId>/rounds/*.json`. For every Gear evaluation that contains persisted run IDs, it verifies membership against Hitch `progress.json` while running and `result.json` when terminal. `submission.json` and `control.json` supply queued/phase/failure diagnostics but never create trial membership. Rear verifies eval, trial, task, attempt, benchmark, sealed run manifest, trajectory references, file paths, byte counts, and checksums before exposing evidence.

When `bundle.index.json` is present, Rear additionally validates its complete file set, digests, context identity, bundle digest, and `eval/publication.json` receipt. Execution provider, worker/lease, resources, image identities, and capture completeness are projected into the comparison UI. Independently captured model interactions remain a separate checksum-validated, bounded read-only evidence stream rather than being treated as canonical trajectory events.

Rear never guesses a run path from a `/refine` response. Gear state supplies the authoritative experiment-to-evaluation association; Hitch supplies the authoritative evaluation-to-trajectory association.

Membership includes both valid and invalid Gear trials. A corrupt experiment is reported independently so the registry remains browsable. Regrades use the digest-verified assessment observation while retaining the sealed source run's trajectory. Native trials resolve every phase through their assessment, run group, sealed bundles, and per-phase trajectory references; incomplete or inconsistent groups are rejected together. Multiple phase conversations contribute one trial observation to score averages.

Benchmark grouping uses Gear's persisted condition identity, or a validated Hitch request policy when reading Hitch directly, rather than each task's remaining timeout. Comparison still checks the actual task environment. Total scores drive the existing reward aggregates; available process scores are averaged separately and expose process components and verifier feedback alongside the trajectory. Partial process-score coverage is shown explicitly.

Canonical run events are projected by DSH's registered `ConversationNodeAssembler` definitions and rendered by the native `trajectory` conversation-view component. Rear supplies only a read-only offline Session snapshot per comparison lane; it does not maintain a second trajectory layout, timeline, table, inspector, search, folding, or virtualization implementation.

## Trace chat and block diff

Select 1–4 runs for a task and open trajectory comparison. The evidence tabs and
analysis remain on the same page:

- **Trajectories** uses DSH's native archived trajectory viewer.
- **Trace chat** embeds normal DSH Chat in a resizable side panel. Opening it
  restores matching history or prepares a blank conversation. Choose the model,
  reasoning effort and access mode in the native composer before sending the
  first message. Markdown, streaming, tools, approvals, stop and history are
  provided by DSH. **New analysis** creates another conversation; the history
  selector shows this source session, experiment and exact run set.
- **Block diff** compares whole blocks or exact excerpts, including different
  block types and passages from the same run. Add sources to the comparison
  list, choose a baseline and switch targets. **Compare first system prompts**
  selects each run's first recorded `request/header` system prompt. Changed
  lines/words are highlighted and unchanged lines can be expanded. Diff runs
  locally without model calls. Changing the run set resets the comparison list.

Collapse and reopen Trace chat without losing the draft. Drag the separator or
use its arrow keys to resize; below 720 px of workbench width, the panels stack.
The analysis directory is fixed, so full-page workspace/preset navigation is
omitted from the embedded Chat. UI labels follow DSH's English/Chinese language
setting; archived evidence and protocol identifiers retain their original text.

Each analysis has its own native workspace in the left sidebar and a directory:

```text
trace-chats/trace-<request UUID>/
  manifest.json          # experiment, run identities and checksums
  traces/                # canonical JSON, event JSONL and line indexes
  AGENTS.md / README.md   # evidence-reading instructions
  session.json           # native session identity and admission state
  analysis/              # generated scripts, notes and reports
```

Preparing the workspace makes no model request and does not copy ordinary Chat
history. After a message is sent, the agent reads relevant files with its normal
tools; Rear does not insert every trace into each request. Snapshots remain fixed
when the original experiment changes. Conversation logs use DSH's durable store
and survive browser reloads and host restarts. Repeated preparation keeps the
same request/session identity and preserves later model/access choices. Existing
callers can supply an initial question; an uncertain admission is never replayed
automatically.

Exports use the same experiment membership and sealed-evidence checks as the
viewer, plus complete canonical checksums. The host reads the sources; browser
trace text is not accepted. Canonical source data above 50 MB fails without truncation.
Provider-only runs without canonical documents cannot be exported. Sources are
initially read-only; workspace instructions direct generated work into
`analysis/`. The agent uses normal host permissions: the working directory is
not an OS sandbox. Gear/Hitch readers remain read-only. Block excerpts retain
run ID, event sequence, field path and exact source offsets, including CRLF text.
An oversized diff shows the complete source texts and requests a smaller excerpt.

Set `traceChatsRoot` to an absolute directory, or use the default
`<source session cwd>/trace-chats`. This repository ignores `/trace-chats/`.
The embedded adapter is verified against DSH `0.1.1-rc.2`; private renderer and
history seams are isolated in `DshNativeChatSurface.tsx`. Unsupported assemblies
show an error. Creating analysis sessions requires DSH's `apiProxy`; the
read-only Refine views remain usable without it.

## Configuration

The bundled Loader row is dormant. Enable it and provide explicit state roots and limits:

```yaml
- id: rear-refinement
  name: dsh-plugin-rear
  config:
    traceChatsRoot: /absolute/path/to/rear/trace-chats
    trajectoryResponseMaxBytes: 8388608
    providerEvidencePageMaxBytes: 262144
    changeWaitMs: 25000
    gear:
      root: /srv/dsh/refine-state
      watchDebounceMs: 200
    hitch:
      id: hitch
      root: /srv/hitch-state
      watchDebounceMs: 200
```

`gear.root` must be the same absolute directory configured in Gear's top-level `stateRoot` field (not under `evolutionState`). `hitch.root` must be the absolute Hitch run-centered state root. Both roots must already exist as real directories; symlinked roots and escaping evidence paths are rejected.

The client loads canonical trajectories through bounded `trajectoryPage` responses. The configured `trajectoryResponseMaxBytes` limits each encoded page, including a fragment of a single large event; content-addressed cursors reject changed snapshots. All pages are assembled before handing the document to DSH. The existing single-response `trajectory` endpoint retains its size limit for older clients. Deploy the host and client build together to enable pagination.

The plugin watches both roots and asks connected views to perform an authoritative rescan after changes. Gear evolutions are global persisted experiments; the active DSH Session scopes only the browser controller, not experiment ownership.

## Development

```bash
npm ci
npm run typecheck
npm run build
npm test
npm pack --dry-run --ignore-scripts
```

Build before the full test suite; package tests inspect `lib/client.js`. See
[Contributing](CONTRIBUTING.md) for branch, validation and bilingual maintenance rules.

The dashboard fixture generator remains a deterministic UI/evidence fixture for tests; production discovery always starts from Gear's persisted registry and round files.

See [the read-only integration specification](docs/dsh-refinement-workbench-plugin-spec.md) for the ownership and validation contract.
