import { readFileSync } from "node:fs";
import type {
  CanonicalTrajectoryDocument,
  ProviderEvidencePage,
  TrajectoryFileRefV2,
} from "../hitch-types";
import type { LoadedRun } from "./run-record";
import { providerFileByOrdinal } from "./trajectory-ref";
import { resolveInside } from "./validation";

const MAX_PAGE_BYTES = 256 * 1024;

export interface DetailResult<T> {
  etag: string;
  body: T;
}

export function canonicalDetail(run: LoadedRun): DetailResult<CanonicalTrajectoryDocument> | null {
  const document = run.trajectoryLoad.canonical;
  const file = run.trajectoryLoad.ref?.files.find((item) => item.role === "canonical_session");
  return document && file ? { etag: `"${file.sha256}"`, body: document } : null;
}

function encodeCursor(offset: number, file: TrajectoryFileRefV2): string {
  return Buffer.from(JSON.stringify({ offset, digest: file.sha256 }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null, file: TrajectoryFileRefV2): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown; digest?: unknown };
    if (value.digest !== file.sha256 || !Number.isSafeInteger(value.offset) || (value.offset as number) < 0) throw new Error();
    return value.offset as number;
  } catch {
    throw new TypeError("invalid provider evidence cursor");
  }
}

function isText(file: TrajectoryFileRefV2): boolean {
  return file.media_type.startsWith("text/")
    || file.media_type === "application/json"
    || file.media_type === "application/x-ndjson"
    || file.media_type.endsWith("+json");
}

export function providerDetail(run: LoadedRun, ordinal: number, cursor: string | null): DetailResult<ProviderEvidencePage> | null {
  const ref = run.trajectoryLoad.ref;
  if (!ref || !Number.isSafeInteger(ordinal) || ordinal < 0) return null;
  const file = providerFileByOrdinal(ref, ordinal);
  if (!file) return null;
  const bytes = readFileSync(resolveInside(run.directory, file.path));
  const offset = decodeCursor(cursor, file);
  if (offset > bytes.length) throw new TypeError("provider evidence cursor is beyond the file");
  let end = Math.min(bytes.length, offset + MAX_PAGE_BYTES);
  if (end < bytes.length && isText(file)) {
    const nextNewline = bytes.indexOf(10, end);
    if (nextNewline >= 0 && nextNewline - offset <= MAX_PAGE_BYTES + 64 * 1024) end = nextNewline + 1;
  }
  const chunk = bytes.subarray(offset, end);
  const descriptor = run.trajectoryLoad.providers[ordinal];
  if (!descriptor) return null;
  return {
    etag: `"${file.sha256}"`,
    body: {
      runId: run.record.run_id,
      file: descriptor,
      encoding: isText(file) ? "utf8" : "base64",
      content: isText(file) ? chunk.toString("utf8") : chunk.toString("base64"),
      nextCursor: end < bytes.length ? encodeCursor(end, file) : null,
    },
  };
}
