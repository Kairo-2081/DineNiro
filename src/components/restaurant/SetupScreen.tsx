import React from 'react';
import { taka, usePolling } from '../../lib/format';
import { STATIONS, type DiningTable, type MenuCategory, type MenuItem, type Station, type TableShape } from '../../types';
import { ErrorNote } from '../ui';
import { ScreenHeader } from './Rail';
import { useWorkspace } from './workspace';

const STATION_LABELS: Record<Station, string> = { kitchen: 'Kitchen', tandoor: 'Tandoor', bar: 'Bar', dessert: 'Dessert' };

function useAction() {
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

function BillingSettings() {
  const { restaurant, setRestaurant, calls } = useWorkspace();
  const [service, setService] = React.useState(String(restaurant.serviceChargePct));
  const [vat, setVat] = React.useState(String(restaurant.vatPct));
  const [footer, setFooter] = React.useState(restaurant.receiptFooter);
  const [saved, setSaved] = React.useState(false);
  const { error, busy, run } = useAction();

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    void run(async () => {
      setRestaurant(await calls.saveSettings({ serviceChargePct: Number(service), vatPct: Number(vat), receiptFooter: footer.trim() }));
      setSaved(true);
    });
  };

  return (
    <form onSubmit={save} className="panel flex flex-col gap-4 p-6" aria-labelledby="billing-title">
      <h2 id="billing-title" className="m-0 font-display text-3xl italic">Billing</h2>
      <ErrorNote message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">Service charge (%)<input className="input" inputMode="decimal" value={service} onChange={(e) => setService(e.target.value)} /></label>
        <label className="field">VAT (%)<input className="input" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} />
          <span className="text-xs text-faint">Use the rate on your VAT registration. {restaurant.vatBin ? `BIN ${restaurant.vatBin} prints on receipts.` : 'Add your BIN so it prints on receipts.'}</span>
        </label>
      </div>
      <label className="field">Receipt footer<input className="input" maxLength={300} value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Thank you for dining with us" /></label>
      <div className="flex items-center justify-end gap-3">
        {saved && <span role="status" className="text-sm text-ok">Saved</span>}
        <button type="submit" className="btn btn-gold" disabled={busy}>Save billing</button>
      </div>
    </form>
  );
}

function TablesSetup() {
  const { calls } = useWorkspace();
  const { data: tables, refresh } = usePolling(() => calls.tables(), 60_000, [calls]);
  const [draft, setDraft] = React.useState({ label: '', seats: 4, section: 'Main hall', shape: 'square' as TableShape });
  const { error, busy, run } = useAction();

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await calls.saveTable(draft);
      setDraft({ ...draft, label: '' });
      await refresh();
    });
  };
  const update = (table: DiningTable, change: Partial<DiningTable>) => void run(async () => { await calls.saveTable({ ...table, ...change }); await refresh(); });

  return (
    <section className="panel flex flex-col gap-4 p-6" aria-labelledby="tables-title">
      <h2 id="tables-title" className="m-0 font-display text-3xl italic">Tables</h2>
      <ErrorNote message={error} />
      <form onSubmit={add} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_90px_1.4fr_1fr_auto]">
        <label className="field">Name<input className="input" required maxLength={20} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="T1" /></label>
        <label className="field">Seats<input className="input" type="number" min={1} max={40} required value={draft.seats} onChange={(e) => setDraft({ ...draft, seats: Number(e.target.value) })} /></label>
        <label className="field">Section<input className="input" maxLength={60} value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value })} /></label>
        <label className="field">Shape
          <select className="input" value={draft.shape} onChange={(e) => setDraft({ ...draft, shape: e.target.value as TableShape })}>
            <option value="square">Square</option><option value="round">Round</option><option value="long">Long</option>
          </select>
        </label>
        <button type="submit" className="btn btn-gold min-h-[46px]" disabled={busy}>Add table</button>
      </form>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5 p-0">
        {tables?.map((t) => (
          <li key={t.id} className={`flex items-center gap-3 rounded-md border border-gold-line bg-surface-2 px-3.5 py-2.5 ${t.active ? '' : 'opacity-55'}`}>
            <span className="font-display text-2xl font-semibold">{t.label}</span>
            <span className="flex-1 text-xs text-muted">{t.seats} seats · {t.section}{t.active ? '' : ' · hidden'}</span>
            <button type="button" className="min-h-11 cursor-pointer border-0 bg-transparent text-xs font-semibold text-[#e8b77d]" onClick={() => update(t, { active: !t.active })}>
              {t.active ? 'Hide' : 'Show'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function parseOptions(text: string) {
  return text.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = part.match(/^(.*?)\s*\+\s*(\d+(?:\.\d{1,2})?)$/);
    return match ? { name: match[1].trim(), priceDelta: Number(match[2]) } : { name: part, priceDelta: 0 };
  });
}

function formatOptions(item?: MenuItem) {
  return (item?.options ?? []).map((o) => (o.priceDelta ? `${o.name} +${o.priceDelta}` : o.name)).join(', ');
}

function DishForm({ categories, item, categoryId, onDone }: { categories: MenuCategory[]; item?: MenuItem; categoryId: string; onDone: () => void }) {
  const { calls } = useWorkspace();
  const [form, setForm] = React.useState({
    categoryId: item?.categoryId ?? categoryId, name: item?.name ?? '', description: item?.description ?? '',
    price: item ? String(item.price) : '', station: item?.station ?? 'kitchen' as Station, options: formatOptions(item),
  });
  const { error, busy, run } = useAction();
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await calls.saveMenuItem({
        id: item?.id, categoryId: form.categoryId, name: form.name.trim(), description: form.description.trim(),
        price: Number(form.price), station: form.station, available: item?.available ?? true, options: parseOptions(form.options),
      });
      onDone();
    });
  };
  return (
    <form onSubmit={save} className="grid gap-3 rounded-md border border-gold-line bg-surface-2 p-4 sm:grid-cols-2">
      <ErrorNote message={error} />
      <label className="field">Dish<input className="input" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label className="field">Price (৳)<input className="input" inputMode="decimal" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
      <label className="field">Category
        <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="field">Prepared at
        <select className="input" value={form.station} onChange={(e) => setForm({ ...form, station: e.target.value as Station })}>
          {STATIONS.map((s) => <option key={s} value={s}>{STATION_LABELS[s]}</option>)}
        </select>
      </label>
      <label className="field sm:col-span-2">Short description<input className="input" maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      <label className="field sm:col-span-2">Options
        <input className="input" value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} placeholder="Extra aloo +30, Less oil, No chilli" />
        <span className="text-xs text-faint">Separate with commas. Add “+30” for an option that costs extra.</span>
      </label>
      <div className="flex justify-end gap-2.5 sm:col-span-2">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn btn-gold" disabled={busy}>{item ? 'Save dish' : 'Add dish'}</button>
      </div>
    </form>
  );
}

function MenuSetup() {
  const { calls } = useWorkspace();
  const { data: menu, refresh } = usePolling(() => calls.menu(), 60_000, [calls]);
  const [newCategory, setNewCategory] = React.useState('');
  const [editing, setEditing] = React.useState<{ categoryId: string; item?: MenuItem } | null>(null);
  const { error, busy, run } = useAction();

  return (
    <section className="panel flex flex-col gap-5 p-6" aria-labelledby="menu-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="menu-title" className="m-0 font-display text-3xl italic">Menu</h2>
        <form className="flex items-end gap-2.5" onSubmit={(e) => { e.preventDefault(); void run(async () => { await calls.saveCategory({ name: newCategory.trim(), sortOrder: menu?.length ?? 0 }); setNewCategory(''); await refresh(); }); }}>
          <label className="field">New category<input className="input" required maxLength={80} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Rice & Biryani" /></label>
          <button type="submit" className="btn min-h-[46px]" disabled={busy}>Add</button>
        </form>
      </div>
      <ErrorNote message={error} />
      {menu?.length === 0 && <p className="m-0 text-muted">Start with a category, such as Rice &amp; Biryani or Drinks.</p>}
      {menu?.map((category) => (
        <div key={category.id} className="flex flex-col gap-2">
          <div className="flex items-center justify-between border-b border-[rgb(216_179_124/0.22)] pb-2">
            <h3 className="eyebrow m-0 text-xs">{category.name}</h3>
            <span className="flex gap-3">
              {category.items.length === 0 && (
                <button type="button" className="min-h-11 cursor-pointer border-0 bg-transparent text-xs font-semibold text-danger"
                  onClick={() => void run(async () => { await calls.deleteCategory(category.id); await refresh(); })}>Remove category</button>
              )}
              <button type="button" className="min-h-11 cursor-pointer border-0 bg-transparent text-xs font-semibold text-[#e8b77d]" onClick={() => setEditing({ categoryId: category.id })}>+ Add dish</button>
            </span>
          </div>
          {editing?.categoryId === category.id && !editing.item && <DishForm categories={menu} categoryId={category.id} onDone={() => { setEditing(null); void refresh(); }} />}
          <ul className="m-0 list-none p-0">
            {category.items.map((item) => editing?.item?.id === item.id ? (
              <li key={item.id}><DishForm categories={menu} item={item} categoryId={category.id} onDone={() => { setEditing(null); void refresh(); }} /></li>
            ) : (
              <li key={item.id} className={`flex flex-wrap items-center gap-3 border-b border-gold-hair py-2.5 ${item.available ? '' : 'opacity-60'}`}>
                <span className="flex min-w-[200px] flex-1 flex-col gap-0.5">
                  <span className="font-medium">{item.name} <span className="text-xs text-faint">· {STATION_LABELS[item.station]}</span></span>
                  {item.options.length > 0 && <span className="text-xs italic text-[#e8b77d]">{formatOptions(item)}</span>}
                </span>
                <span className="w-24 text-right font-semibold">{taka(item.price)}</span>
                <button type="button" className={`btn min-h-10 px-3 text-[11px] ${item.available ? '' : 'btn-gold'}`}
                  onClick={() => void run(async () => {
                    await calls.saveMenuItem({ ...item, options: item.options.map((o) => ({ name: o.name, priceDelta: o.priceDelta })), available: !item.available });
                    await refresh();
                  })}>
                  {item.available ? 'Mark sold out' : 'Back on menu'}
                </button>
                <button type="button" className="min-h-11 cursor-pointer border-0 bg-transparent text-xs font-semibold text-[#e8b77d]" onClick={() => setEditing({ categoryId: category.id, item })}>Edit</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function SetupScreen() {
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-6 px-6 py-6 sm:px-8">
      <ScreenHeader title="Setup" />
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-6">
          <TablesSetup />
          <MenuSetup />
        </div>
        <div className="flex-[1_1_320px]"><BillingSettings /></div>
      </div>
    </main>
  );
}
