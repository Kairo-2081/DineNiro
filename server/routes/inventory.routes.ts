import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/index.ts';
import { requireMembership, type AuthRequest } from '../middleware/auth.ts';
import { isAmount, isIdentifier, isOptionalText, isRecord, isText, money, respondApiError } from '../utils.ts';
import { STOCK_UNITS, type Ingredient, type RecipeLine, type StockMovement, type StockUnit } from '../../src/types.ts';

const router = Router();
const base = '/api/restaurants/:restaurantId';

/** The kitchen keeps stock: chefs receive deliveries, count and record waste. Owners and managers also set up ingredients and recipes. */
const kitchenStock = requireMembership({ roles: ['owner', 'manager', 'chef'], requireApproved: true });
const stockSetup = requireMembership({ roles: ['owner', 'manager'], requireApproved: true });

const qty = (value: unknown) => Math.round(Number(value ?? 0) * 1000) / 1000;

/** A stock quantity: up to 3 decimals (grams of a kilo), below a million. */
function isQuantity(value: unknown, min = 0): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value < 1_000_000 &&
    Math.abs(Math.round(value * 1000) - value * 1000) < 1e-6;
}

function mapIngredient(row: any): Ingredient {
  return {
    id: row.id, name: row.name, category: row.category, unit: row.unit, onHand: qty(row.on_hand), parLevel: qty(row.par_level),
    unitCost: money(row.unit_cost), supplier: row.supplier, active: row.active, usedToday: qty(row.used_today),
    usedPerDay: qty(row.used_per_day), dishes: Number(row.dishes || 0),
  };
}

async function ingredientOrNull(restaurantId: string, id: string) {
  const rows = (await query(`SELECT * FROM dineniro_ingredients($1) g WHERE g.id = $2`, [restaurantId, id])).rows;
  return rows[0] ? mapIngredient(rows[0]) : null;
}

router.get(`${base}/ingredients`, kitchenStock, async (req: AuthRequest, res) => {
  try {
    res.json((await query(`SELECT * FROM dineniro_ingredients($1)`, [req.membership!.restaurantId])).rows.map(mapIngredient));
  } catch (error) {
    respondApiError(res, error, 'Error listing ingredients:');
  }
});

async function saveIngredient(req: AuthRequest, res: any, id: string, status: number) {
  const b = req.body ?? {};
  if (!isText(b.name, 120) || !isOptionalText(b.category, 60) || !STOCK_UNITS.includes(b.unit as StockUnit) ||
    (b.parLevel !== undefined && !isQuantity(b.parLevel)) || (b.unitCost !== undefined && !isAmount(b.unitCost, { max: 999_999 })) ||
    !isOptionalText(b.supplier, 120) || (b.active !== undefined && typeof b.active !== 'boolean')) {
    return res.status(400).json({ error: 'An ingredient needs a name and a unit (kg, g, l, ml or pc). Par level and cost cannot be negative.' });
  }
  const restaurantId = req.membership!.restaurantId;
  const result = await withTransaction((client) => client.query(
    `SELECT dineniro_ingredient_save($1, $2, $3, $4, $5, $6, $7, $8, $9) AS id`,
    [restaurantId, id, b.name.trim(), (b.category || '').trim() || 'Other', b.unit, b.parLevel ?? 0, b.unitCost ?? 0, (b.supplier || '').trim(), b.active ?? true],
  ));
  if (!result.rows[0]?.id) return res.status(404).json({ error: 'Ingredient not found.' });
  res.status(status).json(await ingredientOrNull(restaurantId, id));
}

router.post(`${base}/ingredients`, stockSetup, async (req: AuthRequest, res) => {
  try {
    await saveIngredient(req, res, `ING-${randomUUID()}`, 201);
  } catch (error) {
    respondApiError(res, error, 'Error adding ingredient:');
  }
});

router.put(`${base}/ingredients/:ingredientId`, stockSetup, async (req: AuthRequest, res) => {
  try {
    if (!isIdentifier(req.params.ingredientId)) return res.status(400).json({ error: 'Invalid ingredient ID.' });
    if (!(await ingredientOrNull(req.membership!.restaurantId, req.params.ingredientId))) return res.status(404).json({ error: 'Ingredient not found.' });
    await saveIngredient(req, res, req.params.ingredientId, 200);
  } catch (error) {
    respondApiError(res, error, 'Error saving ingredient:');
  }
});

/** Deliveries add stock (and may update the cost), counts set it to what is on the shelf, waste takes it away. */
router.post(`${base}/ingredients/:ingredientId/stock`, kitchenStock, async (req: AuthRequest, res) => {
  try {
    const { kind, quantity, unitCost, note } = req.body ?? {};
    if (!isIdentifier(req.params.ingredientId)) return res.status(400).json({ error: 'Invalid ingredient ID.' });
    if (!['delivery', 'count', 'waste'].includes(kind) || !isQuantity(quantity) ||
      (unitCost !== undefined && unitCost !== null && (kind !== 'delivery' || !isAmount(unitCost, { max: 999_999 }))) || !isOptionalText(note, 200)) {
      return res.status(400).json({ error: 'Send delivery, count or waste with a quantity. Only deliveries take a new cost.' });
    }
    if (kind === 'waste' && !isText(note, 200)) return res.status(400).json({ error: 'Say why it was thrown away.' });
    const restaurantId = req.membership!.restaurantId;
    const result = await withTransaction((client) => client.query(
      `SELECT dineniro_stock_record($1, $2, $3, $4, $5, $6, $7) AS on_hand`,
      [restaurantId, req.params.ingredientId, kind, quantity, unitCost ?? null, (note || '').trim(), req.user!.sub],
    ));
    if (result.rows[0]?.on_hand === null || result.rows[0]?.on_hand === undefined) return res.status(404).json({ error: 'Ingredient not found.' });
    res.status(201).json(await ingredientOrNull(restaurantId, req.params.ingredientId));
  } catch (error) {
    respondApiError(res, error, 'Error recording stock:');
  }
});

router.get(`${base}/ingredients/:ingredientId/history`, kitchenStock, async (req: AuthRequest, res) => {
  try {
    if (!isIdentifier(req.params.ingredientId)) return res.status(400).json({ error: 'Invalid ingredient ID.' });
    const rows = (await query(`SELECT * FROM dineniro_stock_history($1, $2, 40)`, [req.membership!.restaurantId, req.params.ingredientId])).rows;
    const history: StockMovement[] = rows.map((m: any) => ({
      id: Number(m.id), change: qty(m.change), reason: m.reason, note: m.note, dish: m.dish, tableLabel: m.table_label,
      recordedByName: m.recorded_by_name, createdAt: new Date(m.created_at).toISOString(),
    }));
    res.json(history);
  } catch (error) {
    respondApiError(res, error, 'Error loading stock history:');
  }
});

router.get(`${base}/recipes/:menuItemId`, kitchenStock, async (req: AuthRequest, res) => {
  try {
    if (!isIdentifier(req.params.menuItemId)) return res.status(400).json({ error: 'Invalid dish ID.' });
    const rows = (await query(`SELECT * FROM dineniro_recipe($1, $2)`, [req.membership!.restaurantId, req.params.menuItemId])).rows;
    const lines: RecipeLine[] = rows.map((r: any) => ({ ingredientId: r.ingredient_id, name: r.name, unit: r.unit, quantity: qty(r.quantity), unitCost: money(r.unit_cost) }));
    res.json(lines);
  } catch (error) {
    respondApiError(res, error, 'Error loading recipe:');
  }
});

router.put(`${base}/recipes/:menuItemId`, stockSetup, async (req: AuthRequest, res) => {
  try {
    const lines = req.body?.lines;
    if (!isIdentifier(req.params.menuItemId)) return res.status(400).json({ error: 'Invalid dish ID.' });
    const valid = Array.isArray(lines) && lines.length <= 30 &&
      lines.every((l: unknown) => isRecord(l) && isIdentifier(l.ingredientId) && isQuantity(l.quantity) && (l.quantity as number) > 0) &&
      new Set(lines.map((l: any) => l.ingredientId)).size === lines.length;
    if (!valid) return res.status(400).json({ error: 'A recipe is up to 30 different ingredients, each with a quantity above zero.' });
    const restaurantId = req.membership!.restaurantId;
    const owned = (await query(`SELECT g.id FROM dineniro_ingredients($1) g`, [restaurantId])).rows.map((r: any) => r.id);
    if (!lines.every((l: any) => owned.includes(l.ingredientId))) return res.status(400).json({ error: 'One of those ingredients is not in your stock list.' });
    const result = await withTransaction((client) => client.query(
      `SELECT dineniro_recipe_save($1, $2, $3::jsonb) AS ok`, [restaurantId, req.params.menuItemId, JSON.stringify(lines)],
    ));
    if (!result.rows[0]?.ok) return res.status(404).json({ error: 'Dish not found.' });
    const rows = (await query(`SELECT * FROM dineniro_recipe($1, $2)`, [restaurantId, req.params.menuItemId])).rows;
    res.json(rows.map((r: any) => ({ ingredientId: r.ingredient_id, name: r.name, unit: r.unit, quantity: qty(r.quantity), unitCost: money(r.unit_cost) })));
  } catch (error) {
    respondApiError(res, error, 'Error saving recipe:');
  }
});

export default router;
