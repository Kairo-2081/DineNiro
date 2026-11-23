import React from 'react';
import { api } from '../../lib/api';
import { MANAGER_ASSIGNABLE_ROLES, STAFF_ROLES, type StaffMember, type StaffRole } from '../../types';
import { ErrorNote, Initials, ROLE_LABELS } from '../ui';

interface Props {
  restaurantId: string;
  myRole: StaffRole;
  myUserId: string;
}

const EMPTY_FORM = { name: '', email: '', phone: '', password: '', role: 'waiter' as StaffRole };

export function StaffManager({ restaurantId, myRole, myUserId }: Props) {
  const [staff, setStaff] = React.useState<StaffMember[] | null>(null);
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [adding, setAdding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const assignable = myRole === 'owner' ? STAFF_ROLES : MANAGER_ASSIGNABLE_ROLES;
  const canEdit = (member: StaffMember) => myRole === 'owner' || MANAGER_ASSIGNABLE_ROLES.includes(member.role);

  const load = React.useCallback(async () => {
    try {
      setStaff(await api.staff(restaurantId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the team.');
    }
  }, [restaurantId]);

  React.useEffect(() => { void load(); }, [load]);

  const run = async (userId: string | null, action: () => Promise<unknown>, success?: string) => {
    setBusyId(userId);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusyId(null);
    }
  };

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    void run('new', async () => {
      const result = await api.addStaff(restaurantId, { ...form, phone: form.phone || undefined, password: form.password || undefined });
      setForm(EMPTY_FORM);
      setAdding(false);
      setNotice(result.createdAccount
        ? `${result.member.name} can now sign in as ${result.member.username}.`
        : `${result.member.name} already had a DineNiro account and has been added with their existing password.`);
    });
  };

  const active = staff?.filter((m) => m.active) ?? [];
  const inactive = staff?.filter((m) => !m.active) ?? [];

  const row = (member: StaffMember) => {
    const editable = canEdit(member) && member.userId !== myUserId;
    return (
      <li key={member.userId} className={`flex flex-wrap items-center gap-4 border-b border-gold-hair py-3.5 ${member.active ? '' : 'opacity-60'}`}>
        <Initials name={member.name} />
        <div className="flex min-w-[180px] flex-1 flex-col gap-1">
          <span className="font-semibold">{member.name}{member.userId === myUserId && <span className="font-normal text-faint"> (you)</span>}</span>
          <span className="text-xs text-faint">{member.username} · {member.email}{member.phone && ` · ${member.phone}`}</span>
        </div>
        {editable ? (
          <label className="flex items-center gap-2 text-xs text-muted">
            <span className="sr-only">Role for {member.name}</span>
            <select className="input h-11 w-[140px] py-0" value={member.role} disabled={busyId === member.userId}
              onChange={(e) => void run(member.userId, () => api.updateStaff(restaurantId, member.userId, { role: e.target.value as StaffRole }))}>
              {assignable.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
            </select>
          </label>
        ) : (
          <span className="w-[140px] text-sm text-gold-soft">{ROLE_LABELS[member.role]}</span>
        )}
        <div className="flex gap-2">
          {editable && (
            <button type="button" className="btn min-h-11 px-3.5 text-[11px]" disabled={busyId === member.userId}
              onClick={() => void run(member.userId, () => api.updateStaff(restaurantId, member.userId, { active: !member.active }))}>
              {member.active ? 'Pause access' : 'Restore access'}
            </button>
          )}
          {editable && !member.active && (
            <button type="button" className="btn btn-danger min-h-11 px-3.5 text-[11px]" disabled={busyId === member.userId}
              onClick={() => {
                if (window.confirm(`Remove ${member.name} from this restaurant? Their account stays, but they lose access here.`)) {
                  void run(member.userId, () => api.removeStaff(restaurantId, member.userId), `${member.name} was removed.`);
                }
              }}>
              Remove
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <section className="panel flex flex-col gap-5 p-7" aria-labelledby="team-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <span className="eyebrow">{active.length} active</span>
          <h2 id="team-title" className="m-0 font-display text-4xl font-medium italic">Team</h2>
        </div>
        {!adding && <button type="button" className="btn btn-gold" onClick={() => setAdding(true)}>Add staff member</button>}
      </div>
      <ErrorNote message={error} />
      {notice && <p role="status" className="m-0 rounded-[3px] bg-ok-bg px-3.5 py-2.5 text-sm text-ok">{notice}</p>}

      {adding && (
        <form onSubmit={add} className="grid gap-4 rounded-md border border-gold-line bg-surface-2 p-5 sm:grid-cols-2">
          <label className="field">Name<input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field">Email<input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="field">Phone <span className="text-faint">(optional)</span><input className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label className="field">Role
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
              {assignable.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
            </select>
          </label>
          <label className="field sm:col-span-2">Starting password
            <input className="input" type="text" minLength={8} autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <span className="text-xs text-faint">At least 8 characters. Hand it over in person. Leave blank if they already have a DineNiro account.</span>
          </label>
          <div className="flex justify-end gap-2.5 sm:col-span-2">
            <button type="button" className="btn" onClick={() => { setAdding(false); setForm(EMPTY_FORM); }}>Cancel</button>
            <button type="submit" className="btn btn-gold" disabled={busyId === 'new'}>Add to team</button>
          </div>
        </form>
      )}

      {staff === null ? <p className="m-0 text-muted">Loading…</p> : (
        <>
          <ul className="m-0 list-none p-0">{active.map(row)}</ul>
          {inactive.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="eyebrow pt-2">Paused</span>
              <ul className="m-0 list-none p-0">{inactive.map(row)}</ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
