# dsh-plugin-rear

REAR is an npm-installable DeepSeek Harness plugin that adds a Session-scoped
Refine workbench backed by Hitch run-centered evidence. It is not a standalone
web application and does not add a second data root, router, or server process.

The package is dual-face:

- its package root is a Cordis Host plugin providing the durable refinement
  sidecar, provider registries, `/refine`, Hitch evidence validation, and a
  bounded Connection RPC channel;
- `dsh-plugin-rear/client` is discovered through `dsh.client` metadata and
  contributes the always-visible Refine conversation view and `/refine` card.

## Install

Install it into the DSH Web profile the same way as other distributable DSH
plugins:

```bash
dsh plugin --profile web add dsh-plugin-rear
```

The bundled `cordis.patch.yml` intentionally adds a disabled row, so npm
installation cannot start a local filesystem reader. Enable and configure the
row in the selected profile:

```yaml
- id: rear-refinement
  name: dsh-plugin-rear
  config:
    driver: your-refinement-driver
    evidenceProvider: hitch
    objectiveMaxBytes: 16384
    trajectoryResponseMaxBytes: 8388608
    providerEvidencePageMaxBytes: 262144
    changeWaitMs: 25000
    hitch:
      id: hitch
      root: /absolute/path/to/hitch-state
      watchDebounceMs: 200
```

The Web profile must already provide `storageDomain`, `sessions`, `commands`,
and `connection`, as the stock DSH Web profile does. `hitch.root` must contain
the run-centered `evals/` and `runs/` directories.

## Driver composition

Candidate generation is deliberately not part of REAR. A driver plugin loaded
after REAR registers one exact id:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { RefinementDriver } from 'dsh-plugin-rear'

export const inject = ['refinements']

export function apply(ctx: Context): void {
  const driver: RefinementDriver = {
    id: 'your-refinement-driver',
    available: () => true,
    async run(operation) {
      // Generate candidates and attach exact Hitch eval ids through
      // operation.capabilities. Never write the sidecar directly.
    },
    async resume(operation) {
      // Reattach through the persisted operation/eval ids.
    },
    async cancel() {
      return 'stopped'
    },
  }
  ctx.effect(() => ctx.refinements.registerDriver(driver))
}
```

Provider and driver ids are selected explicitly. REAR never picks the first
registered provider and never derives eval/run ids from paths.

## Evidence and transport boundaries

- Hitch is read only through exact eval/run references stored by the driver.
- Every evidence path is confined to its real run directory; symlink escapes,
  size mismatches, and SHA-256 mismatches fail before bytes reach the browser.
- Normalized trajectories and provider-native evidence use separate endpoints;
  native evidence is cursor-paged and byte-bounded.
- Hitch filesystem watches publish payload-free invalidations. The Client holds
  an event-driven change request and performs an authoritative resync; React
  does not poll files.
- Uninstall disposes the command, RPC channel, watchers, client slots, and
  in-process operations through Cordis effects.

## DSH rc.8 compatibility

DSH `0.1.0-rc.8` supports external dual-face packages, conversation slots, and
generic Connection RPC, so the plugin installs and the workbench operates on
that release. Two public UI seams described by the full workbench spec are not
yet exported by rc.8:

- `ui-trajectory` does not export `TrajectorySurface` or the offline adapter;
- command-row props do not yet expose the generic `openView(viewId)` callback.

On rc.8, users open the always-visible Refine tab directly and canonical lanes
show a compatibility notice while verified provider evidence remains
available. DSH client bundles forbid cross-plugin runtime value imports, so a
future compatible DSH release must promote the offline trajectory surface to a
supported shared service before REAR can consume it without copying trajectory
code.

## Develop and verify

```bash
npm install
npm run typecheck
npm test
npm run pack:check
```

For repeatable UI testing, generate a mountable JSON-storage snapshot and
matching Hitch evidence under `fixtures/dashboard-data`. The generated fixture
is intentionally ignored by Git and its generated README records the exact
demo Session lifecycle and volume/config paths:

```bash
npm run fixture:dashboard
```

The fixture includes three benchmark suites across baseline, safe-tools, and
quality-focused candidates. It exercises the portfolio heatmap, per-benchmark
regression guardrails, quality/latency Pareto frontier, benchmark drill-down,
and trajectory evidence states.

The tests cover persistent lifecycle isolation and restart recovery, CAS
mutations, Hitch ownership/path/checksum behavior, strict comparisons, Client
request invalidation, a real Loader composition, client-bundle purity, and the
install-safe package patch.

The implementation contract is documented in
[`docs/dsh-refinement-workbench-plugin-spec.md`](docs/dsh-refinement-workbench-plugin-spec.md).
