import { createHash } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import type {
  CanonicalTrajectoryDocument,
  ProviderEvidenceDescriptor,
  TrajectoryAvailability,
  TrajectoryFileRefV2,
  TrajectoryFileRole,
  TrajectoryRefV2,
} from "../hitch-types";
import { cachedCanonical } from "./cache";
import { parseCanonicalSession } from "./canonical-session";
import {
  RUN_ID_PATTERN,
  compactError,
  integer,
  optionalString,
  readJsonFile,
  readRegularFile,
  record,
  relativeRef,
  resolveInside,
  sha256,
  string,
} from "./validation";

const ROLES = new Set<TrajectoryFileRole>([
  "provider_events", "provider_transcript", "provider_artifact", "canonical_session",
]);

export interface TrajectoryLoadResult {
  availability: TrajectoryAvailability;
  ref: TrajectoryRefV2 | null;
  canonical: CanonicalTrajectoryDocument | null;
  providers: ProviderEvidenceDescriptor[];
  diagnostic: string | null;
}

export function parseTrajectoryRefV2(value: unknown): TrajectoryRefV2 {
  const parsed = record(value, "trajectory ref");
  if (parsed.schema_version !== "2") throw new TypeError("unsupported_trajectory_ref");
  const runId = string(parsed.run_id, "trajectory run_id");
  if (!RUN_ID_PATTERN.test(runId)) throw new TypeError("invalid trajectory run_id");
  const fidelity = string(parsed.fidelity, "trajectory fidelity");
  if (!["provider_native", "normalized", "minimal"].includes(fidelity)) throw new TypeError("invalid trajectory fidelity");
  if (!Array.isArray(parsed.files) || !parsed.files.length) throw new TypeError("trajectory files must not be empty");
  const files = parsed.files.map((value, index): TrajectoryFileRefV2 => {
    const file = record(value, `trajectory file ${index}`);
    const role = string(file.role, `trajectory file ${index} role`) as TrajectoryFileRole;
    if (!ROLES.has(role)) throw new TypeError(`invalid trajectory file role: ${role}`);
    const bytes = integer(file.bytes, `trajectory file ${index} bytes`);
    if (bytes < 0) throw new TypeError("trajectory bytes must be non-negative");
    const mediaType = string(file.media_type, `trajectory file ${index} media_type`);
    if (role === "canonical_session" && mediaType !== "application/x-ndjson") {
      throw new TypeError(`unsupported canonical media_type: ${mediaType}`);
    }
    return {
      role,
      path: relativeRef(file.path, `trajectory file ${index} path`),
      media_type: mediaType,
      sha256: sha256(file.sha256, `trajectory file ${index} sha256`),
      bytes,
    };
  });
  if (new Set(files.map((file) => file.path)).size !== files.length) throw new TypeError("trajectory paths must be unique");
  if (files.filter((file) => file.role === "canonical_session").length > 1) {
    throw new TypeError("trajectory may include at most one canonical session");
  }
  if (fidelity === "provider_native" && !files.some((file) => file.role.startsWith("provider_"))) {
    throw new TypeError("provider_native trajectory must include provider evidence");
  }
  const redactions = parsed.redactions === undefined ? undefined : (() => {
    if (!Array.isArray(parsed.redactions)) throw new TypeError("trajectory redactions must be an array");
    const values = parsed.redactions.map((value, index) => {
      const item = record(value, `redaction ${index}`);
      const count = integer(item.count, `redaction ${index} count`);
      if (count <= 0) throw new TypeError("redaction count must be positive");
      return { rule_id: string(item.rule_id, `redaction ${index} rule_id`), count };
    });
    if (new Set(values.map((item) => item.rule_id)).size !== values.length) throw new TypeError("redaction rule ids must be unique");
    return values;
  })();
  const provider = optionalString(parsed.provider, "trajectory provider");
  const providerSessionId = optionalString(parsed.provider_session_id, "provider session id");
  return {
    schema_version: "2",
    run_id: runId,
    fidelity: fidelity as TrajectoryRefV2["fidelity"],
    files,
    ...(provider ? { provider } : {}),
    ...(providerSessionId ? { provider_session_id: providerSessionId } : {}),
    ...(redactions ? { redactions } : {}),
  };
}

export function loadTrajectory(runDirectory: string, runId: string, refName: string | undefined, terminal: boolean): TrajectoryLoadResult {
  const fallback = "trajectory.ref.json";
  const chosen = refName || (existsSync(`${runDirectory}/${fallback}`) ? fallback : undefined);
  if (!chosen) {
    return { availability: terminal ? "missing" : "pending", ref: null, canonical: null, providers: [], diagnostic: null };
  }
  let refPath: string;
  try {
    refPath = resolveInside(runDirectory, relativeRef(chosen, "trajectory_ref"));
    const info = lstatSync(refPath);
    if (info.isSymbolicLink() || !info.isFile()) throw new TypeError("trajectory ref must be a regular file");
  } catch (error) {
    return { availability: "corrupt", ref: null, canonical: null, providers: [], diagnostic: compactError(error) };
  }
  let raw: unknown;
  try {
    raw = readJsonFile(refPath, "trajectory ref");
  } catch (error) {
    return { availability: "corrupt", ref: null, canonical: null, providers: [], diagnostic: compactError(error) };
  }
  let rawRecord: Record<string, unknown>;
  try {
    rawRecord = record(raw, "trajectory ref");
  } catch (error) {
    return { availability: "corrupt", ref: null, canonical: null, providers: [], diagnostic: compactError(error) };
  }
  if (rawRecord.schema_version !== "2") {
    return { availability: "unsupported", ref: null, canonical: null, providers: [], diagnostic: "unsupported_trajectory_ref" };
  }
  let ref: TrajectoryRefV2;
  try {
    ref = parseTrajectoryRefV2(raw);
    if (ref.run_id !== runId) throw new TypeError("trajectory run_id does not match manifest");
  } catch (error) {
    const detail = compactError(error);
    return {
      availability: /unsupported canonical/i.test(detail) ? "unsupported" : "corrupt",
      ref: null,
      canonical: null,
      providers: [],
      diagnostic: detail,
    };
  }

  let canonical: CanonicalTrajectoryDocument | null = null;
  const providers: ProviderEvidenceDescriptor[] = [];
  try {
    for (const file of ref.files) {
      const target = resolveInside(runDirectory, file.path);
      const info = lstatSync(target);
      if (info.isSymbolicLink() || !info.isFile()) throw new TypeError(`declared file is not regular (${file.path})`);
      if (info.size !== file.bytes) throw new TypeError(`size mismatch (${file.path})`);
      const bytes = readRegularFile(target);
      const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (digest !== file.sha256) throw new TypeError(`checksum mismatch (${file.path})`);
      if (file.media_type === "application/x-ndjson" || file.role === "canonical_session") {
        for (const [index, line] of bytes.toString("utf8").split(/\r?\n/).entries()) {
          if (!line.trim()) continue;
          try { JSON.parse(line); } catch (error) {
            throw new TypeError(`invalid NDJSON line ${index + 1} (${file.path}): ${(error as Error).message}`);
          }
        }
      }
      if (file.role === "canonical_session") {
        canonical = cachedCanonical(`${file.sha256}:${runId}`, () => parseCanonicalSession(bytes.toString("utf8"), runId));
      }
      else providers.push({
        ordinal: providers.length,
        role: file.role,
        mediaType: file.media_type,
        bytes: file.bytes,
        sha256: file.sha256,
      });
    }
  } catch (error) {
    const detail = compactError(error);
    return {
      availability: /unsupported canonical/i.test(detail) ? "unsupported" : "corrupt",
      ref,
      canonical: null,
      providers: [],
      diagnostic: detail,
    };
  }
  return {
    availability: canonical ? "available" : "raw_only",
    ref,
    canonical,
    providers,
    diagnostic: null,
  };
}

export function providerFileByOrdinal(ref: TrajectoryRefV2, ordinal: number): TrajectoryFileRefV2 | null {
  return ref.files.filter((file) => file.role !== "canonical_session")[ordinal] || null;
}
