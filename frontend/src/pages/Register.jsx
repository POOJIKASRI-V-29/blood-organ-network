import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useReference } from '../context/ReferenceContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { directoryApi } from '../services/api.js';
import { useApi } from '../hooks/useApi.js';
import { Card, Field, Select, Spinner } from '../components/ui/index.jsx';
import { ROLES } from '../constants/index.js';

const ROLE_OPTIONS = [
  { value: ROLES.DONOR, label: 'Donor', blurb: 'Give blood and pledge organs. Activated immediately.' },
  { value: ROLES.RECIPIENT, label: 'Patient / Recipient', blurb: 'Raise blood and organ requests. Activated immediately.' },
  { value: ROLES.HOSPITAL, label: 'Hospital', blurb: 'Raise requests for patients. Requires admin approval.' },
  { value: ROLES.BLOOD_BANK, label: 'Blood bank', blurb: 'Record donations and manage stock. Requires admin approval.' },
  { value: ROLES.TRANSPLANT_CENTER, label: 'Transplant centre', blurb: 'List organs and process matches. Requires admin approval.' },
];

const INSTITUTIONS = [ROLES.HOSPITAL, ROLES.BLOOD_BANK, ROLES.TRANSPLANT_CENTER];
const INDIVIDUALS = [ROLES.DONOR, ROLES.RECIPIENT];

export default function Register() {
  const { register, isAuthenticated } = useAuth();
  const { cities, bloodGroups, loading: refLoading } = useReference();
  const toast = useToast();
  const navigate = useNavigate();

  const [role, setRole] = useState(ROLES.DONOR);
  const [form, setForm] = useState({
    fullName: '', email: '', password: '', phone: '',
    dateOfBirth: '', gender: 'MALE', bloodGroupId: '', cityId: '',
    address: '', weightKg: '', medicalNotes: '',
    organisationName: '', registrationNumber: '', licenseNumber: '', hospitalId: '', bedCapacity: '',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Only needed for the transplant-centre branch, which must name its host hospital.
  const { data: hospitalPage } = useApi(
    () => (role === ROLES.TRANSPLANT_CENTER ? directoryApi.hospitals({ limit: 100 }) : Promise.resolve(null)),
    [role],
  );

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const cityOptions = useMemo(
    () => cities.map((c) => ({ value: c.cityId, label: `${c.name}, ${c.state}` })), [cities]);
  const groupOptions = useMemo(
    () => bloodGroups.map((g) => ({ value: g.bloodGroupId, label: g.groupCode })), [bloodGroups]);

  if (isAuthenticated) return <Navigate to="/app" replace />;

  const buildPayload = () => {
    const base = {
      role,
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      password: form.password,
      phone: form.phone.trim() || null,
    };
    if (INDIVIDUALS.includes(role)) {
      Object.assign(base, {
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        bloodGroupId: Number(form.bloodGroupId),
        cityId: Number(form.cityId),
        address: form.address.trim() || null,
      });
      if (role === ROLES.DONOR) base.weightKg = form.weightKg ? Number(form.weightKg) : null;
      if (role === ROLES.RECIPIENT) base.medicalNotes = form.medicalNotes.trim() || null;
    } else {
      Object.assign(base, {
        organisationName: form.organisationName.trim(),
        address: form.address.trim(),
        cityId: Number(form.cityId),
      });
      if (role === ROLES.TRANSPLANT_CENTER) {
        base.licenseNumber = form.licenseNumber.trim();
        base.hospitalId = Number(form.hospitalId);
      } else {
        base.registrationNumber = form.registrationNumber.trim();
      }
      if (role === ROLES.HOSPITAL) base.bedCapacity = form.bedCapacity ? Number(form.bedCapacity) : null;
    }
    return base;
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setErrors({}); setFormError(null);
    try {
      const user = await register(buildPayload());
      toast.success(
        user.status === 'PENDING'
          ? 'Registered. An administrator must approve your organisation before you can act.'
          : `Welcome, ${user.fullName}.`,
      );
      navigate('/app', { replace: true });
    } catch (err) {
      setFormError(err.message);
      if (err.details) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      }
    } finally {
      setBusy(false);
    }
  };

  const selected = ROLE_OPTIONS.find((r) => r.value === role);

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
      <h1 className="text-2xl font-semibold text-slate-900">Create an account</h1>
      <p className="text-sm text-slate-500 mt-1 mb-6">
        Choose the role that matches how you will use the network.
      </p>

      <form onSubmit={submit} className="space-y-5" noValidate>
        {formError && (
          <div role="alert" className="rounded-lg bg-brand-50 border border-brand-200 text-brand-800 text-sm px-3 py-2">
            {formError}
          </div>
        )}

        <Card title="Role">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {ROLE_OPTIONS.map((option) => (
              <label key={option.value}
                     className={`cursor-pointer rounded-lg border p-3 text-sm transition ${
                       role === option.value
                         ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200'
                         : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="radio" name="role" className="sr-only" value={option.value}
                       checked={role === option.value} onChange={() => setRole(option.value)} />
                <span className="font-medium text-slate-900 block">{option.label}</span>
                <span className="text-xs text-slate-500 block mt-0.5 leading-snug">{option.blurb}</span>
              </label>
            ))}
          </div>
          {INSTITUTIONS.includes(role) && (
            <p className="hint mt-3">
              Institutional accounts are created with <strong>PENDING</strong> status and must be
              verified by an administrator before they can record data or raise requests.
            </p>
          )}
        </Card>

        <Card title="Account details">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={INSTITUTIONS.includes(role) ? 'Contact person' : 'Full name'}
                   htmlFor="fullName" required error={errors.fullName}>
              <input id="fullName" className="input" required value={form.fullName} onChange={set('fullName')} />
            </Field>
            <Field label="Email address" htmlFor="email" required error={errors.email}>
              <input id="email" type="email" className="input" required autoComplete="username"
                     value={form.email} onChange={set('email')} />
            </Field>
            <Field label="Password" htmlFor="password" required error={errors.password}
                   hint="At least 8 characters, with a letter, a digit and a symbol.">
              <input id="password" type="password" className="input" required autoComplete="new-password"
                     value={form.password} onChange={set('password')} />
            </Field>
            <Field label="Phone" htmlFor="phone" error={errors.phone}>
              <input id="phone" className="input" value={form.phone} onChange={set('phone')} />
            </Field>
          </div>
        </Card>

        {INDIVIDUALS.includes(role) && (
          <Card title={role === ROLES.DONOR ? 'Donor profile' : 'Patient profile'}>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Date of birth" htmlFor="dob" required error={errors.dateOfBirth}>
                <input id="dob" type="date" className="input" required value={form.dateOfBirth} onChange={set('dateOfBirth')} />
              </Field>
              <Field label="Gender" htmlFor="gender" required>
                <Select id="gender" value={form.gender} onChange={set('gender')} placeholder={null}
                        options={[{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }, { value: 'OTHER', label: 'Other' }]} />
              </Field>
              <Field label="Blood group" htmlFor="bg" required error={errors.bloodGroupId}>
                <Select id="bg" value={form.bloodGroupId} onChange={set('bloodGroupId')}
                        placeholder={refLoading ? 'Loading…' : 'Select…'} options={groupOptions} required />
              </Field>
              <Field label="City" htmlFor="city" required error={errors.cityId}>
                <Select id="city" value={form.cityId} onChange={set('cityId')}
                        placeholder={refLoading ? 'Loading…' : 'Select…'} options={cityOptions} required />
              </Field>
              <Field label="Address" htmlFor="address" className="sm:col-span-2" error={errors.address}>
                <input id="address" className="input" value={form.address} onChange={set('address')} />
              </Field>
              {role === ROLES.DONOR && (
                <Field label="Weight (kg)" htmlFor="weight" error={errors.weightKg}
                       hint="Most blood services require a minimum of 50 kg.">
                  <input id="weight" type="number" min="20" max="300" step="0.1" className="input"
                         value={form.weightKg} onChange={set('weightKg')} />
                </Field>
              )}
              {role === ROLES.RECIPIENT && (
                <Field label="Medical notes" htmlFor="notes" className="sm:col-span-2" error={errors.medicalNotes}>
                  <textarea id="notes" rows={3} className="textarea" value={form.medicalNotes} onChange={set('medicalNotes')} />
                </Field>
              )}
            </div>
          </Card>
        )}

        {INSTITUTIONS.includes(role) && (
          <Card title={`${selected.label} details`}>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Organisation name" htmlFor="org" required error={errors.organisationName}>
                <input id="org" className="input" required value={form.organisationName} onChange={set('organisationName')} />
              </Field>
              {role === ROLES.TRANSPLANT_CENTER ? (
                <>
                  <Field label="Transplant licence number" htmlFor="lic" required error={errors.licenseNumber}>
                    <input id="lic" className="input" required value={form.licenseNumber} onChange={set('licenseNumber')} />
                  </Field>
                  <Field label="Host hospital" htmlFor="hosp" required error={errors.hospitalId}
                         hint="A transplant centre operates inside a registered hospital.">
                    <Select id="hosp" value={form.hospitalId} onChange={set('hospitalId')} required
                            placeholder="Select…"
                            options={(hospitalPage?.rows ?? []).map((h) => ({ value: h.hospitalId, label: h.name }))} />
                  </Field>
                </>
              ) : (
                <Field label="Registration number" htmlFor="reg" required error={errors.registrationNumber}>
                  <input id="reg" className="input" required value={form.registrationNumber} onChange={set('registrationNumber')} />
                </Field>
              )}
              <Field label="City" htmlFor="icity" required error={errors.cityId}>
                <Select id="icity" value={form.cityId} onChange={set('cityId')} required
                        placeholder={refLoading ? 'Loading…' : 'Select…'} options={cityOptions} />
              </Field>
              {role === ROLES.HOSPITAL && (
                <Field label="Bed capacity" htmlFor="beds" error={errors.bedCapacity}>
                  <input id="beds" type="number" min="1" className="input" value={form.bedCapacity} onChange={set('bedCapacity')} />
                </Field>
              )}
              <Field label="Address" htmlFor="iaddr" required className="sm:col-span-2" error={errors.address}>
                <input id="iaddr" className="input" required value={form.address} onChange={set('address')} />
              </Field>
            </div>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4 text-white" />} Create account
          </button>
          <Link to="/login" className="btn-ghost">I already have an account</Link>
        </div>
      </form>
    </div>
  );
}
