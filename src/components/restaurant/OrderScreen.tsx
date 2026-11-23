import React from 'react';
import { taka, usePolling } from '../../lib/format';
import type { MenuItem, Order, OrderLine, Station } from '../../types';
import { ErrorNote, Motif } from '../ui';
import { ScreenHeader } from './Rail';
import { can, useWorkspace } from './workspace';

const STATION_MOTIF: Record<Station, 'chili' | 'steam' | 'mint' | 'cardamom'> = { kitchen: 'chili', tandoor: 'steam', bar: 'mint', dessert: 'cardamom' };
const TICKET_LABEL = { new: 'In queue', cooking: 'Cooking', ready: 'Ready', served: 'Served' } as const;

/** Choosing options and a note for one dish before it goes on the ticket. */
function DishSheet({ item, onAdd, onClose }: { item: MenuItem; onAdd: (optionIds: string[], quantity: number, note: string) => void; onClose: () => void }) {
  const [chosen, setChosen] = React.useState<string[]>([]);
  const [quantity, setQuantity] = React.useState(1);
  const [note, setNote] = React.useState('');
  const unit = item.price + item.options.filter((o) => chosen.includes(o.id)).reduce((n, o) => n + o.priceDelta, 0);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="dish-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="panel flex w-full max-w-md flex-col gap-4 p-6" onSubmit={(e) => { e.preventDefault(); onAdd(chosen, quantity, note.trim()); }}>
        <h2 id="dish-title" className="m-0 font-display text-3xl italic">{item.name}</h2>
        {item.options.length > 0 && (
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="eyebrow mb-2">Options</legend>
            {item.options.map((o) => (
              <label key={o.id} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
                <input type="checkbox" className="h-5 w-5 accent-[#e8b77d]" checked={chosen.includes(o.id)}
                  onChange={() => setChosen(chosen.includes(o.id) ? chosen.filter((id) => id !== o.id) : [...chosen, o.id])} />
                <span className="flex-1">{o.name}</span>
                {o.priceDelta > 0 && <span className="text-muted">+{taka(o.priceDelta)}</span>}
              </label>
            ))}
          </fieldset>
        )}
        <label className="field">Note for the kitchen<input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. no green chilli" /></label>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-4">
            <button type="button" className="h-11 w-11 cursor-pointer rounded-full border border-[#5a4430] bg-surface text-xl text-cream" aria-label="One fewer" onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</button>
            <span className="min-w-6 text-center text-xl font-semibold">{quantity}</span>
            <button type="button" className="h-11 w-11 cursor-pointer rounded-full border border-[#5a4430] bg-surface text-xl text-cream" aria-label="One more" onClick={() => setQuantity(Math.min(99, quantity + 1))}>+</button>
          </span>
          <span className="text-lg font-semibold text-[#e8b77d]">{taka(unit * quantity)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-gold">Add</button>
        </div>
      </form>
    </div>
  );
}

function LineRow({ line, order, onChange }: { line: OrderLine; order: Order; onChange: (o: Order) => void }) {
  const { calls, role } = useWorkspace();
  const [error, setError] = React.useState<string | null>(null);
  const act = async (fn: () => Promise<Order>) => {
    setError(null);
    try { onChange(await fn()); } catch (err) { setError(err instanceof Error ? err.message : 'That did not work.'); }
  };
  const isDraft = line.status === 'draft';
  return (
    <li className={`flex flex-col gap-2 border-b border-gold-hair py-3.5 ${line.status === 'void' ? 'opacity-50' : ''}`}>
      <div className="flex justify-between gap-3 text-[15px] font-medium">
        <span className={line.status === 'void' ? 'line-through' : ''}><span className="text-[#e8b77d]">{line.quantity}×</span> {line.name}</span>
        <span>{taka(line.unitPrice * line.quantity)}</span>
      </div>
      {(line.options.length > 0 || line.note) && (
        <span className="text-[13px] italic text-[#e8b77d]">{[...line.options, line.note].filter(Boolean).join(' · ')}</span>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted">
          {line.status === 'void' ? `Void: ${line.voidReason}` : isDraft ? 'Not sent yet' : TICKET_LABEL[line.ticketStatus ?? 'new']}
        </span>
        {isDraft && can.order(role) && (
          <span className="flex items-center gap-3">
            <button type="button" aria-label={`Remove one ${line.name}`} className="h-11 w-11 cursor-pointer rounded-full border border-[#5a4430] bg-surface-2 text-xl text-cream"
              onClick={() => void act(() => calls.setQuantity(order.id, line.id, line.quantity - 1))}>−</button>
            <span className="min-w-5 text-center font-semibold">{line.quantity}</span>
            <button type="button" aria-label={`Add one ${line.name}`} className="h-11 w-11 cursor-pointer rounded-full border border-[#5a4430] bg-surface-2 text-xl text-cream"
              onClick={() => void act(() => calls.setQuantity(order.id, line.id, Math.min(99, line.quantity + 1)))}>+</button>
          </span>
        )}
        {line.status === 'sent' && can.supervise(role) && order.status !== 'paid' && (
          <button type="button" className="btn btn-danger min-h-10 px-3 text-[11px]" onClick={() => {
            const reason = window.prompt(`Why is ${line.name} being voided? Owners see this reason in the order.`);
            if (reason?.trim()) void act(() => calls.voidLine(order.id, line.id, reason.trim()));
          }}>Void</button>
        )}
      </div>
      <ErrorNote message={error} />
    </li>
  );
}

export function OrderScreen({ orderId }: { orderId: string }) {
  const { calls, go, role } = useWorkspace();
  const { data: menu, error: menuError } = usePolling(() => calls.menu(), 60_000, [calls]);
  const { data: order, error: orderError, setData: setOrder } = usePolling(() => calls.order(orderId), 15_000, [calls, orderId]);
  const [category, setCategory] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [picking, setPicking] = React.useState<MenuItem | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const editable = order && order.status !== 'paid' && order.status !== 'void' && can.order(role);
  const items = (menu ?? []).flatMap((c) => c.items.map((i) => ({ ...i, categoryName: c.name })))
    .filter((i) => (category === 'all' || i.categoryId === category) && i.name.toLowerCase().includes(search.trim().toLowerCase()));
  const drafts = order?.lines.filter((l) => l.status === 'draft') ?? [];
  const sent = order?.lines.filter((l) => l.status !== 'draft') ?? [];
  const draftTotal = drafts.reduce((n, l) => n + l.unitPrice * l.quantity, 0);

  const run = async (fn: () => Promise<Order | unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (result && typeof result === 'object' && 'lines' in result) setOrder(result as Order);
      after?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const add = (item: MenuItem, optionIds: string[] = [], quantity = 1, note = '') =>
    run(() => calls.addItem(orderId, { menuItemId: item.id, quantity, optionIds, note }), () => setPicking(null));

  return (
    <div className="flex min-h-screen min-w-0 flex-1 flex-wrap">
      <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-4 px-6 py-6 sm:px-8">
        <ScreenHeader
          back={<button type="button" onClick={() => go({ name: 'floor' })} className="w-fit cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold uppercase tracking-[0.12em] text-[#e8b77d]">← Floor</button>}
          title={<>Table {order?.tableLabel ?? '…'} <span className="font-sans text-base font-normal not-italic text-muted">· {order?.guests ?? '–'} guests{order?.serverName ? ` · ${order.serverName}` : ''}</span></>}>
          {editable && (
            <label className="flex h-12 w-60 items-center gap-2.5 rounded border border-gold-line bg-surface-2 px-3.5 text-muted">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              <span className="sr-only">Search menu</span>
              <input type="search" placeholder="Search menu" value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-0 flex-1 border-0 bg-transparent text-sm text-cream outline-none" />
            </label>
          )}
        </ScreenHeader>
        <ErrorNote message={error ?? orderError ?? menuError} />

        {editable ? (
          <>
            <div role="tablist" aria-label="Menu category" className="flex gap-2 overflow-x-auto pb-0.5">
              {[{ id: 'all', name: 'All' }, ...(menu ?? [])].map((c) => (
                <button key={c.id} type="button" role="tab" aria-selected={category === c.id} onClick={() => setCategory(c.id)}
                  className={`min-h-11 flex-none cursor-pointer whitespace-nowrap rounded-full border px-5 text-[13px] font-medium ${category === c.id ? 'border-[#efe4d2] bg-[#efe4d2] text-[#1a0f08]' : 'border-gold-line bg-surface-2 text-muted'}`}>{c.name}</button>
              ))}
            </div>
            {menu && items.length === 0 && <p className="text-muted">{menu.length ? 'No dishes match.' : 'The menu is empty. Owners and managers add dishes in Setup.'}</p>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3 pb-6">
              {items.map((item) => (
                <button key={item.id} type="button" disabled={!item.available || busy}
                  onClick={() => (item.options.length ? setPicking(item) : void add(item))}
                  aria-label={item.available ? `Add ${item.name}, ${taka(item.price)}` : `${item.name}, sold out`}
                  className="panel relative isolate flex min-h-[118px] cursor-pointer flex-col justify-between gap-2.5 overflow-hidden p-4 text-left text-cream hover:border-[rgb(216_179_124/0.6)] disabled:cursor-not-allowed disabled:bg-[#150e09] disabled:text-[#8c7a68]">
                  <Motif name={STATION_MOTIF[item.station]} className="pointer-events-none absolute -bottom-4 -right-4 -z-10 h-24 w-24 text-gold opacity-[0.17]" />
                  <span className="flex flex-col gap-1.5">
                    <span className="font-display text-[23px] font-medium leading-tight">{item.name}</span>
                    {item.description && <span className="text-xs leading-snug text-muted">{item.description}</span>}
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className={`text-[15px] font-semibold ${item.available ? 'text-[#e8b77d]' : ''}`}>{taka(item.price)}</span>
                    {!item.available && <span className="rounded-full border border-[#5a4430] px-2 py-1 text-[11px] font-semibold text-muted">Sold out</span>}
                    {item.available && item.options.length > 0 && <span className="rounded-full border border-gold-soft px-2 py-1 text-[11px] font-semibold text-[#e8b77d]">Options</span>}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : order && (
          <section className="panel p-7">
            <p className="m-0 text-muted">{order.status === 'paid' ? 'This visit is paid and closed.' : order.status === 'void' ? 'This visit was cancelled.' : 'You can view this order but not change it.'}</p>
          </section>
        )}
      </main>

      <aside aria-label="Order ticket" className="relative isolate flex w-full flex-col border-l border-gold-hair bg-surface lg:h-screen lg:w-[380px] lg:flex-none lg:sticky lg:top-0">
        <div aria-hidden="true" className="kantha" />
        <div className="flex items-baseline justify-between border-b border-gold-hair px-6 pb-3.5 pt-5">
          <h2 className="m-0 font-display text-3xl font-medium italic">Ticket</h2>
          <span className="eyebrow">{order?.status === 'billed' ? 'Bill printed' : order?.status ?? ''}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-2">
          {drafts.length === 0 && sent.length === 0 && <p className="my-6 text-sm text-muted">Tap a dish to add it. New dishes go to the kitchen when you press Send.</p>}
          {order && drafts.length > 0 && <ul className="m-0 list-none p-0">{drafts.map((l) => <LineRow key={l.id} line={l} order={order} onChange={setOrder} />)}</ul>}
          {order && sent.length > 0 && (
            <div className="mt-4 flex flex-col">
              <span className="eyebrow">Sent to the kitchen</span>
              <ul className="m-0 list-none p-0">{sent.map((l) => <LineRow key={l.id} line={l} order={order} onChange={setOrder} />)}</ul>
            </div>
          )}
        </div>
        {order && (
          <div className="flex flex-col gap-3 border-t border-gold-line px-6 pb-6 pt-4">
            {drafts.length > 0 && <div className="flex justify-between text-sm text-muted"><span>Not sent ({drafts.reduce((n, l) => n + l.quantity, 0)})</span><span className="text-xl font-semibold text-cream">{taka(draftTotal)}</span></div>}
            {editable && (
              <button type="button" className="btn btn-gold min-h-[60px] text-sm" disabled={busy || drafts.length === 0} onClick={() => void run(() => calls.send(orderId))}>
                Send to kitchen
              </button>
            )}
            <div className="grid grid-cols-2 gap-2.5">
              {can.bill(role) && order.status !== 'paid' && order.status !== 'void' && (
                <button type="button" className="btn" disabled={busy || sent.length === 0 || drafts.length > 0}
                  onClick={() => order.status === 'billed' && order.billId
                    ? go({ name: 'bills', billId: order.billId })
                    : void run(async () => go({ name: 'bills', billId: (await calls.prepareBill(orderId)).id }))}>
                  {order.status === 'billed' ? 'Open bill' : 'Print bill'}
                </button>
              )}
              {editable && sent.length === 0 && (
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => {
                  if (window.confirm('Cancel this visit? Use this when guests leave before ordering.')) void run(() => calls.cancelOrder(orderId), () => go({ name: 'floor' }));
                }}>Guests left</button>
              )}
            </div>
          </div>
        )}
      </aside>
      {picking && <DishSheet item={picking} onClose={() => setPicking(null)} onAdd={(ids, q, note) => void add(picking, ids, q, note)} />}
    </div>
  );
}
