import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState } from "react";
import type { LaunchLink } from "../shared/launch";
import { ticketRead } from "../shared/rpc";
import { discoverSessions, readSession, sameScope, type ActivityScope, type Session } from "./agent-activity";

export function useValidatedAgent(scope: ActivityScope & { workspaceId: string }, active: boolean) {
  const paseo = usePaseo();
  const read = useRpc(ticketRead);
  const identity = JSON.stringify(scope);
  const generation = useRef(0);
  const current = useRef({ identity, active, paseo });
  current.current = { identity, active, paseo };
  useEffect(() => {
    current.current = { identity, active, paseo };
    return () => { generation.current++; current.current = { identity: "", active: false, paseo }; };
  }, [identity, active, paseo]);
  return async (link: LaunchLink) => {
    const started = generation.current;
    if (!active || !sameScope(link, scope)) return false;
    try {
      const [ticket, session] = await Promise.all([
        read({ workspaceId: scope.workspaceId, ticketId: link.ticketId }), readSession(paseo, scope, link),
      ]);
      return generation.current === started && current.current.active && current.current.identity === identity && current.current.paseo === paseo
        && !("kind" in ticket) && ticket.id === link.ticketId && ticket.boardId === scope.boardId
        && ticket.projectId === scope.projectId && session.activity !== "Unavailable";
    } catch { return false; }
  };
}

export function useAgentActivity(scope: ActivityScope, ticketIds: number[], known: LaunchLink[], active: boolean) {
  const paseo = usePaseo();
  const key = JSON.stringify([scope.hostId, scope.boardId, scope.projectId, ticketIds]);
  const knownKey = JSON.stringify(known);
  const [state, setState] = useState<{ key: string; sessions: Session[]; failed: boolean }>({ key: "", sessions: [], failed: false });
  const history = useRef<{ key: string; links: LaunchLink[] }>({ key: "", links: [] });
  useEffect(() => {
    if (!active || ticketIds.length === 0) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const sessions = await discoverSessions(paseo, scope, ticketIds,
          [...known, ...(history.current.key === key ? history.current.links : [])], () => !disposed);
        if (disposed) return;
        history.current = { key, links: sessions.map(({ link }) => link) };
        setState({ key, sessions, failed: false });
      } catch {
        if (!disposed) setState((previous) => ({ key, sessions: previous.key === key ? previous.sessions.map((session) => ({ ...session, activity: "Unavailable" })) : [], failed: true }));
      } finally {
        if (!disposed) timer = setTimeout(() => void refresh(), 5000);
      }
    };
    void refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, [paseo, key, knownKey, active]);
  return {
    sessions: state.key === key ? state.sessions.map((session): Session => active ? session : { ...session, activity: "Unavailable" }) : [],
    unavailable: !active || (state.key === key && state.failed),
  };
}
