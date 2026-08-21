# REAR

**Runtime Experience Analysis & Replay**

REAR is a local analysis and replay workspace for agent runtime evidence. It
reads Hitch's run-centered store, validates run/eval/trajectory integrity,
groups results by benchmark, and lets you pivot between model and harness views.

## Features

- benchmark-level score and run health overview
- model aggregation for comparing harnesses
- harness aggregation for comparing models
- per-task breakdown with every attempt
- selection of up to four trajectories from the same task
- side-by-side messages, tool calls, failures, usage, phase timing, and verifier results
- automatic refresh while Harbor writes new eval records

## Run locally

```bash
npm install
HITCH_DATA_ROOT=/path/to/hitch-data npm run dev
```

The dashboard is available at `http://localhost:3000/`.

`HITCH_DATA_ROOT` must point to the Hitch state root containing `runs/` and
`evals/`. REAR deliberately has no machine-specific fallback. When the variable
is missing, the dashboard stays empty and reports
`hitch_data_root_not_configured`.

## Verification

```bash
npm test
```

The dashboard is intentionally local-only: filesystem access is provided by the
development service and no benchmark data is uploaded or published.
