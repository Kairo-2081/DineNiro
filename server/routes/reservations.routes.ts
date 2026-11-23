import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/index.ts';
import { requireMembership, type AuthRequest } from '../middleware/auth.ts';
import { isIdentifier, isOptionalText, isText, isWholeNumber, respondApiError } from '../utils.ts';
import type { AvailableTable, Reservation, WaitlistEntry } from '../../src/types.ts';

const router = Router();
const base = '/api/restaurants/:restaurantId';

/** Front of house takes bookings and runs the waitlist; cashiers can look. */
const frontOfHouse = requireMembership({ roles: ['owner', 'manager', 'host', 'waiter'], requireApproved: true });
const viewers = requireMembership({ roles: ['owner', 'manager', 'host', 'waiter', 'cashier'], requireApproved: true });

const MAX_RANGE_MS = 8 * 24 * 60 * 60 * 1000;

function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapReservation(r: any): Reservation {
  return {
    id: r.id, tableId: r.table_id, tableLabel: r.table_label, guestName: r.guest_name, phone: r.phone, partySize: r.party_size,
    startsAt: new Date(r.starts_at).toISOString(), endsAt: new Date(r.ends_at).toISOString(), status: r.status, note: r.note,
    orderId: r.order_id, createdByName: r.created_by_name,
  };
}

function mapWaitlist(w: any): WaitlistEntry {
  return {
    id: w.id, guestName: w.guest_name, phone: w.phone, partySize: w.party_size, quotedMinutes: w.quoted_minutes,
    note: w.note, addedAt: new Date(w.added_at).toISOString(),
  };
}

/** Overlapping bookings are refused by the database's exclusion constraint; say so in words. */
function respondBookingError(res: Response, error: unknown, label: string) {
  const dbError = error as { code?: string; constraint?: string };
  if (dbError?.code === '23P01' && dbError.constraint === 'ex_reservations_no_overlap') {
    return res.status(409).json({ error: 'That table is already booked for part of this time. Choose another time or table.' });
  }
  return respondApiError(res, error, label);
}

async function loadReservation(restaurantId: string, id: string) {
  const rows = (await query(
    `SELECT * FROM dineniro_reservations($1, '-infinity', 'infinity') r WHERE r.id = $2`, [restaurantId, id],
  )).rows;
  return rows[0] ? mapReservation(rows[0]) : null;
}

/** Validates a booking body; answers 400 itself and returns null when it is not valid. */
function readBooking(res: Response, body: any) {
  const b = body ?? {};
  const startsAt = parseInstant(b.startsAt);
  if (!isIdentifier(b.tableId) || !isText(b.guestName, 120) || !isOptionalText(b.phone, 50) || !isWholeNumber(b.partySize, 1, 60) ||
    !startsAt || !isWholeNumber(b.durationMinutes, 15, 480) || !isOptionalText(b.note, 300)) {
    res.status(400).json({ error: 'A booking needs a table, a guest name, 1 to 60 guests, a start time and a length of 15 minutes to 8 hours.' });
    return null;
  }
  if (startsAt.getTime() < Date.now() - 15 * 60 * 1000) {
    res.status(400).json({ error: 'That time has already passed.' });
    return null;
  }
  const endsAt = new Date(startsAt.getTime() + b.durationMinutes * 60 * 1000);
  return { ...b, startsAt, endsAt, phone: (b.phone || '').trim(), note: (b.note || '').trim(), guestName: b.guestName.trim() };
}

router.get(`${base}/reservations`, viewers, async (req: AuthRequest, res) => {
  try {
    const from = parseInstant(req.query.from);
    const to = parseInstant(req.query.to);
    if (!from || !to || to <= from || to.getTime() - from.getTime() > MAX_RANGE_MS) {
      return res.status(400).json({ error: 'Send from and to times, at most 8 days apart.' });
    }
    const rows = (await query(`SELECT * FROM dineniro_reservations($1, $2, $3)`, [req.membership!.restaurantId, from, to])).rows;
    res.json(rows.map(mapReservation));
  } catch (error) {
    respondApiError(res, error, 'Error listing reservations:');
  }
});

router.get(`${base}/availability`, frontOfHouse, async (req: AuthRequest, res) => {
  try {
    const startsAt = parseInstant(req.query.startsAt);
    const minutes = Number(req.query.minutes);
    const party = Number(req.query.party);
    const ignore = req.query.ignore;
    if (!startsAt || !isWholeNumber(minutes, 15, 480) || !isWholeNumber(party, 1, 60) || (ignore !== undefined && !isIdentifier(ignore))) {
      return res.status(400).json({ error: 'Send a start time, a length in minutes and the party size.' });
    }
    const rows = (await query(
      `SELECT * FROM dineniro_tables_available($1, $2, $3, $4, $5)`,
      [req.membership!.restaurantId, startsAt, new Date(startsAt.getTime() + minutes * 60_000), party, ignore ?? null],
    )).rows;
    const tables: AvailableTable[] = rows.map((t: any) => ({ tableId: t.table_id, label: t.label, seats: t.seats, section: t.section }));
    res.json(tables);
  } catch (error) {
    respondApiError(res, error, 'Error checking availability:');
  }
});

router.post(`${base}/reservations`, frontOfHouse, async (req: AuthRequest, res) => {
  try {
    const b = readBooking(res, req.body);
    if (!b) return;
    const id = `RSV-${randomUUID()}`;
    const restaurantId = req.membership!.restaurantId;
    await withTransaction((client) => client.query(
      `SELECT dineniro_reservation_save($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [restaurantId, id, b.tableId, b.guestName, b.phone, b.partySize, b.startsAt, b.endsAt, b.note, req.user!.sub],
    ));
    res.status(201).json(await loadReservation(restaurantId, id));
  } catch (error) {
    respondBookingError(res, error, 'Error creating reservation:');
  }
});

router.put(`${base}/reservations/:reservationId`, frontOfHouse, async (req: AuthRequest, res) => {
  try {
    if (!isIdentifier(req.params.reservationId)) return res.status(400).json({ error: 'Invalid booking ID.' });
    const restaurantId = req.membership!.restaurantId;
    if (!(await loadReservation(restaurantId, req.params.reservationId))) return res.status(404).json({ error: 'Booking not found.' });
    const b = readBooking(res, req.body);
    if (!b) return;
    await withTransaction((client) => client.query(
      `SELECT dineniro_reservation_save($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [restaurantId, req.params.reservationId, b.tableId, b.guestName, b.phone, b.partySize, b.startsAt, b.endsAt, b.note, req.user!.sub],
    ));
    res.json(await loadReservation(restaurantId, req.params.reservationId));
  } catch (error) {
    respondBookingError(res, error, 'Error changing reservation:');
  }
});

router.post(`${base}/reservations/:reservationId/close`, frontOfHouse, async (req: AuthRequest, res) => {
  try {
    const { status } = req.body ?? {};
    if (!isIdentifier(req.params.reservationId)) return res.status(400).json({ error: 'Invalid booking ID.' });
    if (status !== 'cancelled' && status !== 'no_show') return res.status(400).json({ error: 'Send cancelled or no_show.' });
    const restaurantId = req.membership!.restaurantId;
    const result = await withTransaction((client) => client.query(
      `SELECT dineniro_reservation_close($1, $2, $3) AS ok`, [restaurantId, req.params.reservationId, status],
    ));
    if (!result.rows[0]?.ok) return res.status(404).json({ error: 'Booking not found.' });
    res.json(await loadReservation(restaurantId, req.params.reservationId));
  } catch (error) {
    respondApiError(res, error, 'Error closing reservation:');
  }
});

router.post(`${base}/reservations/:reservationId/seat`, frontOfHouse, async (req: AuthRequest, res) => {
  try {
    if (!isIdentifier(req.params.reservationId)) return res.status(400).json({ error: 'Invalid booking ID.' });
    const result = await withTransaction((client) => client.query(
      `SELECT dineniro_reservation_seat($1, $2, $3, $4) AS order_id`,
      [req.membership!.restaurantId, req.params.reservationId, `ORD-${randomUUID()}`, req.user!.sub],
    ));
    const orderId = result.rows[0]?.order_id;
    if (!orderId) return res.status(404).json({ error: 'Booking not found.' });
    res.json({ orderId });
  } catch (error) {
    respondApiError(res, error, 'Error seating booking:');
  }
});

// Waitlist.
router.get(`${base}/waitlist`, viewers, async (req: AuthRequest, res) => {
  try {
    res.json((await query(`SELECT * FROM dineniro_waitlist($1)`, [req.membership!.restaurantId])).rows.map(mapWaitlist));
  } catch (error) {
    respondApiError(res, error, 'Error loading the waitlist:');
  }
});

router.post(`${base}/waitlist`, frontOfHouse, async (req: AuthRequest, res) => {
  try {
    const b = req.body ?? {};
    if (!isText(b.guestName, 120) || !isOptionalText(b.phone, 50) || !isWholeNumber(b.partySize, 1, 60) ||
      (b.quotedMinutes !== undefined && !isWholeNumber(b.quotedMinutes, 0, 240)) || !isOptionalText(b.note, 300)) {
      return res.status(400).json({ error: 'A waiting party needs a name and 1 to 60 guests. Quoted waits are up to 240 minutes.' });
    }
    const result = await withTransaction((client) => client.query(
      `SELECT * FROM dineniro_waitlist_add($1, $2, $3, $4, $5, $6, $7)`,
      [req.membership!.restaurantId, `WTL-${randomUUID()}`, b.guestName.trim(), (b.phone || '').trim(), b.partySize, b.quotedMinutes ?? 15, (b.note || '').trim()],
    ));
    res.status(201).json(mapWaitlist(result.rows[0]));
  } catch (error) {
    respondApiError(res, error, 'Error adding to the waitlist:');
  }
});

router.post(`${base}/waitlist/:entryId/left`, frontOfHouse, async (req: AuthRequest, res) => {
  try {
    if (!isIdentifier(req.params.entryId)) return res.status(400).json({ error: 'Invalid waitlist ID.' });
    const result = await withTransaction((client) => client.query(
      `SELECT dineniro_waitlist_left($1, $2) AS ok`, [req.membership!.restaurantId, req.params.entryId],
    ));
    if (!result.rows[0]?.ok) return res.status(404).json({ error: 'Waiting party not found.' });
    res.sendStatus(204);
  } catch (error) {
    respondApiError(res, error, 'Error updating the waitlist:');
  }
});

router.post(`${base}/waitlist/:entryId/seat`, frontOfHouse, async (req: AuthRequest, res) => {
  try {
    const { tableId } = req.body ?? {};
    if (!isIdentifier(req.params.entryId) || !isIdentifier(tableId)) return res.status(400).json({ error: 'Choose a table.' });
    const result = await withTransaction((client) => client.query(
      `SELECT dineniro_waitlist_seat($1, $2, $3, $4, $5) AS order_id`,
      [req.membership!.restaurantId, req.params.entryId, tableId, `ORD-${randomUUID()}`, req.user!.sub],
    ));
    const orderId = result.rows[0]?.order_id;
    if (!orderId) return res.status(404).json({ error: 'Waiting party not found.' });
    res.json({ orderId });
  } catch (error) {
    respondApiError(res, error, 'Error seating from the waitlist:');
  }
});

export default router;
