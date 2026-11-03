import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, Loading, Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { launchInputSchema, launchOptions, launchRecover, launchStart, type LaunchInput, type LaunchLink } from "../shared/launch";
import { ticketRead } from "../shared/rpc";
import { Banner, Button, dismissPickerMenu, focusRing, font, Label, Picker, pickerTouchScope, radius, space } from "./design";
import { canReviseLaunch, type LaunchAttempt } from "./launch-state";
import { useValidatedAgent } from "./use-agent-activity";

type Options = Extract<RpcOutput<typeof launchOptions>, { kind: "launch_options" }>;
type Scope = RpcInput<typeof launchOptions>;
type Form = Pick<LaunchInput, "provider" | "model" | "workspace" | "instructions">;
const workspaceLabels = { worktree: "New worktree", directory: "Project directory", current: "Current workspace" };
const workspaceHints = { worktree: "New branch in an isolated git worktree", directory: "New workspace at the project root", current: "Reuse the workspace this board is open in" };

export function ImplementDialog({ scope, props: { theme, layout, navigation }, attempt, canLaunch, active,
  seed, onRevise, onPersist, onLinked, onClose }: {
  scope: Omit<Scope, "revision"> & { revision?: string }; props: PluginWorkspacePanelProps; attempt?: LaunchAttempt;
  canLaunch(): boolean; active: boolean;
  seed?: LaunchInput; onRevise(input: LaunchInput): void;
  onPersist(attempt: LaunchAttempt): void; onLinked(link: LaunchLink): void; onClose(): void;
}) {
  const validateAgent = useValidatedAgent(scope, active);
  const optionsRpc = useRpc(launchOptions);
  const readTicket = useRpc(ticketRead);
  const start = useRpc(launchStart);
  const recover = useRpc(launchRecover);
  const [options, setOptions] = useState<Options | null>(null);
  const [resolvedScope, setResolvedScope] = useState<Scope | null>(null);
  const [form, setForm] = useState<Form>(seed
    ? { provider: seed.provider, model: seed.model, workspace: seed.workspace, instructions: seed.instructions }
    : { provider: "", model: "", workspace: "current", instructions: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const [focused, setFocused] = useState(false);
  const busy = useRef(false);
  // Keep the immediate submission guard independent of React's next render.
  const submitted = useRef(attempt);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (attempt || submitted.current || !active) return;
    let disposed = false;
    setLoading(true); setError(""); setResolvedScope(null);
    void (async () => {
      const ticket = await readTicket({ workspaceId: scope.workspaceId, ticketId: scope.ticketId });
      if (disposed) return;
      if ("kind" in ticket) { setError(ticket.message); return; }
      if (ticket.boardId !== scope.boardId || ticket.projectId !== scope.projectId || ticket.id !== scope.ticketId
        || (scope.revision && scope.revision !== ticket.revision)) {
        setError("The saved ticket changed. Close this dialog and refresh the ticket before launching."); return;
      }
      const currentScope = { ...scope, revision: ticket.revision };
      const result = await optionsRpc(currentScope);
      if (disposed) return;
      if (result.kind !== "launch_options") { setError(result.message); return; }
      setResolvedScope(currentScope);
      setOptions(result);
      setForm((previous) => {
        const provider = result.providers.find(({ id, models }) => id === previous.provider && models.length)
          ?? result.providers.find(({ models }) => models.length);
        return {
          provider: provider?.id ?? "", model: provider?.models.find(({ id }) => id === previous.model)?.id ?? provider?.models[0]?.id ?? "",
          workspace: (options || seed) && result.workspaces.includes(previous.workspace) ? previous.workspace : result.defaultWorkspace,
          instructions: options || seed ? previous.instructions : result.instructions,
        };
      });
    })().catch(() => { if (!disposed) setError("Cannot load launch options. Check the connection and refresh."); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
    // Refresh is deliberate; neither polling nor a new ticket revision replaces this form.
  }, [optionsRpc, readTicket, active, reload, attempt, scope.hostId, scope.boardId, scope.projectId, scope.workspaceId, scope.ticketId, scope.revision]);

  const open = async (link: LaunchLink) => {
    if (!active || link.ticketId !== scope.ticketId || !await validateAgent(link)) {
      if (mounted.current) setError("Agent unavailable. Its ticket, workspace or session link changed.");
      return;
    }
    if (!mounted.current) return;
    if (!navigation) { setError("Native conversation navigation is unavailable in this app."); return; }
    try { navigation.openAgent({ serverId: link.hostId, agentId: link.agentId }); }
    catch { setError("Cannot open the conversation. Use Open agent to try again."); }
  };
  const run = async (inspect: boolean) => {
    if (busy.current || !active) return;
    const previous = attempt ?? submitted.current;
    const rejected = previous?.result?.kind === "launch_failed" && previous.result.outcome === "rejected" && previous.source !== "recover";
    if (!inspect && (!canLaunch() || !navigation || (previous ? !rejected : !options || !resolvedScope))) return;
    const input = previous?.input ?? { ...resolvedScope, ...form, launchId: options?.launchId, modeId: null };
    const parsed = launchInputSchema.safeParse(input);
    if (!parsed.success) { setError("Choose an available provider, model and workspace before launching."); return; }
    if (!inspect && !previous && (!options?.providers.some(({ id, models }) => id === form.provider && models.some(({ id }) => id === form.model))
      || !options.workspaces.includes(form.workspace))) {
      setError("Choose an available provider, model and workspace before launching."); return;
    }
    busy.current = true; setPending(true); setError("");
    const saved: LaunchAttempt = { input: previous?.input ?? parsed.data, result: null, source: inspect ? "recover" : previous ? "retry" : "start" };
    try {
      // Persist the complete immutable input BEFORE invoking any creation RPC.
      onPersist(saved);
      submitted.current = saved;
    } catch {
      busy.current = false; setPending(false); setError("Cannot save launch recovery details. Nothing was launched."); return;
    }
    try {
      const result = await (inspect ? recover(saved.input) : start(saved.input));
      const next = { ...saved, result };
      onPersist(next); submitted.current = next;
      if (result.kind === "launched" || result.kind === "recovered") {
        onLinked(result);
        if (mounted.current) await open(result);
      }
    } catch {
      if (mounted.current) setError("The response was lost. Inspect this launch before doing anything else. Your instructions are retained.");
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const saved = attempt ?? submitted.current;
  const values = saved?.input ?? form;
  const provider = options?.providers.find(({ id }) => id === values.provider);
  const result = saved?.result;
  const link = result?.kind === "launched" || result?.kind === "recovered" ? result : null;
  const locked = !!saved || pending;
  const choices = (entries: { id: string; label: string }[]) => entries.map(({ id, label }) => ({ value: id, label }));
  const { colors } = theme;
  const pad = layout.compact ? 12 : 20;
  const rejected = !!saved && saved.source !== "recover" && result?.kind === "launch_failed" && result.outcome === "rejected";
  // Exactly one primary per state: Start before launch, Inspect while uncertain, Open once linked.
  const primary = !saved
    ? <Button key="start" variant="primary" icon="Play" label={pending ? "Launching…" : "Start implementation"} theme={theme}
      disabled={pending || loading || !resolvedScope || !canLaunch() || !active || !navigation || !provider?.models.some(({ id }) => id === form.model)} onPress={() => void run(false)} />
    : !link ? <Button key="inspect" variant="primary" icon="Search" label={pending ? "Inspecting…" : "Inspect launch"} theme={theme}
      disabled={pending || !active} onPress={() => void run(true)} />
    : navigation ? <Button key="open" variant="primary" icon="ExternalLink" label="Open agent" theme={theme} disabled={!active || pending} onPress={() => void open(link)} />
    : null;
  const refresh = !saved && <Button key="refresh" variant="ghost" icon="RefreshCw" label="Refresh" accessibilityLabel="Refresh launch options" theme={theme}
      disabled={pending || loading || !active} onPress={() => setReload(reload + 1)} style={layout.compact ? { flex: 1 } : { marginRight: "auto" }} />;
  const secondary = [
    rejected && <Button key="retry" icon="RotateCcw" label="Retry rejected launch" theme={theme}
      disabled={pending || !active || !canLaunch()} onPress={() => void run(false)} />,
    saved && canReviseLaunch(saved) && <Button key="revise" icon={link ? "Plus" : "Pencil"} label={link ? "New implementation" : "Edit launch settings"} theme={theme}
      disabled={pending || !active || !canLaunch()} onPress={() => onRevise(saved.input)} />,
  ];
  const close = <Button key="close" variant="ghost" label="Close" accessibilityLabel="Close implementation" theme={theme} onPress={onClose}
    style={layout.compact ? { flex: 1 } : undefined} />;
  return <Modal title={`Implement ticket #${scope.ticketId}`} open onOpenChange={(isOpen) => { if (!isOpen && !dismissPickerMenu()) onClose(); }}>
    <Modal.Content contentContainerStyle={{ padding: pad }}>
      <View {...pickerTouchScope} style={{ gap: 20 }}>
      {loading && <Loading />}
      {(options || saved) && <>
        <View style={{ gap: space.sm, zIndex: 10 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs, marginHorizontal: -space.xs, zIndex: 10 }}>
            <Picker theme={theme} variant="ghost" label="Provider" icon="Bot" value={values.provider} disabled={locked || loading}
              options={saved ? [{ value: values.provider, label: values.provider }] : choices(options?.providers ?? [])}
              onValueChange={(provider) => setForm({ ...form, provider, model: options?.providers.find(({ id }) => id === provider)?.models[0]?.id ?? "" })} />
            <Picker theme={theme} variant="ghost" label="Model" icon="Cpu" value={values.model} disabled={locked || loading} menuWidth={280}
              options={saved ? [{ value: values.model, label: values.model }] : choices(provider?.models ?? [])}
              onValueChange={(model) => setForm({ ...form, model })} />
            <Picker theme={theme} variant="ghost" label="Workspace" icon="GitBranch" value={values.workspace} disabled={locked || loading} menuWidth={280}
              options={(saved ? [values.workspace] : options?.workspaces ?? []).map((value) => ({ value, label: workspaceLabels[value], description: workspaceHints[value] }))}
              onValueChange={(workspace) => setForm({ ...form, workspace })} />
            <View accessible accessibilityLabel="Permissions: provider default"
              style={{ flexDirection: "row", alignItems: "center", gap: 5, minHeight: 26, paddingHorizontal: space.sm }}>
              <Icon name="ShieldCheck" size={13} color={colors.foregroundMuted} />
              <Text style={{ color: colors.foregroundMuted, fontSize: font.sm }}>Provider default</Text>
            </View>
          </View>
          {!saved && !provider?.models.length && <Banner theme={theme} tone="warning" message="No available model. Check your provider settings, then refresh launch options." />}
        </View>
        <View style={{ gap: space.sm }}>
          <Label theme={theme}>Instructions</Label>
          <TextInput accessibilityLabel="Implementation instructions" value={values.instructions} multiline autoFocus={!saved}
            editable={!locked} onChangeText={(instructions) => setForm({ ...form, instructions })}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            style={{ color: locked ? colors.foregroundMuted : colors.foreground, backgroundColor: locked ? colors.surface1 : colors.surface0,
              borderRadius: radius.card, fontSize: font.md, lineHeight: 20, minHeight: locked ? 120 : layout.compact ? 180 : 260, textAlignVertical: "top",
              ...focusRing(theme, focused, colors.border, { h: space.md, v: 10 }) }} />
        </View>
      </>}
      {(saved && !link || link || error || !active || !canLaunch()) && <View style={{ gap: space.sm }}>
        {saved && !link && <Banner theme={theme} tone="warning"
          message={result && "message" in result ? result.message : "Launch may have started. Inspect this launch to find its conversation."} />}
        {link && (link.kind === "recovered"
          ? <Banner theme={theme} tone="warning" message="Conversation recovered. Initial instruction delivery is unknown. Inspect the conversation; do not resend the instructions." />
          : <Banner theme={theme} tone="success" message="Implementation started." />)}
        {!!error && <Banner theme={theme} tone="warning" message={error} />}
        {!active && <Banner theme={theme} tone="warning" message="Reconnect to continue. Your launch details are retained." />}
        {!canLaunch() && <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ paddingTop: 2 }}><Icon name="Info" size={14} color={colors.foregroundMuted} /></View>
          <Text style={{ flex: 1, color: colors.foregroundMuted, fontSize: font.sm, lineHeight: 18 }}>Refresh the board and resolve pending ticket edits before launching.</Text>
        </View>}
      </View>}
      <View style={layout.compact
        ? { gap: space.sm, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border }
        : { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: space.sm,
          marginHorizontal: -pad, paddingHorizontal: pad, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: colors.border }}>
        {layout.compact ? <>{primary}{secondary}<View style={{ flexDirection: "row", gap: space.sm }}>{refresh}{close}</View></> : <>{refresh}{close}{secondary}{primary}</>}
      </View>
      </View>
    </Modal.Content>
  </Modal>;
}
