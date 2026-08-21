import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { findIndexedRun, scanHitch } from "../lib/hitch-scanner";
import { canonicalDetail, providerDetail } from "../lib/hitch/trajectory-detail";
import { RUN_ID_PATTERN } from "../lib/hitch/validation";

const DEFAULT_ROOT = "/Users/tangyehui/agent-hitch/.hitch";

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [name, content] of Object.entries(headers)) response.setHeader(name, content);
  response.end(status === 304 ? undefined : JSON.stringify(value));
}

function requestUrl(request: IncomingMessage): URL {
  return new URL(request.url || "/", "http://rear.local");
}

export function hitchDataPlugin(): Plugin {
  return {
    name: "hitch-run-centered-data",
    apply: "serve",
    configureServer(server) {
      const root = () => process.env.HITCH_DATA_ROOT || DEFAULT_ROOT;
      server.middlewares.use("/api/hitch-data", (_request, response) => {
        try {
          json(response, 200, scanHitch(root()), { "Cache-Control": "no-store" });
        } catch (error) {
          json(response, 500, { error: error instanceof Error ? error.message : "Unable to read Hitch data" });
        }
      });
      server.middlewares.use("/api/hitch-trajectory", (request, response) => {
        try {
          const url = requestUrl(request);
          const runId = url.searchParams.get("run") || "";
          const view = url.searchParams.get("view");
          if (!RUN_ID_PATTERN.test(runId)) return json(response, 400, { error: "invalid run id" });
          const run = findIndexedRun(root(), runId);
          if (!run) return json(response, 404, { error: "run is not indexed" });
          if (view === "canonical") {
            const detail = canonicalDetail(run);
            if (!detail) return json(response, 409, { error: `canonical trajectory is ${run.summary.trajectory.availability}` });
            if (request.headers["if-none-match"] === detail.etag) return json(response, 304, null, { ETag: detail.etag });
            return json(response, 200, detail.body, { ETag: detail.etag, "Cache-Control": run.sealed ? "private, max-age=31536000, immutable" : "no-cache" });
          }
          if (view === "provider") {
            const fileValue = url.searchParams.get("file");
            if (!fileValue || !/^\d+$/.test(fileValue)) return json(response, 400, { error: "provider file ordinal is required" });
            const detail = providerDetail(run, Number(fileValue), url.searchParams.get("cursor"));
            if (!detail) return json(response, 404, { error: "provider file ordinal is not indexed" });
            if (request.headers["if-none-match"] === detail.etag && !url.searchParams.get("cursor")) {
              return json(response, 304, null, { ETag: detail.etag });
            }
            return json(response, 200, detail.body, { ETag: detail.etag, "Cache-Control": run.sealed ? "private, max-age=31536000, immutable" : "no-cache" });
          }
          return json(response, 400, { error: "view must be canonical or provider" });
        } catch (error) {
          return json(response, 400, { error: error instanceof Error ? error.message : "Unable to read trajectory" });
        }
      });
    },
  };
}
