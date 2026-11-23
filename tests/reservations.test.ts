/**
 * Bookings, double-booking protection, seating and the walk-in waitlist.
 * Needs TEST_DATABASE_URL (the database is wiped); skipped without it.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { approvedRestaurant, Browser, skipWithoutDatabase, startTestServer } from './helpers.ts';

const HOUR = 60 * 60 * 1000;
/** Tomorrow at the given local hour, so tests never depend on the time they run. */
function tomorrowAt(hour: number, minute = 0) {
  const d = new Date(Date.now() + 24 * HOUR);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

describe('Reservations and waitlist', { skip: skipWithoutDatabase }, () => {
  let base = '';
  let stop: () => Promise<void> = async () => {};
  let owner: Browser;
  let host: Browser;
  let chef: Browser;
  let rid = '';
  const ids: Record<string, string> = {};
  const r = (path: string) => `/api/restaurants/${rid}${path}`;
  const book = (who: Browser, body: object) =>
    who.post(r('/reservations'), { guestName: 'Rahman', partySize: 4, durationMinutes: 90, ...body });

  before(async () => {
    const server = await startTestServer();
    base = server.base;
    stop = server.stop;
    ({ owner, restaurantId: rid } = await approvedRestaurant(base, 1));
    ids.t1 = (await owner.post(r('/tables'), { label: 'T1', seats: 4 })).body.id;
    ids.t2 = (await owner.post(r('/tables'), { label: 'T2', seats: 2 })).body.id;
    ids.t3 = (await owner.post(r('/tables'), { label: 'T3', seats: 6 })).body.id;
    for (const role of ['host', 'chef']) {
      await owner.post(r('/staff'), { name: role, email: `${role}@example.com`, password: `${role}-password`, role });
    }
    host = new Browser(base);
    await host.post('/api/auth/login', { identifier: 'host', password: 'host-password' });
    chef = new Browser(base);
    await chef.post('/api/auth/login', { identifier: 'chef', password: 'chef-password' });
  });

  after(() => stop());

  test('a table cannot be double-booked; back-to-back bookings are fine', async () => {
    const first = await book(host, { tableId: ids.t1, startsAt: tomorrowAt(19) });
    assert.equal(first.status, 201);
    assert.equal(first.body.tableLabel, 'T1');
    ids.booking = first.body.id;

    const overlap = await book(host, { tableId: ids.t1, startsAt: tomorrowAt(19, 30), guestName: 'Karim' });
    assert.equal(overlap.status, 409);
    assert.match(overlap.body.error, /already booked/);
    assert.equal((await book(host, { tableId: ids.t1, startsAt: tomorrowAt(20, 30), guestName: 'Hossain' })).status, 201);
    assert.match((await book(host, { tableId: ids.t2, startsAt: tomorrowAt(19), partySize: 7 })).body.error, /too few/);
    assert.match((await book(host, { tableId: ids.t2, startsAt: new Date(Date.now() - 2 * HOUR).toISOString() })).body.error, /passed/);
  });

  test('two hosts booking the same slot at the same moment: exactly one wins', async () => {
    const results = await Promise.all([
      book(host, { tableId: ids.t2, startsAt: tomorrowAt(13), partySize: 2, guestName: 'Sadia' }),
      book(owner, { tableId: ids.t2, startsAt: tomorrowAt(13, 15), partySize: 2, guestName: 'Imran' }),
    ]);
    assert.deepEqual(results.map((x) => x.status).sort(), [201, 409]);
  });

  test('availability suggests free tables that fit, smallest first', async () => {
    const res = await host.get(r(`/availability?startsAt=${encodeURIComponent(tomorrowAt(19))}&minutes=90&party=4`));
    assert.deepEqual(res.body.map((t: any) => t.label), ['T3', 'T2'], 'T1 is booked; T3 fits; T2 is two short so comes last');
  });

  test('moving and cancelling a booking frees its time', async () => {
    const moved = await host.put(r(`/reservations/${ids.booking}`), {
      tableId: ids.t1, guestName: 'Rahman', partySize: 4, startsAt: tomorrowAt(18), durationMinutes: 90, note: 'Birthday',
    });
    assert.equal(moved.body.note, 'Birthday');
    // Moved to 18:00-19:30, so 19:30-20:30 is now free between it and the 20:30 booking.
    assert.equal((await book(host, { tableId: ids.t1, startsAt: tomorrowAt(19, 30), durationMinutes: 60, guestName: 'Karim' })).status, 201);
  });

  test('cancelled bookings free the table', async () => {
    const extra = await book(host, { tableId: ids.t3, startsAt: tomorrowAt(21), guestName: 'Mitra' });
    assert.equal((await host.post(r(`/reservations/${extra.body.id}/close`), { status: 'cancelled' })).body.status, 'cancelled');
    assert.equal((await book(host, { tableId: ids.t3, startsAt: tomorrowAt(21), guestName: 'Alam' })).status, 201);
    assert.match((await host.post(r(`/reservations/${extra.body.id}/close`), { status: 'no_show' })).body.error, /no longer upcoming/);
  });

  test('a booking within the hour shows on the floor; seating it opens the table and closing the visit completes it', async () => {
    const soon = await book(host, { tableId: ids.t2, partySize: 2, guestName: 'Nusrat', startsAt: new Date(Date.now() + 20 * 60_000).toISOString() });
    assert.equal(soon.status, 201);
    let floor = await host.get(r('/floor'));
    const t2 = floor.body.find((t: any) => t.label === 'T2');
    assert.equal(t2.state, 'reserved');
    assert.equal(t2.nextBooking.guestName, 'Nusrat');

    const seated = await host.post(r(`/reservations/${soon.body.id}/seat`));
    assert.ok(seated.body.orderId);
    floor = await host.get(r('/floor'));
    assert.equal(floor.body.find((t: any) => t.label === 'T2').state, 'seated');
    assert.match((await host.post(r(`/reservations/${soon.body.id}/seat`))).body.error, /no longer upcoming/);

    await owner.post(r(`/orders/${seated.body.orderId}/void`));
    const today = await host.get(r(`/reservations?from=${encodeURIComponent(new Date(Date.now() - HOUR).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 2 * HOUR).toISOString())}`));
    assert.equal(today.body.find((b: any) => b.id === soon.body.id).status, 'completed');
  });

  test('the waitlist seats walk-ins, but not at a table booked within the hour', async () => {
    const soon = await book(host, { tableId: ids.t3, partySize: 5, guestName: 'Office party', startsAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    assert.equal(soon.status, 201);
    const walkIn = await host.post(r('/waitlist'), { guestName: 'Mahmud family', partySize: 4, quotedMinutes: 20, phone: '01711000000' });
    assert.equal(walkIn.status, 201);
    await host.post(r('/waitlist'), { guestName: 'Sadia R.', partySize: 2 });
    assert.deepEqual((await host.get(r('/waitlist'))).body.map((w: any) => w.guestName), ['Mahmud family', 'Sadia R.']);

    assert.match((await host.post(r(`/waitlist/${walkIn.body.id}/seat`), { tableId: ids.t3 })).body.error, /booking within the next hour/);
    const seated = await host.post(r(`/waitlist/${walkIn.body.id}/seat`), { tableId: ids.t1 });
    assert.ok(seated.body.orderId);
    const sadia = (await host.get(r('/waitlist'))).body[0].id;
    assert.equal((await host.post(r(`/waitlist/${sadia}/left`))).status, 204);
    assert.deepEqual((await host.get(r('/waitlist'))).body, []);
  });

  test('chefs do not handle bookings; other restaurants cannot see them', async () => {
    assert.equal((await chef.get(r(`/reservations?from=${encodeURIComponent(tomorrowAt(0))}&to=${encodeURIComponent(tomorrowAt(23))}`))).status, 403);
    assert.equal((await chef.post(r('/waitlist'), { guestName: 'X', partySize: 2 })).status, 403);

    const other = await approvedRestaurant(base, 2);
    const o = (path: string) => `/api/restaurants/${other.restaurantId}${path}`;
    assert.equal((await other.owner.post(o(`/reservations/${ids.booking}/close`), { status: 'cancelled' })).status, 404);
    assert.match((await other.owner.post(o('/reservations'), { tableId: ids.t1, guestName: 'X', partySize: 2, startsAt: tomorrowAt(15), durationMinutes: 60 })).body.error, /not on the floor/);
    const list = await other.owner.get(o(`/reservations?from=${encodeURIComponent(tomorrowAt(0))}&to=${encodeURIComponent(tomorrowAt(23, 59))}`));
    assert.deepEqual(list.body, []);
  });
});
