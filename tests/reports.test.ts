/**
 * Reports: headline figures, payment mix, dishes, staff and food cost, from paid bills only.
 * Needs TEST_DATABASE_URL (the database is wiped); skipped without it.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { approvedRestaurant, Browser, skipWithoutDatabase, startTestServer } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;

describe('Reports', { skip: skipWithoutDatabase }, () => {
  let base = '';
  let stop: () => Promise<void> = async () => {};
  let owner: Browser;
  const staff: Record<string, Browser> = {};
  let rid = '';
  const r = (path: string) => `/api/restaurants/${rid}${path}`;
  const today = () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return `from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(new Date(start.getTime() + DAY).toISOString())}&tz=UTC`;
  };

  before(async () => {
    const server = await startTestServer();
    base = server.base;
    stop = server.stop;
    ({ owner, restaurantId: rid } = await approvedRestaurant(base, 1));
    await owner.patch(r('/settings'), { serviceChargePct: 10, vatPct: 5 });
    for (const role of ['waiter', 'cashier']) {
      await owner.post(r('/staff'), { name: role === 'waiter' ? 'Rafi Ahmed' : 'Sumi', email: `${role}@example.com`, password: `${role}-password`, role });
      staff[role] = new Browser(base);
      await staff[role].post('/api/auth/login', { identifier: role, password: `${role}-password` });
    }
    const t1 = (await owner.post(r('/tables'), { label: 'T1', seats: 4 })).body.id;
    const t2 = (await owner.post(r('/tables'), { label: 'T2', seats: 2 })).body.id;
    const t3 = (await owner.post(r('/tables'), { label: 'T3', seats: 2 })).body.id;
    const cat = (await owner.post(r('/categories'), { name: 'Rice' })).body.id;
    const kacchi = (await owner.post(r('/menu-items'), { categoryId: cat, name: 'Kacchi Biryani', price: 480 })).body.id;
    const borhani = (await owner.post(r('/menu-items'), { categoryId: cat, name: 'Borhani', price: 90 })).body.id;
    const rice = (await owner.post(r('/ingredients'), { name: 'Rice', unit: 'kg', unitCost: 160 })).body.id;
    await owner.post(r(`/ingredients/${rice}/stock`), { kind: 'delivery', quantity: 10 });
    await owner.put(r(`/recipes/${kacchi}`), { lines: [{ ingredientId: rice, quantity: 0.2 }] }); // ৳32 a plate

    const w = staff.waiter;
    // Bill A: 2 Kacchi, ৳60 discount, paid in cash.
    const a = (await w.post(r('/orders'), { tableId: t1, guests: 4 })).body.id;
    await w.post(r(`/orders/${a}/items`), { menuItemId: kacchi, quantity: 2 });
    await w.post(r(`/orders/${a}/send`));
    const billA = (await owner.post(r(`/orders/${a}/bill`), { discount: 60 })).body;
    await staff.cashier.post(r(`/bills/${billA.id}/payments`), { method: 'cash', amount: billA.total, tendered: 1100 });

    // Bill B: 1 Kacchi kept, 1 voided before cooking, 2 Borhani (no recipe), split bKash + card.
    const b = (await w.post(r('/orders'), { tableId: t2, guests: 2 })).body.id;
    await w.post(r(`/orders/${b}/items`), { menuItemId: kacchi, quantity: 1 });
    const voidMe = (await w.post(r(`/orders/${b}/send`))).body.lines[0].id;
    await owner.post(r(`/orders/${b}/items/${voidMe}/void`), { reason: 'Wrong order' });
    await w.post(r(`/orders/${b}/items`), { menuItemId: kacchi, quantity: 1 });
    await w.post(r(`/orders/${b}/items`), { menuItemId: borhani, quantity: 2 });
    await w.post(r(`/orders/${b}/send`));
    const billB = (await w.post(r(`/orders/${b}/bill`))).body;
    await staff.cashier.post(r(`/bills/${billB.id}/payments`), { method: 'bkash', amount: 300, reference: 'TRX1' });
    await staff.cashier.post(r(`/bills/${billB.id}/payments`), { method: 'card', amount: Math.round((billB.total - 300) * 100) / 100 });

    // An unpaid bill never counts.
    const c = (await w.post(r('/orders'), { tableId: t3, guests: 2 })).body.id;
    await w.post(r(`/orders/${c}/items`), { menuItemId: borhani, quantity: 1 });
    await w.post(r(`/orders/${c}/send`));
    await w.post(r(`/orders/${c}/bill`));
  });

  after(() => stop());

  test('headline figures add up from paid bills only', async () => {
    const report = (await owner.get(r(`/reports?${today()}`))).body;
    const s = report.summary;
    // A: food 960, discount 60, service 90, VAT 49.50, total 1,039.50
    // B: food 480 + 180 = 660, service 66, VAT 36.30, total 762.30
    assert.deepEqual(
      [s.bills, s.covers, s.foodSales, s.discounts, s.discountedBills, s.netSales, s.serviceCharge, s.vat, s.total],
      [2, 6, 1620, 60, 1, 1560, 156, 85.8, 1801.8],
    );
    assert.equal(s.averageCheck, 900.9);
    assert.equal(s.perCover, 300.3);
    assert.deepEqual([s.voidedLines, s.voidedValue], [1, 480]);
    // Food cost covers dishes with a recipe: 3 Kacchi sold x ৳32; the early void was returned to stock.
    assert.deepEqual([s.foodCost, s.costedSales], [96, 1440]);
    assert.equal(report.previous.bills, 0);
    assert.equal(report.bucket, 'hour');
    assert.equal(report.series.reduce((n: number, p: any) => n + p.bills, 0), 2);
  });

  test('payment mix, top dishes and staff', async () => {
    const report = (await owner.get(r(`/reports?${today()}`))).body;
    const mix = Object.fromEntries(report.payments.map((p: any) => [p.method, p.amount]));
    assert.deepEqual(mix, { cash: 1039.5, card: 462.3, bkash: 300 }, 'cash counts what was kept, not the ৳1,100 handed over');
    assert.deepEqual(report.dishes.map((d: any) => [d.name, d.quantity, d.sales]), [['Kacchi Biryani', 3, 1440], ['Borhani', 2, 180]]);
    assert.equal(report.staff.length, 1);
    assert.deepEqual([report.staff[0].name, report.staff[0].tables, report.staff[0].covers, report.staff[0].total], ['Rafi Ahmed', 2, 6, 1801.8]);
  });

  test('longer ranges group by day, and today becomes the comparison period for tomorrow', async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const week = await owner.get(r(`/reports?from=${encodeURIComponent(new Date(start.getTime() - 6 * DAY).toISOString())}&to=${encodeURIComponent(new Date(start.getTime() + DAY).toISOString())}&tz=Asia/Dhaka`));
    assert.equal(week.body.bucket, 'day');
    assert.equal(week.body.summary.total, 1801.8);
    const tomorrow = await owner.get(r(`/reports?from=${encodeURIComponent(new Date(start.getTime() + DAY).toISOString())}&to=${encodeURIComponent(new Date(start.getTime() + 2 * DAY).toISOString())}&tz=UTC`));
    assert.deepEqual([tomorrow.body.summary.bills, tomorrow.body.previous.total], [0, 1801.8]);
  });

  test('only owners and managers see reports; bad input and other restaurants get nothing', async () => {
    assert.equal((await staff.waiter.get(r(`/reports?${today()}`))).status, 403);
    assert.equal((await staff.cashier.get(r(`/reports?${today()}`))).status, 403);
    assert.equal((await owner.get(r(`/reports?${today().replace('tz=UTC', 'tz=Mars/Olympus')}`))).status, 400);
    assert.equal((await owner.get(r('/reports?from=2026-01-02&to=2026-01-01&tz=UTC'))).status, 400);
    const other = await approvedRestaurant(base, 2);
    assert.equal((await other.owner.get(r(`/reports?${today()}`))).status, 404);
    const theirs = await other.owner.get(`/api/restaurants/${other.restaurantId}/reports?${today()}`);
    assert.equal(theirs.body.summary.bills, 0);
  });
});
