import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Markdown, ScrollView, SettingsSwitch, TextInput } from "@getpaseo/plugin/client/ui";
import { useEffect, useImperativeHandle, useReducer, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import { Text, View } from "react-native";
import type { BoardSnapshot } from "../shared/board";
import { boardRead, ticketCreate, ticketMove, ticketRead, ticketUpdate } from "../shared/rpc";
import type { TicketDetail } from "../shared/ticket";
import type { BoardQuery } from "./board-query";
import { Badge, Banner, Button, font, Label, priorityStyle, radius, Skeleton, space, tint, weight } from "./design";
import { CurrentMenuRow, DetailRow, inputStyle, MenuRow, Segment, SegmentedControl, StatusButton, TagChip } from "./ticket-editor-parts";
import { usePanelActive } from "./use-board";
import { draftFrom, TicketDraft, type Draft } from "./ticket-draft";

/** Where the editor goes next. Dirty drafts ask Save or Discard first; `run` continues with an action outside the editor. */
export type Leave = "close" | "launch" | { open: number | "new" } | { run(): void };
export type EditorHandle = { leave(action: Leave): void };
type Props = {
  ticketId: number | "new"; board: BoardSnapshot; props: PluginWorkspacePanelProps;
  onClose(): void; onSaved(ticket: TicketDetail): void; query: BoardQuery; drafts: Map<string, TicketDraft>;
  /** Switches to another ticket after this draft is resolved, like close. */
  onOpen(ticketId: number | "new"): void;
  // Launch UI supplies this callback; the editor resolves Save/Discard before calling it.
  onLaunch?(ticket: TicketDetail): void;
  /** Extra section after Relations for saved tickets. */
  sessions?: ReactNode;
  ref?: Ref<EditorHandle>;
};
export function TicketEditor(props: Props) {
  const { ticketId, board, props: { workspaceId, theme } } = props;
  const read = useRpc(ticketRead);
  const scope = JSON.stringify([props.props.host.id, board.boardId, ticketId]);
  const [session, setSession] = useState<TicketDraft | null>(() => {
    const existing = props.drafts.get(scope);
    if (existing) return existing;
    if (ticketId !== "new") return null;
    const draft = new TicketDraft(null, board.config);
    props.drafts.set(scope, draft);
    return draft;
  });
  const [error, setError] = useState("");
  const [observed, setObserved] = useState<{ ticket: TicketDetail; epoch: number } | null>(null);
  const active = usePanelActive(props.props.host.id);
  const queryState = useSyncExternalStore(props.query.subscribe, props.query.getSnapshot);
  const detailId = session?.baseline?.id ?? ticketId;
  const [attempt, retry] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (detailId === "new" || !active || queryState.write === "pending") return;
    let disposed = false;
    let running = false;
    const load = async () => {
      if (running || session?.pending || props.drafts.get(scope)?.pending) return;
      running = true;
      try {
        const result = await read({ workspaceId, ticketId: detailId });
        if (disposed || props.query.getSnapshot().epoch !== queryState.epoch) return;
        if ("kind" in result) setError(result.message);
        else if (result.boardId !== board.boardId || result.id !== detailId) setError("The project board changed. Close and reopen this ticket.");
        else {
          setError(""); setObserved({ ticket: result, epoch: queryState.epoch });
          if (!session && !props.drafts.has(scope)) {
            const draft = new TicketDraft(result, board.config);
            props.drafts.set(scope, draft); setSession(draft);
          }
        }
      } catch { if (!disposed && props.query.getSnapshot().epoch === queryState.epoch) setError("Cannot refresh ticket. Your draft is retained; check the connection and retry."); }
      finally { running = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => { disposed = true; clearInterval(timer); };
    // Refresh detail independently; never replace an existing draft or its baseline.
  }, [read, workspaceId, detailId, scope, board.boardId, attempt, active, queryState.epoch, queryState.write]);
  const form = useRef<EditorHandle>(null);
  const forget = () => {
    props.drafts.delete(scope);
    if (session?.baseline) props.drafts.delete(JSON.stringify([props.props.host.id, board.boardId, session.baseline.id]));
  };
  // Without a draft there is nothing to resolve, so leave at once.
  useImperativeHandle(props.ref, () => ({ leave: (action) => {
    if (session) form.current?.leave(action);
    else if (action === "close") props.onClose();
    else if (typeof action === "object") { if ("open" in action) props.onOpen(action.open); else action.run(); }
  } }));
  if (!session) return <View style={{ flex: 1, paddingHorizontal: space.lg, paddingTop: space.md, gap: space.lg, backgroundColor: theme.colors.surface0 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 34 }}>
      {!error && <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.foregroundMuted, fontSize: font.sm }}>Loading ticket…</Text>}
      <View style={{ marginLeft: "auto" }}>
        <Button label="Close ticket" icon="X" iconOnly variant="ghost" theme={theme} onPress={props.onClose} />
      </View>
    </View>
    {error ? <Banner theme={theme} tone="warning" title="Ticket unavailable" message={error}
      actions={<Button label="Retry ticket" icon="RotateCw" size="sm" theme={theme} onPress={retry} />} />
      : <View aria-hidden style={{ gap: space.md }}>
        <Skeleton theme={theme} height={42} />
        <Skeleton theme={theme} width={96} height={12} />
        <Skeleton theme={theme} height={180} />
        {[0, 1, 2].map((row) => <View key={row} style={{ flexDirection: "row", gap: space.md }}>
          <Skeleton theme={theme} width={76} height={14} /><Skeleton theme={theme} height={14} style={{ flex: 1 }} />
        </View>)}
      </View>}
  </View>;
  return <EditorForm {...props} ref={form} session={session} detailError={error}
    observed={observed?.ticket ?? null} detailPending={!!session.baseline && observed?.epoch !== queryState.epoch}
    onObserved={(ticket) => { setObserved({ ticket, epoch: props.query.getSnapshot().epoch }); setError(""); }}
    onSaved={(ticket) => {
      props.drafts.delete(scope);
      props.drafts.set(JSON.stringify([props.props.host.id, board.boardId, ticket.id]), session);
      props.onSaved(ticket);
    }} onClose={() => { forget(); props.onClose(); }} onOpen={(target) => { forget(); props.onOpen(target); }} />;
}

function EditorForm({ session, board, query, props: { theme, workspaceId, host }, onSaved, onClose, onOpen, onLaunch, sessions, ref, observed, onObserved, detailPending, detailError }: Props & { detailPending: boolean; session: TicketDraft; observed: TicketDetail | null; onObserved(ticket: TicketDetail): void; detailError: string }) {
  const active = usePanelActive(host.id);
  const queryState = useSyncExternalStore(query.subscribe, query.getSnapshot);
  const detailStale = !!session.baseline && !!observed && observed.revision !== session.baseline.revision;
  const writeBlocked = !active || !query.canWrite || detailPending || detailStale || !!detailError;
  const [, notify] = useReducer((n: number) => n + 1, 0);
  const create = useRpc(ticketCreate);
  const update = useRpc(ticketUpdate);
  const move = useRpc(ticketMove);
  const readBoard = useRpc(boardRead);
  const read = useRpc(ticketRead);
  const [leave, setLeave] = useState<Leave | null>(null);
  const [preview, setPreview] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const saved = session.baseline;
  const finish = (action: Leave) => {
    setLeave(null);
    if (action === "close") onClose();
    else if (action === "launch") { if (session.baseline) onLaunch?.(session.baseline); }
    else if ("open" in action) onOpen(action.open);
    else action.run();
  };
  const requestLeave = (action: Leave) => {
    if (session.canLeave) finish(action);
    else setLeave(action);
  };
  // Launches and outside actions keep the stricter launch rule: no discarding past a conflict or unknown write.
  const launching = leave === "launch" || (typeof leave === "object" && leave !== null && "run" in leave);
  const save = async () => {
    if (writeBlocked || !query.beginWrite()) return;
    const success = await session.save(workspaceId, create, update, notify);
    query.endWrite(session.recovery === "uncertain");
    if (success && session.baseline) {
      onSaved(session.baseline);
      if (leave) finish(leave);
    }
  };
  const reconcile = async () => {
    if (session.pending || !active || queryState.write === "pending") return;
    session.pending = true; session.error = ""; session.reconciled = false; session.latest = null; notify();
    try {
      const refresh = query.refresh(true, () => readBoard({ workspaceId }));
      const epoch = query.getSnapshot().epoch;
      const snapshot = await refresh;
      if (!snapshot || snapshot.kind !== "ready" || snapshot.boardId !== board.boardId) {
        session.error = snapshot?.kind === "error" ? snapshot.message : "Cannot reconcile this board. Your draft is retained.";
        return;
      }
      if (session.baseline) {
        const latest = await read({ workspaceId, ticketId: session.baseline.id });
        if (query.getSnapshot().epoch !== epoch) { session.error = "Saved data changed while refreshing. Refresh again."; return; }
        if ("kind" in latest) { session.error = latest.message; return; }
        if (latest.boardId !== board.boardId || latest.id !== session.baseline.id) { session.error = "The project board changed. Your draft is retained."; return; }
        session.latest = latest;
        onObserved(latest);
      }
      session.reconciled = true;
    } catch { session.error = "Refresh failed. Your draft is retained; try refreshing again."; }
    finally { session.pending = false; notify(); }
  };
  const moveBlocked = writeBlocked || session.pending || session.dirty || session.recovery !== "none";
  useImperativeHandle(ref, () => ({ leave: (action) => {
    if (session.pending || (action === "launch" && (!onLaunch || writeBlocked))) return;
    requestLeave(action);
  } }));
  const onDraft = (name: Exclude<keyof Draft, "tags" | "blocked">) => (value: string) => { session.draft = { ...session.draft, [name]: value }; notify(); };
  const input = (name: Exclude<keyof Draft, "tags" | "blocked">, label: string, extra: { placeholder?: string; multiline?: boolean; size?: "md" | "lg" } = {}) =>
    <TextInput accessibilityLabel={label} autoFocus={name === "title"} value={session.draft[name]} editable={!session.pending}
      placeholder={extra.placeholder} placeholderTextColor={theme.colors.foregroundMuted} multiline={extra.multiline}
      onFocus={() => setFocused(name)} onBlur={() => setFocused(null)} onChangeText={onDraft(name)}
      style={{ ...inputStyle(theme, focused === name, extra.size), ...(extra.multiline ? { minHeight: 180, lineHeight: 20, textAlignVertical: "top" } : {}) }} />;
  const muted = { color: theme.colors.foregroundMuted, fontSize: font.sm, lineHeight: 17 } as const;
  const showRecovery = session.recovery !== "none" || detailStale || !!detailError;
  const priorities = board.config.priorities;
  return <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 34 }}>
        {saved ? <>
          <Text accessibilityRole="header" accessibilityLabel={`Ticket #${saved.id}`}
            style={{ color: theme.colors.foregroundMuted, fontSize: font.lg, fontWeight: weight.medium, fontVariant: ["tabular-nums"] }}>#{saved.id}</Text>
          <StatusButton theme={theme} status={saved.status} open={moveOpen} disabled={moveBlocked}
            accessibilityLabel={moveOpen ? "Hide Move menu" : "Move ticket"} onPress={() => setMoveOpen(!moveOpen)} />
        </> : <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text accessibilityRole="header" style={{ color: theme.colors.foreground, fontSize: font.xl, fontWeight: weight.semibold }}>New ticket</Text>
          <Text style={muted}>Will be created in {board.config.defaults.status}</Text>
        </View>}
        <View style={{ marginLeft: "auto" }}>
          <Button label="Close ticket" icon="X" iconOnly variant="ghost" theme={theme} disabled={session.pending} onPress={() => requestLeave("close")} />
        </View>
      </View>
      {saved && session.dirty && <Text style={{ ...muted, fontSize: font.xs }}>Save or discard field edits before moving.</Text>}
      {saved && moveOpen && <View accessibilityRole="menu" accessibilityLabel="Move ticket to status"
        style={{ alignSelf: "flex-start", minWidth: 220, maxWidth: "100%", padding: space.xs, gap: 1, borderRadius: radius.card, borderWidth: 1,
          borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
        <Text style={{ ...muted, fontSize: font.xs, paddingHorizontal: space.sm, paddingTop: space.xs, paddingBottom: 2 }}>Move to…</Text>
        {board.config.statuses.map((status) => status.name === saved.status
          ? <CurrentMenuRow key={status.name} theme={theme} label={status.name} />
          : <MenuRow key={status.name} theme={theme} label={status.name} accessibilityLabel={`Move to ${status.name}`} disabled={moveBlocked}
            onPress={() => {
              if (writeBlocked || !query.beginWrite()) return;
              void session.move(workspaceId, status.name, move, notify).then((success) => {
                query.endWrite(session.recovery === "uncertain");
                if (success && session.baseline) { setMoveOpen(false); onSaved(session.baseline); }
              });
            }} />)}
      </View>}
    </View>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xl, gap: space.xl }}
      keyboardShouldPersistTaps="handled">
      {(session.error !== "" || showRecovery) && <View style={{ gap: space.sm }}>
        {session.error !== "" && <Banner theme={theme} tone="danger" message={session.error} />}
        {detailStale && <Banner theme={theme} tone="warning" message="This ticket changed outside this editor. Your draft and original revision are retained." />}
        {detailError && <Banner theme={theme} tone="warning" message={detailError} />}
        {showRecovery && <Banner theme={theme} tone="info" icon="History"
          message="Your draft and original revision are retained. Refresh saved data to review the current ticket."
          actions={<Button label="Refresh saved data" icon="RefreshCw" size="sm" theme={theme}
            disabled={!active || session.pending || queryState.write === "pending"} onPress={() => void reconcile()} />} />}
        {showRecovery && session.reconciled && (session.latest ? <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.card, borderWidth: 1,
          borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
          <Label theme={theme}>Saved version</Label>
          <Text style={{ color: theme.colors.foreground, fontSize: font.md, fontWeight: weight.medium }}>Saved ticket: {session.latest.title} · {session.latest.status}</Text>
          <View style={{ paddingTop: space.xs, borderTopWidth: 1, borderColor: theme.colors.border }}><Markdown>{session.latest.description}</Markdown></View>
          <View style={{ flexDirection: "row" }}>
            <Button label="Discard draft and load saved ticket" variant="danger" size="sm" theme={theme} disabled={session.pending}
              onPress={() => { if (session.latest) { query.acknowledge(); session.accept(session.latest); notify(); } }} />
          </View>
        </View> : <Banner theme={theme} tone="warning"
          message="The board was refreshed. Creation may have succeeded. Close and discard this draft, then inspect the board before creating another ticket." />)}
      </View>}
      <View style={{ gap: space.md }}>
        {input("title", "Title", { placeholder: "Ticket title", size: "lg" })}
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
            <Label theme={theme}>Description</Label>
            <SegmentedControl theme={theme}>
              <Segment theme={theme} label="Write" accessibilityLabel={preview ? "Hide preview" : "Write"} selected={!preview} onPress={() => setPreview(false)} />
              <Segment theme={theme} label="Preview" accessibilityLabel={preview ? "Preview" : "Preview Markdown"} selected={preview} onPress={() => setPreview(true)} />
            </SegmentedControl>
          </View>
          {preview ? <View style={{ minHeight: 180, padding: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface0 }}>
            {session.draft.description.trim() ? <Markdown>{session.draft.description}</Markdown> : <Text style={muted}>Nothing to preview.</Text>}
          </View> : input("description", "Description (Markdown)", { placeholder: "Add a description… Markdown is supported.", multiline: true })}
        </View>
      </View>
      <View style={{ gap: space.sm }}>
        <Label theme={theme}>Details</Label>
        <DetailRow theme={theme} label="Priority">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {priorities.map((value) => {
              const style = priorityStyle(value, priorities);
              const selected = session.draft.priority === value;
              return <Badge key={value} theme={theme} label={value} icon={style.icon} tone={selected ? style.tone : "neutral"} appearance={selected ? "soft" : "outline"}
                selected={selected} disabled={session.pending} accessibilityLabel={`Priority ${value}`}
                onPress={() => { session.draft = { ...session.draft, priority: value }; notify(); }} />;
            })}
          </View>
        </DetailRow>
        <DetailRow theme={theme} label="Assignee" align="start">
          {input("assignee", "Assignee", { placeholder: "Unassigned" })}
          {saved?.assignee && <Text style={{ ...muted, fontSize: font.xs }}>Replace the assignee to reassign. Clearing is not supported.</Text>}
        </DetailRow>
        <DetailRow theme={theme} label="Due date">
          {input("due", "Due date (YYYY-MM-DD)", { placeholder: "YYYY-MM-DD" })}
        </DetailRow>
        <DetailRow theme={theme} label="Tags" align="start">
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, minHeight: 32 }}>
            {session.draft.tags.map((tag, index) => <TagChip key={index} theme={theme} index={index} value={tag} disabled={session.pending}
              focused={focused === `tag-${index}`} autoFocus={tag === "" && index === session.draft.tags.length - 1}
              onFocus={() => setFocused(`tag-${index}`)} onBlur={() => setFocused(null)}
              onChangeText={(value) => { session.draft.tags = session.draft.tags.map((current, i) => i === index ? value : current); notify(); }}
              onRemove={() => { session.draft.tags = session.draft.tags.filter((_, i) => i !== index); notify(); }} />)}
            <Button label="Add tag" icon="Plus" variant="ghost" size="sm" theme={theme} disabled={session.pending}
              onPress={() => { session.draft.tags = [...session.draft.tags, ""]; notify(); }} />
          </View>
        </DetailRow>
        {saved && <View style={{ marginTop: space.xs, borderRadius: radius.card, borderWidth: 1, overflow: "hidden",
          borderColor: session.draft.blocked ? tint(theme.colors.statusWarning, 0.45, theme.colors.border) : theme.colors.border,
          backgroundColor: session.draft.blocked ? tint(theme.colors.statusWarning, 0.06, theme.colors.surface0) : theme.colors.surface0 }}>
          <SettingsSwitch label="Blocked" value={session.draft.blocked} disabled={session.pending}
            onValueChange={(blocked) => { session.draft.blocked = blocked; notify(); }} />
          {session.draft.blocked && <View style={{ gap: space.xs, paddingHorizontal: space.md, paddingBottom: space.md }}>
            {input("blockReason", "Blocked reason", { placeholder: "What is blocking this ticket?" })}
            {!session.draft.blockReason && <Text style={{ ...muted, fontSize: font.xs }}>No reason recorded. Turn off Blocked to unblock, or enter a reason.</Text>}
          </View>}
        </View>}
      </View>
      {saved && <View style={{ gap: space.sm }}>
        <Label theme={theme}>Relations</Label>
        <DetailRow theme={theme} label="Depends on">
          {saved.dependsOn.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {saved.dependsOn.map((id) => <Badge key={id} theme={theme} label={`#${id}`} icon="Link" appearance="outline" accessibilityLabel={`Depends on ticket ${id}`} />)}
          </View> : <Text style={muted}>None</Text>}
        </DetailRow>
        <DetailRow theme={theme} label="Claim">
          {saved.claim ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Badge theme={theme} label={saved.claim.name} icon="Lock" />
            <Text style={muted}>since {formatTime(saved.claim.claimedAt)}</Text>
          </View> : <Text style={muted}>Unclaimed</Text>}
        </DetailRow>
      </View>}
      {saved && sessions}
    </ScrollView>
    {leave && <View accessibilityLabel="Unsaved changes" style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
      <Banner theme={theme} tone="warning" message="Save or discard your draft before continuing."
        actions={<>
          <Button label="Keep editing" size="sm" theme={theme} disabled={session.pending} onPress={() => setLeave(null)} />
          <Button label="Discard draft and continue" variant="danger" size="sm" theme={theme}
            disabled={session.pending || (session.recovery === "uncertain" && !session.reconciled) || (launching && session.recovery !== "none")}
            onPress={() => { if (saved) session.accept(saved); else session.draft = draftFrom(null, board.config); finish(leave); }} />
        </>} />
    </View>}
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md,
      borderTopWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface0 }}>
      <View style={{ flex: 1, minWidth: 80 }}>
        {active && detailPending && !session.pending
          ? <Text accessibilityLiveRegion="polite" numberOfLines={1} style={{ ...muted, fontSize: font.xs }}>Refreshing saved ticket…</Text>
          : saved && session.dirty ? <Text numberOfLines={1} style={{ ...muted, fontSize: font.xs }}>Unsaved edits</Text> : null}
      </View>
      {onLaunch && saved && <Button label="Implement" icon="Play" theme={theme} disabled={writeBlocked || session.pending} onPress={() => requestLeave("launch")} />}
      <Button label={session.pending ? "Working…" : saved ? "Save changes" : "Create ticket"} variant="primary" theme={theme}
        disabled={writeBlocked || session.pending || session.recovery !== "none" || (!!saved && !session.dirty && !leave)} onPress={() => void save()} />
    </View>
  </View>;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
