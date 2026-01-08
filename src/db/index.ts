import { drizzle, LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient, Client } from '@libsql/client';
import * as schema from './schema';

let client: Client | null = null;
let dbInstance: LibSQLDatabase<typeof schema> | null = null;

function getClient(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
      throw new Error('TURSO_DATABASE_URL environment variable is not set');
    }

    client = createClient({
      url,
      authToken,
    });
  }
  return client;
}

export function getDb(): LibSQLDatabase<typeof schema> {
  if (!dbInstance) {
    dbInstance = drizzle(getClient(), { schema });
  }
  return dbInstance;
}

// For backward compatibility - lazy getter
export const db = new Proxy({} as LibSQLDatabase<typeof schema>, {
  get(_target, prop) {
    return (getDb() as any)[prop];
  },
});

export * from './schema';
