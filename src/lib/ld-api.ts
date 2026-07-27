import { LDClient } from "./ld-client";
import { DependentFlag, DependentFlagsResponse, Environment, FeatureFlag, Project } from "./types";

const PAGE_LIMIT = 100;

export function getProjects(client: LDClient): Promise<Project[]> {
  return client.getAllPages<Project>("/api/v2/projects", { params: { limit: PAGE_LIMIT } });
}

export function getEnvironments(client: LDClient, projectKey: string): Promise<Environment[]> {
  return client.getAllPages<Environment>(
    `/api/v2/projects/${encodeURIComponent(projectKey)}/environments`,
    { params: { limit: PAGE_LIMIT } },
  );
}

/**
 * The single sweep the whole dashboard is built on: one paginated pass over
 * GET /flags with `env` + `summary=0`, which includes each flag's
 * per-environment `prerequisites`. The full dependency graph (both
 * directions) is derived from this client-side — no per-flag calls.
 */
export function getAllFlags(
  client: LDClient,
  projectKey: string,
  envKey: string,
  onProgress?: (fetched: number, total?: number) => void,
): Promise<FeatureFlag[]> {
  return client.getAllPages<FeatureFlag>(
    `/api/v2/flags/${encodeURIComponent(projectKey)}`,
    { params: { env: envKey, summary: 0, limit: PAGE_LIMIT } },
    onProgress,
  );
}

/**
 * Beta endpoint — used only as an on-demand, per-flag cross-check in the
 * detail panel, never in bulk (rate-limit budget).
 */
export async function getDependentFlags(
  client: LDClient,
  projectKey: string,
  envKey: string,
  flagKey: string,
): Promise<DependentFlag[]> {
  const res = await client.get<DependentFlagsResponse>(
    `/api/v2/flags/${encodeURIComponent(projectKey)}/${encodeURIComponent(envKey)}/${encodeURIComponent(flagKey)}/dependent-flags`,
    { beta: true },
  );
  return res.items;
}
