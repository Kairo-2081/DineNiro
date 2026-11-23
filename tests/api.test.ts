/**
 * End-to-end API tests against a real PostgreSQL database.
 * Set TEST_DATABASE_URL to a database these tests may wipe, for example:
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/dineniro_test npm test
 * Without it, this file is skipped.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ADMIN_PASSWORD = 'platform-admin-password';

/** A tiny client that keeps its own session cookie, like one browser. */
class Browser {
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

const application = (n: number) => ({
  ownerName: `Owner ${n}`, ownerEmail: `owner${n}@example.com`, ownerPhone: '01700000000',
  password: 'owner-password', restaurantName: `Restaurant ${n}`, restaurantPhone: '01800000000',
  address: 'Road 45', area: 'Gulshan', city: 'Dhaka', cuisine: 'Bangladeshi',
});

describe('DineNiro API', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL is not set' }, () => {
  let server: Server;
  let base = '';
  let closePool: () => Promise<void> = async () => {};

  before(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.DATABASE_SSL ??= 'false';
    process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-characters-long';
    process.env.DINENIRO_ADMIN_PASSWORD = ADMIN_PASSWORD;

    const db = await import('../src/db/index.ts');
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const seed = await import('../src/db/seed.ts');
    await seed.prepareDatabase();
    const { createApp } = await import('../server/app.ts');
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closePool = () => db.pool.end();
  });

  after(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await closePool();
  });

  const admin = () => new Browser(base);
  let ownerA: Browser;
  let restaurantA = '';

  test('guests can only reach sign-in and applying', async () => {
    const guest = new Browser(base);
    assert.equal((await guest.get('/api/admin/stats')).status, 401);
    assert.equal((await guest.get('/api/auth/me')).status, 401);
    assert.equal((await guest.post('/api/auth/login', { identifier: 'admin', password: 'wrong-password' })).status, 401);
  });

  test('an owner applies and the restaurant waits for approval', async () => {
    ownerA = new Browser(base);
    const res = await ownerA.post('/api/restaurants', application(1));
    assert.equal(res.status, 201);
    const [membership] = res.body.session.memberships;
    assert.equal(membership.role, 'owner');
    assert.equal(membership.restaurantStatus, 'pending');
    restaurantA = membership.restaurantId;

    const staff = await ownerA.get(`/api/restaurants/${restaurantA}/staff`);
    assert.equal(staff.status, 409, 'a pending restaurant cannot manage staff yet');
    assert.equal((await ownerA.get(`/api/restaurants/${restaurantA}`)).body.restaurant.status, 'pending');
  });

  test('applying twice with the same email is refused', async () => {
    const res = await new Browser(base).post('/api/restaurants', { ...application(1), restaurantName: 'Copy' });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /email/);
  });

  test('a platform admin approves, and every change is audited', async () => {
    const a = admin();
    assert.equal((await a.post('/api/auth/login', { identifier: 'admin', password: ADMIN_PASSWORD })).status, 200);
    const pending = await a.get('/api/admin/restaurants?status=pending');
    assert.deepEqual(pending.body.map((r: any) => r.id), [restaurantA]);
    assert.equal(pending.body[0].ownerEmail, 'owner1@example.com');

    const badMove = await a.put(`/api/admin/restaurants/${restaurantA}/status`, { status: 'suspended', reason: 'x' });
    assert.equal(badMove.status, 409, 'pending cannot jump straight to suspended');

    assert.equal((await a.put(`/api/admin/restaurants/${restaurantA}/status`, { status: 'approved' })).body.status, 'approved');
    const noReason = await a.put(`/api/admin/restaurants/${restaurantA}/status`, { status: 'suspended' });
    assert.equal(noReason.status, 409);
    assert.match(noReason.body.error, /reason/);

    const audit = await a.get('/api/admin/restaurants/audit');
    assert.deepEqual(audit.body.map((c: any) => [c.oldStatus, c.newStatus]), [['pending', 'approved'], [null, 'pending']]);
    assert.equal(audit.body[0].changedByName, 'Platform admin');
    assert.equal((await a.get('/api/admin/stats')).body.approved, 1);
  });

  test('owners and managers build the team within their limits', async () => {
    const waiter = await ownerA.post(`/api/restaurants/${restaurantA}/staff`, { name: 'Rafi', email: 'rafi@example.com', password: 'waiter-password', role: 'waiter' });
    assert.equal(waiter.status, 201);
    assert.equal(waiter.body.createdAccount, true);

    const managerAdd = await ownerA.post(`/api/restaurants/${restaurantA}/staff`, { name: 'Mina', email: 'mina@example.com', password: 'manager-password', role: 'manager' });
    assert.equal(managerAdd.status, 201);

    const manager = new Browser(base);
    assert.equal((await manager.post('/api/auth/login', { identifier: 'mina@example.com', password: 'manager-password' })).status, 200);
    assert.equal((await manager.post(`/api/restaurants/${restaurantA}/staff`, { name: 'X', email: 'x@example.com', password: 'xxxxxxxx', role: 'owner' })).status, 403);
    assert.equal((await manager.post(`/api/restaurants/${restaurantA}/staff`, { name: 'Habib', email: 'habib@example.com', password: 'chef-password', role: 'chef' })).status, 201);

    const ownerId = (await ownerA.get('/api/auth/me')).body.session.account.id;
    assert.equal((await manager.delete(`/api/restaurants/${restaurantA}/staff/${ownerId}`)).status, 403);
    assert.equal((await manager.patch(`/api/restaurants/${restaurantA}/staff/${waiter.body.member.userId}`, { role: 'cashier' })).body.role, 'cashier');

    const waiterBrowser = new Browser(base);
    await waiterBrowser.post('/api/auth/login', { identifier: 'rafi', password: 'waiter-password' });
    assert.equal((await waiterBrowser.get(`/api/restaurants/${restaurantA}/staff`)).status, 403, 'cashiers cannot manage staff');
    assert.equal((await waiterBrowser.get('/api/admin/restaurants')).status, 403, 'staff cannot reach platform admin');

    const team = await ownerA.get(`/api/restaurants/${restaurantA}/staff`);
    assert.deepEqual(team.body.map((m: any) => m.role), ['owner', 'manager', 'cashier', 'chef']);
  });

  test('the last owner cannot leave or be demoted', async () => {
    const ownerId = (await ownerA.get('/api/auth/me')).body.session.account.id;
    const remove = await ownerA.delete(`/api/restaurants/${restaurantA}/staff/${ownerId}`);
    assert.equal(remove.status, 409);
    assert.match(remove.body.error, /at least one active owner/);
    assert.equal((await ownerA.patch(`/api/restaurants/${restaurantA}/staff/${ownerId}`, { role: 'manager' })).status, 409);
  });

  test('one restaurant cannot see another', async () => {
    const ownerB = new Browser(base);
    const res = await ownerB.post('/api/restaurants', application(2));
    const restaurantB = res.body.session.memberships[0].restaurantId;
    assert.equal((await ownerB.get(`/api/restaurants/${restaurantA}`)).status, 404);
    assert.equal((await ownerB.get(`/api/restaurants/${restaurantA}/staff`)).status, 404);
    assert.equal((await ownerA.get(`/api/restaurants/${restaurantB}`)).status, 404);
  });

  test('suspending a restaurant locks staff management again', async () => {
    const a = admin();
    await a.post('/api/auth/login', { identifier: 'admin@dineniro.local', password: ADMIN_PASSWORD });
    await a.put(`/api/admin/restaurants/${restaurantA}/status`, { status: 'suspended', reason: 'Trade licence expired' });
    const res = await ownerA.get(`/api/restaurants/${restaurantA}/staff`);
    assert.equal(res.status, 409);
    const me = await ownerA.get('/api/auth/me');
    assert.equal(me.body.session.memberships[0].statusReason, 'Trade licence expired');
  });

  test('signing out revokes the session immediately', async () => {
    const b = new Browser(base);
    await b.post('/api/auth/login', { identifier: 'habib', password: 'chef-password' });
    const stolen = b.savedCookie;
    assert.equal((await b.post('/api/auth/logout')).status, 204);
    b.savedCookie = stolen;
    assert.equal((await b.get('/api/auth/me')).status, 401);
  });
});
