import type { Response } from 'express';
import { randomBytes } from 'node:crypto';
import { query } from './db/index.ts';
import type { Restaurant, RestaurantStatus, StaffMember, StaffRole } from '../src/types.ts';
import { STAFF_ROLES } from '../src/types.ts';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72; // bcrypt ignores anything longer

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isText(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= maxLength && (allowEmpty || value.trim().length > 0);
}

export function isOptionalText(value: unknown, maxLength: number): boolean {
  return value === undefined || value === null || isText(value, maxLength, true);
}

export function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function isEmail(value: unknown): value is string {
  return isText(value, 255) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH;
}

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as string[]).includes(value);
}

export function isRestaurantStatus(value: unknown): value is RestaurantStatus {
  return value === 'pending' || value === 'approved' || value === 'rejected' || value === 'suspended';
}

export function optionalTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const USERNAME_PATTERN = /^[a-z0-9._-]{3,100}$/;

/**
 * The username to create: what the person typed, or one made from their email if they left it blank.
 * A typed username is used as is (a clash is reported); a generated one gets a short suffix if it is taken.
 */
export async function chooseUsername(requested: unknown, email: string): Promise<string | null> {
  const typed = typeof requested === 'string' && requested.trim() !== '';
  const clean = (typed ? requested as string : email.split('@')[0]).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (typed) return USERNAME_PATTERN.test(clean) ? clean : null;
  let username = clean.padEnd(3, '0').slice(0, 90);
  while ((await query(`SELECT dineniro_username_taken($1) AS taken`, [username])).rows[0]?.taken) {
    username = `${clean.slice(0, 90)}-${randomBytes(2).toString('hex')}`;
  }
  return username;
}

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : new Date(0).toISOString());

export function mapRestaurant(row: any): Restaurant {
  return {
    id: row.id, name: row.name, phone: row.phone, address: row.address, area: row.area, city: row.city,
    cuisine: row.cuisine || '', tradeLicenceNo: row.trade_licence_no || '', vatBin: row.vat_bin || '',
    status: row.status, statusReason: row.status_reason || '',
    createdAt: iso(row.created_at), statusChangedAt: iso(row.status_changed_at),
    serviceChargePct: Number(row.service_charge_pct ?? 0), vatPct: Number(row.vat_pct ?? 0), receiptFooter: row.receipt_footer || '',
  };
}

export function mapStaffMember(row: any): StaffMember {
  return {
    userId: row.user_id, username: row.username, email: row.email, name: row.name, phone: row.phone || '',
    role: row.role, active: row.active, joinedAt: iso(row.joined_at),
  };
}

/** Turns database errors into safe API responses. Messages raised on purpose by the schema are passed through. */
export function respondApiError(res: Response, error: unknown, message: string) {
  const dbError = error as { code?: string; message?: string; constraint?: string };

  if (dbError?.code === 'P0001' && /^(Status|Staff|Service) Error:/.test(dbError.message || '')) {
    return res.status(409).json({ error: dbError.message!.replace(/^(Status|Staff|Service) Error:\s*/, '') });
  }
  if (dbError?.code === '23505') {
    if (dbError.constraint === 'uq_users_email_lower') return res.status(409).json({ error: 'An account with this email already exists.' });
    if (dbError.constraint === 'uq_users_username_lower') return res.status(409).json({ error: 'This username is taken.' });
    if (dbError.constraint === 'staff_memberships_pkey') return res.status(409).json({ error: 'This person already works at this restaurant.' });
    if (dbError.constraint === 'uq_dining_tables_label') return res.status(409).json({ error: 'There is already a table with this name.' });
    if (dbError.constraint === 'uq_menu_categories_name') return res.status(409).json({ error: 'There is already a category with this name.' });
    if (dbError.constraint === 'uq_orders_active_table') return res.status(409).json({ error: 'This table is already seated.' });
    if (dbError.constraint === 'uq_ingredients_name') return res.status(409).json({ error: 'There is already an ingredient with this name.' });
    return res.status(409).json({ error: 'A resource with these unique values already exists.' });
  }

  if (dbError?.code === '40001' || dbError?.code === '40P01') {
    return res.status(409).json({ error: 'Someone else changed this at the same moment. Try again.' });
  }
  console.error(message, error);
  if (dbError?.code === '23503') return res.status(409).json({ error: 'The request conflicts with a related resource.' });
  if (dbError?.code === '23502' || dbError?.code === '23514' || dbError?.code?.startsWith('22')) {
    return res.status(400).json({ error: 'The request contains invalid data.' });
  }
  return res.status(500).json({ error: 'Internal server error' });
}

/** Postgres NUMERIC arrives as a string; amounts in the API are plain numbers in taka. */
export const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;

/** A taka amount with at most two decimals, e.g. from a form. */
export function isAmount(value: unknown, { min = 0, max = 10_000_000 } = {}): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
}

export function isWholeNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
