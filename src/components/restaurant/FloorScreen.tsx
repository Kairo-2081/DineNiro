import React from 'react';
import { clockTime, minutesSince, taka, useNow, usePolling } from '../../lib/format';
import type { FloorTable, TableState } from '../../types';
import { ErrorNote, Motif } from '../ui';
import { ScreenHeader } from './Rail';
import { can, useWorkspace } from './workspace';

/** Colours from the design. Every state also shows its name in words, so colour is never the only signal. */
export const TABLE_STATES: Record<TableState, { label: string; tile: string; chip: string }> = {
  free: { label: 'Free', tile: 'border-[1.5px] border-dashed border-[#8c7560] bg-transparent text-[#d9c8b4]', chip: 'border border-dashed border-[#8c7560] text-[#d9c8b4]' },
  reserved: { label: 'Reserved', tile: 'border-2 border-[#e8b77d] bg-[#261a12] text-[#e8b77d]', chip: 'border-2 border-[#e8b77d] bg-[#261a12] text-[#e8b77d]' },
  seated: { label: 'Seated', tile: 'border-[1.5px] border-[#e8b77d] bg-[#e8b77d] text-[#1a0f08]', chip: 'bg-[#e8b77d] text-[#1a0f08]' },
  cooking: { label: 'Cooking', tile: 'border-[1.5px] border-[#a9532a] bg-[#a9532a] text-[#fff1e2]', chip: 'bg-[#a9532a] text-[#fff1e2]' },
  ready: { label: 'Food ready', tile: 'border-[1.5px] border-[#8dbf8f] bg-[#8dbf8f] text-[#0f1a10] animate-pulse', chip: 'bg-[#8dbf8f] text-[#0f1a10]' },
  served: { label: 'Served', tile: 'border-[1.5px] border-[#c9d9b8] bg-[#c9d9b8] text-[#0f1a10]', chip: 'bg-[#c9d9b8] text-[#0f1a10]' },
  bill: { label: 'Bill printed', tile: 'border-[1.5px] border-[#8db4cc] bg-[#8db4cc] text-[#0e1820]', chip: 'bg-[#8db4cc] text-[#0e1820]' },
};

function TableTile({ table, selected, onSelect, now }: { table: FloorTable; selected: boolean; onSelect: () => void; now: number }) {
  const s = TABLE_STATES[table.state];
  const size = table.shape === 'long' ? 'col-span-2 h-[104px]' : 'h-[104px]';
  const meta = table.state === 'free' ? `${table.seats} seats`
    : table.state === 'reserved' && table.nextBooking ? `${clockTime(table.nextBooking.startsAt)} · ${table.nextBooking.partySize}`
    : `${table.guests} · ${minutesSince(table.openedAt, now)}m`;
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected}
      aria-label={`Table ${table.label}, ${s.label}${table.state === 'free' ? `, ${table.seats} seats` : `, ${table.guests} guests`}`}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 ${size} ${table.shape === 'round' ? 'mx-auto aspect-square w-[104px] rounded-full' : 'rounded-lg'} ${s.tile} ${selected ? 'outline-2 outline-offset-4 outline-cream' : ''}`}>
      <span className="font-display text-[28px] font-semibold leading-none">{table.label}</span>
      <span className="text-[11px] font-semibold">{meta}</span>
      {table.unsentItems > 0 && <span className="rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-bold">{table.unsentItems} not sent</span>}
    </button>
  );
}

function SeatPanel({ table, onSeated }: { table: FloorTable; onSeated: (orderId: string) => void }) {
  const { calls, role } = useWorkspace();
  const [guests, setGuests] = React.useState(Math.min(2, table.seats));
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const booking = table.nextBooking;
  const seatBooking = async () => {
    setBusy(true);
    setError(null);
    try {
      onSeated((await calls.seatBooking(booking!.id)).orderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not seat the booking.');
      setBusy(false);
    }
  };
  if (!can.seat(role)) return <p className="m-0 text-muted">This table is free.</p>;
  const seat = async () => {
    setBusy(true);
    setError(null);
    try {
      onSeated((await calls.seat(table.tableId, guests)).id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not seat the table.');
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <ErrorNote message={error} />
      {booking && (
        <div className={`flex flex-col gap-2.5 rounded-md border px-4 py-3 ${table.state === 'reserved' ? 'border-[#e8b77d] bg-[#261a12]' : 'border-gold-line bg-surface-2'}`}>
          <span className="text-sm">Booked at <span className="font-semibold">{clockTime(booking.startsAt)}</span> for {booking.guestName} ({booking.partySize})</span>
          {table.state === 'reserved' && (
            <button type="button" className="btn btn-gold min-h-12" disabled={busy} onClick={() => void seatBooking()}>Seat {booking.guestName}</button>
          )}
        </div>
      )}
      {table.state === 'reserved' && <p className="m-0 text-sm text-warn">Seating a walk-in here may leave {booking?.guestName} without their table.</p>}
      <div className="flex items-center justify-between rounded-md border border-gold-line bg-surface-2 px-4 py-3">
        <span className="text-sm">Guests</span>
        <span className="flex items-center gap-4">
          <button type="button" className="h-11 w-11 cursor-pointer rounded-full border border-[#5a4430] bg-surface text-xl text-cream" aria-label="One fewer guest" onClick={() => setGuests(Math.max(1, guests - 1))}>−</button>
          <span className="min-w-6 text-center text-xl font-semibold">{guests}</span>
          <button type="button" className="h-11 w-11 cursor-pointer rounded-full border border-[#5a4430] bg-surface text-xl text-cream" aria-label="One more guest" onClick={() => setGuests(Math.min(60, guests + 1))}>+</button>
        </span>
      </div>
      {guests > table.seats && <p className="m-0 text-sm text-warn">More guests than seats: bring extra chairs.</p>}
      <button type="button" className="btn btn-gold min-h-14" disabled={busy} onClick={() => void seat()}>Seat {guests} {guests === 1 ? 'guest' : 'guests'}</button>
    </div>
  );
}

export function FloorScreen() {
  const { calls, go, role, afterSeating } = useWorkspace();
  const now = useNow();
  const { data: floor, error } = usePolling(() => calls.floor(), 10_000, [calls]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [section, setSection] = React.useState<string | null>(null);

  const sections = [...new Set((floor ?? []).map((t) => t.section))];
  const activeSection = section && sections.includes(section) ? section : sections[0];
  const tables = (floor ?? []).filter((t) => t.section === activeSection);
  const selected = floor?.find((t) => t.tableId === selectedId) ?? null;
  const busy = (floor ?? []).filter((t) => t.state !== 'free' && t.state !== 'reserved');

  return (
    <div className="flex min-h-screen min-w-0 flex-1 flex-wrap">
      <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-5 px-6 py-6 sm:px-8">
        <ScreenHeader title={<>Floor <Motif name="steam" className="h-8 w-8 text-gold-soft opacity-70" /></>}>
          <div className="flex gap-6 text-right text-[13px] text-muted">
            <div><div className="text-xl font-semibold text-cream">{busy.length}/{floor?.length ?? 0}</div>tables seated</div>
            <div><div className="text-xl font-semibold text-cream">{busy.reduce((n, t) => n + (t.guests ?? 0), 0)}</div>covers now</div>
          </div>
        </ScreenHeader>
        <ErrorNote message={error} />

        {floor && floor.length === 0 ? (
          <section className="panel flex flex-col items-start gap-3 p-8">
            <h2 className="m-0 font-display text-3xl italic">No tables yet</h2>
            <p className="m-0 text-muted">Add your tables and menu in Setup, and they will appear here.</p>
            {can.supervise(role) && <button type="button" className="btn btn-gold" onClick={() => go({ name: 'setup' })}>Go to setup</button>}
          </section>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="tablist" aria-label="Floor section" className="flex flex-wrap gap-2">
                {sections.map((s) => (
                  <button key={s} type="button" role="tab" aria-selected={s === activeSection} onClick={() => setSection(s)}
                    className={`min-h-11 cursor-pointer rounded-full border px-5 text-[13px] font-medium ${s === activeSection ? 'border-[#efe4d2] bg-[#efe4d2] text-[#1a0f08]' : 'border-gold-line bg-surface-2 text-muted'}`}>{s}</button>
                ))}
              </div>
              <div className="flex flex-wrap gap-3.5 text-xs text-muted">
                {(Object.keys(TABLE_STATES) as TableState[]).map((state) => (
                  <span key={state} className="flex items-center gap-1.5">
                    <span className={`h-3 w-3 rounded-[3px] ${TABLE_STATES[state].chip}`} />{TABLE_STATES[state].label}
                  </span>
                ))}
              </div>
            </div>
            <div className="relative isolate flex-1 overflow-hidden rounded-md border border-gold-line p-6"
              style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 38%, #2A1A10 0%, #110b07 70%)' }}>
              <div aria-hidden="true" className="pointer-events-none absolute inset-2.5 border border-[rgb(216_179_124/0.22)]" />
              <Motif name="thali" className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[460px] w-[460px] -translate-x-1/2 -translate-y-1/2 text-gold opacity-[0.06]" />
              {!floor ? <p className="text-muted">Loading…</p> : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-6">
                  {tables.map((t) => <TableTile key={t.tableId} table={t} now={now} selected={t.tableId === selectedId} onSelect={() => setSelectedId(t.tableId)} />)}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      <aside aria-label="Selected table" className="relative isolate flex w-full flex-col gap-5 overflow-hidden border-l border-gold-hair bg-surface px-6 py-7 lg:w-[340px] lg:flex-none">
        <div aria-hidden="true" className="kantha absolute inset-x-0 top-0 -z-10" />
        <Motif name="anise" className="pointer-events-none absolute -right-12 -top-8 -z-10 h-48 w-48 text-gold opacity-[0.13]" />
        {!selected ? (
          <p className="m-0 pt-6 text-muted">Tap a table to see who is there and what they ordered.</p>
        ) : (
          <>
            <div className="flex flex-col gap-2.5 pt-3">
              <span className="eyebrow">{selected.section} · {selected.seats} seats</span>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="m-0 font-display text-[44px] font-medium italic leading-none">Table {selected.label}</h2>
                <span className={`rounded-full px-2.5 py-1.5 text-xs font-semibold ${TABLE_STATES[selected.state].chip}`}>{TABLE_STATES[selected.state].label}</span>
              </div>
            </div>
            {selected.state === 'free' || selected.state === 'reserved' ? (
              <SeatPanel key={selected.tableId} table={selected} onSeated={(orderId) => { setSelectedId(null); afterSeating(orderId); }} />
            ) : (
              <>
                <dl className="m-0 grid grid-cols-3 gap-px overflow-hidden rounded border border-gold-line bg-gold-line">
                  {[['Guests', String(selected.guests)], ['Seated', clockTime(selected.openedAt!)], ['Server', selected.serverName ?? '—']].map(([k, v]) => (
                    <div key={k} className="bg-surface-2 p-3"><dt className="text-[11px] text-muted">{k}</dt><dd className="m-0 mt-1.5 truncate text-[17px] font-semibold">{v}</dd></div>
                  ))}
                </dl>
                <div className="flex justify-between text-base font-semibold"><span className="font-medium text-muted">Running total</span><span>{taka(selected.runningTotal)}</span></div>
                <div className="flex-1" />
                <button type="button" className="btn btn-gold min-h-14" onClick={() => go({ name: 'order', orderId: selected.orderId! })}>
                  {can.order(role) ? 'Open order' : 'View order'}
                </button>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
