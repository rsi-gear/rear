import type { CanonicalTrajectoryDocument } from "../hitch-types";

const canonicalDocuments = new Map<string, CanonicalTrajectoryDocument>();

export function cachedCanonical(digest: string, factory: () => CanonicalTrajectoryDocument): CanonicalTrajectoryDocument {
  const cached = canonicalDocuments.get(digest);
  if (cached) return cached;
  const value = factory();
  canonicalDocuments.set(digest, value);
  if (canonicalDocuments.size > 128) canonicalDocuments.delete(canonicalDocuments.keys().next().value as string);
  return value;
}

export function clearHitchCaches(): void {
  canonicalDocuments.clear();
}
