import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { query, withTransaction } from '../db/index.ts';
import type { AccountRole, RestaurantStatus, StaffRole } from '../../src/types.ts';

export interface AppUser extends JwtPayload {
  sub: string;
  jti: string;
  role: AccountRole;
  email: string;
  username: string;
  name: string;
}

export interface Membership {
  restaurantId: string;
  restaurantStatus: RestaurantStatus;
  role: StaffRole;
}

export interface AuthRequest extends Request {
  user?: AppUser;
  membership?: Membership;
}

export const TOKEN_TTL_SECONDS = 60 * 60 * 12; // one working shift
const ACCOUNT_ROLES: AccountRole[] = ['admin', 'staff'];
const AUTH_COOKIE_NAME = 'dineniro_session';

export function assertJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be configured and contain at least 32 characters.');
  }
  return secret;
}

export async function issueAppToken(user: Pick<AppUser, 'sub' | 'role' | 'email' | 'username' | 'name'>): Promise<string> {
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);
  await withTransaction((client) => client.query(`SELECT dineniro_session_create($1, $2, $3)`, [jti, user.sub, expiresAt]));
  const options: SignOptions = { algorithm: 'HS256', expiresIn: TOKEN_TTL_SECONDS, subject: user.sub, jwtid: jti };
  return jwt.sign({ role: user.role, email: user.email, username: user.username, name: user.name }, assertJwtSecret(), options);
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
}

export function revokeAuthSession(jti: string) {
  return withTransaction((client) => client.query(`SELECT dineniro_session_revoke($1)`, [jti]));
}

function requestToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader) return authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : undefined;
  const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${AUTH_COOKIE_NAME}=`));
  if (!cookie) return undefined;
  try {
    return decodeURIComponent(cookie.slice(AUTH_COOKIE_NAME.length + 1));
  } catch {
    return undefined;
  }
}

function decodeToken(token?: string): AppUser | undefined {
  if (!token) return undefined;
  try {
    const decoded = jwt.verify(token, assertJwtSecret(), { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || !decoded.sub || typeof decoded.jti !== 'string' ||
      !ACCOUNT_ROLES.includes(decoded.role as AccountRole) ||
      typeof decoded.email !== 'string' || typeof decoded.username !== 'string' || typeof decoded.name !== 'string') {
      return undefined;
    }
    return decoded as AppUser;
  } catch {
    return undefined;
  }
}

async function hasActiveSession(jti: string): Promise<boolean> {
  const result = await query(`SELECT dineniro_session_active($1) AS active`, [jti]);
  return result.rows[0]?.active === true;
}

/** Guest endpoints: signing in and applying to put a restaurant on the platform. */
const PUBLIC_API_REQUESTS = new Set([
  'POST /api/auth/login',
  'POST /api/restaurants',
]);

/**
 * Validates the session before any API handler or body parser runs.
 * Every API request except the public ones needs a valid, unrevoked app-issued JWT.
 */
export async function authenticateApiRequest(req: AuthRequest, res: Response, next: NextFunction) {
  const apiPath = req.path.replace(/\/+$/, '') || '/';
  if (apiPath !== '/api' && !apiPath.startsWith('/api/')) return next();
  if (req.method === 'OPTIONS') return next();

  const isPublic = PUBLIC_API_REQUESTS.has(`${req.method.toUpperCase()} ${apiPath}`);
  const token = requestToken(req);
  const user = decodeToken(token);
  try {
    if (user && await hasActiveSession(user.jti)) {
      req.user = user;
      return next();
    }
  } catch (error) {
    return next(error);
  }

  if (token) clearAuthCookie(res);
  if (isPublic) return next();
  return res.status(401).json({ error: token ? 'Unauthorized: Session is expired or revoked' : 'Unauthorized: Missing or invalid token' });
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  next();
}

export function requireAccountRole(...roles: AccountRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    next();
  };
}

interface MembershipOptions {
  /** Staff roles allowed through. Empty means any member of the restaurant. */
  roles?: StaffRole[];
  /** Reject requests while the restaurant is pending, rejected or suspended. */
  requireApproved?: boolean;
}

/**
 * Loads the signed-in user's membership in the restaurant named by `:restaurantId`.
 * Each request is scoped to one restaurant: data from any other restaurant is never reachable through it.
 */
export function requireMembership({ roles = [], requireApproved = false }: MembershipOptions = {}) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    if (req.user.role !== 'staff') return res.status(403).json({ error: 'Forbidden: Only restaurant staff can do this.' });
    const restaurantId = req.params.restaurantId;
    if (typeof restaurantId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(restaurantId)) {
      return res.status(400).json({ error: 'Invalid restaurant ID.' });
    }
    try {
      const result = await query(`SELECT * FROM dineniro_membership_get($1, $2)`, [req.user.sub, restaurantId]);
      const row = result.rows[0];
      // Not a member and no such restaurant look the same, so IDs of other restaurants cannot be probed.
      if (!row) return res.status(404).json({ error: 'Restaurant not found.' });
      if (roles.length && !roles.includes(row.role)) return res.status(403).json({ error: 'Forbidden: Your role cannot do this.' });
      if (requireApproved && row.restaurant_status !== 'approved') {
        return res.status(409).json({ error: `This restaurant is ${row.restaurant_status}. It needs platform approval first.` });
      }
      req.membership = { restaurantId: row.restaurant_id, restaurantStatus: row.restaurant_status, role: row.role };
      next();
    } catch (error) {
      next(error);
    }
  };
}
