import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { Sha256 } from "../hitch-types";

export const RUN_ID_PATTERN = /^run_[a-f0-9]{32}$/;
export const EVAL_ID_PATTERN = /^eval_[A-Za-z0-9._-]+$/;
export const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

export function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : string(value, label);
}

export function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
  return value;
}

export function integer(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${label} must be a safe integer`);
  return parsed;
}

export function sha256(value: unknown, label: string): Sha256 {
  const parsed = string(value, label);
  if (!SHA256_PATTERN.test(parsed)) throw new TypeError(`${label} must be a sha256 digest`);
  return parsed as Sha256;
}

export function isoTimestamp(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!Number.isFinite(Date.parse(parsed))) throw new TypeError(`${label} must be an ISO date-time string`);
  return parsed;
}

export function relativeRef(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (
    parsed.includes("\\")
    || parsed.startsWith("/")
    || parsed.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError(`${label} must be a normalized relative path`);
  }
  return parsed;
}

export function resolveInside(root: string, ref: string): string {
  const target = resolve(root, ...ref.split("/"));
  const fromRoot = relative(resolve(root), target);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new TypeError("reference escapes run directory");
  }
  return target;
}

export function readRegularFile(path: string): Buffer {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new TypeError("referenced object must be a regular file");
  return readFileSync(path);
}

export function readJsonFile(path: string, label = "JSON file"): unknown {
  const bytes = readRegularFile(path);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new TypeError(`${label} is invalid JSON: ${(error as Error).message}`);
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function compactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\/[\w./ -]+/g, "[local path]").slice(0, 600);
}
