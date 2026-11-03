import type { usePaseo } from "@getpaseo/plugin/client";
import { launchLabelKeys as keys, launchLinkSchema, type LaunchLink } from "../shared/launch";

type Paseo = ReturnType<typeof usePaseo>;
type Agent = NonNullable<Awaited<ReturnType<ReturnType<Paseo["agents"]["ref"]>["refresh"]>>>["agent"];
export type ActivityScope = Pick<LaunchLink, "hostId" | "boardId" | "projectId">;
export type Session = { link: LaunchLink; activity: "Running" | "Needs input" | "Error" | "Idle" | "Unavailable" };

export function agentActivity(agent: Pick<Agent, "status" | "attentionReason" | "pendingPermissions">): Session["activity"] {
  if (agent.pendingPermissions.length || agent.attentionReason === "permission") return "Needs input";
  if (agent.status === "error" || agent.attentionReason === "error") return "Error";
  if (agent.status === "running" || agent.status === "initializing") return "Running";
  return "Idle";
}

export function linkFromLabels(agent: { id: string; labels: Record<string, string> }): LaunchLink | null {
  const labels = agent.labels;
  const parsed = launchLinkSchema.safeParse({
    hostId: labels[keys.hostId], boardId: labels[keys.boardId], projectId: labels[keys.projectId],
    ticketId: Number(labels[keys.ticketId]), launchId: labels[keys.launchId],
    workspaceId: labels[keys.workspaceId], agentId: agent.id,
  });
  return parsed.success && parsed.data.launchId === agent.id ? parsed.data : null;
}

export function sameScope(link: ActivityScope, scope: ActivityScope) {
  return link.hostId === scope.hostId && link.boardId === scope.boardId && link.projectId === scope.projectId;
}

export async function readSession(paseo: Paseo, scope: ActivityScope, link: LaunchLink): Promise<Session> {
  const unavailable: Session = { link, activity: "Unavailable" };
  if (!sameScope(link, scope)) return unavailable;
  try {
    const [result, workspace] = await Promise.all([
      paseo.agents.ref(link.agentId).refresh(), paseo.workspaces.ref(link.workspaceId).refresh(),
    ]);
    const agent = result?.agent;
    const actual = agent && linkFromLabels(agent);
    if (!agent || agent.archivedAt || agent.status === "closed" || !actual || !sameScope(actual, scope)
      || actual.agentId !== link.agentId || actual.ticketId !== link.ticketId || actual.launchId !== link.launchId || actual.workspaceId !== link.workspaceId
      || agent.workspaceId !== link.workspaceId || !workspace || workspace.id !== link.workspaceId
      || workspace.projectId !== scope.projectId || workspace.archivingAt) return unavailable;
    return { link, activity: agentActivity(agent) };
  } catch { return unavailable; }
}

// One filtered directory scan per board, never one scan per ticket. Plain reads own no daemon subscription.
export async function discoverSessions(paseo: Paseo, scope: ActivityScope, ticketIds: number[], known: LaunchLink[], alive: () => boolean): Promise<Session[]> {
  const links = new Map(known.filter((link) => sameScope(link, scope) && ticketIds.includes(link.ticketId)).map((link) => [link.agentId, link]));
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const page = await paseo.agents.list({
      filter: { labels: { [keys.hostId]: scope.hostId, [keys.boardId]: scope.boardId, [keys.projectId]: scope.projectId }, includeArchived: true, includeBackground: true },
      sort: [{ key: "created_at", direction: "desc" }], page: { limit: 100, ...(cursor ? { cursor } : {}) },
    });
    if (!alive()) return [];
    for (const { agent } of page.entries) {
      const link = linkFromLabels(agent);
      if (link && sameScope(link, scope) && ticketIds.includes(link.ticketId) && !links.has(link.agentId)) links.set(link.agentId, link);
    }
    cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
    if (cursor && cursors.has(cursor)) throw new Error("Repeated session directory cursor");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return Promise.all(Array.from(links.values(), (link) => readSession(paseo, scope, link)));
}
