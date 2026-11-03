import { PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DESCRIPTION_LIMIT, discoverBoards, matchTickets, RESULT_LIMIT, searchTickets } from "../server/attachments";
import type { BoardLookup } from "../server/board";
import { ticketSearch } from "../shared/attachments";

let root: string;
let paseo: Pick<BoardLookup, "projects">;
const kanbanBinary = execFileSync("sh", ["-c", "command -v kanban-md"], { encoding: "utf8" }).trim();

function projects(entries: [name: string, path: string][]): Pick<BoardLookup, "projects"> {
  return { projects: { list: async () => ({ requestId: "test", projects: entries.map(([name, projectRootPath], index) => ({
    projectId: `p${index}`, projectDisplayName: name, projectKind: "git", projectRootPath,
  })) }) } };
}

function cli(board: string, ...args: string[]) {
  return execFileSync("kanban-md", ["--dir", board, "--json", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

async function project(name: string, tickets: string[][] = []) {
  const directory = join(root, name);
  await mkdir(directory);
  if (tickets.length) {
    cli(join(directory, "kanban"), "init", `--name=${name}`);
    for (const args of tickets) cli(join(directory, "kanban"), "create", ...args);
  }
  return directory;
}

async function search(query: string) {
  return ticketSearch.output.parse(await searchTickets({ query }, { paseo }));
}

beforeAll(() => {
  expect(execFileSync("kanban-md", ["--version"], { encoding: "utf8" })).toMatch(/0\.39\./);
});
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "kanban-attach-")));
  const design = await project("design-project", [
    ["Drag cards between columns", "--priority=high", "--tags=ui,dnd"],
    ["Polish toolbar", "--body=Toolbar body"],
    ["Version 2 colours"],
  ]);
  cli(join(design, "kanban"), "move", "2", "done");
  const other = await project("other-app", [["Fix login"], ["Drag handles"]]);
  const invalid = await project("invalid-board");
  await mkdir(join(invalid, "kanban"));
  await project("no-board");
  await symlink(design, join(root, "design-alias"));
  paseo = projects([
    ["design-project", design], ["other-app", other], ["invalid-board", invalid], ["no-board", join(root, "no-board")],
    ["design-alias", join(root, "design-alias")], ["relative", "relative/path"], ["gone", join(root, "gone")],
  ]);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("board discovery", () => {
  it("finds each canonical board once and skips missing, invalid and unavailable projects without creating boards", async () => {
    const boards = await discoverBoards(paseo);
    expect(boards.map(({ projectName, directory }) => [projectName, directory])).toEqual([
      ["design-project", join(root, "design-project", "kanban")],
      ["other-app", join(root, "other-app", "kanban")],
    ]);
    await expect(realpath(join(root, "no-board", "kanban"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await discoverBoards({ projects: { list: async () => { throw new Error("offline"); } } })).toEqual([]);
  });
});

describe("ticket search", () => {
  it("returns open tickets across projects, most recently updated first, for an empty query", async () => {
    cli(join(root, "design-project", "kanban"), "edit", "1", "--assignee=Ada");
    const { items } = await search("  ");
    expect(items.map(({ subtitle, identifier }) => `${subtitle?.split(" · ")[0]} ${identifier}`)).toEqual([
      "design-project #1", "other-app #2", "other-app #1", "design-project #3",
    ]);
  });

  it("matches IDs, title words and project names case-insensitively and ranks exact IDs first", async () => {
    const ids = async (query: string) => (await search(query)).items.map(({ subtitle, identifier }) => `${subtitle?.split(" · ")[0]} ${identifier}`);
    expect(await ids("2")).toEqual(["other-app #2", "design-project #2", "design-project #3"]);
    expect(await ids("#2")).toEqual(["other-app #2", "design-project #2"]);
    expect(await ids("design #2")).toEqual(["design-project #2"]);
    expect(await ids("DRAG")).toEqual(["other-app #2", "design-project #1"]);
    expect(await ids("design drag")).toEqual(["design-project #1"]);
    expect(await ids("other")).toEqual(["other-app #2", "other-app #1"]);
    expect(await ids("drag missing-word")).toEqual([]);
  });

  it("keeps every server match through the app's own client-side filter", async () => {
    // Paseo 0.13.2/0.14.0 Combobox: each token must match `${identifier} ${title}` or the item ID, else every token
    // must match the subtitle. Substring checks are stricter than the app, which also accepts in-word subsequences.
    const survives = (query: string, { id, identifier, title, subtitle = "" }: { id: string; identifier: string; title: string; subtitle?: string }) => {
      const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const label = `${identifier} ${title}`.toLowerCase();
      return tokens.every((token) => label.includes(token) || id.toLowerCase().includes(token))
        || tokens.every((token) => subtitle.toLowerCase().includes(token));
    };
    for (const query of ["2", "#2", "design #2", "Design drag", "other", "other-app fix", "app #1", "colours"]) {
      const { items } = await search(query);
      expect(items.length, query).toBeGreaterThan(0);
      for (const item of items) expect(survives(query, item), `${query}: ${item.id}`).toBe(true);
    }
  });

  it("caps results", () => {
    const board = { projectName: "p", boardId: "/b", directory: "/b" } as never;
    const candidates = Array.from({ length: RESULT_LIMIT + 5 }, (_, index) => ({
      board, file: null, description: "", completed: false, updated: new Date(index * 1000).toISOString(),
      ticket: { id: index + 1, title: "Same title", status: "todo", priority: "low", assignee: null, tags: [], due: null, blocked: false, blockReason: null, dependsOn: [], claim: null },
    }));
    expect(matchTickets(candidates, "")).toHaveLength(RESULT_LIMIT);
    expect(matchTickets(candidates, "same")).toHaveLength(RESULT_LIMIT);
    expect(matchTickets(candidates, "")[0]!.ticket.id).toBe(RESULT_LIMIT + 5);
  });

  it("maps valid attachment items with stable unique IDs and ticket file URLs", async () => {
    const { items } = await search("");
    expect(PluginAttachmentSearchPayloadSchema.parse({ items })).toEqual({ items });
    expect(new Set(items.map(({ id }) => id)).size).toBe(items.length);
    expect((await search("")).items.map(({ id }) => id)).toEqual(items.map(({ id }) => id));
    const drag = items.find(({ title }) => title === "Drag cards between columns")!;
    expect(drag).toMatchObject({ identifier: "#1", subtitle: "design-project · backlog · high", resourceType: "kanban-ticket" });
    expect(fileURLToPath(drag.url)).toBe(join(root, "design-project", "kanban", "tasks", "001-drag-cards-between-columns.md"));
  });

  it("snapshots metadata, the canonical board and the live command, and truncates long descriptions", async () => {
    const board = join(root, "design-project", "kanban");
    cli(board, "edit", "3", `--body=${"x".repeat(DESCRIPTION_LIMIT + 50)}`, "--block=Waiting on review", "--add-dep=1", "--claim=owl");
    const item = (await search("#3")).items[0]!;
    expect(item.subtitle).toBe("design-project · backlog · medium · blocked");
    expect(item.text).toMatch(/^# #3 Version 2 colours\n/);
    for (const line of [
      "- Project: design-project", `- Board: ${board}`, "- Status: backlog", "- Priority: medium",
      "- Assignee: none", "- Tags: none", "- Blocked: yes (Waiting on review)", "- Dependencies: #1",
      `run \`kanban-md --dir ${board} show 3\``,
      `[Description truncated: showing ${DESCRIPTION_LIMIT} of ${DESCRIPTION_LIMIT + 50} characters.`,
    ]) expect(item.text).toContain(line);
    expect(item.text).toMatch(/- Claim: owl since \S+/);
    expect(item.text).not.toContain("x".repeat(DESCRIPTION_LIMIT + 1));
    const tagged = (await search("drag cards")).items[0]!;
    expect(tagged.text).toContain("- Tags: ui, dnd");
    expect(tagged.text).toContain("(No description.)");
    expect(tagged.text).not.toContain(join(root, "other-app"));
  });

  it("returns an empty list when kanban-md is missing and skips a board that stalls", async () => {
    vi.stubEnv("PATH", join(root, "no-board"));
    expect(await search("")).toEqual({ items: [] });
    const bin = join(root, "bin");
    await mkdir(bin);
    // Stall only the design board; delegate everything else to the real CLI.
    await writeFile(join(bin, "kanban-md"), `#!${process.execPath}
if (process.argv.some((arg) => arg.includes("design-project"))) setTimeout(() => {}, 20000);
else process.exitCode = require("node:child_process").spawnSync(${JSON.stringify(kanbanBinary)}, process.argv.slice(2), { stdio: "inherit" }).status;
`, { mode: 0o755 });
    vi.stubEnv("PATH", bin);
    const started = Date.now();
    expect((await search("")).items.map(({ subtitle }) => subtitle?.split(" · ")[0])).toEqual(["other-app", "other-app"]);
    expect(Date.now() - started).toBeLessThan(6000);
  }, 15_000);
});
