export type TrajectoryRole = "system" | "user" | "context" | "assistant" | "tool";

export interface TrajectoryToolDefinition {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface TrajectoryPrompt {
  system: string;
  tools: TrajectoryToolDefinition[];
  config?: Record<string, unknown>;
}

export interface TrajectoryUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  [key: string]: unknown;
}

export interface TrajectoryBlock {
  type: string;
  text?: string;
  name?: string;
  callId?: string;
  arguments?: unknown;
  value?: unknown;
}

export interface AssistantTiming {
  startedAt: number;
  firstTokenAt: number | null;
  completedAt: number;
  usage: TrajectoryUsage | null;
}

export interface TrajectoryRecord {
  id: string;
  index: number;
  seq: number;
  timestamp: number;
  turn: number;
  step: number | null;
  role: TrajectoryRole;
  group: "Message" | "Step";
  title: string;
  text: string;
  input: unknown;
  output: unknown;
  source: unknown;
  blocks: TrajectoryBlock[];
  resultBlocks: TrajectoryBlock[];
  callId: string | null;
  schema: unknown;
  failed: boolean;
  durationMs: number | null;
  timing: AssistantTiming | null;
  prompt: TrajectoryPrompt | null;
  previousPrompt: TrajectoryPrompt | null;
  requestId: string | null;
}

export interface TrajectoryRequest {
  id: string;
  number: number;
  turn: number;
  step: number;
  startedAt: number;
  completedAt: number | null;
  status: "running" | "succeeded" | "failed";
  provider: string | null;
  model: string | null;
  config: Record<string, unknown> | null;
  usage: TrajectoryUsage | null;
  error: unknown;
}

export interface TrajectoryModel {
  records: TrajectoryRecord[];
  requests: TrajectoryRequest[];
  turns: number[];
  startedAt: number;
  completedAt: number;
}
