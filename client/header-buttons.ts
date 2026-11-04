import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";

// On compact layouts Paseo lists header buttons in the Workspace actions menu, the only
// plugin entry point there. Buttons are per workspace, so this follows the workspace list.
export function addKanbanHeaderButtons(client: PluginClientContext, panelId: string): () => void {
  const buttons = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();
  const register = (workspaceId: string) => {
    if (lifetime.signal.aborted || buttons.has(workspaceId)) return;
    buttons.set(workspaceId, client.addHeaderButton({
      id: "open-kanban",
      workspaceId,
      button: {
        title: "Open Kanban",
        icon: "Columns3",
        behavior: { kind: "action", onPress: () => client.openPanel(panelId, { workspaceId }) },
      },
    }));
  };
  const unregister = (workspaceId: string) => {
    buttons.get(workspaceId)?.remove();
    buttons.delete(workspaceId);
  };
  const unregisterAll = () => {
    for (const workspaceId of Array.from(buttons.keys())) unregister(workspaceId);
  };

  // The owned subscription delivers a snapshot, then updates, and a fresh snapshot after a reconnect.
  client.paseo.workspaces.list({ subscribe: {} })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) return void subscription.release();
      const stop = subscription.subscribe({
        snapshot: ({ entries }) => {
          const ids = new Set(entries.map((workspace) => workspace.id));
          for (const workspaceId of Array.from(buttons.keys())) if (!ids.has(workspaceId)) unregister(workspaceId);
          for (const workspaceId of ids) register(workspaceId);
        },
        update: (message) => {
          if (message.type !== "workspace_update") return;
          if (message.payload.kind === "upsert") register(message.payload.workspace.id);
          else unregister(message.payload.id);
        },
      });
      lifetime.signal.addEventListener("abort", () => {
        stop();
        void subscription.release();
      });
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.error("Kanban header buttons: workspace observation failed", error);
    });

  return () => {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    unregisterAll();
  };
}
