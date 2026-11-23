import { Router, type Response } from 'express';
import { query } from '../db/index.ts';
import { comparePassword, hashPassword } from '../db/password.ts';
import { clearAuthCookie, issueAppToken, requireAuth, revokeAuthSession, setAuthCookie, TOKEN_TTL_SECONDS, type AuthRequest } from '../middleware/auth.ts';
import { isText, PASSWORD_MAX_LENGTH, respondApiError } from '../utils.ts';
import type { Account, RestaurantMembership, Session } from '../../src/types.ts';

const router = Router();

// Compared against when no account matches, so a wrong username takes as long as a wrong password.
const dummyHash = hashPassword('dineniro-timing-equaliser');

function mapAccount(row: any): Account {
  return { id: row.id, username: row.username, email: row.email, name: row.name, phone: row.phone || '', role: row.role };
}

export async function loadSession(userId: string): Promise<Session | null> {
  const [accountRes, membershipsRes] = await Promise.all([
    query(`SELECT * FROM dineniro_user_get($1)`, [userId]),
    query(`SELECT * FROM dineniro_memberships_for_user($1)`, [userId]),
  ]);
  if (!accountRes.rows[0]) return null;
  const memberships: RestaurantMembership[] = membershipsRes.rows.map((m: any) => ({
    restaurantId: m.restaurant_id, restaurantName: m.restaurant_name,
    restaurantStatus: m.restaurant_status, statusReason: m.status_reason || '', role: m.role,
  }));
  return { account: mapAccount(accountRes.rows[0]), memberships };
}

/** Signs the account in and answers with the same session shape as GET /api/auth/me. */
export async function signIn(res: Response, account: Pick<Account, 'id' | 'role' | 'email' | 'username' | 'name'>, status = 200) {
  const token = await issueAppToken({ sub: account.id, role: account.role, email: account.email, username: account.username, name: account.name });
  setAuthCookie(res, token);
  const session = await loadSession(account.id);
  return res.status(status).json({ success: true, expiresIn: TOKEN_TTL_SECONDS, session });
}

router.post('/api/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body ?? {};
    if (!isText(identifier, 255) || !isText(password, PASSWORD_MAX_LENGTH)) {
      return res.status(400).json({ error: 'Enter your email or username and your password.' });
    }
    const result = await query(`SELECT * FROM dineniro_auth_user_lookup($1)`, [identifier.trim()]);
    const user: any = result.rows[0];
    const matches = await comparePassword(password, user?.password ?? await dummyHash);
    if (!user || !matches) {
      return res.status(401).json({ error: 'That email/username and password do not match.' });
    }
    return await signIn(res, mapAccount(user));
  } catch (error) {
    respondApiError(res, error, 'Error during login:');
  }
});

router.get('/api/auth/me', async (req: AuthRequest, res) => {
  try {
    const session = req.user ? await loadSession(req.user.sub) : null;
    if (!session) return res.json({ authenticated: false, session: null });
    res.json({ authenticated: true, session });
  } catch (error) {
    respondApiError(res, error, 'Error fetching current user:');
  }
});

router.post('/api/auth/logout', requireAuth, async (req: AuthRequest, res) => {
  try {
    await revokeAuthSession(req.user!.jti);
    clearAuthCookie(res);
    res.sendStatus(204);
  } catch (error) {
    respondApiError(res, error, 'Error logging out:');
  }
});

export default router;
