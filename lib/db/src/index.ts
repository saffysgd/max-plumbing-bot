import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export async function ensureDatabaseSchema(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(185312736, 42)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS bot_sessions (
        peer_id text PRIMARY KEY NOT NULL,
        platform_user_id text NOT NULL,
        step text NOT NULL,
        state jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS plumber_applications (
        id serial PRIMARY KEY,
        peer_id text NOT NULL,
        platform_user_id text NOT NULL,
        customer_name text,
        phone text NOT NULL,
        service text NOT NULL,
        urgency text NOT NULL,
        pipe_material text NOT NULL,
        connection_type text NOT NULL,
        pressure_test boolean NOT NULL,
        description text NOT NULL,
        status text NOT NULL,
        attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export * from "./schema";
