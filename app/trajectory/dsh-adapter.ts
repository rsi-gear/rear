import type { CanonicalTrajectoryDocument, SessionEvent } from "@/lib/hitch-types";
import type {
  AssistantTiming,
  TrajectoryBlock,
  TrajectoryModel,
  TrajectoryPrompt,
  TrajectoryRecord,
  TrajectoryRequest,
  TrajectoryToolDefinition,
  TrajectoryUsage,
} from "./dsh-types";

type UnknownRecord = Record<string, unknown>;

interface StepState {
  turn: number;
  step: number;
  startedAt: number;
  firstTokenAt: number | null;
  text: string;
  reasoning: string;
  toolDeltas: Map<number, { name: string; callId: string; arguments: string }>;
  usage: TrajectoryUsage | null;
  requestId: string;
  prompt: TrajectoryPrompt | null;
  completed: boolean;
}

interface ToolState {
  callId: string;
  name: string;
  input: unknown;
  turn: number;
  step: number;
  seq: number;
  startedAt: number;
  schema: unknown;
  requestId: string | null;
}

function object(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function usage(value: unknown): TrajectoryUsage | null {
  const candidate = object(value);
  return candidate ? candidate as TrajectoryUsage : null;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return left === right;
  }
}

function toolDefinitions(value: unknown): TrajectoryToolDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const entry = object(item);
    if (!entry) return [];
    const callable = object(entry.function) || entry;
    const name = string(callable.name || entry.name);
    if (!name) return [];
    return [{
      name,
      ...(typeof callable.description === "string" ? { description: callable.description } : {}),
      ...(callable.parameters !== undefined ? { parameters: callable.parameters } : {}),
    }];
  });
}

function promptFromHeader(value: unknown): TrajectoryPrompt | null {
  const header = object(value);
  if (!header) return null;
  return {
    system: string(header.system),
    tools: toolDefinitions(header.tools),
    ...(object(header.config) ? { config: object(header.config)! } : {}),
  };
}

function blockText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(blockText).filter(Boolean).join("\n");
  const entry = object(value);
  if (!entry) return "";
  if (typeof entry.text === "string") return entry.text;
  if (typeof entry.content === "string") return entry.content;
  if (entry.content !== undefined) return blockText(entry.content);
  return "";
}

function toBlocks(value: unknown): TrajectoryBlock[] {
  if (typeof value === "string") return value ? [{ type: "text", text: value }] : [];
  if (Array.isArray(value)) return value.flatMap(toBlocks);
  const entry = object(value);
  if (!entry) return [];
  if (Array.isArray(entry.content)) return entry.content.flatMap(toBlocks);
  const type = string(entry.type, "data");
  if (type === "text" || type === "reasoning" || type === "reasoning-text") {
    return [{ type, text: string(entry.text || entry.content) }];
  }
  if (type === "tool-call") {
    return [{
      type,
      name: string(entry.name),
      callId: string(entry.toolCallId || entry.callId),
      arguments: entry.arguments,
      value: entry,
    }];
  }
  if (type === "tool-result") {
    return [{
      type,
      callId: string(entry.toolCallId || entry.callId),
      text: blockText(entry.content),
      value: entry.content,
    }];
  }
  return [{ type, text: blockText(entry) || undefined, value: entry }];
}

function messageValue(data: UnknownRecord): unknown {
  const message = object(data.message);
  return message?.content ?? data.content ?? data.text ?? data.message;
}

function messageSource(data: UnknownRecord): UnknownRecord | null {
  return object(object(data.message)?.source) || object(data.source);
}

function resultCallId(data: UnknownRecord): string {
  const source = messageSource(data);
  if (typeof source?.callId === "string") return source.callId;
  const content = object(data.message)?.content;
  const first = Array.isArray(content) ? object(content[0]) : null;
  return string(first?.toolCallId || first?.callId);
}

function resultFailed(data: UnknownRecord): boolean {
  if (data.error) return true;
  const content = object(data.message)?.content;
  return Array.isArray(content) && content.some((item) => object(item)?.isError === true);
}

function isTokenDelta(chunk: UnknownRecord | null): boolean {
  if (!chunk) return false;
  if ((chunk.type === "text-delta" || chunk.type === "reasoning-delta") && chunk.text !== "") return true;
  return chunk.type === "tool-call-delta" && (chunk.argumentsDelta !== "" || chunk.name !== undefined);
}

function stepKey(turn: number, step: number): string {
  return `${turn}:${step}`;
}

function nextEventTurn(events: SessionEvent[], sequence: number, fallback: number): number {
  for (const event of events) {
    if (event.seq < sequence) continue;
    const turn = event.data.turn;
    if (typeof turn === "number" && Number.isFinite(turn)) return turn;
  }
  return fallback;
}

function providerAndModel(source: UnknownRecord | null, config: UnknownRecord | null): { provider: string | null; model: string | null } {
  return {
    provider: typeof source?.provider === "string" ? source.provider : typeof config?.provider === "string" ? config.provider : null,
    model: typeof source?.model === "string" ? source.model : typeof config?.model === "string" ? config.model : null,
  };
}

function baseRecord(input: Omit<TrajectoryRecord, "index">): TrajectoryRecord {
  return { ...input, index: -1 };
}

function assistantRecord(event: SessionEvent, state: StepState, data: UnknownRecord): TrajectoryRecord {
  const message = object(data.message);
  const finalBlocks = toBlocks(message?.content ?? data.content);
  const streamedBlocks: TrajectoryBlock[] = [
    ...(state.reasoning ? [{ type: "reasoning", text: state.reasoning }] : []),
    ...(state.text ? [{ type: "text", text: state.text }] : []),
    ...[...state.toolDeltas.values()].map((delta) => ({
      type: "tool-call",
      name: delta.name,
      callId: delta.callId,
      arguments: delta.arguments,
    })),
  ];
  const blocks = finalBlocks.length ? finalBlocks : streamedBlocks;
  const messageText = blocks.filter((block) => block.type === "text").map((block) => block.text || "").filter(Boolean).join("\n\n");
  const thinkingText = blocks.filter((block) => block.type === "reasoning" || block.type === "reasoning-text").map((block) => block.text || "").filter(Boolean).join("\n\n");
  const activity = blocks.filter((block) => block.type === "tool-call").map((block) => `${block.name || "tool"}(${typeof block.arguments === "string" ? block.arguments : JSON.stringify(block.arguments)})`).join("\n");
  const text = messageText || thinkingText || activity;
  const finalUsage = usage(data.usage) || state.usage;
  const timing: AssistantTiming = {
    startedAt: state.startedAt,
    firstTokenAt: state.firstTokenAt,
    completedAt: event.time,
    usage: finalUsage,
  };
  return baseRecord({
    id: `assistant:${state.turn}:${state.step}`,
    seq: event.seq,
    timestamp: event.time,
    turn: state.turn,
    step: state.step,
    role: "assistant",
    group: "Step",
    title: "Assistant",
    text,
    input: null,
    output: message?.content ?? data.content ?? null,
    source: message?.source ?? data.source ?? null,
    blocks,
    resultBlocks: [],
    callId: null,
    schema: null,
    failed: Boolean(data.error),
    durationMs: Math.max(0, event.time - state.startedAt),
    timing,
    prompt: state.prompt,
    previousPrompt: null,
    requestId: state.requestId,
  });
}

export function adaptCanonicalTrajectory(document: CanonicalTrajectoryDocument): TrajectoryModel {
  const records: TrajectoryRecord[] = [];
  const requests: TrajectoryRequest[] = [];
  const steps = new Map<string, StepState>();
  const tools = new Map<string, ToolState>();
  let openTurn: number | null = null;
  let openStep: StepState | null = null;
  let latestTurn = 1;
  let currentPrompt: TrajectoryPrompt | null = null;
  let previousPrompt: TrajectoryPrompt | null = null;

  for (const event of document.events) {
    const data = event.data;
    const eventTurn = number(data.turn, openTurn ?? latestTurn);
    const eventStep = number(data.step, openStep?.step ?? 0);
    if (event.type === "turn/start") {
      openTurn = eventTurn;
      latestTurn = eventTurn;
      continue;
    }
    if (event.type === "turn/end") {
      openTurn = null;
      continue;
    }
    if (event.type === "step/start") {
      const requestId = `request:${eventTurn}:${eventStep}`;
      openStep = {
        turn: eventTurn,
        step: eventStep,
        startedAt: event.time,
        firstTokenAt: null,
        text: "",
        reasoning: "",
        toolDeltas: new Map(),
        usage: null,
        requestId,
        prompt: currentPrompt,
        completed: false,
      };
      steps.set(stepKey(eventTurn, eventStep), openStep);
      requests.push({
        id: requestId,
        number: requests.length + 1,
        turn: eventTurn,
        step: eventStep,
        startedAt: event.time,
        completedAt: null,
        status: "running",
        provider: null,
        model: null,
        config: currentPrompt?.config || null,
        usage: null,
        error: null,
      });
      continue;
    }
    if (event.type === "step/end") {
      const state = steps.get(stepKey(eventTurn, eventStep));
      const request = state ? requests.find((item) => item.id === state.requestId) : null;
      if (state && !state.completed && (state.text || state.reasoning || state.toolDeltas.size)) {
        records.push(assistantRecord(event, state, { content: null, error: data.error || null }));
      }
      if (request && request.completedAt === null) {
        request.completedAt = event.time;
        request.status = data.error ? "failed" : "succeeded";
        request.error = data.error || null;
      }
      openStep = null;
      continue;
    }
    if (event.type === "request/header") {
      const nextPrompt = promptFromHeader(data.header);
      if (nextPrompt) {
        const changed = !currentPrompt || !jsonEqual(currentPrompt.system, nextPrompt.system) || !jsonEqual(currentPrompt.tools, nextPrompt.tools);
        previousPrompt = currentPrompt;
        currentPrompt = nextPrompt;
        if (openStep) openStep.prompt = nextPrompt;
        const request = openStep ? requests.find((item) => item.id === openStep!.requestId) : null;
        if (request) request.config = nextPrompt.config || null;
        if (changed) {
          const turn = eventTurn || nextEventTurn(document.events, event.seq, latestTurn);
          records.push(baseRecord({
            id: `system:${event.seq}`,
            seq: event.seq,
            timestamp: event.time,
            turn,
            step: openStep?.step ?? null,
            role: "system",
            group: "Message",
            title: previousPrompt ? "System update" : "System",
            text: nextPrompt.system,
            input: nextPrompt.system,
            output: null,
            source: data.header,
            blocks: toBlocks(nextPrompt.system),
            resultBlocks: [],
            callId: null,
            schema: nextPrompt.tools,
            failed: false,
            durationMs: null,
            timing: null,
            prompt: nextPrompt,
            previousPrompt,
            requestId: openStep?.requestId ?? null,
          }));
        }
      }
      continue;
    }
    if (event.type === "user/message") {
      const source = messageSource(data);
      const role = source?.kind === "user" || !source?.kind ? "user" : "context";
      const turn = typeof data.turn === "number" ? data.turn : openTurn ?? nextEventTurn(document.events, event.seq, latestTurn);
      const value = messageValue(data);
      const blocks = toBlocks(value);
      records.push(baseRecord({
        id: `${role}:${event.seq}`,
        seq: event.seq,
        timestamp: event.time,
        turn,
        step: null,
        role,
        group: "Message",
        title: role === "user" ? "User" : "Context",
        text: blockText(value),
        input: value,
        output: null,
        source,
        blocks,
        resultBlocks: [],
        callId: null,
        schema: null,
        failed: false,
        durationMs: null,
        timing: null,
        prompt: null,
        previousPrompt: null,
        requestId: null,
      }));
      continue;
    }
    if (event.type === "assistant/chunk") {
      const state = steps.get(stepKey(eventTurn, eventStep)) || openStep;
      const chunk = object(data.chunk);
      if (!state || !chunk) continue;
      if (state.firstTokenAt === null && isTokenDelta(chunk)) state.firstTokenAt = event.time;
      if (chunk.type === "text-delta") state.text += string(chunk.text);
      if (chunk.type === "reasoning-delta") state.reasoning += string(chunk.text);
      if (chunk.type === "usage") state.usage = usage(chunk.usage) || usage(chunk);
      if (chunk.type === "tool-call-delta") {
        const index = number(chunk.index, state.toolDeltas.size);
        const current = state.toolDeltas.get(index) || { name: "", callId: "", arguments: "" };
        current.name ||= string(chunk.name);
        current.callId ||= string(chunk.id || chunk.callId);
        current.arguments += string(chunk.argumentsDelta);
        state.toolDeltas.set(index, current);
      }
      continue;
    }
    if (event.type === "assistant/message") {
      const state = steps.get(stepKey(eventTurn, eventStep)) || openStep;
      if (!state) continue;
      records.push(assistantRecord(event, state, data));
      state.completed = true;
      const request = requests.find((item) => item.id === state.requestId);
      if (request) {
        const source = messageSource(data);
        const identity = providerAndModel(source, request.config);
        request.completedAt = event.time;
        request.status = data.error ? "failed" : "succeeded";
        request.error = data.error || null;
        request.usage = usage(data.usage) || state.usage;
        request.provider = identity.provider;
        request.model = identity.model;
      }
      continue;
    }
    if (event.type === "tool/call") {
      const callId = string(data.callId, `call:${event.seq}`);
      const name = string(data.name, "Tool");
      const prompt = openStep?.prompt || currentPrompt;
      tools.set(callId, {
        callId,
        name,
        input: data.arguments ?? data.input ?? null,
        turn: eventTurn,
        step: eventStep,
        seq: event.seq,
        startedAt: event.time,
        schema: prompt?.tools.find((tool) => tool.name === name)?.parameters ?? null,
        requestId: openStep?.requestId ?? null,
      });
      continue;
    }
    if (event.type === "tool/result") {
      const callId = resultCallId(data);
      const call = tools.get(callId);
      const result = messageValue(data);
      const resultBlocks = toBlocks(result);
      records.push(baseRecord({
        id: `tool:${callId || event.seq}`,
        seq: call?.seq ?? event.seq,
        timestamp: call?.startedAt ?? event.time,
        turn: call?.turn ?? eventTurn,
        step: call?.step ?? eventStep,
        role: "tool",
        group: "Step",
        title: call?.name || "Tool",
        text: blockText(result),
        input: call?.input ?? null,
        output: result,
        source: data.message ?? data,
        blocks: [],
        resultBlocks,
        callId: callId || null,
        schema: call?.schema ?? null,
        failed: resultFailed(data),
        durationMs: call ? Math.max(0, event.time - call.startedAt) : null,
        timing: null,
        prompt: null,
        previousPrompt: null,
        requestId: call?.requestId ?? openStep?.requestId ?? null,
      }));
      if (callId) tools.delete(callId);
      continue;
    }
    if (event.ignorable && data.level === "error") {
      records.push(baseRecord({
        id: `context:${event.seq}`,
        seq: event.seq,
        timestamp: event.time,
        turn: eventTurn,
        step: openStep?.step ?? null,
        role: "context",
        group: "Message",
        title: "Context",
        text: string(data.message, "Diagnostic error"),
        input: data,
        output: null,
        source: data,
        blocks: toBlocks(data.message),
        resultBlocks: [],
        callId: null,
        schema: null,
        failed: true,
        durationMs: null,
        timing: null,
        prompt: null,
        previousPrompt: null,
        requestId: openStep?.requestId ?? null,
      }));
    }
  }

  records.sort((left, right) => left.seq - right.seq || left.timestamp - right.timestamp);
  records.forEach((record, index) => { record.index = index; });
  for (const request of requests) {
    const related = records.filter((record) => record.requestId === request.id);
    if (!related.length) continue;
    const anchor = related.find((record) => record.role === "assistant") || related[0];
    related.forEach((record) => { record.requestId = null; });
    if (anchor) anchor.requestId = request.id;
  }
  const turns = [...new Set(records.map((record) => record.turn))].sort((left, right) => left - right);
  const timestamps = document.events.map((event) => event.time);
  return {
    records,
    requests,
    turns,
    startedAt: timestamps.length ? Math.min(document.session.createdAt, ...timestamps) : document.session.createdAt,
    completedAt: timestamps.length ? Math.max(document.session.createdAt, ...timestamps) : document.session.createdAt,
  };
}
