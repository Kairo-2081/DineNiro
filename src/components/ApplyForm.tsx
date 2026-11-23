import React from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { RestaurantApplication } from '../types';
import { ErrorNote } from './ui';

const EMPTY: RestaurantApplication = {
  ownerName: '', ownerEmail: '', ownerPhone: '', username: '', password: '',
  restaurantName: '', restaurantPhone: '', address: '', area: '', city: 'Dhaka',
  cuisine: '', tradeLicenceNo: '', vatBin: '',
};

type Key = keyof RestaurantApplication;

export function ApplyForm({ onCancel }: { onCancel: () => void }) {
  const { setSession } = useAuth();
  const [form, setForm] = React.useState(EMPTY);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const field = (key: Key, label: string, options: { type?: string; required?: boolean; autoComplete?: string; hint?: string } = {}) => (
    <label className="field">
      <span>{label}{options.required === false && <span className="text-faint"> (optional)</span>}</span>
      <input
        className="input" type={options.type ?? 'text'} required={options.required !== false} autoComplete={options.autoComplete}
        value={form[key] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        minLength={key === 'password' ? 8 : undefined}
      />
      {options.hint && <span className="text-xs text-faint">{options.hint}</span>}
    </label>
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSession(await api.apply({ ...form, username: form.username?.trim() || undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the application.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-4xl flex-col gap-8" aria-labelledby="apply-title">
      <div className="flex flex-col gap-3">
        <span className="eyebrow">Join DineNiro</span>
        <h1 id="apply-title" className="m-0 font-display text-5xl font-medium italic">Apply for your restaurant</h1>
        <p className="m-0 max-w-[60ch] text-muted">
          A platform admin checks every application before the restaurant goes live. You can sign in straight away and
          see where your application stands.
        </p>
      </div>
      <ErrorNote message={error} />

      <fieldset className="panel m-0 grid gap-5 p-7 sm:grid-cols-2">
        <legend className="eyebrow px-2">The restaurant</legend>
        {field('restaurantName', 'Restaurant name')}
        {field('restaurantPhone', 'Restaurant phone', { type: 'tel' })}
        <div className="sm:col-span-2">{field('address', 'Street address', { autoComplete: 'street-address' })}</div>
        {field('area', 'Area', { hint: 'e.g. Gulshan 2, Dhanmondi' })}
        {field('city', 'City', { autoComplete: 'address-level2' })}
        {field('cuisine', 'Cuisine', { required: false })}
        <div />
        {field('tradeLicenceNo', 'Trade licence number', { required: false })}
        {field('vatBin', 'VAT registration (BIN)', { required: false, hint: 'Printed on every receipt once set' })}
      </fieldset>

      <fieldset className="panel m-0 grid gap-5 p-7 sm:grid-cols-2">
        <legend className="eyebrow px-2">You, the owner</legend>
        {field('ownerName', 'Your name', { autoComplete: 'name' })}
        {field('ownerPhone', 'Your phone', { type: 'tel', autoComplete: 'tel' })}
        {field('ownerEmail', 'Email', { type: 'email', autoComplete: 'email' })}
        {field('username', 'Username', { required: false, autoComplete: 'username', hint: 'Leave blank to use your email name' })}
        {field('password', 'Password', { type: 'password', autoComplete: 'new-password', hint: 'At least 8 characters' })}
      </fieldset>

      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className="btn" onClick={onCancel}>Back</button>
        <button type="submit" className="btn btn-gold min-h-[52px]" disabled={busy}>{busy ? 'Sending…' : 'Send application'}</button>
      </div>
    </form>
  );
}
