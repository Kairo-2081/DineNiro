/**
 * One dinner service end to end: setup, seating, ordering, the kitchen, billing and payment.
 * Needs TEST_DATABASE_URL (the database is wiped); skipped without it.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { approvedRestaurant, Browser, skipWithoutDatabase, startTestServer } from './helpers.ts';

describe('Dinner service', { skip: skipWithoutDatabase }, () => {
  let base = '';
  let stop: () => Promise<void> = async () => {};
  let owner: Browser;
  let rid = '';
  const staff: Record<string, Browser> = {};
  const ids: Record<string, string> = {};
  const r = (path: string) => `/api/restaurants/${rid}${path}`;

  before(async () => {
    const server = await startTestServer();
    base = server.base;
    stop = server.stop;
    ({ owner, restaurantId: rid } = await approvedRestaurant(base, 1));
    for (const role of ['waiter', 'chef', 'cashier', 'host']) {
      await owner.post(r('/staff'), { name: role, email: `${role}@example.com`, password: `${role}-password`, role });
      staff[role] = new Browser(base);
      const login = await staff[role].post('/api/auth/login', { identifier: role, password: `${role}-password` });
      assert.equal(login.status, 200);
    }
  });

  after(() => stop());

  test('owners set up billing, tables and the menu; other roles cannot', async () => {
    const settings = await owner.patch(r('/settings'), { serviceChargePct: 10, vatPct: 5, receiptFooter: 'Thank you' });
    assert.equal(settings.body.vatPct, 5);
    assert.equal((await staff.waiter.patch(r('/settings'), { vatPct: 0 })).status, 403);

    ids.t1 = (await owner.post(r('/tables'), { label: 'T1', seats: 4 })).body.id;
    ids.t2 = (await owner.post(r('/tables'), { label: 'T2', seats: 2, shape: 'round' })).body.id;
    assert.equal((await owner.post(r('/tables'), { label: 't1', seats: 2 })).status, 409, 'table names are unique ignoring case');

    ids.rice = (await owner.post(r('/categories'), { name: 'Rice' })).body.id;
    ids.drinks = (await owner.post(r('/categories'), { name: 'Drinks' })).body.id;
    const kacchi = await owner.post(r('/menu-items'), {
      categoryId: ids.rice, name: 'Kacchi Biryani', price: 480, options: [{ name: 'Extra aloo', priceDelta: 30 }, { name: 'Less oil' }],
    });
    assert.equal(kacchi.status, 201);
    ids.kacchi = kacchi.body.id;
    ids.extraAloo = kacchi.body.options[0].id;
    ids.borhani = (await owner.post(r('/menu-items'), { categoryId: ids.drinks, name: 'Borhani', price: 90, station: 'bar' })).body.id;
    const lassi = await owner.post(r('/menu-items'), { categoryId: ids.drinks, name: 'Mango Lassi', price: 140, station: 'bar', available: false });
    ids.lassi = lassi.body.id;
    ids.firni = (await owner.post(r('/menu-items'), { categoryId: ids.rice, name: 'Firni', price: 120, options: [{ name: 'Pistachio', priceDelta: 20 }] })).body.id;
    assert.equal((await owner.delete(r(`/categories/${ids.rice}`))).status, 409, 'a category with dishes cannot be removed');

    const menu = await staff.waiter.get(r('/menu'));
    assert.deepEqual(menu.body.map((c: any) => c.items.length), [2, 2]);
  });

  test('a host seats the table, and it cannot be seated twice', async () => {
    const floor = await staff.host.get(r('/floor'));
    assert.deepEqual(floor.body.map((t: any) => t.state), ['free', 'free']);
    const order = await staff.host.post(r('/orders'), { tableId: ids.t1, guests: 4 });
    assert.equal(order.status, 201);
    ids.order = order.body.id;
    assert.equal((await staff.waiter.post(r('/orders'), { tableId: ids.t1, guests: 2 })).status, 409);
    assert.equal((await staff.host.post(r(`/orders/${ids.order}/items`), { menuItemId: ids.borhani })).status, 403, 'hosts seat, waiters order');
  });

  test('the waiter orders: options are priced in, sold-out and foreign options are refused', async () => {
    const add = (body: object) => staff.waiter.post(r(`/orders/${ids.order}/items`), body);
    const first = await add({ menuItemId: ids.kacchi, quantity: 2, optionIds: [ids.extraAloo], note: 'one without chilli' });
    assert.equal(first.body.lines[0].unitPrice, 510);
    assert.deepEqual(first.body.lines[0].options, ['Extra aloo']);
    await add({ menuItemId: ids.borhani, quantity: 4 });
    assert.match((await add({ menuItemId: ids.lassi })).body.error, /sold out/);
    assert.match((await add({ menuItemId: ids.borhani, optionIds: [ids.extraAloo] })).body.error, /does not belong/);

    assert.match((await staff.waiter.post(r(`/orders/${ids.order}/bill`), {})).body.error, /send or remove/);
    const floor = await staff.waiter.get(r('/floor'));
    assert.equal(floor.body[0].unsentItems, 2);
  });

  test('sending makes one kitchen ticket that moves step by step', async () => {
    const sent = await staff.waiter.post(r(`/orders/${ids.order}/send`));
    assert.ok(sent.body.lines.every((l: any) => l.status === 'sent' && l.ticketStatus === 'new'));
    assert.equal((await staff.waiter.get(r('/floor'))).body[0].state, 'cooking');

    const kitchen = await staff.chef.get(r('/kitchen'));
    const ticket = kitchen.body.tickets[0];
    assert.equal(ticket.tableLabel, 'T1');
    assert.equal(ticket.items.length, 2);

    assert.equal((await staff.waiter.post(r(`/kitchen/${ticket.id}/advance`), { from: 'new' })).status, 403, 'waiters cannot start cooking');
    assert.equal((await staff.chef.post(r(`/kitchen/${ticket.id}/advance`), { from: 'new' })).body.status, 'cooking');
    const stale = await staff.chef.post(r(`/kitchen/${ticket.id}/advance`), { from: 'new' });
    assert.equal(stale.status, 409, 'a second tap with the old status does not skip a step');
    await staff.chef.post(r(`/kitchen/${ticket.id}/advance`), { from: 'cooking' });
    assert.equal((await staff.waiter.get(r('/floor'))).body[0].state, 'ready');
    assert.equal((await staff.waiter.post(r(`/kitchen/${ticket.id}/advance`), { from: 'ready' })).body.status, 'served');
    assert.equal((await staff.waiter.get(r('/floor'))).body[0].state, 'served');
  });

  test('sent dishes can only be voided by a manager or owner, with a reason', async () => {
    const order = await staff.waiter.post(r(`/orders/${ids.order}/items`), { menuItemId: ids.firni });
    await staff.waiter.post(r(`/orders/${ids.order}/send`));
    const firniLine = order.body.lines.find((l: any) => l.name === 'Firni').id;
    assert.match((await staff.waiter.patch(r(`/orders/${ids.order}/items/${firniLine}`), { quantity: 0 })).body.error, /already gone to the kitchen/);
    assert.equal((await staff.waiter.post(r(`/orders/${ids.order}/items/${firniLine}/void`), { reason: 'x' })).status, 403);
    const voided = await owner.post(r(`/orders/${ids.order}/items/${firniLine}/void`), { reason: 'Guest changed their mind' });
    assert.equal(voided.body.lines.find((l: any) => l.id === firniLine).status, 'void');
  });

  test('the bill: discount, then service charge, then VAT; adding food reopens it', async () => {
    assert.equal((await staff.waiter.post(r(`/orders/${ids.order}/bill`), { discount: 80 })).status, 403, 'only managers and owners discount');
    let bill = (await owner.post(r(`/orders/${ids.order}/bill`), { discount: 80 })).body;
    // (2 x 510 + 4 x 90) = 1380, less 80 = 1300; service 10% = 130; VAT 5% of 1430 = 71.50
    assert.deepEqual([bill.subtotal, bill.discount, bill.serviceCharge, bill.vat, bill.total], [1380, 80, 130, 71.5, 1501.5]);
    assert.equal((await staff.waiter.get(r('/floor'))).body[0].state, 'bill');

    const reopened = await staff.waiter.post(r(`/orders/${ids.order}/items`), { menuItemId: ids.borhani });
    assert.equal(reopened.body.status, 'open');
    assert.equal(reopened.body.billId, null);
    const extra = reopened.body.lines.find((l: any) => l.status === 'draft').id;
    await staff.waiter.patch(r(`/orders/${ids.order}/items/${extra}`), { quantity: 0 });

    bill = (await owner.post(r(`/orders/${ids.order}/bill`), { discount: 80 })).body;
    assert.equal(bill.total, 1501.5);
    ids.bill = bill.id;
  });

  test('payments split across methods, and the table frees itself when paid', async () => {
    const pay = (body: object, who = staff.cashier) => who.post(r(`/bills/${ids.bill}/payments`), body);
    assert.equal((await pay({ method: 'cash', amount: 100 }, staff.chef)).status, 403);
    assert.match((await pay({ method: 'card', amount: 2000 })).body.error, /only 1501\.50 is left/);
    assert.equal((await pay({ method: 'bkash', amount: 500 })).status, 400, 'bKash needs a transaction ID');

    const partial = await pay({ method: 'bkash', amount: 500, reference: 'TRX8F2K91' });
    assert.deepEqual([partial.body.paid, partial.body.status], [500, 'open']);
    assert.match((await staff.waiter.post(r(`/orders/${ids.order}/items`), { menuItemId: ids.borhani })).body.error, /already paid/);

    const settled = await pay({ method: 'cash', amount: 1001.5, tendered: 1100 });
    assert.deepEqual([settled.body.paid, settled.body.status], [1501.5, 'paid']);
    assert.equal((await pay({ method: 'cash', amount: 1 })).status, 409);
    assert.deepEqual((await staff.waiter.get(r('/floor'))).body.map((t: any) => t.state), ['free', 'free']);

    const receipt = await staff.cashier.get(r(`/bills/${ids.bill}`));
    assert.deepEqual(receipt.body.lines.map((l: any) => l.name), ['Kacchi Biryani', 'Borhani'], 'voided dishes are not printed');
    assert.equal(receipt.body.restaurant.receiptFooter, 'Thank you');
    assert.equal(receipt.body.bill.payments[1].tendered, 1100);
  });

  test('guests who leave before ordering can be cancelled; tables in use cannot be removed', async () => {
    const order = await staff.waiter.post(r('/orders'), { tableId: ids.t2, guests: 2 });
    const t2 = { label: 'T2', seats: 2, active: false };
    assert.match((await owner.put(r(`/tables/${ids.t2}`), t2)).body.error, /still at this table/);
    assert.equal((await staff.waiter.post(r(`/orders/${order.body.id}/void`))).body.status, 'void');
    assert.equal((await owner.put(r(`/tables/${ids.t2}`), t2)).body.active, false);
    assert.equal((await staff.waiter.get(r('/floor'))).body.length, 1);
  });

  test('another restaurant cannot touch these tables, dishes or orders', async () => {
    const other = await approvedRestaurant(base, 2);
    const o = (path: string) => `/api/restaurants/${other.restaurantId}${path}`;
    const table = (await other.owner.post(o('/tables'), { label: 'A1', seats: 2 })).body.id;
    const order = (await other.owner.post(o('/orders'), { tableId: table, guests: 2 })).body.id;

    assert.equal((await other.owner.get(r(`/orders/${ids.order}`))).status, 404);
    assert.equal((await other.owner.post(o('/orders'), { tableId: ids.t1, guests: 2 })).status, 409, 'cannot seat a table of restaurant 1');
    assert.match((await other.owner.post(o(`/orders/${order}/items`), { menuItemId: ids.kacchi })).body.error, /not on the menu/);
    assert.equal((await other.owner.get(o(`/orders/${ids.order}`))).status, 404, 'restaurant 1 order is invisible through restaurant 2');
    assert.equal((await other.owner.get(o(`/bills/${ids.bill}`))).status, 404);
    assert.equal((await other.owner.post(o(`/kitchen/x/advance`), { from: 'new' })).status, 404);
  });
});
