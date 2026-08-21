import type {
  CanonicalTrajectoryDocument,
  CanonicalTrajectorySummary,
  SessionEvent,
  SessionHeaderLine,
} from "../hitch-types";
import { finiteNumber, integer, record, string } from "./validation";

const KNOWN_TYPES = new Set([
  "turn/start", "turn/end", "step/start", "step/end",
  "request/header", "user/message", "assistant/chunk", "assistant/message",
  "tool/call", "tool/result",
]);

function header(value: unknown): SessionHeaderLine {
  const parsed = record(value, "session header");
  if (parsed.type !== "session") throw new TypeError("session header type must be 'session'");
  if (integer(parsed.version, "session version") !== 0) throw new TypeError("unsupported canonical session version");
  const createdAt = integer(parsed.createdAt, "session createdAt");
  const delegationDepth = integer(parsed.delegationDepth, "delegationDepth");
  if (createdAt < 0 || delegationDepth < 0) throw new TypeError("session numeric fields must be non-negative");
  return { ...parsed, type: "session", version: 0, id: string(parsed.id, "session id"), createdAt, delegationDepth };
}

function event(value: unknown): SessionEvent {
  const parsed = record(value, "session event");
  const seq = integer(parsed.seq, "event seq");
  const time = integer(parsed.time, "event time");
  if (seq < 0 || time < 0) throw new TypeError("event seq and time must be non-negative");
  return {
    ...parsed,
    type: string(parsed.type, "event type"),
    seq,
    time,
    data: record(parsed.data, "event data"),
    ...(parsed.ignorable === true ? { ignorable: true } : {}),
  };
}

function callIdFromResult(data: Record<string, unknown>): string | null {
  const message = data.message && typeof data.message === "object" ? data.message as Record<string, unknown> : null;
  const source = message?.source && typeof message.source === "object" ? message.source as Record<string, unknown> : null;
  if (typeof source?.callId === "string") return source.callId;
  const content = Array.isArray(message?.content) ? message.content : [];
  const first = content[0] && typeof content[0] === "object" ? content[0] as Record<string, unknown> : null;
  return typeof first?.toolCallId === "string" ? first.toolCallId : null;
}

function toolFailed(data: Record<string, unknown>): boolean {
  if (data.error) return true;
  const message = data.message && typeof data.message === "object" ? data.message as Record<string, unknown> : null;
  const content = Array.isArray(message?.content) ? message.content : [];
  return content.some((item) => item && typeof item === "object" && (item as Record<string, unknown>).isError === true);
}

function usageNumber(usage: Record<string, unknown>, key: string): number {
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function parseCanonicalSession(content: string, runId: string): CanonicalTrajectoryDocument {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new TypeError("canonical session is empty");
  let parsedHeader: SessionHeaderLine;
  try {
    parsedHeader = header(JSON.parse(lines[0]));
  } catch (error) {
    throw new TypeError(`invalid canonical header: ${(error as Error).message}`);
  }
  const events: SessionEvent[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    try {
      const parsed = event(JSON.parse(lines[index]));
      if (parsed.seq !== index - 1) throw new TypeError(`seq must be contiguous: expected ${index - 1}, got ${parsed.seq}`);
      events.push(parsed);
    } catch (error) {
      throw new TypeError(`invalid canonical event line ${index + 1}: ${(error as Error).message}`);
    }
  }
  validateInvariants(events);
  const summary = summarizeCanonical(events);
  return {
    runId,
    session: parsedHeader,
    summary,
    events,
  };
}

export function validateInvariants(events: SessionEvent[]): void {
  let openTurn: number | null = null;
  let openStep: { turn: number; step: number } | null = null;
  const calls = new Set<string>();
  for (const item of events) {
    const data = item.data;
    switch (item.type) {
      case "turn/start": {
        if (openTurn !== null) throw new TypeError(`nested turn/start at seq ${item.seq}`);
        openTurn = finiteNumber(data.turn, "turn number");
        break;
      }
      case "turn/end": {
        if (openTurn === null) throw new TypeError(`turn/end without turn/start at seq ${item.seq}`);
        if (openStep) throw new TypeError(`turn/end with open step at seq ${item.seq}`);
        if (data.turn !== undefined && data.turn !== openTurn) throw new TypeError(`turn/end identity mismatch at seq ${item.seq}`);
        openTurn = null;
        break;
      }
      case "step/start": {
        if (openTurn === null) throw new TypeError(`step/start outside a turn at seq ${item.seq}`);
        if (openStep) throw new TypeError(`nested step/start at seq ${item.seq}`);
        const turn = finiteNumber(data.turn, "step turn");
        const step = finiteNumber(data.step, "step number");
        if (turn !== openTurn) throw new TypeError(`step/start turn mismatch at seq ${item.seq}`);
        openStep = { turn, step };
        break;
      }
      case "step/end": {
        if (!openStep) throw new TypeError(`step/end without step/start at seq ${item.seq}`);
        if (calls.size) throw new TypeError(`step/end with open tool calls at seq ${item.seq}`);
        if ((data.turn !== undefined && data.turn !== openStep.turn) || (data.step !== undefined && data.step !== openStep.step)) {
          throw new TypeError(`step/end identity mismatch at seq ${item.seq}`);
        }
        openStep = null;
        break;
      }
      case "tool/call": {
        if (!openStep) throw new TypeError(`tool/call outside a step at seq ${item.seq}`);
        const id = string(data.callId, "tool call id");
        if (calls.has(id)) throw new TypeError(`duplicate tool call ${id} at seq ${item.seq}`);
        calls.add(id);
        break;
      }
      case "tool/result": {
        const id = callIdFromResult(data);
        if (!id || !calls.has(id)) throw new TypeError(`tool/result without matching call at seq ${item.seq}`);
        calls.delete(id);
        break;
      }
      default:
        if (!KNOWN_TYPES.has(item.type) && item.ignorable !== true) {
          throw new TypeError(`unknown required event type ${item.type} at seq ${item.seq}`);
        }
    }
  }
  if (openTurn !== null || openStep || calls.size) throw new TypeError("canonical session ends with open brackets or tool calls");
}

export function summarizeCanonical(events: SessionEvent[]): CanonicalTrajectorySummary {
  let turnCount = 0;
  let stepCount = 0;
  let toolCalls = 0;
  let toolFailures = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let inputSeen = false;
  let outputSeen = false;
  let cacheReadSeen = false;
  let cacheWriteSeen = false;
  const errors: string[] = [];
  let currentStep: { turn: number; step: number; startedAt: number; firstTokenSeen: boolean } | null = null;
  const ttfts: number[] = [];
  for (const item of events) {
    if (item.type === "turn/start") turnCount += 1;
    if (item.type === "turn/end") {
      const reason = item.data.reason;
      const reasonKind = reason && typeof reason === "object" ? (reason as Record<string, unknown>).kind : null;
      if (item.data.error || (reasonKind && reasonKind !== "completed") || (typeof reason === "string" && /error|fail|cancel|timeout/i.test(reason))) {
        const detail = item.data.error || reason;
        errors.push(typeof detail === "string" ? detail : JSON.stringify(detail));
      }
    }
    if (item.type === "step/start") {
      stepCount += 1;
      currentStep = {
        turn: typeof item.data.turn === "number" ? item.data.turn : -1,
        step: typeof item.data.step === "number" ? item.data.step : -1,
        startedAt: item.time,
        firstTokenSeen: false,
      };
    }
    if (item.type === "step/end") currentStep = null;
    if (item.type === "tool/call") toolCalls += 1;
    if (item.type === "tool/result" && toolFailed(item.data)) {
      toolFailures += 1;
      errors.push(`Tool failure at seq ${item.seq}`);
    }
    if (item.type === "assistant/chunk" && currentStep && !currentStep.firstTokenSeen) {
      const turn = typeof item.data.turn === "number" ? item.data.turn : currentStep.turn;
      const step = typeof item.data.step === "number" ? item.data.step : currentStep.step;
      const chunk = item.data.chunk && typeof item.data.chunk === "object" ? item.data.chunk as Record<string, unknown> : null;
      const tokenDelta = chunk && (
        ((chunk.type === "text-delta" || chunk.type === "reasoning-delta") && chunk.text !== "")
        || (chunk.type === "tool-call-delta" && (chunk.argumentsDelta !== "" || chunk.name !== undefined))
      );
      if (turn === currentStep.turn && step === currentStep.step && tokenDelta) {
        ttfts.push(Math.max(0, item.time - currentStep.startedAt));
        currentStep.firstTokenSeen = true;
      }
    }
    if (item.type === "assistant/message" && item.data.usage && typeof item.data.usage === "object") {
      const usage = item.data.usage as Record<string, unknown>;
      inputSeen ||= typeof usage.inputTokens === "number" && Number.isFinite(usage.inputTokens);
      outputSeen ||= typeof usage.outputTokens === "number" && Number.isFinite(usage.outputTokens);
      cacheReadSeen ||= typeof usage.cacheReadTokens === "number" && Number.isFinite(usage.cacheReadTokens);
      cacheWriteSeen ||= typeof usage.cacheWriteTokens === "number" && Number.isFinite(usage.cacheWriteTokens);
      inputTokens += usageNumber(usage, "inputTokens");
      outputTokens += usageNumber(usage, "outputTokens");
      cacheReadTokens += usageNumber(usage, "cacheReadTokens");
      cacheWriteTokens += usageNumber(usage, "cacheWriteTokens");
    }
    if (item.ignorable && item.data.level === "error") errors.push(String(item.data.message || `Diagnostic at seq ${item.seq}`));
  }
  return {
    turnCount,
    stepCount,
    toolCalls,
    toolFailures,
    usage: {
      inputTokens: inputSeen ? inputTokens : null,
      outputTokens: outputSeen ? outputTokens : null,
      cacheReadTokens: cacheReadSeen ? cacheReadTokens : null,
      cacheWriteTokens: cacheWriteSeen ? cacheWriteTokens : null,
    },
    errors: [...new Set(errors)].slice(0, 50),
    ttftMs: ttfts.length ? Math.min(...ttfts) : null,
  };
}
