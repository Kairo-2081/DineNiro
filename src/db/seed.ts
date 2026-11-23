import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { query, withTransaction } from './index.ts';
import { hashPassword } from './password.ts';

/** The first admin's password comes from the environment. Too short or missing means no admin is created. */
export const MIN_ADMIN_PASSWORD_LENGTH = 12;
export const readAdminPassword = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const value = env.DINENIRO_ADMIN_PASSWORD ?? '';
  return value.length >= MIN_ADMIN_PASSWORD_LENGTH ? value : null;
};

export async function ensureDatabaseSchema() {
  const schemaSql = await readFile(path.resolve(process.cwd(), 'schema.sql'), 'utf8');
  await withTransaction((client) => client.query(schemaSql));
  console.log('Database schema applied from schema.sql.');
}

/** Creates the first platform admin when there is none yet. No demo restaurants or staff are ever seeded. */
export async function ensureFirstAdmin(env: NodeJS.ProcessEnv = process.env) {
  const count = Number((await query(`SELECT dineniro_admin_count() AS count`)).rows[0]?.count || 0);
  if (count > 0) return;
  const password = readAdminPassword(env);
  if (!password) {
    console.warn(`No admin account created: set DINENIRO_ADMIN_PASSWORD (at least ${MIN_ADMIN_PASSWORD_LENGTH} characters) and restart.`);
    return;
  }
  const email = env.DINENIRO_ADMIN_EMAIL?.trim().toLowerCase() || 'admin@dineniro.local';
  await withTransaction(async (client) => client.query(
    `SELECT * FROM dineniro_admin_create($1, $2, $3, $4, $5, $6)`,
    [`ADM-${randomUUID()}`, 'admin', email, await hashPassword(password), 'Platform admin', ''],
  ));
  console.log(`First platform admin created: sign in as "admin" or ${email}.`);
}

export async function prepareDatabase() {
  await ensureDatabaseSchema();
  await ensureFirstAdmin();
}
