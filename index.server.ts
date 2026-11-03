import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readBoard, readTicket } from "./server/reads";
import { createBoard, createTicket, moveTicket, updateTicket } from "./server/mutations";
import { boardCreate, boardRead, ticketCreate, ticketMove, ticketRead, ticketUpdate } from "./shared/rpc";
import { launchOptions, launchRecover, launchStart } from "./shared/launch";
import { getLaunchOptions, recoverLaunch, startLaunch } from "./server/launch";
import { ticketSearch } from "./shared/attachments";
import { searchTickets } from "./server/attachments";

export default function contribute(server: PluginServerContext) {
  server.handle(boardRead, readBoard);
  server.handle(ticketRead, readTicket);
  server.handle(boardCreate, createBoard);
  server.handle(ticketCreate, createTicket);
  server.handle(ticketUpdate, updateTicket);
  server.handle(ticketMove, moveTicket);
  server.handle(launchOptions, getLaunchOptions);
  server.handle(launchStart, startLaunch);
  server.handle(launchRecover, recoverLaunch);
  server.handle(ticketSearch, searchTickets);
  return () => {};
}
