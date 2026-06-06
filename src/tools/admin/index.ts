import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerAdminAiProviderGet } from "./manage/admin-ai-provider-get.js";
import { registerAdminAiProviderWrite } from "./manage/admin-ai-provider-write.js";
import { registerAdminGroupGet } from "./manage/admin-group-get.js";
import { registerAdminGroupWrite } from "./manage/admin-group-write.js";
import { registerAdminHouseholdGet } from "./manage/admin-household-get.js";
import { registerAdminHouseholdWrite } from "./manage/admin-household-write.js";
import { registerAdminUserActions } from "./manage/admin-user-actions.js";
import { registerAdminUserGet } from "./manage/admin-user-get.js";
import { registerAdminUserWrite } from "./manage/admin-user-write.js";
import { registerAdminAbout } from "./site/admin-about.js";
import { registerAdminBackupGet } from "./site/admin-backup-get.js";
import { registerAdminBackupRestore } from "./site/admin-backup-restore.js";
import { registerAdminBackupWrite } from "./site/admin-backup-write.js";
import { registerAdminMaintenanceClean } from "./site/admin-maintenance-clean.js";
import { registerAdminMaintenanceGet } from "./site/admin-maintenance-get.js";

/** Options controlling which admin tools are registered. */
export type RegisterOptions = { readOnly: boolean };

/**
 * Registers the admin toolset (opt-in via MEALIE_TOOLSETS=admin): the
 * site-operator surface — manage users/households/groups, AI providers,
 * backups (incl. the double-gated restore), maintenance, email test, and
 * debug. Highest-blast-radius domain: reads are always registered; writes
 * only when not read-only.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 * @param options - Registration options (read-only switch)
 */
export function registerAdminTools(
  server: McpServer,
  client: MealieClient,
  options: RegisterOptions,
): void {
  // Reads (always on).
  registerAdminAbout(server, client);
  registerAdminUserGet(server, client);
  registerAdminHouseholdGet(server, client);
  registerAdminGroupGet(server, client);
  registerAdminAiProviderGet(server, client);
  registerAdminBackupGet(server, client);
  registerAdminMaintenanceGet(server, client);

  if (options.readOnly) return;
  // Writes (stripped under read-only).
  registerAdminUserWrite(server, client);
  registerAdminUserActions(server, client);
  registerAdminHouseholdWrite(server, client);
  registerAdminGroupWrite(server, client);
  registerAdminAiProviderWrite(server, client);
  registerAdminBackupWrite(server, client);
  registerAdminBackupRestore(server, client);
  registerAdminMaintenanceClean(server, client);
}
