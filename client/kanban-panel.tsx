import { type PluginWorkspacePanelProps, useTabState } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Text, View, type ScrollView as NativeScrollView } from "react-native";
import type { BoardSnapshot } from "../shared/board";
import type { LaunchInput, LaunchLink } from "../shared/launch";
import type { Session } from "./agent-activity";
import { boardQueryKey, defaultBoardView, filterTickets, type BoardView } from "./board-view";
import { ActivityDot, Badge, Banner, Button, font, Label, pickerTouchScope, radius, Skeleton, space, tint, weight, type Theme } from "./design";
import { BoardHeader, EmptyResults, FilterBar, FilterChips, SearchField, StatusTabs, type FilterField } from "./board-toolbar";
import { ColumnLane, EmptyLane, laneBackground } from "./column-lane";
import { TicketCard, type CardActivity } from "./ticket-card";
import type { TicketDraft } from "./ticket-draft";
import { TicketEditor, type EditorHandle } from "./ticket-editor";
import { CreateBoard } from "./create-board";
import type { BoardQuery } from "./board-query";
import { useBoard } from "./use-board";
import { ImplementDialog } from "./implement-dialog";
import { defaultLaunchPanel, launchForTicket, launchPanelSchema, type LaunchAttempt } from "./launch-state";
import { useAgentActivity, useValidatedAgent } from "./use-agent-activity";

function ReadyBoard({ board, props, query, drafts, active, onRefresh, notices }: {
  board: BoardSnapshot; props: PluginWorkspacePanelProps; query: BoardQuery; drafts: Map<string, TicketDraft>; active: boolean;
  onRefresh(): void; notices: ReactNode;
}) {
  const { theme, layout, tab, host } = props;
  const scope = boardQueryKey(host.id, board.boardId);
  const [saved, setSaved] = useTabState(tab, launchPanelSchema, defaultLaunchPanel);
  const view = saved.scope === scope ? saved : { ...defaultBoardView, scope, launches: saved.launches };
  const state = useRef(view);
  state.current = view;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [launchTarget, setLaunchTarget] = useState<{ ticketId: number; revision?: string; seed?: LaunchInput } | null>(null);
  const [editor, setEditor] = useState<number | "new" | null>(view.selectedTicket);
  const editorRef = useRef<EditorHandle>(null);
  // After closing, focus returns to the closed ticket's card when it is still on the board (web only; native refs cannot focus).
  // A just-created ticket's card can appear after the board refresh, so the request waits briefly for it.
  const cards = useRef(new Map<number, { focus?(): void }>());
  const returnFocus = useRef<{ id: number; until: number } | null>(null);
  const focusCard = (id: number) => {
    const card = cards.current.get(id);
    if (!card || returnFocus.current?.id !== id) return;
    if (Date.now() <= returnFocus.current.until) card.focus?.();
    returnFocus.current = null;
  };
  useEffect(() => {
    if (editor !== null) returnFocus.current = null;
    else if (returnFocus.current) {
      const { id } = returnFocus.current;
      if (cards.current.has(id)) focusCard(id);
      else if (board.tickets.some((ticket) => ticket.id === id)) returnFocus.current = null;
    }
  }, [editor]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const columns = useRef<NativeScrollView>(null);
  const lanes = useRef(new Map<string, number>());
  const [overflow, setOverflow] = useState({ x: 0, view: 0, content: 0 });
  const compact = layout.compact || (width > 0 && width < 720);
  const update = (changes: Partial<typeof view>) => {
    const next = { ...state.current, ...changes };
    setSaved(next); state.current = next;
  };
  const show = (target: number | "new" | null) => { setEditor(target); update({ selectedTicket: typeof target === "number" ? target : null }); };
  // Switching goes through the editor so a dirty draft asks Save or Discard first, exactly like Close.
  const open = (target: number | "new") => {
    if (editor === null) show(target);
    else if (editor !== target) editorRef.current?.leave({ open: target });
  };
  // Card actions for another ticket resolve the open draft first; the open ticket's own actions match the editor's buttons.
  const outside = (ticketId: number, run: () => void) => { if (editor === null || editor === ticketId) run(); else editorRef.current?.leave({ run }); };
  const writing = query.getSnapshot().write === "pending";
  const launchScope = (ticketId: number) => ({ hostId: host.id, boardId: board.boardId, projectId: board.projectId, workspaceId: props.workspaceId, ticketId });
  const attemptFor = (ticketId: number) => launchForTicket(view.launches, launchScope(ticketId));
  const persistLaunch = (attempt: LaunchAttempt) => {
    if (!mounted.current) return;
    const previous = state.current.launches;
    update({ launches: previous.some(({ input }) => input.launchId === attempt.input.launchId)
      ? previous.map((item) => item.input.launchId === attempt.input.launchId ? attempt : item)
      : [...previous, attempt] });
  };
  const validateAgent = useValidatedAgent({ hostId: host.id, boardId: board.boardId, projectId: board.projectId, workspaceId: props.workspaceId }, active);
  const [navigationError, setNavigationError] = useState("");
  const openAgent = async (link: LaunchLink) => {
    const valid = await validateAgent(link);
    if (!mounted.current) return;
    if (!valid) { setNavigationError("Agent unavailable. Its ticket, workspace or session link changed."); return; }
    try { props.navigation?.openAgent({ serverId: link.hostId, agentId: link.agentId }); setNavigationError(""); }
    catch { setNavigationError("Cannot open this conversation. Try again."); }
  };
  const tickets = filterTickets(board.tickets, view);
  const statuses = board.config.statuses.filter((status) => !view.status || status.name === view.status);
  const selectedStatus = statuses.find((status) => status.name === view.selectedStatus)?.name ?? statuses[0]?.name;
  const visibleStatuses = compact ? statuses.filter((status) => status.name === selectedStatus) : statuses;
  const visibleIds = [...new Set([
    ...(compact && editor !== null ? [] : tickets.filter((ticket) => visibleStatuses.some((status) => status.name === ticket.status)).map(({ id }) => id)),
    ...(typeof editor === "number" ? [editor] : []),
  ])].sort((a, b) => a - b);
  const knownLinks = view.launches.flatMap(({ result }) => result?.kind === "launched" || result?.kind === "recovered" ? [result] : []);
  const activity = useAgentActivity({ hostId: host.id, boardId: board.boardId, projectId: board.projectId }, visibleIds, knownLinks, active);
  const sessionsFor = (ticketId: number) => activity.sessions.filter(({ link }) => link.ticketId === ticketId);
  const choices = (values: string[]) => [{ label: "All", value: "" }, ...values.map((value) => ({ label: value, value }))];
  const filters: FilterField[] = [
    { label: "Status", icon: "CircleDashed", value: view.status, options: choices(board.config.statuses.map((status) => status.name)),
      chip: view.status ? `Status: ${view.status}` : null, onChange: (status) => update({ status }), clear: () => update({ status: "" }) },
    { label: "Priority", icon: "SignalHigh", value: view.priority, options: choices(board.config.priorities),
      chip: view.priority ? `Priority: ${view.priority}` : null, onChange: (priority) => update({ priority }), clear: () => update({ priority: "" }) },
    { label: "Assignee", icon: "User", value: view.assignee, options: [{ label: "All", value: "" }, { label: "Unassigned", value: "unassigned" },
      ...Array.from(new Set(board.tickets.flatMap((ticket) => ticket.assignee ? [ticket.assignee] : []))).sort().map((name) => ({ label: name, value: `name:${name}` }))],
      chip: view.assignee ? `Assignee: ${view.assignee === "unassigned" ? "Unassigned" : view.assignee.slice(5)}` : null,
      onChange: (assignee) => update({ assignee }), clear: () => update({ assignee: "" }) },
    { label: "Tag", icon: "Tag", value: view.tag, options: choices(Array.from(new Set(board.tickets.flatMap((ticket) => ticket.tags))).sort()),
      chip: view.tag ? `Tag: ${view.tag}` : null, onChange: (tag) => update({ tag }), clear: () => update({ tag: "" }) },
    { label: "Blocking", icon: "Ban", value: view.blocked, options: [{ label: "All", value: "all" }, { label: "Blocked", value: "blocked" }, { label: "Not blocked", value: "unblocked" }],
      chip: view.blocked !== "all" ? (view.blocked === "blocked" ? "Blocked" : "Not blocked") : null,
      onChange: (blocked) => update({ blocked: blocked as BoardView["blocked"] }), clear: () => update({ blocked: "all" }) },
  ];
  const chips = [
    ...(view.search ? [{ label: `Search: ${view.search}`, clear: () => update({ search: "" }) }] : []),
    ...filters.flatMap(({ chip, clear }) => chip ? [{ label: chip, clear }] : []),
  ];
  const reset = () => update({ ...defaultBoardView, scope, selectedStatus: view.selectedStatus });
  // Search already shows in the field, so the Filters badge counts only the bar's filters.
  const filterCount = filters.filter(({ chip }) => chip).length;
  const countIn = (name: string) => tickets.filter((ticket) => ticket.status === name).length;
  const navigate = (name: string) => { update({ selectedStatus: name }); if (!compact) columns.current?.scrollTo({ x: lanes.current.get(name) ?? 0, animated: false }); };
  const cardActivity = (sessions: Session[], primary: Session["activity"] | undefined): CardActivity =>
    activity.unavailable ? { kind: "unavailable" } : sessions.length && primary ? { kind: "sessions", primary, count: sessions.length } : { kind: "none" };
  const selectedSessions = typeof editor === "number" ? sessionsFor(editor) : [];
  const noMatches = tickets.length === 0 && board.tickets.length > 0;
  const more = { left: overflow.x > 1, right: overflow.x + overflow.view < overflow.content - 1 };
  return <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ flex: 1, gap: space.md }}>
    <BoardHeader theme={theme} name={board.config.name} shown={tickets.length} total={board.tickets.length}
      onRefresh={onRefresh} refreshDisabled={!active} onNew={() => open("new")} newDisabled={editor === "new" || !query.canWrite} />
    {notices}
    {!!navigationError && <Banner theme={theme} tone="warning" message={navigationError} />}
    <View style={{ flex: 1, flexDirection: "row", gap: space.lg }}>
    <View style={{ flex: 1, minWidth: 0, gap: space.md, display: compact && editor !== null ? "none" : "flex" }}>
    <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
      <SearchField theme={theme} value={view.search} onChange={(search) => update({ search })} />
      <Button theme={theme} icon="ListFilter" label="Filters" accessibilityLabel={filtersOpen ? "Hide filters" : "Show filters"}
        onPress={() => setFiltersOpen(!filtersOpen)} selected={filtersOpen}
        trailing={filterCount > 0 ? <Badge theme={theme} tone="accent" label={String(filterCount)} accessibilityLabel={`${filterCount} active`} /> : undefined} />
    </View>
    {filtersOpen ? <FilterBar theme={theme} fields={filters} onClear={chips.length > 0 ? reset : undefined} />
      : chips.length > 0 && <FilterChips theme={theme} chips={chips} onClear={reset} />}
    {compact && <StatusTabs theme={theme} tabs={statuses.map((status) => ({ name: status.name, count: countIn(status.name) }))}
      selected={selectedStatus} onSelect={navigate} />}
    {noMatches ? <View style={{ flex: 1, paddingTop: space.xl }}><EmptyResults theme={theme} empty={false} onClear={chips.length > 0 ? reset : undefined} /></View> : <>
    {tickets.length === 0 && <EmptyResults theme={theme} empty onClear={chips.length > 0 ? reset : undefined} />}
    <View style={{ flex: 1 }}>
    <ScrollView key={compact ? "compact" : "wide"} ref={columns} horizontal={!compact} style={{ flex: 1 }}
      onLayout={(event) => { const view = event.nativeEvent.layout.width; setOverflow((current) => ({ ...current, view })); }}
      onContentSizeChange={(content) => setOverflow((current) => ({ ...current, content }))} scrollEventThrottle={32}
      onScroll={compact ? undefined : (event) => { const x = event.nativeEvent.contentOffset.x; setOverflow((current) => ({ ...current, x })); }}
      // The bottom padding keeps the horizontal scrollbar off the lanes.
      contentContainerStyle={{ gap: 12, ...(compact ? {} : { flexGrow: 1, paddingBottom: space.md }) }}>
      {visibleStatuses.map((status) => <ColumnLane key={status.name} theme={theme} name={status.name} count={countIn(status.name)}
        wip={board.tickets.filter((ticket) => ticket.status === status.name).length} wipLimit={status.wipLimit} compact={compact}
        selected={selectedStatus === status.name} onNavigate={compact ? undefined : () => navigate(status.name)}
        onLayout={(x) => lanes.current.set(status.name, x)}>
        <ScrollView scrollEnabled={!compact} style={compact ? undefined : { flex: 1, marginRight: -space.sm }}
          // Cards stop short of the lane edge so the vertical scrollbar sits in its own gutter instead of over them.
          contentContainerStyle={{ gap: space.sm, paddingBottom: space.xs, ...(compact ? {} : { paddingRight: space.md }) }}>
          {tickets.filter((ticket) => ticket.status === status.name).map((ticket) => {
            const attempt = attemptFor(ticket.id);
            const sessions = sessionsFor(ticket.id);
            const primary = (["Needs input", "Error", "Running", "Idle", "Unavailable"] as const).find((value) => sessions.some(({ activity }) => activity === value));
            const available = sessions.find((session) => session.activity === primary && session.activity !== "Unavailable");
            return <TicketCard key={ticket.id} ticket={ticket} theme={theme} priorities={board.config.priorities}
              ref={(node) => { if (!node) { cards.current.delete(ticket.id); return; } cards.current.set(ticket.id, node as { focus?(): void }); if (editor === null) focusCard(ticket.id); }}
              activity={cardActivity(sessions, primary)}
              selected={ticket.id === editor} disabled={editor !== null && writing}
              launchDisabled={!attempt && (!active || !query.canWrite)} recovering={!!attempt}
              onImplement={props.navigation || attempt ? () => {
                if (!attempt && (!active || !query.canWrite)) return;
                const draft = drafts.get(JSON.stringify([host.id, board.boardId, ticket.id]));
                if (!attempt && draft && !draft.canLeave) { if (editor === ticket.id) editorRef.current?.leave("launch"); else open(ticket.id); return; }
                outside(ticket.id, () => setLaunchTarget({ ticketId: ticket.id }));
              } : undefined} onOpenAgent={props.navigation && available ? () => outside(ticket.id, () => void openAgent(available.link)) : undefined}
              onSelect={() => { if (!writing) open(ticket.id); }} />;
          })}
          {!tickets.some((ticket) => ticket.status === status.name) && <EmptyLane theme={theme} />}
        </ScrollView>
      </ColumnLane>)}
    </ScrollView>
    {!compact && more.left && <EdgeFade theme={theme} side="left" />}
    {!compact && more.right && <EdgeFade theme={theme} side="right" />}
    </View>
    </>}
  </View>
    {editor !== null && <View style={{ width: compact ? "100%" : 420, maxWidth: "100%", gap: space.md,
      ...(compact ? {} : { borderLeftWidth: 1, borderColor: theme.colors.border, paddingLeft: space.lg }) }}>
      <TicketEditor ref={editorRef} key={JSON.stringify([scope, editor])} ticketId={editor} board={board} props={props} drafts={drafts} query={query}
        onLaunch={props.navigation ? (ticket) => setLaunchTarget({ ticketId: ticket.id, revision: ticket.revision }) : undefined}
        onSaved={(ticket) => show(ticket.id)} onOpen={show}
        onClose={() => { returnFocus.current = typeof editor === "number" ? { id: editor, until: Date.now() + 3000 } : null; show(null); }}
        sessions={typeof editor === "number" && <SessionList theme={theme} sessions={selectedSessions} unavailable={activity.unavailable}
          onOpen={props.navigation ? (link) => void openAgent(link) : undefined}
          onInspect={attemptFor(editor) ? () => setLaunchTarget({ ticketId: editor }) : undefined} />} />
    </View>}
    {launchTarget && <ImplementDialog key={JSON.stringify([scope, launchTarget.ticketId, launchTarget.revision, launchTarget.seed?.launchId])}
      scope={{ ...launchScope(launchTarget.ticketId), revision: launchTarget.revision }}
      props={props} attempt={launchTarget.seed ? undefined : attemptFor(launchTarget.ticketId)} seed={launchTarget.seed}
      onRevise={(seed) => setLaunchTarget({ ticketId: seed.ticketId, seed })} active={active} canLaunch={() => {
        const draft = drafts.get(JSON.stringify([host.id, board.boardId, launchTarget.ticketId]));
        return active && query.canWrite && (!draft || draft.canLeave);
      }}
      onPersist={persistLaunch} onLinked={() => { if (mounted.current) void query.refresh(true); }} onClose={() => setLaunchTarget(null)} />}
    </View>
  </View>;
}

/** Linked agents for the open ticket, shown as the editor's last section. */
function SessionList({ theme, sessions, unavailable, onOpen, onInspect }: {
  theme: Theme; sessions: Session[]; unavailable: boolean; onOpen?(link: LaunchLink): void; onInspect?(): void;
}) {
  return <View style={{ gap: space.sm }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 28 }}>
      <Label theme={theme}>Implementation sessions</Label>
      <Text accessibilityLabel={`${sessions.length} session${sessions.length === 1 ? "" : "s"}`}
        style={{ color: theme.colors.foregroundMuted, fontSize: font.xs, fontVariant: ["tabular-nums"] }}>{sessions.length}</Text>
      {onInspect && <Button theme={theme} variant="ghost" size="sm" icon="RotateCcw" label="Inspect ticket launch" onPress={onInspect} style={{ marginLeft: "auto" }} />}
    </View>
    <View accessibilityLabel="Linked implementation sessions" style={{ gap: 2 }}>
      {unavailable && <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: space.xs }}>
        <Icon name="TriangleAlert" size={13} color={theme.colors.statusWarning} />
        <Text style={{ color: theme.colors.statusWarning, fontSize: font.sm }}>Agent activity unavailable</Text>
      </View>}
      {!sessions.length && <Text style={{ color: theme.colors.foregroundMuted, fontSize: font.sm }}>No linked sessions</Text>}
      {sessions.map(({ link, activity }) => <View key={link.agentId} style={{ flexDirection: "row", alignItems: "center", gap: space.sm,
        minHeight: 34, paddingLeft: space.sm, paddingRight: 2, borderRadius: radius.control, backgroundColor: theme.colors.surface1 }}>
        <ActivityDot theme={theme} activity={activity} size={7} />
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: theme.colors.foreground, fontSize: font.sm, fontFamily: "monospace" }}>{link.agentId}</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: font.xs, fontWeight: weight.medium }}>{activity}</Text>
        {onOpen && <Button theme={theme} variant="ghost" size="sm" icon="ArrowUpRight" iconOnly label={`Open agent ${link.agentId}`}
          disabled={activity === "Unavailable"} onPress={() => onOpen(link)} />}
      </View>)}
    </View>
  </View>;
}

/** Fades the board edge where more lanes are scrolled out of view. Stacked bands, since gradients are not portable. */
function EdgeFade({ theme, side }: { theme: Theme; side: "left" | "right" }) {
  const steps = [0.9, 0.7, 0.5, 0.3, 0.12];
  return <View style={{ position: "absolute", top: 0, bottom: space.md, [side]: 0, width: 28, flexDirection: side === "right" ? "row-reverse" : "row", pointerEvents: "none" }}>
    {steps.map((alpha) => <View key={alpha} style={{ flex: 1, backgroundColor: tint(theme.colors.surface0, alpha, "transparent") }} />)}
  </View>;
}

/** Placeholder lanes while the first board read is in flight. */
function BoardSkeleton({ theme, compact }: { theme: Theme; compact: boolean }) {
  return <View accessible accessibilityLabel="Loading board…" accessibilityLiveRegion="polite" style={{ flex: 1, gap: space.md }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 34 }}>
      <Skeleton theme={theme} width={180} height={20} />
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: font.sm }}>Loading board…</Text>
    </View>
    <Skeleton theme={theme} height={34} />
    <View style={{ flex: 1, flexDirection: "row", gap: 12, overflow: "hidden" }}>
      {(compact ? [3] : [3, 2, 2, 1]).map((count, lane) => <View key={lane} style={{ flex: 1, minWidth: compact ? undefined : 220, maxWidth: compact ? undefined : 340,
        gap: space.sm, padding: space.sm, borderRadius: radius.panel, backgroundColor: laneBackground(theme) }}>
        <Skeleton theme={theme} width={90} height={14} style={{ margin: 6 }} />
        {Array.from({ length: count }, (_, card) => <View key={card} style={{ gap: space.sm, padding: space.md, borderRadius: radius.card,
          borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
          <Skeleton theme={theme} width={64} height={12} />
          <Skeleton theme={theme} height={14} />
          <Skeleton theme={theme} width={140} height={14} />
        </View>)}
      </View>)}
    </View>
  </View>;
}

export function KanbanPanel(props: PluginWorkspacePanelProps) {
  const { theme, layout, host, workspaceId } = props;
  const drafts = useRef(new Map<string, TicketDraft>()).current;
  const { data, refresh, lastReady, query, stale, write, scope, active } = useBoard(host.id, workspaceId);
  const notices = <>
    {lastReady && (stale || !active) && <Banner theme={theme} tone="warning" message="Board data is stale. Your draft is retained." />}
    {(write === "uncertain" || write === "review") && <Banner theme={theme} tone="warning" title="Write outcome unknown"
      message="A write may have succeeded. Refresh and inspect the board before allowing more writes. Creation is never retried automatically."
      actions={<Button size="sm" icon="Check" label="I inspected the refreshed board" theme={theme}
        disabled={!active || stale || write !== "review"} onPress={() => query.acknowledge()} />} />}
  </>;
  const missing = data.kind === "missing";
  return <View {...pickerTouchScope} style={{ flex: 1, padding: layout.compact ? space.md : space.lg, gap: space.md, backgroundColor: theme.colors.surface0 }}>
    {lastReady ? <ReadyBoard key={JSON.stringify([scope, lastReady.boardId])} board={lastReady} props={props} query={query} drafts={drafts} active={active}
      onRefresh={refresh} notices={notices} /> : data.kind === "loading" ? <>{notices}<BoardSkeleton theme={theme} compact={layout.compact} /></> : <>
      {notices}
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl }}>
        <View style={{ width: "100%", maxWidth: 380, alignItems: "center", gap: space.md }}>
          <View style={{ width: 48, height: 48, borderRadius: radius.panel, alignItems: "center", justifyContent: "center",
            borderWidth: 1, borderColor: missing ? theme.colors.border : tint(theme.colors.statusWarning, 0.4, theme.colors.border),
            backgroundColor: missing ? theme.colors.surface1 : tint(theme.colors.statusWarning, 0.1, theme.colors.surface1) }}>
            <Icon name={missing ? "SquareKanban" : data.kind === "error" ? "TriangleAlert" : "CloudOff"} size={22}
              color={missing ? theme.colors.foregroundMuted : theme.colors.statusWarning} />
          </View>
          <View style={{ alignItems: "center", gap: space.xs }}>
            <Text accessibilityRole="header" style={{ color: theme.colors.foreground, fontSize: font.xl, fontWeight: weight.semibold, textAlign: "center" }}>
              {missing ? "No board yet" : "Cannot load board"}
            </Text>
            <Text accessibilityRole={missing ? undefined : "alert"} style={{ color: theme.colors.foregroundMuted, fontSize: font.md, lineHeight: 19, textAlign: "center" }}>
              {missing ? "Create a board for this project to start tracking tickets." : data.kind === "error" ? data.message : "The host could not be reached. Check the connection and retry."}
            </Text>
          </View>
          <CreateBoard key={scope} workspaceId={workspaceId} theme={theme} available={active && missing} query={query} onCreated={refresh} style={{ alignItems: "center" }} />
          <Button theme={theme} variant={missing ? "ghost" : "secondary"} size="sm" icon="RefreshCw" label={missing ? "Refresh" : "Retry"}
            accessibilityLabel="Refresh board" disabled={!active} onPress={refresh} />
        </View>
      </View>
    </>}
  </View>;
}
