import { useHosts, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { boardRead } from "../shared/rpc";
import { boardQueryKey } from "./board-view";
import { getBoardQuery } from "./board-query";

export function usePanelActive(hostId: string) {
  const online = useHosts().find((host) => host.serverId === hostId)?.status === "online";
  const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);
  // shortcut: SDK 0.13.2 has no tab visibility signal; use mounted + app-active until a public signal exists.
  return online && (!appState || appState === "active");
}

export function useBoard(hostId: string, workspaceId: string) {
  const read = useRpc(boardRead);
  const active = usePanelActive(hostId);
  const project = useWorkspace(workspaceId, (workspace) => JSON.stringify([workspace.projectId, workspace.projectRootPath]));
  const scope = JSON.stringify([hostId, workspaceId, project]);
  const [identity, setIdentity] = useState<{ scope: string; key: string } | null>(null);
  const key = identity?.scope === scope ? identity.key : JSON.stringify(["board-discovery", hostId, project ?? workspaceId]);
  const query = useMemo(() => getBoardQuery(key), [key]);
  const state = useSyncExternalStore(query.subscribe, query.getSnapshot);
  useEffect(() => {
    if (active) return query.activate(() => read({ workspaceId }));
  }, [query, active, read, workspaceId]);
  useEffect(() => {
    if (state.data.kind !== "ready" && state.data.kind !== "missing") return;
    const canonical = boardQueryKey(hostId, state.data.boardId);
    if (canonical === key) return;
    getBoardQuery(canonical).seed(state.data);
    setIdentity({ scope, key: canonical });
  }, [state.data, hostId, scope, key]);
  const data: typeof state.data = !active && state.data.kind === "loading" ? { kind: "transport-error" } : state.data;
  return { ...state, data, query, scope, active, refresh: () => { if (active) void query.refresh(true); } };
}
