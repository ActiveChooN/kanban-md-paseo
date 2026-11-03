import type { PluginAttachmentItem, PluginAttachmentSearchPayload, RpcInput } from "@getpaseo/plugin";
import { createHash } from "node:crypto";
import { isAbsolute, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ticketSearch } from "../shared/attachments";
import { resolveProjectBoard, type BoardLookup, type ResolvedBoard } from "./board";
import { runKanban } from "./cli";
import { cliTicket, summary } from "./reads";

export const RESULT_LIMIT = 20;
export const DESCRIPTION_LIMIT = 12_000;
const BOARD_CONCURRENCY = 4;
const BOARD_TIMEOUT_MS = 3_000;
const QUERY_LIMIT = 200;

type ProjectSource = Pick<BoardLookup, "projects">;
type Candidate = {
  board: ResolvedBoard;
  ticket: ReturnType<typeof summary>;
  updated: string;
  description: string;
  completed: boolean;
  file: string | null;
};
// `list` also reports the task file and a completion timestamp, which kanban-md clears when a ticket reopens.
const listExtras = z.object({ completed: z.string().optional(), file: z.string().optional() });

/**
 * Paseo passes only the query, so search every project's canonical board on this host.
 * Missing, invalid and unreadable boards are skipped; nothing is created.
 */
export async function discoverBoards(paseo: ProjectSource): Promise<ResolvedBoard[]> {
  let projects: Awaited<ReturnType<ProjectSource["projects"]["list"]>>["projects"];
  try {
    ({ projects } = await paseo.projects.list());
  } catch {
    return [];
  }
  const resolved = await Promise.all(projects.map((project) => resolveProjectBoard(project).catch(() => null)));
  const boards = new Map<string, ResolvedBoard>();
  for (const board of resolved) {
    if (board?.kind === "present" && !boards.has(board.boardId)) boards.set(board.boardId, board);
  }
  return [...boards.values()];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function mapLimit<T, R>(values: T[], limit: number, map: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await map(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

async function boardTickets(board: ResolvedBoard): Promise<Candidate[]> {
  try {
    // The CLI's own 10 s limit still applies; this only stops one slow board from stalling the picker.
    const tasks = await withTimeout(runKanban({ board, operation: { kind: "list" }, output: z.array(cliTicket) }), BOARD_TIMEOUT_MS);
    return tasks.map((task) => {
      const extras = listExtras.safeParse(task);
      return {
        board, ticket: summary(task), updated: task.updated, description: task.body ?? "",
        completed: Boolean(extras.success && extras.data.completed),
        file: extras.success ? extras.data.file ?? null : null,
      };
    });
  } catch {
    return [];
  }
}

type Token = { text: string; id: number | null; idOnly: boolean };

export function parseQuery(query: string): Token[] {
  return query.toLowerCase().split(/\s+/).flatMap((raw): Token[] => {
    const id = /^(#?)(\d+)$/.exec(raw);
    if (id) return [{ text: id[2]!, id: Number(id[2]), idOnly: id[1] === "#" }];
    const text = raw.replace(/^#+/, "");
    return text ? [{ text, id: null, idOnly: false }] : [];
  });
}

/** Every token must match the ticket ID, its title or its project name. Null means no match. */
function score({ board, ticket }: Candidate, tokens: Token[]): number | null {
  const title = ticket.title.toLowerCase();
  const project = board.projectName.toLowerCase();
  let total = 0;
  for (const token of tokens) {
    if (token.id === ticket.id) total += 1000;
    else if (token.idOnly) return null;
    else if (title.includes(token.text)) total += 10;
    else if (project.includes(token.text)) total += 1;
    else return null;
  }
  return total;
}

function byRecent(a: Candidate, b: Candidate) {
  return Number(a.completed) - Number(b.completed)
    || Date.parse(b.updated) - Date.parse(a.updated)
    || a.board.projectName.localeCompare(b.board.projectName)
    || a.ticket.id - b.ticket.id;
}

export function matchTickets(candidates: Candidate[], query: string): Candidate[] {
  const tokens = parseQuery(query);
  if (!tokens.length) return candidates.filter(({ completed }) => !completed).sort(byRecent).slice(0, RESULT_LIMIT);
  return candidates
    .flatMap((candidate) => {
      const value = score(candidate, tokens);
      return value === null ? [] : [{ candidate, value }];
    })
    .sort((a, b) => b.value - a.value || byRecent(a.candidate, b.candidate))
    .slice(0, RESULT_LIMIT)
    .map(({ candidate }) => candidate);
}

function shellQuote(value: string) {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

// Link the ticket file only when kanban-md reports it inside the canonical board; otherwise link the board.
function ticketUrl({ board, file }: Candidate) {
  if (file && isAbsolute(file)) {
    const path = relative(board.directory, file);
    if (path && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path)) return pathToFileURL(file).href;
  }
  return pathToFileURL(board.directory).href;
}

export function ticketSnapshot({ board, ticket, updated, description }: Candidate) {
  const none = "none";
  const live = `kanban-md --dir ${shellQuote(board.directory)} show ${ticket.id}`;
  const lines = [
    `# #${ticket.id} ${ticket.title}`,
    "",
    `- Project: ${board.projectName}`,
    `- Board: ${board.directory}`,
    `- Status: ${ticket.status}`,
    `- Priority: ${ticket.priority}`,
    `- Assignee: ${ticket.assignee ?? none}`,
    `- Tags: ${ticket.tags.length ? ticket.tags.join(", ") : none}`,
    `- Due: ${ticket.due ?? none}`,
    `- Blocked: ${ticket.blocked ? `yes${ticket.blockReason ? ` (${ticket.blockReason})` : ""}` : "no"}`,
    `- Dependencies: ${ticket.dependsOn.length ? ticket.dependsOn.map((id) => `#${id}`).join(", ") : none}`,
    `- Claim: ${ticket.claim ? `${ticket.claim.name} since ${ticket.claim.claimedAt}` : none}`,
    `- Updated: ${updated}`,
    "",
    `This is a snapshot of ticket #${ticket.id} from the canonical kanban-md board at ${board.directory}. `
      + `For the live version, run \`${live}\`. Use that board for any ticket changes and follow its claim rules.`,
    "",
    "## Description",
    "",
  ];
  const body = description.trim();
  if (!body) lines.push("(No description.)");
  else if (body.length <= DESCRIPTION_LIMIT) lines.push(body);
  else {
    lines.push(body.slice(0, DESCRIPTION_LIMIT), "",
      `[Description truncated: showing ${DESCRIPTION_LIMIT} of ${body.length} characters. Run \`${live}\` for the full text.]`);
  }
  return lines.join("\n");
}

/**
 * The app filters and re-ranks results again on the client (Paseo 0.13.2 and 0.14.0): every query token must match
 * `"<identifier> <title>"` or the item ID, or else every token must match the subtitle. The project name therefore
 * goes in the hidden ID so that "design #12" survives that filter; the board hash keeps the ID unique and stable.
 */
export function attachmentItem(candidate: Candidate): PluginAttachmentItem {
  const { board, ticket } = candidate;
  const boardHash = createHash("sha256").update(board.boardId).digest("hex").slice(0, 16);
  const project = board.projectName.toLowerCase().replace(/\s+/g, "-");
  return {
    id: `kanban:${project}:${boardHash}:${ticket.id}`,
    identifier: `#${ticket.id}`,
    title: ticket.title,
    subtitle: [board.projectName, ticket.status, ticket.priority, ...(ticket.blocked ? ["blocked"] : [])].join(" · "),
    url: ticketUrl(candidate),
    text: ticketSnapshot(candidate),
    resourceType: "kanban-ticket",
  };
}

// Like the other handlers, never throw. The payload has no error variant, so failures mean fewer or no results.
export async function searchTickets(input: RpcInput<typeof ticketSearch>, { paseo }: { paseo: ProjectSource }): Promise<PluginAttachmentSearchPayload> {
  try {
    const parsed = ticketSearch.input.safeParse(input);
    const query = parsed.success ? parsed.data.query.slice(0, QUERY_LIMIT) : "";
    const boards = await discoverBoards(paseo);
    const candidates = (await mapLimit(boards, BOARD_CONCURRENCY, boardTickets)).flat();
    return { items: matchTickets(candidates, query).map(attachmentItem) };
  } catch {
    return { items: [] };
  }
}
