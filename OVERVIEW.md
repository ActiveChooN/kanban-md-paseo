# Kanban

A workspace panel for kanban-md boards. Search, filter and edit tickets, move them between statuses, start an agent on a ticket, or attach a ticket to any prompt.

Every workspace in a project, including sibling worktrees, uses the board at `<projectRootPath>/kanban`. The plugin changes tickets only through the kanban-md CLI, so claims and WIP limits still apply. It never claims tickets, marks them done, or commits, pushes or merges code.

## Setup

Requires Paseo `^0.13.2 || ^0.14.0 || ^0.15.0` and kanban-md 0.39.x on the daemon's PATH. Launching into a new worktree needs Git.

## Data

The plugin reads and writes ticket files on the daemon machine and makes no network requests. Launching an agent or attaching a ticket puts the ticket's content in the prompt, which Paseo sends to your provider.

See the [README](https://github.com/ActiveChooN/kanban-md-paseo#readme) for details and limits.
