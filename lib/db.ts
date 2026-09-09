import { Pool, type PoolClient } from "pg";
import { databaseConfig } from "../scripts/db-config.mjs";
const globalDb = globalThis as unknown as { wissenPool?: Pool };
export const db =
  globalDb.wissenPool ??
  new Pool({
    ...databaseConfig(),
    max: 8,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 20000,
  });
if (!globalDb.wissenPool)
  db.on("error", () => {
    console.error("Database pool connection failed");
  });
if (process.env.NODE_ENV !== "production") globalDb.wissenPool = db;
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
