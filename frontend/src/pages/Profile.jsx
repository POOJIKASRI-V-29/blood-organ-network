import { useState } from 'react';
import { authApi } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useReference } from '../context/ReferenceContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  Badge, BloodChip, Card, Detail, Field, PageHeader, Select, Spinner, fmt,
} from '../components/ui/index.jsx';
import { ROLES, ROLE_LABELS } from '../constants/index.js';

export default function Profile() {
  const { user, refresh } = useAuth();
  const { cities } = useReference();
  const toast = useToast();
  const profile = user?.profile ?? {};

  const [form, setForm] = useState({
    fullName: user?.fullName ?? '', phone: user?.phone ?? '',
    address: profile.address ?? '', cityId: profile.cityId ?? '',
    weightKg: profile.weightKg ?? '', medicalNotes: profile.medicalNotes ?? '',
  });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [errors, setErrors] = useState({});

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const isIndividual = [ROLES.DONOR, ROLES.RECIPIENT].includes(user?.role);

  const saveProfile = async (event) => {
    event.preventDefault();
    setBusy(true); setErrors({});
    try {
      const payload = { fullName: form.fullName.trim(), phone: form.phone.trim() || null };
      if (isIndividual) {
        payload.address = form.address.trim() || null;
        if (form.cityId) payload.cityId = Number(form.cityId);
        if (user.role === ROLES.DONOR && form.weightKg) payload.weightKg = Number(form.weightKg);
        if (user.role === ROLES.RECIPIENT) payload.medicalNotes = form.medicalNotes.trim() || null;
      }
      await authApi.updateProfile(payload);
      await refresh();
      toast.success('Profile updated.');
    } catch (err) {
      toast.error(err.message);
      if (err.details) setErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
    } finally { setBusy(false); }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    if (passwords.newPassword !== passwords.confirm) {
      toast.error('The new passwords do not match.');
      return;
    }
    setPwBusy(true);
    try {
      await authApi.changePassword({
        currentPassword: passwords.currentPassword, newPassword: passwords.newPassword,
      });
      toast.success('Password changed.');
      setPasswords({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) { toast.error(err.message); }
    finally { setPwBusy(false); }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="My profile" subtitle={`${ROLE_LABELS[user?.role] ?? user?.role} account`} />

      <Card title="Account" className="mb-4">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Detail label="Role">{ROLE_LABELS[user?.role] ?? user?.role}</Detail>
          <Detail label="Status"><Badge value={user?.status} /></Detail>
          <Detail label="Member since">{fmt.date(user?.createdAt)}</Detail>
          <Detail label="Last sign-in">{user?.lastLoginAt ? fmt.dateTime(user.lastLoginAt) : 'This session'}</Detail>
          {profile.bloodGroup && <Detail label="Blood group"><BloodChip group={profile.bloodGroup} /></Detail>}
          {profile.age != null && <Detail label="Age">{profile.age}</Detail>}
          {profile.eligibilityStatus && <Detail label="Eligibility"><Badge value={profile.eligibilityStatus} /></Detail>}
          {profile.totalDonations != null && <Detail label="Donations">{profile.totalDonations}</Detail>}
          {profile.registrationNumber && <Detail label="Registration no.">{profile.registrationNumber}</Detail>}
          {profile.licenseNumber && <Detail label="Licence no.">{profile.licenseNumber}</Detail>}
        </dl>
      </Card>

      <form onSubmit={saveProfile}>
        <Card title="Edit details" className="mb-4"
              actions={<button type="submit" className="btn-primary btn-sm" disabled={busy}>
                {busy && <Spinner className="h-4 w-4 text-white" />} Save
              </button>}>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Full name" htmlFor="fn" error={errors.fullName}>
              <input id="fn" className="input" value={form.fullName} onChange={set('fullName')} />
            </Field>
            <Field label="Phone" htmlFor="ph" error={errors.phone}>
              <input id="ph" className="input" value={form.phone} onChange={set('phone')} />
            </Field>
            <Field label="Email" htmlFor="em" hint="Email addresses cannot be changed here — contact an administrator.">
              <input id="em" className="input" value={user?.email ?? ''} disabled />
            </Field>
            {isIndividual && (
              <>
                <Field label="City" htmlFor="ct" error={errors.cityId}>
                  <Select id="ct" value={form.cityId} onChange={set('cityId')} placeholder="Select…"
                          options={cities.map((c) => ({ value: c.cityId, label: `${c.name}, ${c.state}` }))} />
                </Field>
                <Field label="Address" htmlFor="ad" className="sm:col-span-2" error={errors.address}>
                  <input id="ad" className="input" value={form.address} onChange={set('address')} />
                </Field>
                {user.role === ROLES.DONOR && (
                  <Field label="Weight (kg)" htmlFor="wt" error={errors.weightKg}>
                    <input id="wt" type="number" step="0.1" min="20" max="300" className="input"
                           value={form.weightKg} onChange={set('weightKg')} />
                  </Field>
                )}
                {user.role === ROLES.RECIPIENT && (
                  <Field label="Medical notes" htmlFor="mn" className="sm:col-span-2" error={errors.medicalNotes}>
                    <textarea id="mn" rows={3} className="textarea" value={form.medicalNotes} onChange={set('medicalNotes')} />
                  </Field>
                )}
              </>
            )}
          </div>
        </Card>
      </form>

      <form onSubmit={changePassword}>
        <Card title="Change password"
              actions={<button type="submit" className="btn-primary btn-sm" disabled={pwBusy}>
                {pwBusy && <Spinner className="h-4 w-4 text-white" />} Update password
              </button>}>
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Current password" htmlFor="cp">
              <input id="cp" type="password" className="input" autoComplete="current-password" required
                     value={passwords.currentPassword}
                     onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} />
            </Field>
            <Field label="New password" htmlFor="np" hint="8+ characters with a letter, digit and symbol.">
              <input id="np" type="password" className="input" autoComplete="new-password" required
                     value={passwords.newPassword}
                     onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} />
            </Field>
            <Field label="Confirm new password" htmlFor="cf">
              <input id="cf" type="password" className="input" autoComplete="new-password" required
                     value={passwords.confirm}
                     onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} />
            </Field>
          </div>
        </Card>
      </form>
    </div>
  );
}
