import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { workspaceInputSchema } from "../shared/ticket";
import { BoardError } from "./errors";

type Paseo = PluginHandlerContext["paseo"];
export type BoardLookup = {
  workspaces: { ref(id: string): Pick<ReturnType<Paseo["workspaces"]["ref"]>, "refresh"> };
  projects: Pick<Paseo["projects"], "list">;
};
export type ProjectRecord = Pick<
  Awaited<ReturnType<Paseo["projects"]["list"]>>["projects"][number],
  "projectId" | "projectKind" | "projectDisplayName" | "projectRootPath"
>;

export async function resolveBoard({ paseo, workspaceId }: {
  paseo: BoardLookup;
  workspaceId: string;
}) {
  if (!workspaceInputSchema.safeParse({ workspaceId }).success) {
    throw new BoardError("invalid_input");
  }
  const project = await (async () => {
    try {
      const workspace = await paseo.workspaces.ref(workspaceId).refresh();
      if (!workspace) throw new BoardError("workspace_unavailable");
      const { projects } = await paseo.projects.list();
      const project = projects.find(({ projectId }) => projectId === workspace.projectId);
      if (!project) throw new BoardError("workspace_unavailable");
      return project;
    } catch {
      throw new BoardError("workspace_unavailable");
    }
  })();
  return resolveProjectBoard(project);
}

/** Resolves a project's canonical `<projectRootPath>/kanban` board. Never creates anything. */
export async function resolveProjectBoard(project: ProjectRecord) {
  let projectRootPath: string;
  try {
    if (!isAbsolute(project.projectRootPath)) throw new Error();
    projectRootPath = await realpath(project.projectRootPath);
    if (!(await stat(projectRootPath)).isDirectory()) throw new Error();
  } catch {
    throw new BoardError("root_unavailable");
  }

  let directory = join(projectRootPath, "kanban");
  let exists = true;
  try {
    await lstat(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") exists = false;
    else throw new BoardError("board_unavailable");
  }
  if (exists) {
    try {
      // Resolve the board too: different roots can point at the same physical board.
      directory = await realpath(directory);
      if (!(await stat(directory)).isDirectory()) throw new Error();
    } catch {
      throw new BoardError("board_unavailable");
    }
    try {
      if (!(await stat(join(directory, "config.yml"))).isFile()) throw new Error();
    } catch {
      throw new BoardError("invalid_configuration");
    }
  }
  const kind: "present" | "missing" = exists ? "present" : "missing";
  return {
    kind,
    projectId: project.projectId,
    projectKind: project.projectKind,
    projectName: project.projectDisplayName,
    projectRootPath,
    directory,
    boardId: directory,
  };
}

export type ResolvedBoard = Awaited<ReturnType<typeof resolveBoard>>;
