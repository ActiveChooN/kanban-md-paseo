# Architecture

The Markdown ticket files are the source of truth. Paseo owns workspaces and agents. The plugin connects the two and keeps no state of its own beyond panel tab state.

## Layout

- `shared/` holds the Zod RPC contracts: six ticket RPCs (`board.read`, `board.create`, `ticket.read`, `ticket.create`, `ticket.update`, `ticket.move`), three launch RPCs and `ticket.search` for attachments.
- `server/` resolves the board, runs the CLI, queues writes and handles launches.
- `client/` holds the panel, the shared board query, ticket drafts and the implement dialog. `client/design/` holds the UI primitives.
- `index.server.ts` and `index.client.tsx` register everything and return cleanup functions.

## Board resolution

`server/board.ts` looks up the workspace's project through the Paseo SDK and uses `<projectRootPath>/kanban`, never the workspace directory. That's how sibling worktrees share one board. The real path (symlinks resolved) is the board's identity, used as the queue key and client cache key.

Only a missing board can be initialized, and only when the user clicks Create board. Bad config, a missing root or a missing executable are errors.

## Running the CLI

`server/cli.ts` is the only place that spawns `kanban-md`. It runs without a shell and with an absolute `--dir` and `--json`, closed stdin, a 10 s timeout and a 4 MiB output cap. Arguments come from a fixed set of operations, never from RPC input directly. Output is validated with Zod. Errors expose a safe code and never include argv, ticket bodies or raw output.

The CLI's config JSON doesn't include claim-required statuses, so `reads.ts` also parses `config.yml` for them.

## Writes and consistency

Each ticket has a revision, a hash of everything the CLI returns for it. Updates and moves send the revision they started from. `server/queue.ts` serializes the preflight read, the write and the result read per board. A changed revision returns `conflict` without writing.

Updates send only changed fields. Status changes use `kanban-md move` so transition timestamps stay right. No claim, release or force flags are ever passed, so the CLI still enforces ownership and WIP limits.

If a write times out or its result can't be read, the board is marked uncertain and blocks further writes until a successful `board.read`. Nothing is retried automatically. The plugin can't tell which ticket a lost create made.

External CLI or editor writes can still land between the revision check and the write. This is not a cross-process lock.

## Client

`client/board-query.ts` keeps one query per host and board. It's shared by every mounted panel on that board and polls every five seconds while the app is active and the host is connected. Stale responses are dropped. Failed reads keep the last good data and disable writes.

Drafts (`ticket-draft.ts`) keep their baseline revision. Polls and conflicts never replace a draft. Only Save or an explicit Discard does.

## Launching agents

`launch.options` reads the saved ticket and lists the host's providers, models and workspace choices. The panel saves the full launch request, including a UUID and the literal instructions, to tab state before calling `launch.start`.

The UUID is the agent ID and the idempotency key. A new workspace's ID is derived from it (`wks_` plus 16 hex digits of its SHA-256). Paseo's create APIs deduplicate on that key. If the response is lost, `launch.recover` finds the existing agent and workspace without creating anything. It reports prompt delivery as `unknown`, because the SDK can't confirm delivery. The plugin never resends the prompt.

Agents carry `kanban.*` labels (host, board, project, ticket, launch, workspace, input hash). `client/agent-activity.ts` finds sessions by these labels and checks them before Open agent navigates.

## Tests

`npm test` runs Vitest against real kanban-md on temporary boards, with SDK doubles for Paseo. `npm run test:host` (`tests/isolated-host.mjs`) installs the packed plugin on a throwaway daemon with Paseo's mock provider. It runs the board, worktree, launch, recovery and cleanup flows end to end.
