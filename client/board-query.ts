import type { BoardReadResult, BoardSnapshot } from "../shared/board";

type Read = () => Promise<BoardReadResult>;
type BoardState = BoardReadResult | { kind: "loading" | "transport-error" };
type QueryState = {
  data: BoardState; lastReady: BoardSnapshot | null; stale: boolean;
  write: "idle" | "pending" | "uncertain" | "review"; epoch: number;
};

const queries = new Map<string, BoardQuery>();
export function getBoardQuery(key: string) {
  let query = queries.get(key);
  if (!query) { query = new BoardQuery(); queries.set(key, query); }
  return query;
}

// One board owns its polling, response generation and write gate across all panels.
export class BoardQuery {
  private state: QueryState = { data: { kind: "loading" }, lastReady: null, stale: true, write: "idle", epoch: 0 };
  private listeners = new Set<() => void>();
  private readers = new Set<Read>();
  private request: Promise<BoardReadResult | undefined> | null = null;
  private readOwner: Read | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      this.releaseUnused();
    };
  };
  private releaseUnused() {
    queueMicrotask(() => {
      if (this.listeners.size || this.readers.size || this.state.write !== "idle") return;
      for (const [key, query] of queries) if (query === this) queries.delete(key);
    });
  }
  private publish(changes: Partial<QueryState>) {
    this.state = { ...this.state, ...changes };
    for (const listener of this.listeners) listener();
  }
  seed(data: Exclude<BoardReadResult, { kind: "error" }>) {
    if (this.state.data.kind !== "loading") return;
    this.publish({ data, lastReady: data.kind === "ready" ? data : null, stale: false });
  }
  private invalidate() {
    this.request = null;
    this.publish({ stale: true, epoch: this.state.epoch + 1 });
  }
  activate(read: Read) {
    this.readers.add(read);
    if (this.readers.size === 1) {
      if (this.state.stale) void this.refresh();
      this.timer = setInterval(() => void this.refresh(), 5000);
    }
    return () => {
      this.readers.delete(read);
      if (this.readOwner === read && this.readers.size) { this.invalidate(); void this.refresh(); }
      if (!this.readers.size) {
        clearInterval(this.timer);
        this.invalidate();
        this.releaseUnused();
      }
    };
  }
  refresh = (fresh = false, read = this.readers.values().next().value): Promise<BoardReadResult | undefined> => {
    if (!read || this.state.write === "pending") return Promise.resolve(undefined);
    if (fresh) this.invalidate();
    if (this.request) return this.request;
    this.readOwner = read;
    const epoch = this.state.epoch;
    const request = Promise.resolve().then(read).then((data) => {
      if (epoch !== this.state.epoch) return undefined;
      const ready = data.kind === "ready" || (data.kind === "missing" && !this.state.lastReady);
      this.publish({ data, stale: !ready,
        lastReady: data.kind === "ready" ? data : this.state.lastReady,
        write: ready && this.state.write === "uncertain" ? "review" : this.state.write });
      return data;
    }).catch(() => {
      if (epoch === this.state.epoch) this.publish({ data: { kind: "transport-error" }, stale: true });
      return undefined;
    }).finally(() => { if (this.request === request) { this.request = null; this.readOwner = undefined; } });
    this.request = request;
    return request;
  };
  get canWrite() { return !this.state.stale && this.state.write === "idle"; }
  beginWrite() {
    if (!this.canWrite) return false;
    this.invalidate();
    this.publish({ write: "pending" });
    return true;
  }
  endWrite(uncertain: boolean) {
    this.invalidate();
    this.publish({ write: uncertain ? "uncertain" : "idle" });
    void this.refresh();
    this.releaseUnused();
  }
  acknowledge() {
    if (this.state.write === "review" && !this.state.stale) this.publish({ write: "idle" });
  }
}
