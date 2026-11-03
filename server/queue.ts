import { resolveBoard, type BoardLookup, type ResolvedBoard } from "./board";
import { BoardError } from "./errors";

type QueueState = { uncertain: boolean };
const queues = new Map<string, QueueState & { tail: Promise<void> }>();

// One queue per physical board, shared by all workspaces and RPC handlers.
export async function withBoard<T>({ paseo, workspaceId }: {
  paseo: BoardLookup;
  workspaceId: string;
}, operation: (context: { board: ResolvedBoard; state: QueueState }) => Promise<T>): Promise<T> {
  const identity = await resolveBoard({ paseo, workspaceId });
  let queue = queues.get(identity.boardId);
  if (!queue) {
    queue = { tail: Promise.resolve(), uncertain: false };
    queues.set(identity.boardId, queue);
  }
  const state = queue;
  const result = state.tail.then(async () => {
    const board = await resolveBoard({ paseo, workspaceId });
    if (board.boardId !== identity.boardId) throw new BoardError("board_unavailable");
    return operation({ board, state });
  });
  const tail = result.then(() => {}, () => {});
  state.tail = tail;
  void tail.then(() => {
    if (state.tail === tail && !state.uncertain) queues.delete(identity.boardId);
  });
  return result;
}
