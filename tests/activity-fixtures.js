import { vi } from "vitest";
import { launchLabelKeys } from "../shared/launch";

export function activitySdk(links = () => []) {
  const agent = (link) => ({ id: link.agentId, workspaceId: link.workspaceId, status: "idle", pendingPermissions: [],
    labels: Object.fromEntries(Object.entries(launchLabelKeys).filter(([field]) => field in link).map(([field, key]) => [key, String(link[field])])) });
  return {
    agents: {
      list: vi.fn(async () => ({ entries: links().map((link) => ({ agent: agent(link) })), pageInfo: { hasMore: false, nextCursor: null } })),
      ref: vi.fn((id) => ({ refresh: vi.fn(async () => { const link = links().find((link) => link.agentId === id); return link ? { agent: agent(link) } : null; }) })),
    },
    workspaces: { ref: vi.fn((id) => ({ refresh: vi.fn(async () => { const link = links().find((link) => link.workspaceId === id); return link ? { id, projectId: link.projectId, archivingAt: null } : null; }) })) },
  };
}
