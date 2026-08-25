# dsh-plugin-rear

Rear is a read-only DeepSeek Harness workbench for experiments produced by Gear and trajectories persisted by Hitch.

Gear is the only refinement control plane. It owns `/refine`, candidate generation, evaluation scheduling, promotion, and experiment state. Rear does not register `/refine`, inspect its command return value, persist a refinement sidecar, cancel experiments, or modify Gear state.

## Compatibility

The development and test baseline is DSH `0.1.1-rc.2`. Rear also recognizes the legacy `refinement/created` Session event written by pre-Gear Rear releases, so historical sessions containing that event remain readable. The current Gear-backed runtime never writes or consumes the event, and new refinement views do not depend on it.

## Data flow

```text
Gear registry + round state
  evolutionId / roundId / evalId / runId
                    │
                    ▼
Hitch evals/<evalId>/result.json
                    │ exact run membership
                    ▼
Hitch runs/<runId>/manifest.json
                    │ trajectory_ref
                    ▼
TrajectoryRef V2 → canonical trajectory file
```

Rear reads `gear.root/registry.json` and `gear.root/evolutions/<evolutionId>/rounds/*.json`. For every Gear evaluation that contains persisted run IDs, it verifies that the Gear run set exactly matches the Hitch eval result. Hitch then verifies eval, trial, task, attempt, benchmark, run manifest, `trajectory_ref`, file path, byte count, and checksum before Rear exposes a trajectory.

Rear never guesses a run path from a `/refine` response. Gear state supplies the authoritative experiment-to-evaluation association; Hitch supplies the authoritative evaluation-to-trajectory association.

## Configuration

The bundled Loader row is dormant. Enable it and provide explicit state roots and limits:

```yaml
- id: rear-refinement
  name: dsh-plugin-rear
  config:
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

The plugin watches both roots and asks connected views to perform an authoritative rescan after changes. Gear evolutions are global persisted experiments; the active DSH Session scopes only the browser controller, not experiment ownership.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run pack:check
```

The dashboard fixture generator remains a deterministic UI/evidence fixture for tests; production discovery always starts from Gear's persisted registry and round files.

See [the read-only integration specification](docs/dsh-refinement-workbench-plugin-spec.md) for the ownership and validation contract.
