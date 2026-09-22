# dsh-plugin-rear

[English](README.md)

Rear 是 DSH 中的 Gear 实验工作台：只读查看 Gear 实验和 Hitch 轨迹，
并为轨迹分析创建独立的本地 Agent 工作区。

Gear 是唯一的优化控制平面，负责 `/refine`、候选生成、评测调度、晋升和实验状态。
Rear 不注册 `/refine`，不解析它的命令返回值，不另存优化状态，不取消实验，也不修改 Gear 状态。

## 兼容性

开发与测试基线为 DSH `0.1.1-rc.2`。Rear 根据 Hitch daemon 的实际产物识别能力，
兼容旧 CLI 评测和 daemon 提交的评测，不依赖 Hitch 包版本号判断。
早期 Rear 写入的 `refinement/created` Session 事件仍可读取；当前 Gear 集成不写入、
不消费此事件，新视图也不依赖它。

证据读取器已适配 Gear dev `aa460e3` 和 Hitch dev `7ee8908` 的合同，包括无效 trial、
部分完成的评测、复用的 seed/held-out 基准、仅重新评分的结果、原生 phase group 和
标准化评分通道。旧版仅有 reward 的结果仍可读取，缺失的过程分不会被伪造。

## 数据流

```text
Gear registry + round state
  evolutionId / roundId / evalId / runId
                    │
                    ▼
Hitch submission.json + control.json
                    │ 仅提供生命周期与阶段信息
Hitch progress.json 或 result.json
                    │ 运行归属的权威来源
                    ▼
Hitch runs/<runId>/manifest.json
      │             └─ bundle.index.json + eval/publication.json
      ├─ trajectory_ref
      └─ interactions/interaction.ref.json
                    ▼
规范化轨迹 / 执行后端证据 / 模型交互
```

Rear 读取 `gear.root/registry.json` 和 `gear.root/evolutions/<evolutionId>/rounds/*.json`。
对于 Gear 已保存的 run ID，运行中通过 Hitch `progress.json` 核实归属，终态通过
`result.json` 核实。`submission.json`、`control.json` 提供排队、阶段和失败诊断，
不能据此推断 trial 成员。暴露证据前会验证 eval、trial、task、attempt、benchmark、
封存的运行清单、轨迹引用、文件路径、字节数与校验和。

存在 `bundle.index.json` 时，还会验证完整文件集合、摘要、上下文标识、bundle 摘要和
`eval/publication.json` 回执。执行后端、worker/lease、资源、镜像标识和采集完整性会显示
在对比界面。独立采集的模型交互是另一条经校验、限量分页的只读证据流，不会冒充规范化轨迹事件。

Rear 不从 `/refine` 返回值猜测运行路径。Gear 提供实验到评测的权威关联，
Hitch 提供评测到运行轨迹的权威关联。

归属验证包含有效和无效 trial。损坏的实验单独报错，不妨碍浏览其他实验。
重新评分使用摘要验证后的 assessment observation，同时保留原运行的封存轨迹。
原生 trial 的每个 phase 均经 assessment、run group、封存 bundle 和轨迹引用解析；
不完整或不一致的组整体拒绝。多个 phase 会话只计作一次 trial observation。

Benchmark 分组使用 Gear 保存的评测条件标识；直接读取 Hitch 时使用经过校验的 request policy，
不按每个任务剩余超时分组。对比仍核查实际任务环境。总分用于现有 reward 汇总；可用过程分单独
求平均，并展示评分组成、反馈和覆盖率，明确标识部分缺失的过程分。

规范化事件由 DSH 已注册的 `ConversationNodeAssembler` 投影，再由原生 `trajectory`
视图渲染。Rear 为每条对比轨迹提供只读离线 Session 快照，复用 DSH 的布局、检查器、搜索、
折叠与虚拟滚动。

## 轨迹分析与块 Diff

选择同一任务的 1–4 条运行轨迹，进入轨迹对比。证据与分析留在同一页面：

- **轨迹**：使用 DSH 原生归档轨迹查看器。
- **轨迹分析**：在可调整宽度的侧面板中使用普通 DSH Chat。打开时恢复匹配的历史，或准备
  空白会话。发送第一条消息前即可在原生输入框选择模型、推理强度和权限。Markdown、流式输出、
  工具、审批、停止和历史均由 DSH 提供。**新建分析**创建另一个会话；历史选择器仅显示当前
  来源会话、实验和所选运行集合对应的分析。
- **块 Diff**：可比较整个内容块或精确划选文本，包括不同类型的块、同一轨迹中的不同片段。
  添加来源到对比列表后，选择基准并切换目标。**对比首个系统提示词**选择各运行首个
  `request/header` 中记录的系统提示词。高亮变化的行和词，可展开未变化的行。
  Diff 在本地计算，不调用模型；切换运行集合会重置对比列表。

收起、展开轨迹分析时保留草稿。拖动分隔条或用方向键调整大小；工作台宽度小于 720 px 时
上下排列。分析目录固定，因此面板不提供整页 Chat 的全局工作区、预设切换入口。
界面跟随 DSH 的中英文语言设置，归档证据和协议标识保持原文。

每次分析在左侧列表中拥有独立的原生工作区，并创建以下目录：

```text
trace-chats/trace-<request UUID>/
  manifest.json          # 实验、运行标识和校验和
  traces/                # 完整规范化 JSON、事件 JSONL 和行号索引
  AGENTS.md / README.md   # 证据阅读说明
  session.json           # 原生会话标识及首条消息提交状态
  analysis/              # 生成的脚本、笔记和报告
```

准备工作区不调用模型，也不复制普通 Chat 历史。发送消息后，Agent 用普通工具按需读取文件，
Rear 不会把全部轨迹反复塞进每次请求。原始实验变化不会刷新已有快照。对话日志保存在 DSH
的持久化存储中，浏览器刷新和宿主重启后可恢复。重复准备沿用同一请求、会话标识，保留用户
后来选择的模型与权限。已有调用方仍可传入首条问题；若提交结果不确定，不会自动重放。

导出与查看器使用相同的实验归属、封存证据验证，并验证完整规范化文件的校验和。
源文件由宿主读取，不接受浏览器传来的轨迹正文。规范化源文件合计超过 50 MB 时会报错，不截断证据。
只有 provider 文件、没有规范化文档的运行不能导出。源文件初始为只读；工作区说明要求把
生成内容写入 `analysis/`。Agent 使用宿主的正常权限，工作目录本身不是操作系统沙箱。
Gear/Hitch 读取器保持只读。块划选保留 run ID、事件序号、字段路径和精确来源偏移，兼容
CRLF 换行。Diff 计算过大时显示完整原文，提示缩小选区。

`traceChatsRoot` 可指定绝对目录；默认是 `<来源会话 cwd>/trace-chats`。
本仓库忽略 `/trace-chats/`。内嵌适配器已在 DSH `0.1.1-rc.2` 验证；私有渲染器和历史
接口集中在 `DshNativeChatSurface.tsx`，不支持的宿主会明确报错。创建分析会话需要 DSH
`apiProxy`；缺少该服务时仍可使用只读 Refine 视图。

## 配置

包内 Loader 配置默认关闭。启用时显式指定状态根目录和限制：

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

`gear.root` 必须与 Gear 顶层 `stateRoot` 一致，不在 `evolutionState` 下。
`hitch.root` 必须是 Hitch 以运行目录为中心的状态根目录。两者都必须是已存在的真实绝对目录；
符号链接根目录及越界证据路径会被拒绝。

客户端通过限量的 `trajectoryPage` 响应加载规范化轨迹。
`trajectoryResponseMaxBytes` 限制每页编码大小，大事件也会分页；按内容寻址的游标会拒绝
读取已变化的快照。完整拼接所有页后才交给 DSH。旧 `trajectory` 单响应接口保留原有大小
限制。启用分页时需同时部署宿主与客户端构建产物。

插件监听两个状态根目录，变化时通知视图重新进行权威扫描。Gear evolution 是全局持久化
实验；当前 DSH Session 只限定浏览器控制器，不决定实验归属。

## 开发

```sh
npm ci
npm run typecheck
npm run build
npm test
npm pack --dry-run --ignore-scripts
```

全量测试前先构建；打包测试会检查 `lib/client.js`。分支、验证和双语维护规则见
[参与开发](CONTRIBUTING.zh-CN.md)。

仪表盘样例生成器只用于确定性的 UI/证据测试；生产发现始终从 Gear 保存的 registry 和 round
文件开始。归属与验证合同见[只读集成规范](docs/dsh-refinement-workbench-plugin-spec.md)。
