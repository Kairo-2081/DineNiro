import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/index.ts';
import { requireMembership, type AuthRequest } from '../middleware/auth.ts';
import { isAmount, isIdentifier, isOptionalText, isRecord, isText, isWholeNumber, mapRestaurant, money, respondApiError } from '../utils.ts';
import { STATIONS, type DiningTable, type MenuCategory, type Station, type TableShape } from '../../src/types.ts';

const router = Router();
const base = '/api/restaurants/:restaurantId';

/** Tables, menu and billing settings are set up by owners and managers. */
const setupRoles = requireMembership({ roles: ['owner', 'manager'], requireApproved: true });
const anyMember = requireMembership({ requireApproved: true });

const SHAPES: TableShape[] = ['square', 'round', 'long'];

function mapTable(row: any): DiningTable {
  return { id: row.id, label: row.label, seats: row.seats, section: row.section, shape: row.shape, sortOrder: row.sort_order, active: row.active };
}

export async function loadMenu(restaurantId: string): Promise<MenuCategory[]> {
  const result = await query(`SELECT * FROM dineniro_menu($1)`, [restaurantId]);
  const categories = new Map<string, MenuCategory>();
  for (const row of result.rows) {
    if (!categories.has(row.category_id)) {
      categories.set(row.category_id, { id: row.category_id, name: row.category_name, sortOrder: row.category_sort, items: [] });
    }
    if (row.item_id) {
      categories.get(row.category_id)!.items.push({
        id: row.item_id, categoryId: row.category_id, name: row.name, description: row.description, price: money(row.price),
        station: row.station, available: row.available, sortOrder: row.item_sort,
        options: (row.options as any[]).map((o) => ({ id: o.id, name: o.name, priceDelta: money(o.priceDelta) })),
      });
    }
  }
  return [...categories.values()];
}

// Billing settings.
router.patch(`${base}/settings`, setupRoles, async (req: AuthRequest, res) => {
  try {
    const { serviceChargePct, vatPct, receiptFooter } = req.body ?? {};
    const rate = (v: unknown) => v === undefined || isAmount(v, { max: 30 });
    if (!rate(serviceChargePct) || !rate(vatPct) || !isOptionalText(receiptFooter, 300)) {
      return res.status(400).json({ error: 'Service charge and VAT are percentages from 0 to 30. The receipt footer is up to 300 characters.' });
    }
    const result = await withTransaction((client) => client.query(
      `SELECT * FROM dineniro_settings_update($1, $2, $3, $4)`,
      [req.membership!.restaurantId, serviceChargePct ?? null, vatPct ?? null, receiptFooter ?? null],
    ));
    res.json(mapRestaurant(result.rows[0]));
  } catch (error) {
    respondApiError(res, error, 'Error saving billing settings:');
  }
});

// Tables.
router.get(`${base}/tables`, setupRoles, async (req: AuthRequest, res) => {
  try {
    res.json((await query(`SELECT * FROM dineniro_tables_list($1)`, [req.membership!.restaurantId])).rows.map(mapTable));
  } catch (error) {
    respondApiError(res, error, 'Error listing tables:');
  }
});

async function saveTable(req: AuthRequest, res: any, id: string, status: number) {
  const b = req.body ?? {};
  if (!isText(b.label, 20) || !isWholeNumber(b.seats, 1, 40) || !isOptionalText(b.section, 60) ||
    (b.shape !== undefined && !SHAPES.includes(b.shape)) || (b.sortOrder !== undefined && !isWholeNumber(b.sortOrder, 0, 10_000)) ||
    (b.active !== undefined && typeof b.active !== 'boolean')) {
    return res.status(400).json({ error: 'A table needs a name (up to 20 characters) and 1 to 40 seats.' });
  }
  const result = await withTransaction((client) => client.query(
    `SELECT * FROM dineniro_table_save($1, $2, $3, $4, $5, $6, $7, $8)`,
    [req.membership!.restaurantId, id, b.label.trim(), b.seats, (b.section || '').trim() || 'Main hall', b.shape ?? 'square', b.sortOrder ?? 0, b.active ?? true],
  ));
  if (!result.rows[0]) return res.status(404).json({ error: 'Table not found.' });
  res.status(status).json(mapTable(result.rows[0]));
}

router.post(`${base}/tables`, setupRoles, async (req: AuthRequest, res) => {
  try {
    await saveTable(req, res, `TBL-${randomUUID()}`, 201);
  } catch (error) {
    respondApiError(res, error, 'Error adding table:');
  }
});

router.put(`${base}/tables/:tableId`, setupRoles, async (req: AuthRequest, res) => {
  try {
    if (!isIdentifier(req.params.tableId)) return res.status(400).json({ error: 'Invalid table ID.' });
    const exists = await query(`SELECT 1 FROM dineniro_tables_list($1) t WHERE t.id = $2`, [req.membership!.restaurantId, req.params.tableId]);
    if (!exists.rows[0]) return res.status(404).json({ error: 'Table not found.' });
    await saveTable(req, res, req.params.tableId, 200);
  } catch (error) {
    respondApiError(res, error, 'Error saving table:');
  }
});

// Menu.
router.get(`${base}/menu`, anyMember, async (req: AuthRequest, res) => {
  try {
    res.json(await loadMenu(req.membership!.restaurantId));
  } catch (error) {
    respondApiError(res, error, 'Error loading the menu:');
  }
});

async function saveCategory(req: AuthRequest, res: any, id: string, status: number) {
  const { name, sortOrder } = req.body ?? {};
  if (!isText(name, 80) || (sortOrder !== undefined && !isWholeNumber(sortOrder, 0, 10_000))) {
    return res.status(400).json({ error: 'A category needs a name of up to 80 characters.' });
  }
  const result = await withTransaction((client) => client.query(
    `SELECT * FROM dineniro_category_save($1, $2, $3, $4)`, [req.membership!.restaurantId, id, name.trim(), sortOrder ?? 0],
  ));
  if (!result.rows[0]) return res.status(404).json({ error: 'Category not found.' });
  res.status(status).json({ id: result.rows[0].id, name: result.rows[0].name, sortOrder: result.rows[0].sort_order });
}

router.post(`${base}/categories`, setupRoles, async (req: AuthRequest, res) => {
  try {
    await saveCategory(req, res, `CAT-${randomUUID()}`, 201);
  } catch (error) {
    respondApiError(res, error, 'Error adding category:');
  }
});

router.put(`${base}/categories/:categoryId`, setupRoles, async (req: AuthRequest, res) => {
  try {
    if (!isIdentifier(req.params.categoryId)) return res.status(400).json({ error: 'Invalid category ID.' });
    await saveCategory(req, res, req.params.categoryId, 200);
  } catch (error) {
    respondApiError(res, error, 'Error saving category:');
  }
});

router.delete(`${base}/categories/:categoryId`, setupRoles, async (req: AuthRequest, res) => {
  try {
    if (!isIdentifier(req.params.categoryId)) return res.status(400).json({ error: 'Invalid category ID.' });
    const result = await withTransaction((client) => client.query(
      `SELECT dineniro_category_delete($1, $2) AS deleted`, [req.membership!.restaurantId, req.params.categoryId],
    ));
    if (!result.rows[0]?.deleted) return res.status(404).json({ error: 'Category not found.' });
    res.sendStatus(204);
  } catch (error) {
    respondApiError(res, error, 'Error removing category:');
  }
});

async function saveMenuItem(req: AuthRequest, res: any, id: string, status: number) {
  const b = req.body ?? {};
  const options = b.options ?? [];
  const validOptions = Array.isArray(options) && options.length <= 20 &&
    options.every((o: unknown) => isRecord(o) && isText(o.name, 80) && (o.priceDelta === undefined || isAmount(o.priceDelta, { max: 99_999 })));
  if (!isIdentifier(b.categoryId) || !isText(b.name, 120) || !isOptionalText(b.description, 300) || !isAmount(b.price, { max: 999_999 }) ||
    (b.station !== undefined && !STATIONS.includes(b.station as Station)) || (b.available !== undefined && typeof b.available !== 'boolean') ||
    (b.sortOrder !== undefined && !isWholeNumber(b.sortOrder, 0, 10_000)) || !validOptions) {
    return res.status(400).json({ error: 'A dish needs a category, a name, a price in taka and a valid station. Up to 20 options, each with a name.' });
  }
  const restaurantId = req.membership!.restaurantId;
  const category = await query(`SELECT 1 FROM dineniro_menu($1) m WHERE m.category_id = $2 LIMIT 1`, [restaurantId, b.categoryId]);
  if (!category.rows[0]) return res.status(400).json({ error: 'That category is not on this menu.' });

  const optionRows = options.map((o: any) => ({ id: `OPT-${randomUUID()}`, name: o.name.trim(), priceDelta: o.priceDelta ?? 0 }));
  const result = await withTransaction((client) => client.query(
    `SELECT dineniro_menu_item_save($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) AS id`,
    [restaurantId, id, b.categoryId, b.name.trim(), (b.description || '').trim(), b.price, b.station ?? 'kitchen',
      b.available ?? true, b.sortOrder ?? 0, JSON.stringify(optionRows)],
  ));
  if (!result.rows[0]?.id) return res.status(404).json({ error: 'Dish not found.' });
  const menu = await loadMenu(restaurantId);
  res.status(status).json(menu.flatMap((c) => c.items).find((item) => item.id === id));
}

router.post(`${base}/menu-items`, setupRoles, async (req: AuthRequest, res) => {
  try {
    await saveMenuItem(req, res, `ITM-${randomUUID()}`, 201);
  } catch (error) {
    respondApiError(res, error, 'Error adding dish:');
  }
});

router.put(`${base}/menu-items/:itemId`, setupRoles, async (req: AuthRequest, res) => {
  try {
    if (!isIdentifier(req.params.itemId)) return res.status(400).json({ error: 'Invalid dish ID.' });
    const menu = await loadMenu(req.membership!.restaurantId);
    if (!menu.some((c) => c.items.some((i) => i.id === req.params.itemId))) return res.status(404).json({ error: 'Dish not found.' });
    await saveMenuItem(req, res, req.params.itemId, 200);
  } catch (error) {
    respondApiError(res, error, 'Error saving dish:');
  }
});

export default router;
