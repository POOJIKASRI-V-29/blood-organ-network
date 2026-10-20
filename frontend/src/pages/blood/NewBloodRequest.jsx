import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { bloodApi, directoryApi } from '../../services/api.js';
import { useReference } from '../../context/ReferenceContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useApi } from '../../hooks/useApi.js';
import { Card, Disclaimer, Field, PageHeader, Select, Spinner } from '../../components/ui/index.jsx';
import { ROLES, URGENCIES } from '../../constants/index.js';

function inDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function NewBloodRequest() {
  const { user, hasRole } = useAuth();
  const { bloodGroups, bloodComponents } = useReference();
  const toast = useToast();
  const navigate = useNavigate();

  const isHospital = hasRole(ROLES.HOSPITAL);
  const isRecipient = hasRole(ROLES.RECIPIENT);

  const [form, setForm] = useState({
    hospitalId: '', recipientId: '',
    bloodGroupId: isRecipient ? String(user?.profile?.bloodGroupId ?? '') : '',
    componentId: '2', unitsRequired: '1', urgency: 'ROUTINE',
    patientName: isRecipient ? (user?.fullName ?? '') : '',
    requiredBy: inDays(7), notes: '',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Hospitals and recipients are only selectable by roles allowed to act for others.
  const { data: hospitals } = useApi(
    () => (isHospital ? Promise.resolve(null) : directoryApi.hospitals({ limit: 100, status: 'ACTIVE' })), []);
  const { data: recipients } = useApi(
    () => (hasRole(ROLES.ADMIN, ROLES.HOSPITAL) ? directoryApi.recipients({ limit: 100 }) : Promise.resolve(null)), []);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setErrors({}); setFormError(null);
    try {
      const payload = {
        bloodGroupId: Number(form.bloodGroupId),
        componentId: Number(form.componentId),
        unitsRequired: Number(form.unitsRequired),
        urgency: form.urgency,
        requiredBy: form.requiredBy,
        patientName: form.patientName.trim() || null,
        notes: form.notes.trim() || null,
      };
      // A hospital account is bound to its own hospital by the API; others must choose.
      if (!isHospital && form.hospitalId) payload.hospitalId = Number(form.hospitalId);
      if (!isRecipient && form.recipientId) payload.recipientId = Number(form.recipientId);

      const created = await bloodApi.createRequest(payload);
      toast.success(`Request ${created.requestCode} created.`);
      navigate(`/app/blood/requests/${created.bloodRequestId}`);
    } catch (err) {
      setFormError(err.message);
      if (err.details) setErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="New blood request"
                  subtitle="The request is matched against live inventory using the stored compatibility matrix." />

      <form onSubmit={submit} className="space-y-4" noValidate>
        {formError && (
          <div role="alert" className="rounded-lg bg-brand-50 border border-brand-200 text-brand-800 text-sm px-3 py-2">
            {formError}
          </div>
        )}

        <Card title="Patient and hospital">
          <div className="grid sm:grid-cols-2 gap-4">
            {isHospital ? (
              <Field label="Hospital">
                <input className="input" value={user?.profile?.name ?? ''} disabled />
                <p className="hint">Requests are raised for your own hospital.</p>
              </Field>
            ) : (
              <Field label="Hospital" htmlFor="hosp" required error={errors.hospitalId}>
                <Select id="hosp" value={form.hospitalId} onChange={set('hospitalId')} required placeholder="Select a hospital…"
                        options={(hospitals?.rows ?? []).map((h) => ({ value: h.hospitalId, label: `${h.name} — ${h.city}` }))} />
              </Field>
            )}

            {isRecipient ? (
              <Field label="Patient">
                <input className="input" value={user?.fullName ?? ''} disabled />
                <p className="hint">Requests are raised in your own name.</p>
              </Field>
            ) : (
              <Field label="Registered patient" htmlFor="rec" error={errors.recipientId}
                     hint="Optional — leave blank for an unregistered or emergency admission.">
                <Select id="rec" value={form.recipientId} onChange={set('recipientId')} placeholder="Not a registered patient"
                        options={(recipients?.rows ?? []).map((r) => ({ value: r.recipientId, label: `${r.recipientName} (${r.bloodGroup})` }))} />
              </Field>
            )}

            <Field label="Patient name on the request" htmlFor="pname" className="sm:col-span-2" error={errors.patientName}>
              <input id="pname" className="input" value={form.patientName} onChange={set('patientName')}
                     placeholder="e.g. RTA Trauma Case 114" />
            </Field>
          </div>
        </Card>

        <Card title="Requirement">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Blood group required" htmlFor="bg" required error={errors.bloodGroupId}>
              <Select id="bg" value={form.bloodGroupId} onChange={set('bloodGroupId')} required placeholder="Select…"
                      options={bloodGroups.map((g) => ({ value: g.bloodGroupId, label: g.groupCode }))} />
            </Field>
            <Field label="Component" htmlFor="comp" required error={errors.componentId}>
              <Select id="comp" value={form.componentId} onChange={set('componentId')} required placeholder={null}
                      options={bloodComponents.map((c) => ({ value: c.componentId, label: `${c.name} (${c.shelfLifeDays}d shelf life)` }))} />
            </Field>
            <Field label="Units required" htmlFor="units" required error={errors.unitsRequired}>
              <input id="units" type="number" min="1" max="50" className="input" required
                     value={form.unitsRequired} onChange={set('unitsRequired')} />
            </Field>
            <Field label="Urgency" htmlFor="urg" required error={errors.urgency}>
              <Select id="urg" value={form.urgency} onChange={set('urgency')} required placeholder={null}
                      options={URGENCIES.map((u) => ({ value: u, label: u }))} />
            </Field>
            <Field label="Required by" htmlFor="by" required error={errors.requiredBy}
                   hint="A request past this date is retired automatically by the housekeeping procedure.">
              <input id="by" type="date" className="input" required min={inDays(0)}
                     value={form.requiredBy} onChange={set('requiredBy')} />
            </Field>
            <Field label="Clinical notes" htmlFor="notes" className="sm:col-span-2" error={errors.notes}>
              <textarea id="notes" rows={3} className="textarea" value={form.notes} onChange={set('notes')} />
            </Field>
          </div>
        </Card>

        <Disclaimer />

        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4 text-white" />} Create request
          </button>
          <Link to="/app/blood/requests" className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
