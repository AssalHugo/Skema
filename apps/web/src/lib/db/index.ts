import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { dbEnv } from "@/lib/env";
import * as schema from "./schema";

export type Database = NeonHttpDatabase<typeof schema>;

let instance: Database | undefined;

/** Client Drizzle (driver HTTP Neon, adapté aux fonctions serverless). */
export function getDb(): Database {
  instance ??= drizzle(neon(dbEnv().DATABASE_URL), { schema });
  return instance;
}

export { schema };
