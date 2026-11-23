import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/index.ts';
import { hashPassword } from '../db/password.ts';
import { requireMembership, type AuthRequest } from '../middleware/auth.ts';
import { isEmail, isOptionalText, isPassword, isText, mapRestaurant, optionalTrimmed, PASSWORD_MIN_LENGTH, respondApiError, chooseUsername } from '../utils.ts';
import { signIn } from './auth.routes.ts';

const router = Router();

/** A new owner applies to put their restaurant on DineNiro. The restaurant stays pending until a platform admin approves it. */
router.post('/api/restaurants', async (req: AuthRequest, res) => {
  try {
    if (req.user) return res.status(409).json({ error: 'Sign out before applying with a new owner account.' });
    const b = req.body ?? {};
    const required: [unknown, number][] = [
      [b.ownerName, 255], [b.ownerPhone, 50], [b.restaurantName, 255], [b.restaurantPhone, 50],
      [b.address, 500], [b.area, 120], [b.city, 120],
    ];
    if (!required.every(([value, max]) => isText(value, max)) || !isEmail(b.ownerEmail)) {
      return res.status(400).json({ error: 'Owner name, email and phone, and the restaurant name, phone, address, area and city are required.' });
    }
    if (!isPassword(b.password)) {
      return res.status(400).json({ error: `Choose a password of at least ${PASSWORD_MIN_LENGTH} characters.` });
    }
    if (![b.cuisine, b.tradeLicenceNo, b.vatBin].every((v) => isOptionalText(v, 120))) {
      return res.status(400).json({ error: 'Cuisine, trade licence number and VAT BIN must be under 120 characters.' });
    }
    const email = b.ownerEmail.trim().toLowerCase();
    const username = await chooseUsername(b.username, email);
    if (!username) return res.status(400).json({ error: 'Usernames need 3 or more letters, numbers, dots, dashes or underscores.' });

    const userId = `USR-${randomUUID()}`;
    const restaurantId = `RST-${randomUUID()}`;
    const passwordHash = await hashPassword(b.password);
    await withTransaction((client) => client.query(
      `SELECT * FROM dineniro_restaurant_apply($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [userId, username, email, passwordHash, b.ownerName.trim(), b.ownerPhone.trim(),
        restaurantId, b.restaurantName.trim(), b.restaurantPhone.trim(), b.address.trim(), b.area.trim(), b.city.trim(),
        optionalTrimmed(b.cuisine), optionalTrimmed(b.tradeLicenceNo), optionalTrimmed(b.vatBin)],
    ));
    return await signIn(res, { id: userId, role: 'staff', email, username, name: b.ownerName.trim() }, 201);
  } catch (error) {
    respondApiError(res, error, 'Error creating restaurant application:');
  }
});

/** Any member can see their restaurant, including while it waits for approval. */
router.get('/api/restaurants/:restaurantId', requireMembership(), async (req: AuthRequest, res) => {
  try {
    const result = await query(`SELECT * FROM dineniro_restaurant_get($1)`, [req.membership!.restaurantId]);
    res.json({ restaurant: mapRestaurant(result.rows[0]), role: req.membership!.role });
  } catch (error) {
    respondApiError(res, error, 'Error fetching restaurant:');
  }
});

export default router;
