import { Router } from 'express';
import { query } from '../db/index.ts';
import { requireMembership, type AuthRequest } from '../middleware/auth.ts';
import { money, respondApiError } from '../utils.ts';
import type { ReportSummary, SalesReport } from '../../src/types.ts';

const router = Router();
const ownersAndManagers = requireMembership({ roles: ['owner', 'manager'], requireApproved: true });

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 400 * DAY_MS;

function mapSummary(row: any): ReportSummary {
  const bills = Number(row.bills || 0);
  const covers = Number(row.covers || 0);
  const total = money(row.total);
  const foodSales = money(row.food_sales);
  const discounts = money(row.discounts);
  return {
    bills, covers, foodSales, discounts, discountedBills: Number(row.discounted_bills || 0),
    serviceCharge: money(row.service_charge), vat: money(row.vat), total, netSales: money(foodSales - discounts),
    averageCheck: bills ? money(total / bills) : 0, perCover: covers ? money(total / covers) : 0,
    voidedLines: Number(row.voided_lines || 0), voidedValue: money(row.voided_value),
    foodCost: money(row.food_cost), costedSales: money(row.costed_sales),
    averageTurnMinutes: row.avg_turn_minutes === null ? null : Number(row.avg_turn_minutes),
  };
}

/**
 * Sales for [from, to) with the same length of time just before it for comparison.
 * `tz` is the restaurant's time zone (the browser sends its own), used to group sales into local hours or days.
 */
router.get('/api/restaurants/:restaurantId/reports', ownersAndManagers, async (req: AuthRequest, res) => {
  try {
    const from = new Date(String(req.query.from ?? ''));
    const to = new Date(String(req.query.to ?? ''));
    const tz = String(req.query.tz ?? 'UTC');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > MAX_RANGE_MS) {
      return res.status(400).json({ error: 'Send from and to times, at most 400 days apart.' });
    }
    if (tz.length > 60 || !(await query(`SELECT dineniro_time_zone_valid($1) AS ok`, [tz])).rows[0]?.ok) {
      return res.status(400).json({ error: 'Unknown time zone.' });
    }
    const rid = req.membership!.restaurantId;
    const length = to.getTime() - from.getTime();
    const previousFrom = new Date(from.getTime() - length);
    const bucket = length <= 1.5 * DAY_MS ? 'hour' : 'day';

    const [summary, previous, series, dishes, staff, payments] = await Promise.all([
      query(`SELECT * FROM dineniro_report_summary($1, $2, $3)`, [rid, from, to]),
      query(`SELECT * FROM dineniro_report_summary($1, $2, $3)`, [rid, previousFrom, from]),
      query(`SELECT * FROM dineniro_report_series($1, $2, $3, $4, $5)`, [rid, from, to, bucket, tz]),
      query(`SELECT * FROM dineniro_report_dishes($1, $2, $3, 10)`, [rid, from, to]),
      query(`SELECT * FROM dineniro_report_staff($1, $2, $3)`, [rid, from, to]),
      query(`SELECT * FROM dineniro_report_payments($1, $2, $3)`, [rid, from, to]),
    ]);

    // Series buckets are local wall-clock times; send them as plain "YYYY-MM-DDTHH:mm" strings, not instants.
    const localStamp = (value: any) => {
      const d = value instanceof Date ? value : new Date(value);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const report: SalesReport = {
      from: from.toISOString(), to: to.toISOString(), bucket,
      summary: mapSummary(summary.rows[0]), previous: mapSummary(previous.rows[0]),
      series: series.rows.map((s: any) => ({ bucket: localStamp(s.bucket), bills: Number(s.bills), covers: Number(s.covers), total: money(s.total) })),
      dishes: dishes.rows.map((d: any) => ({ menuItemId: d.menu_item_id, name: d.name, quantity: Number(d.quantity), sales: money(d.sales) })),
      staff: staff.rows.map((s: any) => ({
        userId: s.user_id, name: s.name, tables: Number(s.tables), covers: Number(s.covers), total: money(s.total),
        averageTurnMinutes: s.avg_turn_minutes === null ? null : Number(s.avg_turn_minutes),
      })),
      payments: payments.rows.map((p: any) => ({ method: p.method, payments: Number(p.payments), amount: money(p.amount) })),
    };
    res.json(report);
  } catch (error) {
    respondApiError(res, error, 'Error building report:');
  }
});

export default router;
