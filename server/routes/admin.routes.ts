import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/index.ts';
import { hashPassword } from '../db/password.ts';
import { requireAccountRole, type AuthRequest } from '../middleware/auth.ts';
import { isEmail, isIdentifier, isOptionalText, isPassword, isRestaurantStatus, isText, mapRestaurant, PASSWORD_MIN_LENGTH, respondApiError, chooseUsername } from '../utils.ts';
import type { PlatformStats, RestaurantStatusChange, RestaurantSummary } from '../../src/types.ts';

const router = Router();
const adminOnly = requireAccountRole('admin');

router.get('/api/admin/stats', adminOnly, async (_req, res) => {
  try {
    const row: any = (await query(`SELECT * FROM dineniro_admin_stats()`)).rows[0] ?? {};
    const stats: PlatformStats = {
      pending: Number(row.pending || 0), approved: Number(row.approved || 0), suspended: Number(row.suspended || 0),
      rejected: Number(row.rejected || 0), activeStaff: Number(row.active_staff || 0),
    };
    res.json(stats);
  } catch (error) {
    respondApiError(res, error, 'Error fetching platform stats:');
  }
});

router.get('/api/admin/restaurants', adminOnly, async (req, res) => {
  try {
    const status = req.query.status;
    if (status !== undefined && !isRestaurantStatus(status)) return res.status(400).json({ error: 'Unknown restaurant status.' });
    const result = await query(`SELECT * FROM dineniro_restaurants_list($1)`, [status ?? null]);
    const restaurants: RestaurantSummary[] = result.rows.map((row: any) => ({
      ...mapRestaurant(row), ownerName: row.owner_name || '', ownerEmail: row.owner_email || '', staffCount: Number(row.staff_count || 0),
    }));
    res.json(restaurants);
  } catch (error) {
    respondApiError(res, error, 'Error listing restaurants:');
  }
});

router.put('/api/admin/restaurants/:id/status', adminOnly, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body ?? {};
    if (!isIdentifier(id)) return res.status(400).json({ error: 'Invalid restaurant ID.' });
    if (!isRestaurantStatus(status) || !isOptionalText(reason, 1000)) {
      return res.status(400).json({ error: 'Send a valid status and, optionally, a reason under 1,000 characters.' });
    }
    const result = await withTransaction((client) => client.query(
      `SELECT * FROM dineniro_restaurant_status_update($1, $2, $3, $4)`, [id, status, reason ?? '', req.user!.sub],
    ));
    if (!result.rows[0]) return res.status(404).json({ error: 'Restaurant not found.' });
    res.json(mapRestaurant(result.rows[0]));
  } catch (error) {
    respondApiError(res, error, 'Error updating restaurant status:');
  }
});

router.get('/api/admin/restaurants/audit', adminOnly, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const result = await query(`SELECT * FROM dineniro_restaurant_audit($1)`, [limit]);
    const changes: RestaurantStatusChange[] = result.rows.map((row: any) => ({
      id: Number(row.id), restaurantId: row.restaurant_id, restaurantName: row.restaurant_name,
      oldStatus: row.old_status, newStatus: row.new_status, reason: row.reason || '',
      changedByName: row.changed_by_name, changedAt: new Date(row.changed_at).toISOString(),
    }));
    res.json(changes);
  } catch (error) {
    respondApiError(res, error, 'Error fetching restaurant audit trail:');
  }
});

/** An existing platform admin adds another one. */
router.post('/api/admin/admins', adminOnly, async (req, res) => {
  try {
    const { name, email, phone, username, password } = req.body ?? {};
    if (!isText(name, 255) || !isEmail(email) || !isOptionalText(phone, 50)) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }
    if (!isPassword(password)) return res.status(400).json({ error: `Passwords need at least ${PASSWORD_MIN_LENGTH} characters.` });
    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = await chooseUsername(username, cleanEmail);
    if (!cleanUsername) return res.status(400).json({ error: 'Usernames need 3 or more letters, numbers, dots, dashes or underscores.' });
    const result = await withTransaction(async (client) => client.query(
      `SELECT * FROM dineniro_admin_create($1, $2, $3, $4, $5, $6)`,
      [`ADM-${randomUUID()}`, cleanUsername, cleanEmail, await hashPassword(password), name.trim(), (phone || '').trim()],
    ));
    const row: any = result.rows[0];
    res.status(201).json({ id: row.id, username: row.username, email: row.email, name: row.name, phone: row.phone, role: row.role });
  } catch (error) {
    respondApiError(res, error, 'Error creating administrator:');
  }
});

export default router;
