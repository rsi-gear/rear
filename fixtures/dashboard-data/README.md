# REAR dashboard dummy data

这是一个可重复挂载的持久化测试快照，包含 DSH Refinement 状态和 Hitch run-centered 证据。

## 固定 Session

- id: `rear-dashboard-demo`
- createdAt: `1787216400000`
- cwd: `/workspace/rear-dashboard-demo`

REAR 按完整 Session lifecycle 隔离数据，因此当前 DSH Session 的这三个值必须完全一致。若宿主不从持久化层恢复该 Session，请用这些 metadata 创建测试 Session。

## Benchmark 组合

- `rear-dashboard-benchmark@2026.08`
- `tool-use-safety@2026.08`
- `long-context-retrieval@2026.07`

候选数据刻意保留不同权衡：baseline 延迟最低；safe-tools 在工具安全上领先；quality-v2 等权平均得分最高，但在 destructive-guard 上超过 0.01 回归红线。

## 挂载

```yaml
volumes:
  - ./fixtures/dashboard-data/storage:/mnt/rear-dashboard/storage
  - ./fixtures/dashboard-data/hitch:/mnt/rear-dashboard/hitch:ro
```

把 `@deepseek-ai/dsh-storage-json` 的 `root` 指向 `/mnt/rear-dashboard/storage`，把 `dsh-plugin-rear.config.hitch.root` 指向 `/mnt/rear-dashboard/hitch`。Hitch 是只读证据源；storage 可以读写，测试期间的变化会持久保留。

## 重置或定制

```bash
npm run fixture:dashboard
npm run fixture:dashboard -- --output ./work/rear-dashboard-test
npm run fixture:dashboard -- --session-id my-session --session-created-at 1787293200000 --session-cwd /workspace/demo
```

生成命令会完整替换目标目录。默认数据是确定性的，包含 3 条历史 refinement、2 次迭代、3 个候选版本和 3 套 benchmark。数据覆盖跨 benchmark 提升、回退红线、质量/延迟权衡，以及 improved/regressed/unchanged、invalid、timed-out、missing、provider-only、corrupt 和分页 raw evidence 场景。
