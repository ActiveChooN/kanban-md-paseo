import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRef, useState, useSyncExternalStore } from "react";
import { View, type ViewStyle } from "react-native";
import { boardCreate, boardRead } from "../shared/rpc";
import type { BoardQuery } from "./board-query";
import { Banner, Button, space } from "./design";

export function CreateBoard({ workspaceId, theme, available, onCreated, query, style }: {
  workspaceId: string; theme: PluginWorkspacePanelProps["theme"]; available: boolean; onCreated(): void; query: BoardQuery;
  /** Layout only, e.g. `alignItems: "center"` inside a centered empty state. */
  style?: ViewStyle;
}) {
  useSyncExternalStore(query.subscribe, query.getSnapshot);
  const create = useRpc(boardCreate);
  const read = useRpc(boardRead);
  const guard = useRef(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (guard.current || (!uncertain && !query.beginWrite())) return;
    let unknown = false;
    guard.current = true; setPending(true); setError("");
    try {
      const result = uncertain ? await query.refresh(true, () => read({ workspaceId })) : await create({ workspaceId });
      if (!result) { setError("Refresh failed. Check the connection and retry."); return; }
      if (result.kind === "ready") onCreated();
      else if (result.kind === "missing") { setUncertain(false); onCreated(); }
      else {
        setError(result.message);
        if (["write_uncertain", "timeout", "invalid_output", "output_limit"].includes(result.code)) { unknown = true; setUncertain(true); }
      }
    } catch { unknown = true; setUncertain(true); setError("The response was lost. Refresh before trying to create the board again."); }
    finally { if (!uncertain) query.endWrite(unknown); guard.current = false; setPending(false); }
  };
  if (!available && !uncertain && !pending && !error) return null;
  return <View style={{ gap: space.md, alignItems: "flex-start", maxWidth: 480, ...style }}>
    {error !== "" && <Banner theme={theme} tone="warning" message={error} style={{ alignSelf: "stretch" }} />}
    <Button variant="primary" icon={uncertain ? "RefreshCw" : "Plus"} label={pending ? "Working…" : uncertain ? "Refresh board creation result" : "Create board"} theme={theme}
      disabled={pending || (!uncertain && (!available || !query.canWrite))} onPress={() => void submit()} />
  </View>;
}
