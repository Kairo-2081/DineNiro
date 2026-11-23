import React from 'react';
import { clockTime, minutesSince, useNow, usePolling } from '../../lib/format';
import type { AvailableTable, Reservation, WaitlistEntry } from '../../types';
import { ErrorNote, Motif } from '../ui';
import { ScreenHeader } from './Rail';
import { can, useWorkspace } from './workspace';

/** The timeline runs from 11:00 to midnight so lunch and dinner both fit; it scrolls sideways on a tablet. */
const OPEN_HOUR = 11;
const CLOSE_HOUR = 24;
const SLOT_MINUTES = 30;
const SLOT_WIDTH = 64;
const LABEL_WIDTH = 72;
const SLOTS = ((CLOSE_HOUR - OPEN_HOUR) * 60) / SLOT_MINUTES;
const DURATIONS = [60, 90, 120, 150, 180];

const BLOCK_STYLES: Record<Reservation['status'], string> = {
  booked: 'border-[1.5px] border-[#e8b77d] bg-[#261a12] text-cream',
  seated: 'bg-[#8dbf8f] text-[#0f1a10]',
  completed: 'bg-[#2a1d14] text-muted',
  no_show: 'border border-dashed border-[#8a5a4a] bg-transparent text-danger',
  cancelled: 'hidden',
};
const STATUS_LABEL: Record<Reservation['status'], string> = {
  booked: 'Booked', seated: 'Seated', completed: 'Finished', no_show: 'No-show', cancelled: 'Cancelled',
};

function dayStart(offsetDays: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

function atMinutes(day: Date, minutesFromOpen: number) {
  return new Date(day.getTime() + (OPEN_HOUR * 60 + minutesFromOpen) * 60_000);
}

function minutesFromOpen(day: Date, iso: string) {
  return (new Date(iso).getTime() - day.getTime()) / 60_000 - OPEN_HOUR * 60;
}

function timeOptions() {
  const out: { value: number; label: string }[] = [];
  for (let m = 0; m < (CLOSE_HOUR - OPEN_HOUR) * 60; m += 15) {
    const h = OPEN_HOUR + Math.floor(m / 60);
    out.push({ value: m, label: `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h < 12 || h === 24 ? 'am' : 'pm'}` });
  }
  return out;
}
const TIME_OPTIONS = timeOptions();

interface Draft {
  id?: string;
  minutes: number;
  durationMinutes: number;
  partySize: number;
  guestName: string;
  phone: string;
  note: string;
  tableId: string;
}

function BookingForm({ day, draft: initial, onDone, onCancel }: { day: Date; draft: Draft; onDone: () => void; onCancel: () => void }) {
  const { calls } = useWorkspace();
  const [draft, setDraft] = React.useState(initial);
  const [tables, setTables] = React.useState<AvailableTable[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const startsAt = atMinutes(day, draft.minutes).toISOString();

  React.useEffect(() => {
    let current = true;
    setTables(null);
    calls.availability(startsAt, draft.durationMinutes, draft.partySize, draft.id)
      .then((list) => { if (current) setTables(list); })
      .catch((err) => { if (current) setError(err instanceof Error ? err.message : 'Could not check tables.'); });
    return () => { current = false; };
  }, [calls, startsAt, draft.durationMinutes, draft.partySize, draft.id]);

  const chosenFree = tables?.some((t) => t.tableId === draft.tableId);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await calls.book({
        id: draft.id, tableId: draft.tableId, guestName: draft.guestName.trim(), phone: draft.phone.trim() || undefined,
        partySize: draft.partySize, startsAt, durationMinutes: draft.durationMinutes, note: draft.note.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the booking.');
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="booking-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form onSubmit={submit} className="panel flex max-h-[92vh] w-full max-w-xl flex-col gap-4 overflow-auto p-6">
        <h2 id="booking-title" className="m-0 font-display text-3xl italic">{draft.id ? 'Change booking' : 'New booking'}</h2>
        <p className="m-0 text-sm text-muted">{day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <ErrorNote message={error} />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="field">Time
            <select className="input" value={draft.minutes} onChange={(e) => setDraft({ ...draft, minutes: Number(e.target.value) })}>
              {TIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="field">Length
            <select className="input" value={draft.durationMinutes} onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })}>
              {DURATIONS.map((m) => <option key={m} value={m}>{m >= 120 ? `${m / 60} hours` : m === 90 ? '1½ hours' : '1 hour'}</option>)}
            </select>
          </label>
          <label className="field">Guests<input className="input" type="number" min={1} max={60} required value={draft.partySize}
            onChange={(e) => setDraft({ ...draft, partySize: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} /></label>
        </div>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="eyebrow mb-2">Free tables</legend>
          {tables === null ? <p className="m-0 text-sm text-muted">Checking…</p> : tables.length === 0 ? (
            <p className="m-0 text-sm text-warn">No table is free for this time and party. Try another time.</p>
          ) : (
            <div role="radiogroup" aria-label="Table" className="flex flex-wrap gap-2">
              {tables.map((t) => (
                <button key={t.tableId} type="button" role="radio" aria-checked={draft.tableId === t.tableId} onClick={() => setDraft({ ...draft, tableId: t.tableId })}
                  className={`flex min-h-14 min-w-[84px] cursor-pointer flex-col items-center justify-center rounded-md px-3 ${draft.tableId === t.tableId ? 'border-2 border-[#e8b77d] bg-[#261a12] text-[#e8b77d]' : 'border border-gold-line bg-surface-2 text-cream'}`}>
                  <span className="font-display text-xl font-semibold">{t.label}</span>
                  <span className="text-[11px] text-muted">{t.seats} seats</span>
                </button>
              ))}
            </div>
          )}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">Guest name<input className="input" required maxLength={120} value={draft.guestName} onChange={(e) => setDraft({ ...draft, guestName: e.target.value })} /></label>
          <label className="field">Phone<input className="input" type="tel" maxLength={50} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></label>
        </div>
        <label className="field">Note<input className="input" maxLength={300} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Birthday, high chair, window seat…" /></label>
        <div className="flex justify-end gap-2.5">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-gold" disabled={busy || !chosenFree}>{draft.id ? 'Save booking' : 'Book table'}</button>
        </div>
      </form>
    </div>
  );
}

function SeatDialog({ entry, onDone, onCancel }: { entry: WaitlistEntry; onDone: (orderId: string) => void; onCancel: () => void }) {
  const { calls } = useWorkspace();
  const { data: floor } = usePolling(() => calls.floor(), 15_000, [calls]);
  const [error, setError] = React.useState<string | null>(null);
  const free = (floor ?? []).filter((t) => (t.state === 'free' || t.state === 'reserved') && t.seats + 2 >= entry.partySize);
  const seat = async (tableId: string) => {
    setError(null);
    try {
      onDone((await calls.seatFromWaitlist(entry.id, tableId)).orderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not seat the party.');
    }
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="seat-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="panel flex w-full max-w-md flex-col gap-4 p-6">
        <h2 id="seat-title" className="m-0 font-display text-3xl italic">Seat {entry.guestName}</h2>
        <p className="m-0 text-sm text-muted">{entry.partySize} guests. Choose a free table.</p>
        <ErrorNote message={error} />
        <div className="flex flex-wrap gap-2">
          {floor && free.length === 0 && <p className="m-0 text-sm text-warn">No free table fits {entry.partySize} right now.</p>}
          {free.map((t) => (
            <button key={t.tableId} type="button" onClick={() => void seat(t.tableId)}
              className={`flex min-h-14 min-w-[84px] cursor-pointer flex-col items-center justify-center rounded-md border px-3 text-cream ${t.state === 'reserved' ? 'border-dashed border-[#e8b77d] bg-transparent' : 'border-gold-line bg-surface-2'}`}>
              <span className="font-display text-xl font-semibold">{t.label}</span>
              <span className="text-[11px] text-muted">{t.seats} seats{t.state === 'reserved' ? ' · booked soon' : ''}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Waitlist() {
  const { calls, role, afterSeating } = useWorkspace();
  const now = useNow();
  const { data: entries, error, refresh } = usePolling(() => calls.waitlist(), 15_000, [calls]);
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({ guestName: '', phone: '', partySize: 2, quotedMinutes: 15 });
  const [seating, setSeating] = React.useState<WaitlistEntry | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setActionError(null);
    try {
      await calls.addToWaitlist({ ...form, guestName: form.guestName.trim(), phone: form.phone.trim() || undefined });
      setForm({ guestName: '', phone: '', partySize: 2, quotedMinutes: 15 });
      setAdding(false);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not add the party.');
    }
  };

  return (
    <section aria-labelledby="waitlist-title" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 id="waitlist-title" className="m-0 font-display text-3xl font-medium italic">Waitlist</h2>
        <span className="text-[13px] text-muted">{entries?.length ?? 0} waiting</span>
      </div>
      <ErrorNote message={error ?? actionError} />
      {entries?.map((w) => {
        const waited = minutesSince(w.addedAt, now);
        return (
          <div key={w.id} className="flex flex-col gap-2.5 rounded-md border border-gold-line bg-surface-2 p-3.5">
            <div className="flex justify-between gap-2"><span className="font-semibold">{w.guestName}</span><span className="text-[13px] font-semibold text-[#e8b77d]">{w.partySize} ppl</span></div>
            <div className={`text-xs ${waited > w.quotedMinutes ? 'text-warn' : 'text-muted'}`}>
              Waiting {waited} min · quoted {w.quotedMinutes} min{w.phone && ` · ${w.phone}`}
            </div>
            {can.book(role) && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn min-h-11 px-3 text-[11px]" onClick={() => void calls.waitlistLeft(w.id).then(refresh)}>Left</button>
                <button type="button" className="btn btn-gold min-h-11 px-3 text-[11px]" onClick={() => setSeating(w)}>Seat</button>
              </div>
            )}
          </div>
        );
      })}
      {entries?.length === 0 && <p className="m-0 text-sm text-muted">No one is waiting.</p>}
      {can.book(role) && (adding ? (
        <form onSubmit={add} className="flex flex-col gap-3 rounded-md border border-gold-line bg-surface-2 p-3.5">
          <label className="field">Name<input className="input" required maxLength={120} value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="field">Guests<input className="input" type="number" min={1} max={60} value={form.partySize} onChange={(e) => setForm({ ...form, partySize: Number(e.target.value) || 1 })} /></label>
            <label className="field">Quoted wait (min)<input className="input" type="number" min={0} max={240} value={form.quotedMinutes} onChange={(e) => setForm({ ...form, quotedMinutes: Number(e.target.value) || 0 })} /></label>
          </div>
          <label className="field">Phone<input className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2"><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button><button type="submit" className="btn btn-gold">Add</button></div>
        </form>
      ) : <button type="button" className="btn" onClick={() => setAdding(true)}>Add walk-in</button>)}
      {seating && <SeatDialog entry={seating} onCancel={() => setSeating(null)} onDone={(orderId) => { setSeating(null); afterSeating(orderId); }} />}
    </section>
  );
}

function BookingDetail({ booking, onEdit, onChanged, onClose }: { booking: Reservation; onEdit: () => void; onChanged: () => void; onClose: () => void }) {
  const { calls, go, role, afterSeating } = useWorkspace();
  const [error, setError] = React.useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); onChanged(); } catch (err) { setError(err instanceof Error ? err.message : 'That did not work.'); }
  };
  const upcoming = booking.status === 'booked' && can.book(role);
  return (
    <section aria-labelledby="booking-detail" className="flex flex-col gap-3">
      <button type="button" onClick={onClose} className="w-fit cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold uppercase tracking-[0.12em] text-[#e8b77d]">← Waitlist</button>
      <span className="eyebrow">{STATUS_LABEL[booking.status]} · Table {booking.tableLabel}</span>
      <h2 id="booking-detail" className="m-0 font-display text-[34px] font-medium italic leading-tight">{booking.guestName}</h2>
      <dl className="m-0 flex flex-col text-sm">
        {[['Time', `${clockTime(booking.startsAt)} to ${clockTime(booking.endsAt)}`], ['Guests', String(booking.partySize)], ['Phone', booking.phone || '—'], ['Note', booking.note || '—'], ['Booked by', booking.createdByName ?? '—']].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-gold-hair py-2.5"><dt className="text-muted">{k}</dt><dd className="m-0 text-right">{v}</dd></div>
        ))}
      </dl>
      <ErrorNote message={error} />
      {upcoming && (
        <div className="flex flex-col gap-2.5 pt-2">
          <button type="button" className="btn btn-gold min-h-14" onClick={() => void act(async () => afterSeating((await calls.seatBooking(booking.id)).orderId))}>Seat now</button>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" className="btn px-2" onClick={onEdit}>Change</button>
            <button type="button" className="btn btn-danger px-2" onClick={() => void act(() => calls.closeBooking(booking.id, 'no_show'))}>No-show</button>
            <button type="button" className="btn btn-danger px-2" onClick={() => { if (window.confirm(`Cancel ${booking.guestName}'s booking?`)) void act(() => calls.closeBooking(booking.id, 'cancelled')); }}>Cancel</button>
          </div>
        </div>
      )}
      {booking.status === 'seated' && booking.orderId && (
        <button type="button" className="btn" onClick={() => go({ name: 'order', orderId: booking.orderId! })}>Open their order</button>
      )}
    </section>
  );
}

export function BookingsScreen() {
  const { calls, role } = useWorkspace();
  const now = useNow(30_000);
  const [offset, setOffset] = React.useState(0);
  const day = React.useMemo(() => dayStart(offset), [offset]);
  const from = day.toISOString();
  const to = dayStart(offset + 1).toISOString();
  const { data: bookings, error, refresh } = usePolling(() => calls.reservations(from, to), 20_000, [calls, from]);
  const { data: floor } = usePolling(() => calls.floor(), 60_000, [calls]);
  const [form, setForm] = React.useState<Draft | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);

  const tables = (floor ?? []).map((t) => ({ id: t.tableId, label: t.label, seats: t.seats }));
  const visible = (bookings ?? []).filter((b) => b.status !== 'cancelled');
  const selected = bookings?.find((b) => b.id === selectedId) ?? null;
  const nowOffset = offset === 0 ? minutesFromOpen(day, new Date(now).toISOString()) : null;
  const covers = visible.filter((b) => b.status !== 'no_show').reduce((n, b) => n + b.partySize, 0);

  React.useEffect(() => {
    // Open the timeline near the current time (or 6 pm on other days).
    const target = nowOffset !== null && nowOffset > 0 ? nowOffset - 60 : (18 - OPEN_HOUR) * 60;
    scroller.current?.scrollTo({ left: Math.max(0, (target / SLOT_MINUTES) * SLOT_WIDTH) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, floor === null]);

  const newDraft = (tableId = '', minutes?: number): Draft => {
    const start = minutes ?? Math.max(0, Math.ceil(((nowOffset ?? (19 - OPEN_HOUR) * 60) + 30) / 15) * 15);
    return { minutes: Math.min(start, (CLOSE_HOUR - OPEN_HOUR) * 60 - 60), durationMinutes: 90, partySize: 2, guestName: '', phone: '', note: '', tableId };
  };

  const onRowClick = (event: React.MouseEvent<HTMLDivElement>, tableId: string) => {
    if (!can.book(role) || event.target !== event.currentTarget) return;
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const minutes = Math.floor((x / SLOT_WIDTH) * SLOT_MINUTES / 15) * 15;
    setForm(newDraft(tableId, minutes));
  };

  return (
    <div className="flex min-h-screen min-w-0 flex-1 flex-wrap">
      <main className="flex min-w-0 flex-[999_1_620px] flex-col gap-5 px-6 py-6 sm:px-8">
        <ScreenHeader title={<>Reservations <Motif name="anise" className="h-8 w-8 text-gold-soft opacity-70" /></>}>
          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" className="btn min-h-11 px-3.5" aria-label="Previous day" onClick={() => setOffset(offset - 1)}>‹</button>
            <button type="button" className="btn min-h-11 px-3.5" onClick={() => setOffset(0)} disabled={offset === 0}>Today</button>
            <button type="button" className="btn min-h-11 px-3.5" aria-label="Next day" onClick={() => setOffset(offset + 1)}>›</button>
            {can.book(role) && <button type="button" className="btn btn-gold min-h-11" onClick={() => setForm(newDraft())}>New booking</button>}
          </div>
        </ScreenHeader>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted">
          <span className="font-semibold text-cream">{day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <span><span className="font-semibold text-cream">{visible.length}</span> bookings</span>
          <span><span className="font-semibold text-cream">{covers}</span> covers</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] border-[1.5px] border-[#e8b77d]" />Booked</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] bg-[#8dbf8f]" />Seated</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] bg-[#2a1d14]" />Finished</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] border border-dashed border-[#8a5a4a]" />No-show</span>
        </div>
        <ErrorNote message={error} />
        {floor && tables.length === 0 ? <p className="text-muted">Add tables in Setup first.</p> : (
          <div ref={scroller} className="overflow-x-auto rounded-md border border-gold-line bg-surface">
            <div className="relative" style={{ width: LABEL_WIDTH + SLOTS * SLOT_WIDTH }}>
              <div className="sticky top-0 flex h-9 border-b border-gold-line text-[11px] font-semibold text-muted">
                <span className="sticky left-0 z-10 flex-none bg-surface pl-3.5 leading-9" style={{ width: LABEL_WIDTH }}>Table</span>
                {Array.from({ length: SLOTS }, (_, i) => {
                  const m = i * SLOT_MINUTES;
                  return <span key={i} className="flex-none border-l border-gold-hair pl-1.5 leading-9" style={{ width: SLOT_WIDTH }}>{m % 60 === 0 ? TIME_OPTIONS[m / 15].label.replace(':00', '') : ''}</span>;
                })}
              </div>
              {tables.map((t) => (
                <div key={t.id} className="relative flex h-[54px] border-b border-gold-hair">
                  <span className="sticky left-0 z-10 flex flex-none flex-col justify-center bg-surface pl-3.5" style={{ width: LABEL_WIDTH }}>
                    <span className="font-display text-lg font-semibold leading-none">{t.label}</span>
                    <span className="text-[10px] text-faint">{t.seats} seats</span>
                  </span>
                  <div className={`relative flex-1 ${can.book(role) ? 'cursor-copy' : ''}`} onClick={(e) => onRowClick(e, t.id)}
                    style={{ backgroundImage: `repeating-linear-gradient(90deg, transparent 0 ${SLOT_WIDTH - 1}px, rgb(216 179 124 / 0.06) ${SLOT_WIDTH - 1}px ${SLOT_WIDTH}px)` }}>
                    {visible.filter((b) => b.tableId === t.id).map((b) => {
                      const left = Math.max(0, (minutesFromOpen(day, b.startsAt) / SLOT_MINUTES) * SLOT_WIDTH);
                      const right = Math.min(SLOTS * SLOT_WIDTH, (minutesFromOpen(day, b.endsAt) / SLOT_MINUTES) * SLOT_WIDTH);
                      if (right <= 0 || left >= SLOTS * SLOT_WIDTH) return null;
                      return (
                        <button key={b.id} type="button" onClick={() => setSelectedId(b.id)}
                          aria-label={`${b.guestName}, ${b.partySize} guests, ${clockTime(b.startsAt)}, ${STATUS_LABEL[b.status]}`}
                          className={`absolute top-1.5 flex h-[42px] cursor-pointer flex-col justify-center overflow-hidden whitespace-nowrap rounded px-2.5 text-left ${BLOCK_STYLES[b.status]} ${b.id === selectedId ? 'outline-2 outline-offset-2 outline-cream' : ''}`}
                          style={{ left: left + 2, width: Math.max(28, right - left - 4) }}>
                          <span className="text-[13px] font-semibold leading-tight">{b.guestName}</span>
                          <span className="text-[11px] opacity-85">{b.partySize} ppl · {clockTime(b.startsAt)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {nowOffset !== null && nowOffset > 0 && nowOffset < SLOTS * SLOT_MINUTES && (
                <div aria-hidden="true" className="pointer-events-none absolute bottom-0 top-7 z-20 w-0.5 bg-cream" style={{ left: LABEL_WIDTH + (nowOffset / SLOT_MINUTES) * SLOT_WIDTH }} />
              )}
            </div>
          </div>
        )}
        {can.book(role) && <p className="m-0 text-xs text-faint">Tip: tap an empty spot on a table's row to book that table at that time.</p>}
      </main>

      <aside className="relative isolate flex w-full flex-col gap-4 overflow-hidden border-l border-gold-hair bg-surface px-6 py-7 lg:w-[330px] lg:flex-none">
        <div aria-hidden="true" className="kantha absolute inset-x-0 top-0 -z-10" />
        <Motif name="mint" className="pointer-events-none absolute -bottom-6 -right-10 -z-10 h-44 w-44 text-gold opacity-[0.08]" />
        <div className="pt-3">
          {selected ? (
            <BookingDetail booking={selected} onClose={() => setSelectedId(null)} onChanged={() => void refresh()}
              onEdit={() => setForm({
                id: selected.id, minutes: minutesFromOpen(day, selected.startsAt),
                durationMinutes: Math.round((new Date(selected.endsAt).getTime() - new Date(selected.startsAt).getTime()) / 60_000),
                partySize: selected.partySize, guestName: selected.guestName, phone: selected.phone, note: selected.note, tableId: selected.tableId,
              })} />
          ) : <Waitlist />}
        </div>
      </aside>
      {form && <BookingForm day={day} draft={form} onCancel={() => setForm(null)} onDone={() => { setForm(null); void refresh(); }} />}
    </div>
  );
}
