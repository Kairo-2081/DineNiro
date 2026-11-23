import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/index.ts';
import { requireMembership, type AuthRequest } from '../middleware/auth.ts';
import { isAmount, isIdentifier, isOptionalText, isText, isWholeNumber, mapRestaurant, money, respondApiError } from '../utils.ts';
import {
  PAYMENT_METHODS, type Bill, type BillSummary, type FloorTable, type KitchenTicket, type Order, type OrderLine,
  type PaymentMethod, type Receipt, type StaffRole, type TicketStatus,
} from '../../src/types.ts';

const router = Router();
const base = '/api/restaurants/:restaurantId';

const member = (...roles: StaffRole[]) => requireMembership({ roles, requireApproved: true });
const everyone = member();
const seating = member('owner', 'manager', 'waiter', 'host');
const ordering = member('owner', 'manager', 'waiter');
const supervisors = member('owner', 'manager');
const kitchenView = member('owner', 'manager', 'chef', 'waiter');
const billing = member('owner', 'manager', 'cashier', 'waiter');
const payments = member('owner', 'manager', 'cashier');

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

function mapLine(row: any): OrderLine {
  return {
    id: row.id, menuItemId: row.menu_item_id, name: row.name, unitPrice: money(row.unit_price), quantity: row.quantity,
    options: row.options ?? [], note: row.note, station: row.station, status: row.status, ticketStatus: row.ticket_status ?? null,
    voidReason: row.void_reason || '',
  };
}

async function loadOrder(restaurantId: string, orderId: string): Promise<Order | null> {
  const [orderRes, linesRes] = await Promise.all([
    query(`SELECT * FROM dineniro_order_get($1, $2)`, [restaurantId, orderId]),
    query(`SELECT * FROM dineniro_order_items($1, $2)`, [restaurantId, orderId]),
  ]);
  const o = orderRes.rows[0];
  if (!o) return null;
  return {
    id: o.id, tableId: o.table_id, tableLabel: o.table_label, guests: o.guests, status: o.status,
    openedAt: iso(o.opened_at)!, closedAt: iso(o.closed_at), serverName: o.server_name, billId: o.bill_id,
    lines: linesRes.rows.map(mapLine),
  };
}

async function loadBill(restaurantId: string, billId: string): Promise<Bill | null> {
  const b = (await query(`SELECT * FROM dineniro_bill_get($1, $2)`, [restaurantId, billId])).rows[0];
  if (!b) return null;
  return {
    id: b.id, orderId: b.order_id, number: b.number, subtotal: money(b.subtotal), discount: money(b.discount),
    serviceChargePct: money(b.service_charge_pct), serviceCharge: money(b.service_charge), vatPct: money(b.vat_pct), vat: money(b.vat),
    total: money(b.total), paid: money(b.paid), status: b.status, createdAt: iso(b.created_at)!, paidAt: iso(b.paid_at),
    tableLabel: b.table_label, guests: b.guests, serverName: b.server_name,
    payments: (b.payments as any[]).map((p) => ({
      id: p.id, method: p.method, amount: money(p.amount), tendered: p.tendered === null ? null : money(p.tendered),
      reference: p.reference, createdAt: iso(p.createdAt)!,
    })),
  };
}

function checkId(res: Response, value: unknown, what: string): value is string {
  if (isIdentifier(value)) return true;
  res.status(400).json({ error: `Invalid ${what} ID.` });
  return false;
}

/** Runs an order change, then answers with the whole updated order (or 404 if it is not this restaurant's). */
async function changeOrder(req: AuthRequest, res: Response, run: (restaurantId: string, orderId: string) => Promise<unknown>, label: string) {
  try {
    const restaurantId = req.membership!.restaurantId;
    const orderId = req.params.orderId;
    if (!checkId(res, orderId, 'order')) return;
    if (!(await query(`SELECT 1 FROM dineniro_order_get($1, $2)`, [restaurantId, orderId])).rows[0]) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    const outcome = await run(restaurantId, orderId);
    if (outcome === false) return res.status(404).json({ error: 'Dish not found on this order.' });
    res.json(await loadOrder(restaurantId, orderId));
  } catch (error) {
    respondApiError(res, error, label);
  }
}

// Floor.
router.get(`${base}/floor`, everyone, async (req: AuthRequest, res) => {
  try {
    const rows = (await query(`SELECT * FROM dineniro_floor($1)`, [req.membership!.restaurantId])).rows;
    const floor: FloorTable[] = rows.map((r: any) => ({
      tableId: r.table_id, label: r.label, seats: r.seats, section: r.section, shape: r.shape, state: r.state,
      orderId: r.order_id, guests: r.guests, openedAt: iso(r.opened_at), serverName: r.server_name,
      runningTotal: money(r.running_total), unsentItems: Number(r.unsent_items || 0),
    }));
    res.json(floor);
  } catch (error) {
    respondApiError(res, error, 'Error loading the floor:');
  }
});

// Orders.
router.post(`${base}/orders`, seating, async (req: AuthRequest, res) => {
  try {
    const { tableId, guests } = req.body ?? {};
    if (!checkId(res, tableId, 'table')) return;
    if (!isWholeNumber(guests, 1, 60)) return res.status(400).json({ error: 'Guests must be between 1 and 60.' });
    const id = `ORD-${randomUUID()}`;
    await withTransaction((client) => client.query(
      `SELECT * FROM dineniro_order_open($1, $2, $3, $4, $5)`, [req.membership!.restaurantId, id, tableId, guests, req.user!.sub],
    ));
    res.status(201).json(await loadOrder(req.membership!.restaurantId, id));
  } catch (error) {
    respondApiError(res, error, 'Error seating table:');
  }
});

router.get(`${base}/orders/:orderId`, everyone, async (req: AuthRequest, res) => {
  try {
    if (!checkId(res, req.params.orderId, 'order')) return;
    const order = await loadOrder(req.membership!.restaurantId, req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json(order);
  } catch (error) {
    respondApiError(res, error, 'Error loading order:');
  }
});

router.post(`${base}/orders/:orderId/items`, ordering, (req: AuthRequest, res) => {
  const { menuItemId, quantity = 1, optionIds = [], note } = req.body ?? {};
  if (!checkId(res, menuItemId, 'dish')) return;
  if (!isWholeNumber(quantity, 1, 99) || !Array.isArray(optionIds) || optionIds.length > 20 || !optionIds.every(isIdentifier) || !isOptionalText(note, 200)) {
    return res.status(400).json({ error: 'Quantity is 1 to 99; notes are up to 200 characters.' });
  }
  return changeOrder(req, res, (restaurantId, orderId) => withTransaction((client) => client.query(
    `SELECT dineniro_order_item_add($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [restaurantId, orderId, `OLI-${randomUUID()}`, menuItemId, quantity, JSON.stringify(optionIds), (note || '').trim(), req.user!.sub],
  )), 'Error adding dish:');
});

router.patch(`${base}/orders/:orderId/items/:itemId`, ordering, (req: AuthRequest, res) => {
  const { quantity } = req.body ?? {};
  if (!checkId(res, req.params.itemId, 'dish')) return;
  if (!isWholeNumber(quantity, 0, 99)) return res.status(400).json({ error: 'Quantity is 0 (remove) to 99.' });
  return changeOrder(req, res, async (restaurantId, orderId) => (await withTransaction((client) => client.query(
    `SELECT dineniro_order_item_set_quantity($1, $2, $3, $4) AS ok`, [restaurantId, orderId, req.params.itemId, quantity],
  ))).rows[0].ok, 'Error changing dish:');
});

router.post(`${base}/orders/:orderId/items/:itemId/void`, supervisors, (req: AuthRequest, res) => {
  if (!checkId(res, req.params.itemId, 'dish')) return;
  if (!isText(req.body?.reason, 200)) return res.status(400).json({ error: 'Give a reason for the void.' });
  return changeOrder(req, res, async (restaurantId, orderId) => (await withTransaction((client) => client.query(
    `SELECT dineniro_order_item_void($1, $2, $3, $4, $5) AS ok`, [restaurantId, orderId, req.params.itemId, req.body.reason, req.user!.sub],
  ))).rows[0].ok, 'Error voiding dish:');
});

router.post(`${base}/orders/:orderId/send`, ordering, (req: AuthRequest, res) =>
  changeOrder(req, res, (restaurantId, orderId) => withTransaction((client) => client.query(
    `SELECT dineniro_order_send($1, $2, $3, $4)`, [restaurantId, orderId, `TKT-${randomUUID()}`, req.user!.sub],
  )), 'Error sending to kitchen:'));

router.post(`${base}/orders/:orderId/void`, ordering, (req: AuthRequest, res) =>
  changeOrder(req, res, (restaurantId, orderId) => withTransaction((client) => client.query(
    `SELECT dineniro_order_void($1, $2)`, [restaurantId, orderId],
  )), 'Error cancelling order:'));

// Kitchen.
router.get(`${base}/kitchen`, kitchenView, async (req: AuthRequest, res) => {
  try {
    const rows = (await query(`SELECT * FROM dineniro_kitchen_tickets($1)`, [req.membership!.restaurantId])).rows;
    const tickets: KitchenTicket[] = rows.map((t: any) => ({
      id: t.id, number: t.number, status: t.status, orderId: t.order_id, tableLabel: t.table_label, serverName: t.server_name,
      sentAt: iso(t.sent_at)!, startedAt: iso(t.started_at), readyAt: iso(t.ready_at), items: t.items,
    }));
    res.json({ tickets, serverTime: new Date().toISOString() });
  } catch (error) {
    respondApiError(res, error, 'Error loading kitchen tickets:');
  }
});

router.post(`${base}/kitchen/:ticketId/advance`, kitchenView, async (req: AuthRequest, res) => {
  try {
    const from = req.body?.from as TicketStatus;
    if (!checkId(res, req.params.ticketId, 'ticket')) return;
    if (!['new', 'cooking', 'ready'].includes(from)) return res.status(400).json({ error: 'Send the ticket status you are moving it from.' });
    // Waiters only collect finished food from the pass; cooking steps are the kitchen's.
    if (req.membership!.role === 'waiter' && from !== 'ready') return res.status(403).json({ error: 'Only the kitchen can start or finish a ticket.' });
    const result = await withTransaction((client) => client.query(
      `SELECT dineniro_ticket_advance($1, $2, $3) AS status`, [req.membership!.restaurantId, req.params.ticketId, from],
    ));
    if (!result.rows[0]?.status) return res.status(404).json({ error: 'Ticket not found.' });
    res.json({ id: req.params.ticketId, status: result.rows[0].status });
  } catch (error) {
    respondApiError(res, error, 'Error moving ticket:');
  }
});

// Bills and payments.
router.post(`${base}/orders/:orderId/bill`, billing, async (req: AuthRequest, res) => {
  try {
    const discount = req.body?.discount ?? 0;
    if (!checkId(res, req.params.orderId, 'order')) return;
    if (!isAmount(discount)) return res.status(400).json({ error: 'The discount is an amount in taka.' });
    if (discount > 0 && !['owner', 'manager'].includes(req.membership!.role)) {
      return res.status(403).json({ error: 'Only an owner or manager can give a discount.' });
    }
    const restaurantId = req.membership!.restaurantId;
    const result = await withTransaction((client) => client.query(
      `SELECT dineniro_bill_prepare($1, $2, $3, $4, $5) AS id`, [restaurantId, req.params.orderId, `BIL-${randomUUID()}`, discount, req.user!.sub],
    ));
    const billId = result.rows[0]?.id;
    if (!billId) return res.status(404).json({ error: 'Order not found.' });
    res.json(await loadBill(restaurantId, billId));
  } catch (error) {
    respondApiError(res, error, 'Error preparing bill:');
  }
});

router.get(`${base}/bills`, billing, async (req: AuthRequest, res) => {
  try {
    const rows = (await query(`SELECT * FROM dineniro_bills_recent($1, 40)`, [req.membership!.restaurantId])).rows;
    const bills: BillSummary[] = rows.map((b: any) => ({
      id: b.id, number: b.number, tableLabel: b.table_label, total: money(b.total), paid: money(b.paid), status: b.status,
      createdAt: iso(b.created_at)!, paidAt: iso(b.paid_at), methods: b.methods || '',
    }));
    res.json(bills);
  } catch (error) {
    respondApiError(res, error, 'Error listing bills:');
  }
});

/** The bill with its lines and the restaurant's details: everything a printed receipt needs. */
router.get(`${base}/bills/:billId`, billing, async (req: AuthRequest, res) => {
  try {
    if (!checkId(res, req.params.billId, 'bill')) return;
    const restaurantId = req.membership!.restaurantId;
    const bill = await loadBill(restaurantId, req.params.billId);
    if (!bill) return res.status(404).json({ error: 'Bill not found.' });
    const [order, restaurantRes] = await Promise.all([
      loadOrder(restaurantId, bill.orderId),
      query(`SELECT * FROM dineniro_restaurant_get($1)`, [restaurantId]),
    ]);
    const receipt: Receipt = { bill, lines: order!.lines.filter((l) => l.status === 'sent'), restaurant: mapRestaurant(restaurantRes.rows[0]) };
    res.json(receipt);
  } catch (error) {
    respondApiError(res, error, 'Error loading bill:');
  }
});

router.post(`${base}/bills/:billId/payments`, payments, async (req: AuthRequest, res) => {
  try {
    const { method, amount, tendered, reference } = req.body ?? {};
    if (!checkId(res, req.params.billId, 'bill')) return;
    if (!PAYMENT_METHODS.includes(method as PaymentMethod) || !isAmount(amount, { min: 0.01 }) || !isOptionalText(reference, 100)) {
      return res.status(400).json({ error: 'Choose cash, card, bKash or Nagad and an amount above zero.' });
    }
    if (tendered !== undefined && tendered !== null && (method !== 'cash' || !isAmount(tendered) || tendered < amount)) {
      return res.status(400).json({ error: 'Cash received must be at least the amount being paid.' });
    }
    if ((method === 'bkash' || method === 'nagad') && !isText(reference, 100)) {
      return res.status(400).json({ error: 'Enter the transaction ID for bKash and Nagad payments.' });
    }
    const restaurantId = req.membership!.restaurantId;
    const result = await withTransaction((client) => client.query(
      `SELECT dineniro_payment_add($1, $2, $3, $4, $5, $6, $7, $8) AS ok`,
      [restaurantId, req.params.billId, `PAY-${randomUUID()}`, method, amount, tendered ?? null, (reference || '').trim(), req.user!.sub],
    ));
    if (!result.rows[0]?.ok) return res.status(404).json({ error: 'Bill not found.' });
    res.status(201).json(await loadBill(restaurantId, req.params.billId));
  } catch (error) {
    respondApiError(res, error, 'Error recording payment:');
  }
});

export default router;
