import { db } from "@/lib/db";
import { BookStack } from "@/lib/intake/bookstack";
import { decrypt } from "@/lib/intake/crypto";
import { tenantHost } from "@/lib/tenant-host";
import { embeddingsEnabledForTenant, embeddingsTenantIds } from "./embeddings";
import { indexTenant } from "./indexing";
import type { DbClient } from "./retrieval";

/**
 * Hourly refresh of the chunk index for every tenant on the QA-tenant gate.
 * One tenant failing never stops the others.
 */
export async function refreshWikiIndexes(database: DbClient = db) {
  for (const teamId of embeddingsTenantIds()) {
    if (!embeddingsEnabledForTenant(teamId)) continue;
    try {
      const tenant = (
        await database.query(
          "SELECT t.id,t.slug,t.host FROM tenants t WHERE t.team_id=$1 AND t.status='running' LIMIT 1",
          [teamId],
        )
      ).rows[0] as { id: string; slug: string; host?: string | null } | undefined;
      if (!tenant) continue;
      const secret = (
        await database.query(
          "SELECT api_id,api_secret_enc FROM tenant_secrets WHERE tenant_id=$1",
          [tenant.id],
        )
      ).rows[0] as { api_id: string; api_secret_enc: string } | undefined;
      if (!secret) continue;
      const client = new BookStack(
        tenantHost(tenant),
        secret.api_id,
        decrypt(secret.api_secret_enc, tenant.slug),
      );
      await indexTenant(client, teamId, database);
    } catch {
      // Keep going: the next tenant and the next hour still get a chance.
    }
  }
}

const globalJobs = globalThis as unknown as {
  wikiIndexTimer?: ReturnType<typeof setInterval>;
};

export function startWikiIndexRefresh() {
  if (globalJobs.wikiIndexTimer) return;
  void refreshWikiIndexes().catch(() =>
    console.error("Wiki index refresh failed"),
  );
  globalJobs.wikiIndexTimer = setInterval(() => {
    void refreshWikiIndexes().catch(() =>
      console.error("Wiki index refresh failed"),
    );
  }, 3600000);
  globalJobs.wikiIndexTimer.unref();
}
