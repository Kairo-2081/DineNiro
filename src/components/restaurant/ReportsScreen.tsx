import React from 'react';
import { taka, usePolling } from '../../lib/format';
import type { PaymentMethod, ReportSummary, SalesReport } from '../../types';
import { ErrorNote, Motif } from '../ui';
import { ScreenHeader } from './Rail';
import { useWorkspace } from './workspace';

type RangeKey = 'today' | 'yesterday' | '7d' | '30d';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'yesterday', label: 'Yesterday' }, { key: '7d', label: '7 days' }, { key: '30d', label: '30 days' },
];
const DAY = 24 * 60 * 60 * 1000;
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', card: 'Card', bkash: 'bKash', nagad: 'Nagad' };
/** Four payment colours that differ in lightness as well as hue, from the design's palette. */
const METHOD_COLOUR: Record<PaymentMethod, string> = { cash: '#e8b77d', bkash: '#c96a35', card: '#8db4cc', nagad: '#8dbf8f' };

function rangeFor(key: RangeKey) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const tomorrow = new Date(midnight.getTime() + DAY);
  if (key === 'yesterday') return { from: new Date(midnight.getTime() - DAY), to: midnight };
  if (key === '7d') return { from: new Date(midnight.getTime() - 6 * DAY), to: tomorrow };
  if (key === '30d') return { from: new Date(midnight.getTime() - 29 * DAY), to: tomorrow };
  return { from: midnight, to: tomorrow };
}

function change(now: number, before: number) {
  if (!before) return now ? { text: 'new', tone: 'text-muted' } : { text: '—', tone: 'text-muted' };
  const pct = Math.round(((now - before) / before) * 100);
  const tone = pct > 0 ? 'text-ok' : pct < 0 ? 'text-danger' : 'text-muted';
  // Against a nearly empty period, a percentage like +5783% says nothing useful.
  if (pct >= 900) return { text: `over ${Math.floor(now / before)}× previous`, tone };
  return { text: `${pct > 0 ? '+' : ''}${pct}% vs previous`, tone };
}

function Kpi({ label, value, now, before }: { label: string; value: string; now: number; before: number }) {
  const delta = change(now, before);
  return (
    <div className="panel flex flex-col gap-2.5 p-5">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-[28px] font-semibold leading-none">{value}</span>
      <span className={`text-xs font-medium ${delta.tone}`}>{delta.text}</span>
    </div>
  );
}

function bucketLabel(stamp: string, bucket: 'hour' | 'day') {
  const [date, time] = stamp.split('T');
  if (bucket === 'hour') {
    const h = Number(time.slice(0, 2));
    return `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`;
  }
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function toCsv(report: SalesReport, rangeLabel: string, restaurantName: string) {
  const s = report.summary;
  const rows: (string | number)[][] = [
    [`${restaurantName}: ${rangeLabel}`], [],
    ['Figure', 'Amount'],
    ['Bills', s.bills], ['Covers', s.covers], ['Food sales', s.foodSales], ['Discounts', s.discounts], ['Net sales', s.netSales],
    ['Service charge', s.serviceCharge], ['VAT collected', s.vat], ['Total taken', s.total], ['Average check', s.averageCheck],
    ['Voided dishes', s.voidedLines], ['Voided value', s.voidedValue], ['Food cost (dishes with a recipe)', s.foodCost], [],
    ['Payment method', 'Payments', 'Amount'], ...report.payments.map((p) => [METHOD_LABEL[p.method], p.payments, p.amount]), [],
    ['Dish', 'Sold', 'Sales'], ...report.dishes.map((d) => [d.name, d.quantity, d.sales]), [],
    ['Server', 'Tables', 'Covers', 'Sales', 'Average turn (min)'], ...report.staff.map((m) => [m.name, m.tables, m.covers, m.total, m.averageTurnMinutes ?? '']), [],
    [report.bucket === 'hour' ? 'Hour' : 'Day', 'Bills', 'Covers', 'Sales'], ...report.series.map((p) => [p.bucket.replace('T', ' '), p.bills, p.covers, p.total]),
  ];
  return rows.map((row) => row.map((cell) => {
    const text = String(cell);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\n');
}

function MoneyRow({ label, value, strong = false, note }: { label: string; value: string; strong?: boolean; note?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-b border-gold-hair py-2.5 text-sm ${strong ? 'font-semibold' : ''}`}>
      <span className={strong ? '' : 'text-muted'}>{label}{note && <span className="block text-xs font-normal text-faint">{note}</span>}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function ReportsScreen() {
  const { calls, restaurant } = useWorkspace();
  const [key, setKey] = React.useState<RangeKey>('today');
  const range = React.useMemo(() => rangeFor(key), [key]);
  const { data: report, error } = usePolling(() => calls.report(range.from.toISOString(), range.to.toISOString(), TIME_ZONE), 60_000, [calls, range]);
  const label = RANGES.find((r) => r.key === key)!.label;

  const s: ReportSummary | undefined = report?.summary;
  const p = report?.previous;
  const maxBar = Math.max(1, ...(report?.series ?? []).map((x) => x.total));
  const peak = report?.series.reduce((best, x) => (x.total > (best?.total ?? 0) ? x : best), null as SalesReport['series'][number] | null);
  const totalPaid = (report?.payments ?? []).reduce((n, x) => n + x.amount, 0);
  const topSales = Math.max(1, ...(report?.dishes ?? []).map((d) => d.sales));
  const foodCostPct = s && s.costedSales > 0 ? Math.round((s.foodCost / s.costedSales) * 100) : null;

  const exportCsv = () => {
    if (!report) return;
    const blob = new Blob([`﻿${toCsv(report, `${label} (${range.from.toLocaleDateString('en-GB')}–${new Date(range.to.getTime() - 1).toLocaleDateString('en-GB')})`, restaurant.name)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dineniro-${restaurant.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${key}-${range.from.toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-6 px-6 py-6 sm:px-8">
      <ScreenHeader title={<>Reports <Motif name="chili" className="h-8 w-8 text-gold-soft opacity-70" /></>}>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Date range" className="flex flex-wrap gap-2">
            {RANGES.map((r) => (
              <button key={r.key} type="button" role="tab" aria-selected={key === r.key} onClick={() => setKey(r.key)}
                className={`min-h-11 cursor-pointer rounded-full border px-4 text-[13px] font-medium ${key === r.key ? 'border-[#efe4d2] bg-[#efe4d2] text-[#1a0f08]' : 'border-gold-line bg-surface-2 text-muted'}`}>{r.label}</button>
            ))}
          </div>
          <button type="button" className="btn min-h-11" disabled={!report} onClick={exportCsv}>Export CSV</button>
        </div>
      </ScreenHeader>
      <ErrorNote message={error} />
      {!report || !s || !p ? <p className="text-muted">Loading…</p> : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
            <Kpi label="Net sales" value={taka(s.netSales)} now={s.netSales} before={p.netSales} />
            <Kpi label="Covers" value={String(s.covers)} now={s.covers} before={p.covers} />
            <Kpi label="Average check" value={taka(s.averageCheck)} now={s.averageCheck} before={p.averageCheck} />
            <Kpi label="Bills" value={String(s.bills)} now={s.bills} before={p.bills} />
          </div>

          {s.bills === 0 ? (
            <section className="panel p-8"><p className="m-0 text-muted">No paid bills in this period yet.</p></section>
          ) : (
            <>
              <div className="flex flex-wrap gap-5">
                <section aria-labelledby="sales-chart" className="panel flex min-w-0 flex-[999_1_560px] flex-col gap-4 p-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 id="sales-chart" className="m-0 font-display text-[28px] font-medium italic">Sales by {report.bucket}</h2>
                    {peak && <span className="text-xs text-muted">Busiest: {bucketLabel(peak.bucket, report.bucket)} · {taka(peak.total)}</span>}
                  </div>
                  <div className="overflow-x-auto">
                    <div role="img" aria-label={`Bar chart of sales by ${report.bucket}`} className="flex h-[220px] min-w-full items-end gap-2 border-b border-[rgb(216_179_124/0.22)] pt-2"
                      style={{ width: Math.max(report.series.length * 44, 100) }}>
                      {report.series.map((x) => (
                        <div key={x.bucket} className="flex h-full min-w-8 flex-1 flex-col items-center justify-end gap-1.5" title={`${bucketLabel(x.bucket, report.bucket)}: ${taka(x.total)}, ${x.bills} bills`}>
                          <span className="text-[10px] font-semibold text-muted">{x.total >= 1000 ? `${Math.round(x.total / 100) / 10}k` : Math.round(x.total)}</span>
                          <div className="w-full max-w-9 rounded-t-[3px]" style={{ height: `${Math.max(4, Math.round((x.total / maxBar) * 170))}px`, background: x === peak ? '#f4e9da' : '#e8b77d' }} />
                        </div>
                      ))}
                    </div>
                    <div className="flex min-w-full gap-2 pt-1.5" style={{ width: Math.max(report.series.length * 44, 100) }}>
                      {report.series.map((x) => <span key={x.bucket} className="min-w-8 flex-1 text-center text-[11px] text-faint">{bucketLabel(x.bucket, report.bucket)}</span>)}
                    </div>
                  </div>
                </section>

                <section aria-labelledby="payment-mix" className="panel flex flex-[1_1_300px] flex-col gap-4 p-6">
                  <h2 id="payment-mix" className="m-0 font-display text-[28px] font-medium italic">Payment mix</h2>
                  <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                    {report.payments.map((x) => <div key={x.method} style={{ width: `${(x.amount / totalPaid) * 100}%`, background: METHOD_COLOUR[x.method] }} />)}
                  </div>
                  <div className="flex flex-col gap-3 text-sm">
                    {report.payments.map((x) => (
                      <div key={x.method} className="flex items-center gap-2.5">
                        <span className="h-3 w-3 rounded-[3px]" style={{ background: METHOD_COLOUR[x.method] }} />
                        <span className="flex-1">{METHOD_LABEL[x.method]} <span className="text-xs text-faint">· {x.payments}</span></span>
                        <span className="tabular-nums">{taka(x.amount)}</span>
                        <span className="w-10 text-right text-muted">{Math.round((x.amount / totalPaid) * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="flex flex-wrap items-start gap-5">
                <section aria-labelledby="top-dishes" className="panel flex flex-[1_1_340px] flex-col gap-3.5 p-6">
                  <h2 id="top-dishes" className="m-0 font-display text-[28px] font-medium italic">Top dishes</h2>
                  {report.dishes.map((d) => (
                    <div key={d.menuItemId} className="flex flex-col gap-1.5">
                      <div className="flex justify-between gap-3 text-sm"><span>{d.name}</span><span className="text-muted">{d.quantity} sold · <span className="text-cream">{taka(d.sales)}</span></span></div>
                      <div className="h-1.5 rounded bg-[#2e2118]"><div className="h-full rounded bg-[#e8b77d]" style={{ width: `${(d.sales / topSales) * 100}%` }} /></div>
                    </div>
                  ))}
                </section>

                <section aria-labelledby="staff-table" className="panel flex min-w-0 flex-[999_1_480px] flex-col gap-3 p-6">
                  <h2 id="staff-table" className="m-0 font-display text-[28px] font-medium italic">Staff</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[440px] border-collapse text-sm">
                      <thead><tr className="text-left text-[11px] uppercase tracking-[0.12em] text-gold-soft">
                        {['Server', 'Tables', 'Covers', 'Sales', 'Avg check', 'Avg turn'].map((h) => <th key={h} className="border-b border-gold-line px-3 py-2.5 font-semibold">{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {report.staff.map((m) => (
                          <tr key={m.userId ?? m.name} className="border-b border-gold-hair">
                            <td className="px-3 py-2.5 font-semibold">{m.name}</td><td className="px-3 py-2.5">{m.tables}</td><td className="px-3 py-2.5">{m.covers}</td>
                            <td className="px-3 py-2.5">{taka(m.total)}</td><td className="px-3 py-2.5">{taka(Math.round((m.total / m.tables) * 100) / 100)}</td>
                            <td className="px-3 py-2.5">{m.averageTurnMinutes === null ? '—' : `${m.averageTurnMinutes} min`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <aside aria-labelledby="money-title" className="relative isolate flex flex-[1_1_300px] flex-col gap-1 overflow-hidden rounded-sm bg-raised px-6 py-7">
                  <div aria-hidden="true" className="pointer-events-none absolute inset-[7px] border border-[rgb(216_179_124/0.38)]" />
                  <span className="eyebrow">For the accounts</span>
                  <h2 id="money-title" className="m-0 pb-2 font-display text-[28px] font-medium italic">Where the money went</h2>
                  <MoneyRow label="Food sales" value={taka(s.foodSales)} />
                  <MoneyRow label="Discounts" value={`−${taka(s.discounts)}`} note={`${s.discountedBills} ${s.discountedBills === 1 ? 'bill' : 'bills'}`} />
                  <MoneyRow label="Net sales" value={taka(s.netSales)} strong />
                  <MoneyRow label="Service charge" value={taka(s.serviceCharge)} />
                  <MoneyRow label="VAT collected" value={taka(s.vat)} note="To pay over to NBR" />
                  <MoneyRow label="Total taken" value={taka(s.total)} strong />
                  <MoneyRow label="Voided dishes" value={taka(s.voidedValue)} note={`${s.voidedLines} ${s.voidedLines === 1 ? 'dish' : 'dishes'}, not billed`} />
                  <MoneyRow label="Food cost" value={foodCostPct === null ? 'Add recipes' : `${taka(s.foodCost)} · ${foodCostPct}%`} note={foodCostPct === null ? undefined : 'Of dishes that have a recipe'} />
                  {s.averageTurnMinutes !== null && <MoneyRow label="Average table time" value={`${s.averageTurnMinutes} min`} />}
                </aside>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
