import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const ADMIN_PASSWORD = 'platform-admin-password';
export const skipWithoutDatabase = !TEST_DATABASE_URL && 'TEST_DATABASE_URL is not set';

/** A tiny client that keeps its own session cookie, like one browser. */
export class Browser {
  private cookie = '';
  constructor(private base: string) {}
  async call(method: string, path: string, body?: unknown) {
    const response = await fetch(this.base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0];
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
  get(path: string) { return this.call('GET', path); }
  post(path: string, body?: unknown) { return this.call('POST', path, body ?? {}); }
  put(path: string, body: unknown) { return this.call('PUT', path, body); }
  patch(path: string, body: unknown) { return this.call('PATCH', path, body); }
  delete(path: string) { return this.call('DELETE', path); }
  get savedCookie() { return this.cookie; }
  set savedCookie(value: string) { this.cookie = value; }
}

export const application = (n: number) => ({
  ownerName: `Owner ${n}`, ownerEmail: `owner${n}@example.com`, ownerPhone: '01700000000',
  password: 'owner-password', restaurantName: `Restaurant ${n}`, restaurantPhone: '01800000000',
  address: 'Road 45', area: 'Gulshan', city: 'Dhaka', cuisine: 'Bangladeshi',
});

/** Wipes the test database, applies the schema and starts the API on a free port. */
export async function startTestServer() {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.DATABASE_SSL ??= 'false';
  process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-characters-long';
  process.env.DINENIRO_ADMIN_PASSWORD = ADMIN_PASSWORD;

  const db = await import('../src/db/index.ts');
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const seed = await import('../src/db/seed.ts');
  await seed.prepareDatabase();
  const { createApp } = await import('../server/app.ts');
  const server: Server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    browser: () => new Browser(base),
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await db.pool.end();
    },
  };
}

/** Applies for a restaurant, has the platform admin approve it, and returns the signed-in owner. */
export async function approvedRestaurant(base: string, n: number) {
  const owner = new Browser(base);
  const applied = await owner.post('/api/restaurants', application(n));
  const restaurantId: string = applied.body.session.memberships[0].restaurantId;
  const admin = new Browser(base);
  await admin.post('/api/auth/login', { identifier: 'admin', password: ADMIN_PASSWORD });
  await admin.put(`/api/admin/restaurants/${restaurantId}/status`, { status: 'approved' });
  return { owner, restaurantId };
}
