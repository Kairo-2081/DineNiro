/**
 * Ingredients, recipes, and stock moving with service: sales, voids, deliveries, counts and waste.
 * Needs TEST_DATABASE_URL (the database is wiped); skipped without it.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { approvedRestaurant, Browser, skipWithoutDatabase, startTestServer } from './helpers.ts';

describe('Inventory', { skip: skipWithoutDatabase }, () => {
  let base = '';
  let stop: () => Promise<void> = async () => {};
  let owner: Browser;
  const staff: Record<string, Browser> = {};
  let rid = '';
  const ids: Record<string, string> = {};
  const r = (path: string) => `/api/restaurants/${rid}${path}`;
  const ingredient = async (id: string) => (await owner.get(r('/ingredients'))).body.find((i: any) => i.id === id);
  const kacchi = async () => (await owner.get(r('/menu'))).body.flatMap((c: any) => c.items).find((i: any) => i.id === ids.kacchi);

  before(async () => {
    const server = await startTestServer();
    base = server.base;
    stop = server.stop;
    ({ owner, restaurantId: rid } = await approvedRestaurant(base, 1));
    for (const role of ['waiter', 'chef']) {
      await owner.post(r('/staff'), { name: role, email: `${role}@example.com`, password: `${role}-password`, role });
      staff[role] = new Browser(base);
      await staff[role].post('/api/auth/login', { identifier: role, password: `${role}-password` });
    }
    ids.table = (await owner.post(r('/tables'), { label: 'T1', seats: 4 })).body.id;
    ids.cat = (await owner.post(r('/categories'), { name: 'Rice' })).body.id;
    ids.kacchi = (await owner.post(r('/menu-items'), { categoryId: ids.cat, name: 'Kacchi Biryani', price: 480 })).body.id;
  });

  after(() => stop());

  test('owners set up ingredients and recipes; chefs can look but not change them; waiters cannot see stock', async () => {
    const rice = await owner.post(r('/ingredients'), { name: 'Kalijira rice', category: 'Dry goods', unit: 'kg', parLevel: 10, unitCost: 160, supplier: 'Karwan Bazar' });
    assert.equal(rice.status, 201);
    ids.rice = rice.body.id;
    ids.mutton = (await owner.post(r('/ingredients'), { name: 'Mutton', category: 'Meat', unit: 'kg', parLevel: 5, unitCost: 1150 })).body.id;
    ids.potato = (await owner.post(r('/ingredients'), { name: 'Potato', unit: 'pc', parLevel: 20, unitCost: 8 })).body.id;
    assert.equal((await owner.post(r('/ingredients'), { name: 'kalijira RICE', unit: 'kg' })).status, 409);
    assert.equal((await staff.chef.post(r('/ingredients'), { name: 'Ghee', unit: 'l' })).status, 403);
    assert.equal((await staff.waiter.get(r('/ingredients'))).status, 403);

    const recipe = await owner.put(r(`/recipes/${ids.kacchi}`), { lines: [
      { ingredientId: ids.rice, quantity: 0.18 }, { ingredientId: ids.mutton, quantity: 0.22 }, { ingredientId: ids.potato, quantity: 1 },
    ] });
    assert.equal(recipe.body.length, 3);
    assert.equal((await staff.chef.get(r(`/recipes/${ids.kacchi}`))).body.length, 3);
    assert.equal((await owner.put(r(`/recipes/${ids.kacchi}`), { lines: [{ ingredientId: ids.rice, quantity: 0 }] })).status, 400);

    const dish = await kacchi();
    // 0.18 x 160 + 0.22 x 1150 + 1 x 8 = 28.80 + 253 + 8 = 289.80
    assert.equal(dish.foodCost, 289.8);
    assert.equal(dish.portionsLeft, 0, 'nothing has been delivered yet');
    const plain = (await owner.post(r('/menu-items'), { categoryId: ids.cat, name: 'Plain rice', price: 60 })).body;
    assert.deepEqual([plain.portionsLeft, plain.foodCost], [null, null], 'a dish without a recipe has no stock limit');
  });

  test('deliveries, counts and waste move stock, and every change is in the ledger', async () => {
    await staff.chef.post(r(`/ingredients/${ids.rice}/stock`), { kind: 'delivery', quantity: 25, unitCost: 165, note: 'Invoice 4410' });
    await staff.chef.post(r(`/ingredients/${ids.mutton}/stock`), { kind: 'delivery', quantity: 4 });
    await staff.chef.post(r(`/ingredients/${ids.potato}/stock`), { kind: 'delivery', quantity: 40 });
    assert.equal((await ingredient(ids.rice)).unitCost, 165, 'a delivery with a price updates the cost');

    const counted = await staff.chef.post(r(`/ingredients/${ids.rice}/stock`), { kind: 'count', quantity: 24.5 });
    assert.equal(counted.body.onHand, 24.5);
    assert.equal((await staff.chef.post(r(`/ingredients/${ids.mutton}/stock`), { kind: 'waste', quantity: 0.5 })).status, 400, 'waste needs a reason');
    const wasted = await staff.chef.post(r(`/ingredients/${ids.mutton}/stock`), { kind: 'waste', quantity: 0.5, note: 'Left out overnight' });
    assert.equal(wasted.body.onHand, 3.5);

    const history = (await staff.chef.get(r(`/ingredients/${ids.rice}/history`))).body;
    assert.deepEqual(history.map((m: any) => [m.reason, m.change]), [['count', -0.5], ['delivery', 25]]);
    assert.equal(history[1].note, 'Invoice 4410');
    // Mutton limits it: 3.5 / 0.22 = 15.9 -> 15 portions.
    assert.equal((await kacchi()).portionsLeft, 15);
  });

  test('sending dishes uses their recipe; a void before cooking puts it back, after cooking does not', async () => {
    const order = (await staff.waiter.post(r('/orders'), { tableId: ids.table, guests: 4 })).body.id;
    await staff.waiter.post(r(`/orders/${order}/items`), { menuItemId: ids.kacchi, quantity: 2 });
    assert.equal((await ingredient(ids.rice)).onHand, 24.5, 'unsent dishes use nothing');
    const sent = await staff.waiter.post(r(`/orders/${order}/send`));
    assert.equal((await ingredient(ids.rice)).onHand, 24.14);
    assert.equal((await ingredient(ids.mutton)).onHand, 3.06);
    assert.equal((await ingredient(ids.potato)).onHand, 38);
    assert.equal((await ingredient(ids.rice)).usedToday, 0.36);

    const history = (await owner.get(r(`/ingredients/${ids.mutton}/history`))).body;
    assert.deepEqual([history[0].reason, history[0].dish, history[0].tableLabel], ['sale', 'Kacchi Biryani', 'T1']);

    const line = sent.body.lines[0].id;
    await owner.post(r(`/orders/${order}/items/${line}/void`), { reason: 'Wrong table' });
    assert.equal((await ingredient(ids.rice)).onHand, 24.5, 'voided before the kitchen started: stock returned');
    const floor = (await staff.waiter.get(r('/floor'))).body[0];
    assert.equal(floor.state, 'served', 'a ticket with every dish voided closes, so the table no longer shows as cooking');

    await staff.waiter.post(r(`/orders/${order}/items`), { menuItemId: ids.kacchi, quantity: 1 });
    const second = await staff.waiter.post(r(`/orders/${order}/send`));
    const cooking = second.body.lines.find((l: any) => l.status === 'sent').id;
    const ticket = (await staff.chef.get(r('/kitchen'))).body.tickets.find((k: any) => k.items.some((i: any) => i.id === cooking));
    await staff.chef.post(r(`/kitchen/${ticket.id}/advance`), { from: 'new' });
    await owner.post(r(`/orders/${order}/items/${cooking}/void`), { reason: 'Guest left' });
    assert.equal((await ingredient(ids.rice)).onHand, 24.32, 'voided after cooking started: the food is gone');
  });

  test('low stock: the list shows on-hand against par so the kitchen can reorder', async () => {
    const mutton = await ingredient(ids.mutton);
    assert.ok(mutton.onHand < mutton.parLevel);
    assert.equal(mutton.dishes, 1);
    const rice = await ingredient(ids.rice);
    assert.ok(rice.onHand > rice.parLevel);
  });

  test('a unit cannot change once stock is recorded; other restaurants cannot touch this stock', async () => {
    assert.match((await owner.put(r(`/ingredients/${ids.rice}`), { name: 'Kalijira rice', unit: 'g' })).body.error, /unit cannot change/);
    const other = await approvedRestaurant(base, 2);
    const o = (path: string) => `/api/restaurants/${other.restaurantId}${path}`;
    assert.equal((await other.owner.post(o(`/ingredients/${ids.rice}/stock`), { kind: 'delivery', quantity: 1 })).status, 404);
    assert.equal((await other.owner.put(o(`/ingredients/${ids.rice}`), { name: 'x', unit: 'kg' })).status, 404);
    const theirCat = (await other.owner.post(o('/categories'), { name: 'Rice' })).body.id;
    const theirDish = (await other.owner.post(o('/menu-items'), { categoryId: theirCat, name: 'Tehari', price: 300 })).body.id;
    assert.match((await other.owner.put(o(`/recipes/${theirDish}`), { lines: [{ ingredientId: ids.rice, quantity: 1 }] })).body.error, /not in your stock list/);
    assert.deepEqual((await other.owner.get(o('/ingredients'))).body, []);
  });
});
