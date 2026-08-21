# REAR

**Runtime Experience Analysis & Replay**

REAR is a local analysis and replay workspace for agent runtime evidence. It
reads Hitch's persisted Harbor evals, groups results by benchmark, and lets you
pivot between model and harness views.

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
npm run dev
```

The dashboard is available at `http://localhost:3000/`.

By default, the local data endpoint reads:

```text
/Users/tangyehui/agent-hitch/.hitch
```

Use another Hitch root by setting `HITCH_DATA_ROOT` before starting the service.

## Verification

```bash
npm test
```

The dashboard is intentionally local-only: filesystem access is provided by the
development service and no benchmark data is uploaded or published.
