import type { z } from "zod";
import { boardErrorMessages, type boardErrorSchema } from "../shared/errors";

export type BoardErrorCode = keyof typeof boardErrorMessages;

// Never retain subprocess errors, argv, stderr, or validation issues: they can contain ticket bodies.
export class BoardError extends Error {
  constructor(readonly code: BoardErrorCode, readonly reason?: BoardErrorCode, readonly cliCode?: string) {
    super(boardErrorMessages[code]);
    this.name = "BoardError";
  }
}

export function failure(error: unknown) {
  const safe = error instanceof BoardError ? error : new BoardError("invalid_output");
  return { kind: "error", code: safe.code, message: safe.message, cliCode: safe.cliCode ?? null } satisfies z.infer<typeof boardErrorSchema>;
}
