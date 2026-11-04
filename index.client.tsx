import type { PluginClientContext } from "@getpaseo/plugin/client";
import { addKanbanHeaderButtons } from "./client/header-buttons";
import { KanbanPanel } from "./client/kanban-panel";
import { ticketAttachmentSource } from "./shared/attachments";

export default function contribute(client: PluginClientContext) {
  const removePanel = client.addWorkspacePanel({
    id: "kanban",
    title: "Kanban",
    icon: "Columns3",
    Component: KanbanPanel,
  });
  const removeCommand = client.addCommandCenterItem({
    id: "open-kanban",
    title: "Open Kanban",
    icon: "Columns3",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("kanban");
    },
  });
  const removeAttachmentSource = client.addAttachmentSource(ticketAttachmentSource);
  const removeHeaderButtons = addKanbanHeaderButtons(client, "kanban");

  return () => {
    removeHeaderButtons();
    removeAttachmentSource();
    removeCommand();
    removePanel();
  };
}
