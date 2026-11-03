import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createPaseoApi } from "@getpaseo/client";
import { createHostClient } from "@getpaseo/client/node";
import { AGENT_PROVIDER_DEFINITIONS, DEV_AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";
import { parse, stringify } from "yaml";

// Deliberately separate from vitest: this starts an owned daemon and requires process/socket access.
const root = await mkdtemp(join(tmpdir(), "kanban-paseo-isolated-"));
const home = join(root, "paseo");
const ui = process.argv.includes("--ui");
let listen = join(home, "daemon.sock");
if (ui) {
  const port = createServer();
  port.listen(0, "127.0.0.1");
  await once(port, "listening");
  listen = `127.0.0.1:${port.address().port}`;
  await new Promise((resolve) => port.close(resolve));
}
const endpoint = ui ? `ws://${listen}/ws` : `unix://${listen}`;
const pluginId = "kanban-md";
const env = {
  PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: join(root, "config"),
  XDG_CACHE_HOME: join(root, "cache"), XDG_DATA_HOME: join(root, "data"),
  PASEO_HOME: home, PASEO_NODE_ENV: "development", PASEO_RELAY_ENABLED: "false",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
};
const run = (command, args, cwd = root) => execFileSync(command, args, {
  env, cwd, input: "", encoding: "utf8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"],
});
let daemon, driver, paseo;
let output = "";
try {
  await mkdir(home);
  await writeFile(join(home, "ISOLATED_TEST_HOME"), "Owned by tests/isolated-host.mjs; safe to remove after exit.\n");
  const providers = Object.fromEntries([...AGENT_PROVIDER_DEFINITIONS, ...DEV_AGENT_PROVIDER_DEFINITIONS]
    .map(({ id }) => [id, { enabled: id === "mock" }]));
  await writeFile(join(home, "config.json"), JSON.stringify({
    daemon: { listen, relay: { enabled: false }, mcp: { enabled: false, injectIntoAgents: false } },
    pluginsEnabled: true, agents: { providers, metadataGeneration: { providers: [] } },
    features: { webUi: { enabled: ui, ...(process.env.KANBAN_TEST_WEB_DIST ? { distDir: resolve(process.env.KANBAN_TEST_WEB_DIST) } : {}) }, dictation: { enabled: false }, voiceMode: { enabled: false } },
  }));
  console.log(`Isolated home: ${home}`);
  console.log(run("paseo", ["--version"]).trim(), run("kanban-md", ["--version"]).trim());
  daemon = spawn("paseo", ["daemon", "run", "--home", home], { env, cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  daemon.stdout.on("data", (data) => { output = (output + data).slice(-64_000); });
  daemon.stderr.on("data", (data) => { output = (output + data).slice(-64_000); });
  for (let tries = 0; ; tries++) {
    driver = createHostClient(endpoint, { clientId: "kanban-isolated-test", connectTimeoutMs: 1000, reconnect: { enabled: false } });
    try { await driver.connect(); break; }
    catch (error) {
      await driver.close();
      if (tries >= 120 || daemon.exitCode !== null) throw error;
      await delay(500);
    }
  }
  paseo = createPaseoApi(driver);
  const [packed] = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], resolve(".")));
  assert.ok(!packed.files.some(({ path }) => path.startsWith("tests/")));
  run("tar", ["-xzf", join(root, packed.filename), "-C", root]);
  const artifact = join(root, "package");
  // yaml is the sole runtime dependency; host-provided modules must resolve through Paseo.
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(artifact, "package.json"), "utf8")).dependencies), ["yaml"]);
  await mkdir(join(artifact, "node_modules"));
  await cp(resolve("node_modules/yaml"), join(artifact, "node_modules/yaml"), { recursive: true });
  const installed = await driver.installDirectoryPlugin(artifact, pluginId);
  assert.equal(installed.status, "running", JSON.stringify(installed));
  assert.ok((await driver.getPluginCatalog()).find(({ id, clientBundle }) => id === pluginId && clientBundle.length));
  console.log("Packed plugin server loaded and client bundle compiled with only its runtime dependency.");
  const available = await paseo.providers.listAvailable();
  assert.deepEqual(available.providers.filter(({ available }) => available).map(({ provider }) => provider), ["mock"]);
  const rpc = (method, input) => driver.invokePluginRpc(pluginId, method, input);
  const project = join(root, "project ' $(literal)");
  const unrelated = join(root, "unrelated");
  for (const path of [project, unrelated]) {
    await mkdir(path);
    await writeFile(join(path, ".gitignore"), "kanban/\n");
    run("git", ["init", "-b", "main"], path);
    run("git", ["add", ".gitignore"], path);
    run("git", ["-c", "user.name=Isolated Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture"], path);
  }
  const current = await paseo.workspaces.create({ source: { kind: "directory", path: project }, title: "Main test workspace" });
  const other = await paseo.workspaces.create({ source: { kind: "directory", path: unrelated }, title: "Unrelated project" });
  const sibling = await paseo.workspaces.create({ source: { kind: "worktree", cwd: project, action: "branch-off", branchName: "sibling" }, title: "Sibling worktree" });
  const workspaceId = current.id;
  const boardId = join(project, "kanban");
  assert.equal((await rpc("board.read", { workspaceId })).kind, "missing");
  const board = await rpc("board.create", { workspaceId });
  assert.equal(board.kind, "ready", JSON.stringify(board));
  assert.equal(board.boardId, boardId);
  assert.equal((await rpc("board.read", { workspaceId: sibling.id })).boardId, boardId);
  assert.equal((await rpc("board.read", { workspaceId: other.id })).kind, "missing");
  const otherBoard = await rpc("board.create", { workspaceId: other.id });
  assert.notEqual(otherBoard.boardId, boardId);
  assert.equal(otherBoard.tickets.length, 0);
  const cli = (...args) => JSON.parse(run("kanban-md", ["--dir", boardId, "--json", ...args], project));
  const title = "Literal 'quotes' ; $(touch SHOULD_NOT_EXIST) `uname` & Unicode λ";
  let ticket = await rpc("ticket.create", { workspaceId, title, description: "## Acceptance\n- Keep the canonical board.", tags: ["comma,tag", "ui"], priority: "high" });
  assert.equal(ticket.title, title, JSON.stringify(ticket));
  const ticketId = ticket.id;
  const initialRevision = ticket.revision;
  assert.deepEqual(ticket.tags, ["comma,tag", "ui"]);
  const dependency = await rpc("ticket.create", { workspaceId, title: "Dependency" });
  cli("edit", String(ticketId), "--estimate=3h", `--add-dep=${dependency.id}`);
  ticket = await rpc("ticket.read", { workspaceId, ticketId });
  const metadata = cli("show", String(ticketId));
  const updates = await Promise.all([workspaceId, sibling.id].map((id) => rpc("ticket.update", {
    workspaceId: id, ticketId, revision: ticket.revision, changes: { title: `${title} edited` },
  })));
  assert.equal(updates.filter(({ code }) => code === "conflict").length, 1);
  ticket = updates.find(({ revision }) => revision);
  assert.equal(cli("show", String(ticketId)).estimate, metadata.estimate);
  assert.deepEqual(ticket.dependsOn, [dependency.id]);
  assert.equal((await rpc("ticket.update", { workspaceId, ticketId, revision: initialRevision, changes: { title: "Stale overwrite" } })).code, "conflict");
  cli("edit", String(ticketId), `--remove-dep=${dependency.id}`);
  ticket = await rpc("ticket.read", { workspaceId, ticketId });
  assert.equal((await rpc("ticket.move", { workspaceId, ticketId, revision: ticket.revision, status: "in-progress" })).cliCode, "CLAIM_REQUIRED");
  ticket = await rpc("ticket.move", { workspaceId: sibling.id, ticketId, revision: ticket.revision, status: "todo" });
  assert.equal(ticket.status, "todo", JSON.stringify(ticket));
  const started = cli("show", String(ticketId)).started;
  assert.ok(started);
  const configFile = join(boardId, "config.yml");
  const config = parse(await readFile(configFile, "utf8"));
  config.wip_limits = { todo: 1 };
  config.priorities = ["low", "medium", "high", "urgent"];
  await writeFile(configFile, stringify(config));
  const custom = await rpc("board.read", { workspaceId });
  assert.deepEqual(custom.config.priorities, config.priorities);
  const second = await rpc("ticket.create", { workspaceId, title: "WIP must reject", priority: "urgent" });
  assert.equal((await rpc("ticket.move", { workspaceId, ticketId: second.id, revision: second.revision, status: "todo" })).cliCode, "WIP_LIMIT_EXCEEDED");
  cli("edit", String(ticketId), "--claim=isolated-owner");
  ticket = await rpc("ticket.read", { workspaceId, ticketId });
  assert.equal((await rpc("ticket.update", { workspaceId, ticketId, revision: ticket.revision, changes: { title: "No takeover" } })).cliCode, "TASK_CLAIMED");
  cli("edit", String(ticketId), "--release");
  ticket = await rpc("ticket.read", { workspaceId, ticketId });
  ticket = await rpc("ticket.update", { workspaceId, ticketId, revision: ticket.revision, changes: { description: "## Acceptance\n- Keep the canonical board.\n- Never complete automatically." } });
  assert.equal(cli("show", String(ticketId)).started, started);
  assert.equal(cli("show", String(ticketId)).estimate, metadata.estimate);
  assert.equal((await rpc("board.read", { workspaceId: other.id })).tickets.length, 0);
  console.log("RPC board/create/edit/move, sibling worktree identity, project isolation, custom config, WIP/claim rejection, stale edits and queue recovery passed.");

  const { self } = await paseo.hosts.list();
  const scope = { workspaceId, ticketId, boardId, projectId: board.projectId, hostId: self.serverId, revision: ticket.revision };
  const options = await rpc("launch.options", scope);
  assert.equal(options.kind, "launch_options", JSON.stringify(options));
  assert.equal(options.defaultWorkspace, "worktree");
  assert.ok(options.providers.find(({ id, models }) => id === "mock" && models.some(({ id }) => id === "ten-second-stream")));
  const input = { ...scope, launchId: options.launchId, workspace: "worktree", provider: "mock", model: "ten-second-stream", modeId: null, instructions: options.instructions };
  // Persist exactly what the client must retain, then deliberately discard its creation response.
  await writeFile(join(root, "launch.json"), JSON.stringify(input));
  const launchResult = await rpc("launch.start", input);
  assert.equal(launchResult.kind, "launched", JSON.stringify(launchResult));
  await paseo.dispose();
  await driver.close();
  driver = createHostClient(endpoint, { clientId: "kanban-reconnected-test", reconnect: { enabled: false } });
  await driver.connect();
  paseo = createPaseoApi(driver);
  assert.equal((await driver.reloadPlugin(pluginId)).status, "running");
  const recovered = await rpc("launch.recover", JSON.parse(await readFile(join(root, "launch.json"), "utf8")));
  assert.equal(recovered.kind, "recovered", JSON.stringify(recovered));
  assert.equal(recovered.promptDelivery, "unknown");
  const launchedWorkspace = await paseo.workspaces.ref(recovered.workspaceId).refresh();
  assert.equal(launchedWorkspace.projectRootPath, project);
  assert.notEqual(launchedWorkspace.workspaceDirectory, project);
  assert.ok(launchedWorkspace.workspaceDirectory.startsWith(join(home, "worktrees")));
  assert.equal((await rpc("board.read", { workspaceId: recovered.workspaceId })).boardId, boardId);
  const agent = paseo.agents.ref(recovered.agentId);
  const snapshot = await agent.refresh();
  assert.equal(snapshot.agent.labels["kanban.board"], boardId);
  assert.equal(snapshot.agent.cwd, launchedWorkspace.workspaceDirectory);
  await agent.waitForFinish(30_000);
  assert.equal((await agent.refresh()).agent.status, "idle");
  const timeline = JSON.stringify((await driver.fetchAgentTimeline(recovered.agentId)).entries);
  assert.ok(timeline.includes("Before implementation, re-read the saved ticket"));
  assert.ok(timeline.includes("never initialize or use a worktree-local board"));
  assert.ok(timeline.includes("Never complete automatically."));
  assert.equal((await rpc("ticket.read", { workspaceId, ticketId })).status, "todo");
  assert.equal(cli("show", String(ticketId)).completed, undefined);
  await assert.rejects(access(join(project, "SHOULD_NOT_EXIST")), { code: "ENOENT" });
  const beforeRetry = await paseo.agents.list();
  assert.equal((await rpc("launch.start", input)).kind, "recovered");
  assert.equal(JSON.stringify((await driver.fetchAgentTimeline(recovered.agentId)).entries), timeline);
  assert.equal((await paseo.agents.list()).entries.length, beforeRetry.entries.length);
  assert.equal((await rpc("board.read", { workspaceId: other.id })).tickets.length, 0);
  console.log("Managed worktree launch, canonical prompt/labels/cwd, completion without Done, reconnect/reload and response-loss recovery without duplicate prompt passed.");

  if (ui) {
    const { checkWebHost } = await import("./web-preflight.mjs");
    await checkWebHost({ url: `http://${listen}`, env, reloadPlugin: () => driver.reloadPlugin(pluginId) });
  }

  assert.equal((await driver.disablePlugin(pluginId)).status, "disabled");
  await assert.rejects(rpc("board.read", { workspaceId }));
  assert.ok(!(await driver.getPluginCatalog()).some(({ id }) => id === pluginId));
  assert.equal((await driver.enablePlugin(pluginId)).status, "running");
  assert.equal((await rpc("board.read", { workspaceId })).boardId, boardId);
  await driver.removePlugin(pluginId);
  assert.ok(!(await driver.listPlugins()).some(({ id }) => id === pluginId));
  console.log("Disable/enable/remove cleanup passed.");
} catch (error) {
  if (driver) console.error(await driver.getPluginLogs(pluginId).catch(() => []));
  console.error(output.split("\n").filter((line) => /"level":(40|50|60)/.test(line)).slice(-12).join("\n"));
  throw error;
} finally {
  await Promise.allSettled([paseo?.dispose(), driver?.close()]);
  if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
    const exited = once(daemon, "exit");
    daemon.kill("SIGTERM");
    const kill = setTimeout(() => daemon.kill("SIGKILL"), 10_000);
    await exited;
    clearTimeout(kill);
  }
  assert.equal(await readFile(join(home, "ISOLATED_TEST_HOME"), "utf8"), "Owned by tests/isolated-host.mjs; safe to remove after exit.\n");
  await rm(root, { recursive: true, force: true });
  console.log("Disposable daemon stopped and home removed.");
}
