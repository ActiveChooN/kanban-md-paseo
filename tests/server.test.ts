import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resolveBoard, type BoardLookup, type ResolvedBoard } from "../server/board";
import { readBoard, readTicket } from "../server/reads";
import { runKanban } from "../server/cli";
import { createBoard, createTicket, moveTicket, updateTicket } from "../server/mutations";
import { ticketDetailSchema } from "../shared/ticket";

let root: string;
let paseo: BoardLookup;
const taskSchema = z.object({ id: z.number(), title: z.string(), status: z.string(), body: z.string().optional(), tags: z.array(z.string()).optional() });
const initSchema = z.object({ status: z.literal("initialized"), name: z.string() });

function sdk(projects: { projectId: string; projectRootPath: string }[], workspaceProjects: Record<string, string>): BoardLookup {
  return {
    projects: { list: async () => ({ requestId: "test", projects: projects.map((project) => ({
      ...project, projectDisplayName: "--Project 'quoted' 雪", projectKind: "git",
    })) }) },
    workspaces: { ref: (id) => ({ refresh: async () => {
      const projectId = workspaceProjects[id];
      if (!projectId) return null;
      return {
        id, projectId, projectDisplayName: "stale name", projectRootPath: "/wrong-root",
        workspaceDirectory: `/unavailable/worktrees/${id}`, projectKind: "git", workspaceKind: "worktree",
        name: id, archivingAt: null, status: "done", statusEnteredAt: null, activityAt: null, scripts: [],
      };
    } }) },
  };
}

async function board() { return resolveBoard({ paseo, workspaceId: "one" }); }

async function initialize(): Promise<ResolvedBoard> {
  const missing = await board();
  const result = await runKanban({ board: missing, operation: { kind: "init" }, output: initSchema });
  expect(result.name).toBe("--Project 'quoted' 雪");
  return board();
}

async function executable(script: string) {
  const bin = join(root, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "kanban-md"), `#!${process.execPath}\n${script}`, { mode: 0o755 });
  vi.stubEnv("PATH", bin);
}

beforeAll(() => {
  expect(execFileSync("kanban-md", ["--version"], { encoding: "utf8" })).toMatch(/0\.39\./);
});
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kanban-paseo-"));
  paseo = sdk([{ projectId: "project", projectRootPath: root }], { one: "project", two: "project" });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("canonical project board", () => {
  it("shares identity across sibling worktrees, isolates projects, and keeps identity after creation", async () => {
    const missing = await board();
    expect(missing).toMatchObject({ kind: "missing", directory: join(root, "kanban") });
    expect(await resolveBoard({ paseo, workspaceId: "two" })).toEqual(missing);
    const ready = await initialize();
    expect(ready.boardId).toBe(missing.boardId);
    const otherRoot = join(root, "other");
    await mkdir(otherRoot);
    const other = await resolveBoard({ paseo: sdk([{ projectId: "other", projectRootPath: otherRoot }], { one: "other" }), workspaceId: "one" });
    expect(other.boardId).not.toBe(ready.boardId);
  });

  it("resolves root and board symlinks to the same queue identity", async () => {
    const original = await initialize();
    const alias = join(root, "alias");
    await symlink(root, alias);
    const viaRoot = await resolveBoard({ paseo: sdk([{ projectId: "alias", projectRootPath: alias }], { one: "alias" }), workspaceId: "one" });
    expect(viaRoot.boardId).toBe(original.boardId);
    const otherRoot = join(root, "other");
    await mkdir(otherRoot);
    await symlink(original.directory, join(otherRoot, "kanban"));
    const viaBoard = await resolveBoard({ paseo: sdk([{ projectId: "other", projectRootPath: otherRoot }], { one: "other" }), workspaceId: "one" });
    expect(viaBoard.boardId).toBe(original.boardId);
  });

  it("rejects missing SDK identities and relative, absent, or non-directory project roots", async () => {
    await expect(resolveBoard({ paseo, workspaceId: "unknown" })).rejects.toMatchObject({ code: "workspace_unavailable" });
    await expect(resolveBoard({ paseo: sdk([], { one: "gone" }), workspaceId: "one" })).rejects.toMatchObject({ code: "workspace_unavailable" });
    const file = join(root, "file");
    await writeFile(file, "x");
    for (const path of ["relative", join(root, "absent"), file]) {
      await expect(resolveBoard({ paseo: sdk([{ projectId: "p", projectRootPath: path }], { one: "p" }), workspaceId: "one" })).rejects.toMatchObject({ code: "root_unavailable" });
    }
  });

  it("never treats incomplete boards or dangling symlinks as permission to initialize", async () => {
    const directory = join(root, "kanban");
    await mkdir(directory);
    await expect(board()).rejects.toMatchObject({ code: "invalid_configuration" });
    await rm(directory, { recursive: true });
    await symlink(join(root, "absent"), directory);
    await expect(board()).rejects.toMatchObject({ code: "board_unavailable" });
  });
});

describe("real kanban-md 0.39.x", () => {
  it("round-trips literal quotes, Unicode, leading dashes, metacharacters, and CSV tags", async () => {
    const resolved = await initialize();
    const marker = join(root, "must-not-exist");
    const literal = `--title='quotes' 雪 \"double\" $(touch ${marker}); \`touch ${marker}\` & | > <`;
    const tags = ["--leading", 'a,"quoted"', "雪", "$(literal)"];
    const created = await runKanban({ board: resolved, operation: { kind: "create", fields: { title: literal, description: literal, tags } }, output: taskSchema });
    expect(created).toMatchObject({ title: literal, body: literal, tags });
    const edited = `${literal}\nsecond line`;
    await runKanban({ board: resolved, operation: { kind: "edit", ticketId: created.id, fields: { description: edited, title: `--edited ${literal}`, removeTags: ['a,"quoted"'], addTags: ['new,"tag"'] } }, output: taskSchema });
    const shown = await runKanban({ board: resolved, operation: { kind: "show", ticketId: created.id }, output: taskSchema });
    expect(shown.title).toBe(`--edited ${literal}`);
    expect(shown.body).toBe(`${edited}\n`);
    expect(shown.tags).toEqual(["--leading", "雪", "$(literal)", 'new,"tag"']);
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    const configPath = join(resolved.directory, "config.yml");
    await writeFile(configPath, (await readFile(configPath, "utf8")).replace("- name: todo", "- name: --custom"));
    expect(await runKanban({ board: resolved, operation: { kind: "move", ticketId: created.id, status: "--custom" }, output: taskSchema })).toMatchObject({ status: "--custom" });
    expect(await runKanban({ board: resolved, operation: { kind: "list" }, output: z.array(taskSchema) })).toHaveLength(1);
  });

  it("distinguishes missing boards, malformed configuration, and safe CLI rejections", async () => {
    await expect(runKanban({ board: await board(), operation: { kind: "list" }, output: z.array(taskSchema) })).rejects.toMatchObject({ code: "board_missing" });
    const resolved = await initialize();
    await expect(runKanban({ board: resolved, operation: { kind: "create", fields: { title: "one", priority: "invalid" } }, output: taskSchema })).rejects.toMatchObject({ code: "cli_rejected", cliCode: "INVALID_PRIORITY" });
    await runKanban({ board: resolved, operation: { kind: "create", fields: { title: "one" } }, output: taskSchema });
    await expect(runKanban({ board: resolved, operation: { kind: "move", ticketId: 1, status: "in-progress" }, output: taskSchema })).rejects.toMatchObject({ code: "cli_rejected", cliCode: "CLAIM_REQUIRED" });
    execFileSync("kanban-md", ["--dir", resolved.directory, "--json", "edit", "1", "--claim=someone"]);
    await expect(runKanban({ board: resolved, operation: { kind: "edit", ticketId: 1, fields: { title: "no" } }, output: taskSchema })).rejects.toMatchObject({ code: "cli_rejected", cliCode: "TASK_CLAIMED" });
    await writeFile(join(resolved.directory, "config.yml"), "broken: [");
    await expect(runKanban({ board: resolved, operation: { kind: "config" }, output: z.object({}) })).rejects.toMatchObject({ code: "invalid_configuration" });
  });

  it("preserves WIP rejection and detects a board removed after resolution", async () => {
    const resolved = await initialize();
    const config = join(resolved.directory, "config.yml");
    await writeFile(config, `${await readFile(config, "utf8")}\nwip_limits:\n    todo: 1\n`);
    for (const title of ["one", "two"]) {
      await runKanban({ board: resolved, operation: { kind: "create", fields: { title } }, output: taskSchema });
    }
    await runKanban({ board: resolved, operation: { kind: "move", ticketId: 1, status: "todo" }, output: taskSchema });
    await expect(runKanban({ board: resolved, operation: { kind: "move", ticketId: 2, status: "todo" }, output: taskSchema })).rejects.toMatchObject({ code: "cli_rejected", cliCode: "WIP_LIMIT_EXCEEDED" });
    await rm(resolved.directory, { recursive: true });
    await expect(runKanban({ board: resolved, operation: { kind: "list" }, output: z.array(taskSchema) })).rejects.toMatchObject({ code: "board_missing" });
  });
});

describe("process boundary", () => {
  it("rejects runtime commands, paths, unknown flags, and NUL before spawning", async () => {
    const resolved = await initialize();
    vi.stubEnv("PATH", root);
    for (const operation of [
      { kind: "delete", ticketId: 1 },
      { kind: "list", path: "/arbitrary" },
      { kind: "create", fields: { title: "one", command: "injected" } },
      { kind: "create", fields: { title: "one", description: "secret\0body" } },
    ]) {
      await expect(Reflect.apply(runKanban, undefined, [{ board: resolved, operation, output: taskSchema }])).rejects.toMatchObject({ code: "invalid_input" });
    }
  });

  it("closes stdin and uses absolute board arguments", async () => {
    const resolved = await initialize();
    await executable('process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(JSON.stringify(process.argv.slice(2))));');
    expect(await runKanban({ board: resolved, operation: { kind: "config" }, output: z.array(z.string()) })).toEqual(["--dir", resolved.directory, "--json", "config"]);
  });

  it("distinguishes an absent executable, launch failure, and removed root", async () => {
    const resolved = await initialize();
    vi.stubEnv("PATH", root);
    await expect(runKanban({ board: resolved, operation: { kind: "create", fields: { title: "private body" } }, output: taskSchema })).rejects.toMatchObject({ code: "executable_missing" });
    await writeFile(join(root, "kanban-md"), "not executable", { mode: 0o644 });
    await expect(runKanban({ board: resolved, operation: { kind: "list" }, output: z.array(taskSchema) })).rejects.toMatchObject({ code: "process_failed" });
    await rm(root, { recursive: true });
    await expect(runKanban({ board: resolved, operation: { kind: "list" }, output: z.array(taskSchema) })).rejects.toMatchObject({ code: "root_unavailable" });
  });

  it("rejects invalid JSON and wrong output shapes without exposing output", async () => {
    const resolved = await initialize();
    for (const value of ["private body", '{"body":"private body"}']) {
      await executable(`process.stdout.write(${JSON.stringify(value)});`);
      const error = await runKanban({ board: resolved, operation: { kind: "show", ticketId: 1 }, output: taskSchema }).catch((error: unknown) => error);
      expect(error).toMatchObject({ code: "invalid_output" });
      expect(String(error)).not.toContain("private body");
      expect(JSON.stringify(error)).not.toContain("private body");
    }
  });

  it("treats lost write responses and unknown CLI failures as uncertain and never retries", async () => {
    const resolved = await initialize();
    const marker = join(root, "writes");
    for (const response of ['process.stdout.write("private body");', 'process.stdout.write(JSON.stringify({code:"INTERNAL_ERROR",error:"private body"})); process.exitCode=2;']) {
      await executable(`require("node:fs").appendFileSync(${JSON.stringify(marker)}, "x"); ${response}`);
      const error = await runKanban({ board: resolved, operation: { kind: "create", fields: { title: "private body" } }, output: taskSchema }).catch((error: unknown) => error);
      expect(error).toMatchObject({ code: "write_uncertain" });
      expect(String(error) + JSON.stringify(error)).not.toContain("private body");
    }
    expect(await readFile(marker, "utf8")).toBe("xx");
  });

  it("classifies a crashed process without exposing stderr", async () => {
    const resolved = await initialize();
    await executable('process.stderr.write("private body"); process.kill(process.pid, "SIGKILL");');
    await expect(runKanban({ board: resolved, operation: { kind: "list" }, output: z.array(taskSchema) })).rejects.toMatchObject({ code: "process_failed" });
    const error = await runKanban({ board: resolved, operation: { kind: "create", fields: { title: "one" } }, output: taskSchema }).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "write_uncertain", reason: "process_failed" });
    expect(String(error) + JSON.stringify(error)).not.toContain("private body");
  });

  it.each(["stdout", "stderr"])("bounds %s for reads and writes", async (stream) => {
    const resolved = await initialize();
    await executable(`process.${stream}.write("x".repeat(5 * 1024 * 1024));`);
    await expect(runKanban({ board: resolved, operation: { kind: "list" }, output: z.array(taskSchema) })).rejects.toMatchObject({ code: "output_limit" });
    await expect(runKanban({ board: resolved, operation: { kind: "create", fields: { title: "one" } }, output: taskSchema })).rejects.toMatchObject({ code: "write_uncertain", reason: "output_limit" });
  });

  it("kills timed-out reads and writes even if the executable ignores SIGTERM", async () => {
    const resolved = await initialize();
    await executable('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);');
    await Promise.all([
      expect(runKanban({ board: resolved, operation: { kind: "list" }, output: z.array(taskSchema) })).rejects.toMatchObject({ code: "timeout" }),
      expect(runKanban({ board: resolved, operation: { kind: "create", fields: { title: "one" } }, output: taskSchema })).rejects.toMatchObject({ code: "write_uncertain", reason: "timeout" }),
    ]);
  }, 15_000);
});


describe("read RPCs", () => {
  const input = { workspaceId: "one" };
  it("returns missing state and shares canonical identity across worktrees", async () => {
    const missing = await readBoard(input, { paseo });
    expect(missing).toMatchObject({ kind: "missing", boardId: join(root, "kanban"), projectId: "project" });
    await initialize();
    const ready = await readBoard(input, { paseo });
    expect(ready).toMatchObject({ kind: "ready", tickets: [], boardId: join(root, "kanban") });
    expect(await readBoard({ workspaceId: "two" }, { paseo })).toEqual(ready);
  });

  it("preserves custom workflows, WIP limits and claim requirements", async () => {
    const resolved = await initialize();
    const configPath = join(resolved.directory, "config.yml");
    const config = (await readFile(configPath, "utf8"))
      .replaceAll("backlog", "intake").replaceAll("in-progress", "building")
      .replaceAll("medium", "normal").replaceAll("critical", "urgent");
    await writeFile(configPath, `${config}\nwip_limits:\n    building: 3\n`);
    const result = await readBoard(input, { paseo });
    expect(result).toMatchObject({ kind: "ready", config: {
      defaults: { status: "intake", priority: "normal" }, priorities: ["low", "normal", "high", "urgent"],
      statuses: expect.arrayContaining([
        { name: "building", requireClaim: true, wipLimit: 3 },
        { name: "intake", requireClaim: false, wipLimit: null },
      ]),
    } });
  });

  it("separates summary and body, normalizes absent fields, and returns a stable revision", async () => {
    const resolved = await initialize();
    await runKanban({ board: resolved, operation: { kind: "create", fields: { title: "one", description: "# Private body" } }, output: taskSchema });
    const result = await readBoard(input, { paseo });
    expect(result).toMatchObject({ kind: "ready", tickets: [{ id: 1, assignee: null, tags: [], due: null, blocked: false, blockReason: null, dependsOn: [], claim: null }] });
    expect(JSON.stringify(result)).not.toContain("Private body");
    const detail = await readTicket({ ...input, ticketId: 1 }, { paseo });
    expect(detail).toMatchObject({ id: 1, boardId: resolved.boardId, projectId: "project", description: "# Private body\n", revision: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(await readTicket({ ...input, ticketId: 1 }, { paseo })).toEqual(detail);
    execFileSync("kanban-md", ["--dir", resolved.directory, "edit", "1", "--estimate=5h"]);
    const changed = await readTicket({ ...input, ticketId: 1 }, { paseo });
    expect(changed).not.toEqual(detail);
    expect(changed).toMatchObject({ description: "# Private body\n" });
  });

  it("includes due, blocking, dependencies and claim metadata", async () => {
    const resolved = await initialize();
    for (const title of ["one", "two"]) await runKanban({ board: resolved, operation: { kind: "create", fields: { title } }, output: taskSchema });
    execFileSync("kanban-md", ["--dir", resolved.directory, "edit", "2", "--due=2026-12-01", "--block=waiting", "--add-dep=1", "--claim=worker"]);
    expect(await readTicket({ ...input, ticketId: 2 }, { paseo })).toMatchObject({ due: "2026-12-01", blocked: true, blockReason: "waiting", dependsOn: [1], claim: { name: "worker", claimedAt: expect.any(String) } });
  });

  it("returns safe typed errors for missing tickets, boards, and invalid inputs", async () => {
    expect(await readTicket({ ...input, ticketId: 1 }, { paseo })).toMatchObject({ kind: "error", code: "board_missing" });
    await initialize();
    expect(await readTicket({ ...input, ticketId: 999 }, { paseo })).toMatchObject({ kind: "error", code: "cli_rejected", cliCode: "TASK_NOT_FOUND" });
    expect(await readTicket({ ...input, ticketId: 0 }, { paseo })).toMatchObject({ kind: "error", code: "invalid_input" });
  });

  it("rejects an absent task directory instead of returning an empty board", async () => {
    const resolved = await initialize();
    await rm(join(resolved.directory, "tasks"), { recursive: true });
    expect(await readBoard(input, { paseo })).toMatchObject({ kind: "error", code: "board_unavailable" });
  });

  it("rejects invalid configuration and skipped malformed tickets rather than returning empty", async () => {
    const resolved = await initialize();
    await writeFile(join(resolved.directory, "tasks", "001-broken.md"), "private malformed body");
    const result = await readBoard(input, { paseo });
    expect(result).toMatchObject({ kind: "error", code: "invalid_output" });
    expect(JSON.stringify(result)).not.toContain("private malformed body");
    await writeFile(join(resolved.directory, "config.yml"), "broken: [");
    expect(await readBoard(input, { paseo })).toMatchObject({ kind: "error", code: "invalid_configuration" });
  });

  it("hashes hidden metadata and nested properties independently of JSON key order", async () => {
    await initialize();
    const task = { id: 1, title: "one", status: "todo", priority: "low", created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z", body: "body", estimate: "1h", properties: { a: 1, b: [2, 3] } };
    async function read(value: unknown) {
      await executable(`process.stdout.write(${JSON.stringify(JSON.stringify(value))});`);
      return readTicket({ ...input, ticketId: 1 }, { paseo });
    }
    const original = await read(task);
    expect(await read({ ...task, properties: { b: [2, 3], a: 1 }, file: "/different/path", children: [{ id: 2 }] })).toEqual(original);
    for (const change of [{ estimate: "2h" }, { properties: { a: 2 } }, { body: "changed" }]) {
      const changed = await read({ ...task, ...change });
      expect(changed).not.toEqual(original);
      expect(changed).toHaveProperty("revision");
    }
  });

  it("rejects malformed CLI JSON, mismatched IDs, and invalid optional fields", async () => {
    await initialize();
    for (const output of ["secret body", JSON.stringify({ id: 1 }), JSON.stringify({ id: 2, title: "secret", status: "todo", priority: "low", created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z" }), JSON.stringify({ id: 1, title: "secret", status: "todo", priority: "low", created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z", tags: "bad" })]) {
      await executable(`process.stdout.write(${JSON.stringify(output)});`);
      const error = await readTicket({ ...input, ticketId: 1 }, { paseo });
      expect(error).toMatchObject({ kind: "error", code: "invalid_output" });
      expect(JSON.stringify(error)).not.toContain("secret");
    }
  });
});

describe("queued mutation RPCs", () => {
  const input = { workspaceId: "one" };
  const detail = async (ticketId = 1) => ticketDetailSchema.parse(await readTicket({ ...input, ticketId }, { paseo }));
  const raw = (ticketId = 1) => z.looseObject({ id: z.number() }).parse(JSON.parse(execFileSync("kanban-md", [
    "--dir", join(root, "kanban"), "--json", "show", String(ticketId),
  ], { encoding: "utf8" })));

  it("creates only explicitly, once across sibling workspaces, using project name and defaults", async () => {
    expect(await readBoard(input, { paseo })).toMatchObject({ kind: "missing" });
    expect(await createTicket({ ...input, title: "no implicit board" }, { paseo })).toMatchObject({ code: "board_missing" });
    const results = await Promise.all([
      createBoard(input, { paseo }), createBoard({ workspaceId: "two" }, { paseo }),
    ]);
    expect(results.filter((result) => result.kind === "ready")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "error")).toMatchObject([{ cliCode: "BOARD_ALREADY_EXISTS" }]);
    expect(await readBoard(input, { paseo })).toMatchObject({
      kind: "ready", config: { name: "--Project 'quoted' 雪", defaults: { status: "backlog", priority: "medium" } }, tickets: [],
    });
    const configPath = join(root, "kanban", "config.yml");
    await writeFile(configPath, "invalid: [");
    expect(await createBoard(input, { paseo })).toMatchObject({ kind: "error" });
    expect(await readFile(configPath, "utf8")).toBe("invalid: [");
    await rm(configPath);
    expect(await createBoard(input, { paseo })).toMatchObject({ code: "invalid_configuration" });
  });

  it("serializes concurrent edits and moves from sibling workspaces and rejects stale revisions", async () => {
    await createBoard(input, { paseo });
    const created = ticketDetailSchema.parse(await createTicket({ ...input, title: "original" }, { paseo }));
    const base = { ...input, ticketId: created.id, revision: created.revision };
    const results = await Promise.all([
      updateTicket({ ...base, changes: { title: "edited" } }, { paseo }),
      moveTicket({ ...base, workspaceId: "two", status: "todo" }, { paseo }),
    ]);
    expect(results.filter((result) => "revision" in result)).toHaveLength(1);
    expect(results.filter((result) => "kind" in result)).toMatchObject([{ code: "conflict" }]);
    expect(await updateTicket({ ...base, changes: { description: "keep my draft" } }, { paseo })).toMatchObject({ code: "conflict" });
    expect(await moveTicket({ ...base, status: "done" }, { paseo })).toMatchObject({ code: "conflict" });
    expect((await detail()).description).toBe("");
  });

  it("uses literal arguments and supports replacement and clearing with one edit", async () => {
    await createBoard(input, { paseo });
    const marker = join(root, "must-not-exist");
    const literal = `--quotes ' 雪 $(touch ${marker}); \`touch ${marker}\``;
    let current = ticketDetailSchema.parse(await createTicket({
      ...input, title: literal, description: literal, assignee: "first", tags: ['a,"b"', "old"], due: "2026-12-01",
    }, { paseo }));
    expect(current).toMatchObject({ title: literal, description: `${literal}\n`, blocked: false });
    current = ticketDetailSchema.parse(await updateTicket({
      ...input, ticketId: 1, revision: current.revision,
      changes: { description: "", assignee: literal, tags: ['new,"tag"', "--literal"], due: null, blockReason: literal },
    }, { paseo }));
    expect(current).toMatchObject({ description: "", assignee: literal, tags: ['new,"tag"', "--literal"], due: null, blocked: true, blockReason: literal });
    current = ticketDetailSchema.parse(await updateTicket({
      ...input, ticketId: 1, revision: current.revision, changes: { tags: [], blockReason: null },
    }, { paseo }));
    expect(current).toMatchObject({ tags: [], blocked: false, blockReason: null });
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves unrelated metadata and skips unchanged fields and no-op moves", async () => {
    await createBoard(input, { paseo });
    await createTicket({ ...input, title: "parent" }, { paseo });
    await createTicket({ ...input, title: "child", tags: ["one", "two"], description: "body", assignee: "owner" }, { paseo });
    execFileSync("kanban-md", ["--dir", join(root, "kanban"), "edit", "2", "--parent=1", "--add-dep=1", "--estimate=2h", "--class=fixed-date", "--started=2026-10-01", "--completed=2026-10-02", "--set-property=custom=42"]);
    const before = raw(2);
    const current = await detail(2);
    const base = { ...input, ticketId: 2, revision: current.revision };
    expect(await updateTicket({ ...base, changes: {
      title: current.title, description: current.description, assignee: current.assignee ?? "owner",
      tags: ["two", "one", "one"], due: null, blockReason: null,
    } }, { paseo })).toEqual(current);
    expect(await moveTicket({ ...base, status: current.status }, { paseo })).toEqual(current);
    expect(raw(2)).toEqual(before);
    await updateTicket({ ...base, changes: { priority: "high" } }, { paseo });
    const { updated: _oldUpdated, priority: _oldPriority, ...unchanged } = before;
    const { updated: _newUpdated, priority, ...after } = raw(2);
    expect(priority).toBe("high");
    expect(after).toEqual(unchanged);
  });

  it("respects claims, claim-required statuses and WIP limits, and recovers after rejections", async () => {
    await createBoard(input, { paseo });
    await createTicket({ ...input, title: "one" }, { paseo });
    await createTicket({ ...input, title: "two" }, { paseo });
    let current = await detail();
    expect(await moveTicket({ ...input, ticketId: 1, revision: current.revision, status: "in-progress" }, { paseo })).toMatchObject({ cliCode: "CLAIM_REQUIRED" });
    execFileSync("kanban-md", ["--dir", join(root, "kanban"), "edit", "1", "--claim=someone"]);
    current = await detail();
    const before = raw();
    expect(await updateTicket({ ...input, ticketId: 1, revision: current.revision, changes: { title: "no" } }, { paseo })).toMatchObject({ cliCode: "TASK_CLAIMED" });
    expect(await moveTicket({ ...input, ticketId: 1, revision: current.revision, status: "todo" }, { paseo })).toMatchObject({ cliCode: "TASK_CLAIMED" });
    expect(raw()).toEqual(before);
    execFileSync("kanban-md", ["--dir", join(root, "kanban"), "edit", "1", "--release"]);
    const config = join(root, "kanban", "config.yml");
    await writeFile(config, `${await readFile(config, "utf8")}\nwip_limits:\n    todo: 1\n`);
    const [one, two] = await Promise.all([detail(1), detail(2)]);
    const moved = await Promise.all([one, two].map((ticket) => moveTicket({ ...input, ticketId: ticket.id, revision: ticket.revision, status: "todo" }, { paseo })));
    expect(moved.filter((result) => "revision" in result)).toHaveLength(1);
    expect(moved.filter((result) => "kind" in result)).toMatchObject([{ cliCode: "WIP_LIMIT_EXCEEDED" }]);
    expect(await createTicket({ ...input, title: "invalid", priority: "absent" }, { paseo })).toMatchObject({ cliCode: "INVALID_PRIORITY" });
    expect(await createTicket({ ...input, title: "queue recovered" }, { paseo })).toHaveProperty("revision");
  });

  it("uses move to set transition timestamps and preserves them during editing", async () => {
    await createBoard(input, { paseo });
    let current = ticketDetailSchema.parse(await createTicket({ ...input, title: "one" }, { paseo }));
    expect(raw()).not.toHaveProperty("started");
    current = ticketDetailSchema.parse(await moveTicket({ ...input, ticketId: 1, revision: current.revision, status: "todo" }, { paseo }));
    expect(raw()).toHaveProperty("started");
    const started = raw().started;
    current = ticketDetailSchema.parse(await updateTicket({ ...input, ticketId: 1, revision: current.revision, changes: { title: "edited" } }, { paseo }));
    expect(raw().started).toEqual(started);
    expect(raw()).not.toHaveProperty("completed");
    await moveTicket({ ...input, ticketId: 1, revision: current.revision, status: "done" }, { paseo });
    expect(raw()).toMatchObject({ started, completed: expect.any(String) });
  });

  it("rejects creation into a claim-required default and respects creation WIP limits", async () => {
    await createBoard(input, { paseo });
    const path = join(root, "kanban", "config.yml");
    const config = await readFile(path, "utf8");
    await writeFile(path, config.replace("status: backlog", "status: in-progress"));
    expect(await createTicket({ ...input, title: "no unclaimed active ticket" }, { paseo })).toMatchObject({ cliCode: "CLAIM_REQUIRED" });
    expect(await readBoard(input, { paseo })).toMatchObject({ tickets: [] });
    await writeFile(path, `${config}\nwip_limits:\n    backlog: 1\n`);
    const results = await Promise.all([
      createTicket({ ...input, title: "one" }, { paseo }),
      createTicket({ workspaceId: "two", title: "two" }, { paseo }),
    ]);
    expect(results.filter((result) => "revision" in result)).toHaveLength(1);
    expect(results.filter((result) => "kind" in result)).toMatchObject([{ cliCode: "WIP_LIMIT_EXCEEDED" }]);
  });

  it.each(["lost-write-response", "failed-result-read"])("requires reconciliation after %s and never retries", async (mode) => {
    await createBoard(input, { paseo });
    const real = execFileSync("which", ["kanban-md"], { encoding: "utf8" }).trim();
    const log = join(root, "calls");
    await executable(`
      const fs = require("node:fs");
      const args = process.argv.slice(2);
      fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
      const result = require("node:child_process").spawnSync(${JSON.stringify(real)}, args, { encoding: "utf8" });
      if (args.includes(${JSON.stringify(mode === "lost-write-response" ? "create" : "show")})) {
        process.stdout.write("private invalid response");
      } else { process.stdout.write(result.stdout); }
      process.stderr.write(result.stderr);
      process.exitCode = result.status;
    `);
    expect(await createTicket({ ...input, title: "written once" }, { paseo })).toMatchObject({ code: "write_uncertain" });
    expect(await createTicket({ ...input, title: "blocked until refresh" }, { paseo })).toMatchObject({ code: "write_uncertain" });
    const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => z.array(z.string()).parse(JSON.parse(line)));
    expect(calls.filter((args) => args.includes("create"))).toHaveLength(1);
    await executable('process.stdout.write("private invalid response");');
    expect(await readBoard(input, { paseo })).toMatchObject({ code: "invalid_output" });
    expect(await createTicket({ ...input, title: "still blocked" }, { paseo })).toMatchObject({ code: "write_uncertain" });
    vi.unstubAllEnvs();
    // A detail read cannot reconcile an unknown create outcome for the whole board.
    await detail();
    expect(await createTicket({ ...input, title: "needs board refresh" }, { paseo })).toMatchObject({ code: "write_uncertain" });
    expect(await readBoard(input, { paseo })).toMatchObject({ kind: "ready", tickets: [{ title: "written once" }] });
    expect(await createTicket({ ...input, title: "deliberate next create" }, { paseo })).toHaveProperty("revision");
    expect(await readBoard(input, { paseo })).toMatchObject({ tickets: [{ id: 1 }, { id: 2 }] });
  });
});
