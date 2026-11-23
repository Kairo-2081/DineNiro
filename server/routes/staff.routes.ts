import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/index.ts';
import { hashPassword } from '../db/password.ts';
import { requireMembership, type AuthRequest } from '../middleware/auth.ts';
import { isEmail, isIdentifier, isOptionalText, isPassword, isStaffRole, isText, mapStaffMember, PASSWORD_MIN_LENGTH, respondApiError, chooseUsername } from '../utils.ts';
import { MANAGER_ASSIGNABLE_ROLES, type StaffRole } from '../../src/types.ts';

const router = Router();

/** Owners and managers run the team; managers cannot create, change or remove owners and managers. */
const canManage = requireMembership({ roles: ['owner', 'manager'], requireApproved: true });

function managerMayTouch(actorRole: StaffRole, ...roles: (StaffRole | undefined)[]) {
  return actorRole === 'owner' || roles.every((role) => role === undefined || MANAGER_ASSIGNABLE_ROLES.includes(role));
}

async function memberOrNotFound(res: Response, restaurantId: string, userId: string) {
  if (!isIdentifier(userId)) {
    res.status(400).json({ error: 'Invalid staff member ID.' });
    return null;
  }
  const result = await query(`SELECT * FROM dineniro_staff_member_get($1, $2)`, [restaurantId, userId]);
  if (!result.rows[0]) {
    res.status(404).json({ error: 'Staff member not found.' });
    return null;
  }
  return mapStaffMember(result.rows[0]);
}

router.get('/api/restaurants/:restaurantId/staff', canManage, async (req: AuthRequest, res) => {
  try {
    const result = await query(`SELECT * FROM dineniro_staff_list($1)`, [req.membership!.restaurantId]);
    res.json(result.rows.map(mapStaffMember));
  } catch (error) {
    respondApiError(res, error, 'Error listing staff:');
  }
});

router.post('/api/restaurants/:restaurantId/staff', canManage, async (req: AuthRequest, res) => {
  try {
    const b = req.body ?? {};
    if (!isText(b.name, 255) || !isEmail(b.email) || !isOptionalText(b.phone, 50) || !isStaffRole(b.role)) {
      return res.status(400).json({ error: 'Name, email and a valid role are required.' });
    }
    if (!managerMayTouch(req.membership!.role, b.role)) {
      return res.status(403).json({ error: 'Only an owner can add owners or managers.' });
    }
    if (b.password !== undefined && b.password !== '' && !isPassword(b.password)) {
      return res.status(400).json({ error: `Passwords need at least ${PASSWORD_MIN_LENGTH} characters.` });
    }
    const email = b.email.trim().toLowerCase();
    const username = await chooseUsername(b.username, email);
    if (!username) return res.status(400).json({ error: 'Usernames need 3 or more letters, numbers, dots, dashes or underscores.' });

    const passwordHash = b.password ? await hashPassword(b.password) : '';
    const result = await withTransaction((client) => client.query(
      `SELECT * FROM dineniro_staff_add($1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.membership!.restaurantId, `USR-${randomUUID()}`, username, email, passwordHash, b.name.trim(), (b.phone || '').trim(), b.role],
    ));
    const row = result.rows[0];
    res.status(201).json({ member: mapStaffMember(row), createdAccount: row.created_account });
  } catch (error) {
    respondApiError(res, error, 'Error adding staff member:');
  }
});

router.patch('/api/restaurants/:restaurantId/staff/:userId', canManage, async (req: AuthRequest, res) => {
  try {
    const { role, active } = req.body ?? {};
    if ((role !== undefined && !isStaffRole(role)) || (active !== undefined && typeof active !== 'boolean') ||
      (role === undefined && active === undefined)) {
      return res.status(400).json({ error: 'Send a valid role, an active flag, or both.' });
    }
    const current = await memberOrNotFound(res, req.membership!.restaurantId, req.params.userId);
    if (!current) return;
    if (!managerMayTouch(req.membership!.role, current.role, role)) {
      return res.status(403).json({ error: 'Only an owner can change owners or managers.' });
    }
    const result = await withTransaction((client) => client.query(
      `SELECT * FROM dineniro_staff_update($1, $2, $3, $4)`,
      [req.membership!.restaurantId, current.userId, role ?? null, active ?? null],
    ));
    res.json(mapStaffMember(result.rows[0]));
  } catch (error) {
    respondApiError(res, error, 'Error updating staff member:');
  }
});

router.delete('/api/restaurants/:restaurantId/staff/:userId', canManage, async (req: AuthRequest, res) => {
  try {
    const current = await memberOrNotFound(res, req.membership!.restaurantId, req.params.userId);
    if (!current) return;
    if (!managerMayTouch(req.membership!.role, current.role)) {
      return res.status(403).json({ error: 'Only an owner can remove owners or managers.' });
    }
    await withTransaction((client) => client.query(`SELECT dineniro_staff_remove($1, $2)`, [req.membership!.restaurantId, current.userId]));
    res.sendStatus(204);
  } catch (error) {
    respondApiError(res, error, 'Error removing staff member:');
  }
});

export default router;
