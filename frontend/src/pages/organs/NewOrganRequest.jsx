import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { organApi, directoryApi } from '../../services/api.js';
import { useReference } from '../../context/ReferenceContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useApi } from '../../hooks/useApi.js';
import { Card, Disclaimer, Field, PageHeader, Select, Spinner } from '../../components/ui/index.jsx';
import { ROLES, URGENCIES } from '../../constants/index.js';

export default function NewOrganRequest() {
  const { user, hasRole } = useAuth();
  const { organTypes, bloodGroups } = useReference();
  const toast = useToast();
  const navigate = useNavigate();

  const isHospital = hasRole(ROLES.HOSPITAL);
  const isRecipient = hasRole(ROLES.RECIPIENT);

  const [form, setForm] = useState({
    hospitalId: '', recipientId: '', organTypeId: '',
    bloodGroupId: isRecipient ? String(user?.profile?.bloodGroupId ?? '') : '',
    urgency: 'ROUTINE', medicalPriority: '50', requiredBy: '', notes: '',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data: hospitals } = useApi(
    () => (isHospital ? Promise.resolve(null) : directoryApi.hospitals({ limit: 100, status: 'ACTIVE' })), []);
  const { data: recipients } = useApi(
    () => (isRecipient ? Promise.resolve(null) : directoryApi.recipients({ limit: 100 })), []);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setErrors({}); setFormError(null);
    try {
      const payload = {
        organTypeId: Number(form.organTypeId),
        urgency: form.urgency,
        medicalPriority: Number(form.medicalPriority),
        notes: form.notes.trim() || null,
        requiredBy: form.requiredBy || null,
      };
      if (form.bloodGroupId) payload.bloodGroupId = Number(form.bloodGroupId);
      if (!isHospital && form.hospitalId) payload.hospitalId = Number(form.hospitalId);
      if (!isRecipient && form.recipientId) payload.recipientId = Number(form.recipientId);

      const created = await organApi.createRequest(payload);
      toast.success(`Request ${created.requestCode} created. Run matching to score candidate organs.`);
      navigate(`/app/organs/requests/${created.organRequestId}`);
    } catch (err) {
      setFormError(err.message);
      if (err.details) setErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
    } finally { setBusy(false); }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="New organ request"
                  subtitle="Candidate organs are scored on blood compatibility, urgency, clinical priority, location and donor age." />

      <form onSubmit={submit} className="space-y-4" noValidate>
        {formError && (
          <div role="alert" className="rounded-lg bg-brand-50 border border-brand-200 text-brand-800 text-sm px-3 py-2">{formError}</div>
        )}

        <Card title="Patient and hospital">
          <div className="grid sm:grid-cols-2 gap-4">
            {isHospital ? (
              <Field label="Hospital"><input className="input" value={user?.profile?.name ?? ''} disabled /></Field>
            ) : (
              <Field label="Hospital" htmlFor="h" required error={errors.hospitalId}>
                <Select id="h" value={form.hospitalId} onChange={set('hospitalId')} required placeholder="Select…"
                        options={(hospitals?.rows ?? []).map((x) => ({ value: x.hospitalId, label: `${x.name} — ${x.city}` }))} />
              </Field>
            )}
            {isRecipient ? (
              <Field label="Patient">
                <input className="input" value={user?.fullName ?? ''} disabled />
                <p className="hint">Your age and blood group are taken from your profile.</p>
              </Field>
            ) : (
              <Field label="Patient" htmlFor="r" required error={errors.recipientId}
                     hint="An organ request must name a registered patient.">
                <Select id="r" value={form.recipientId} onChange={set('recipientId')} required placeholder="Select…"
                        options={(recipients?.rows ?? []).map((x) => ({ value: x.recipientId, label: `${x.recipientName} (${x.bloodGroup}, ${x.age}y)` }))} />
              </Field>
            )}
          </div>
        </Card>

        <Card title="Clinical requirement">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Organ type" htmlFor="ot" required error={errors.organTypeId}>
              <Select id="ot" value={form.organTypeId} onChange={set('organTypeId')} required placeholder="Select…"
                      options={organTypes.map((o) => ({ value: o.organTypeId, label: `${o.name} (${o.maxColdIschemiaHours}h window)` }))} />
            </Field>
            <Field label="Recipient blood group" htmlFor="bg" error={errors.bloodGroupId}
                   hint="Defaults to the patient's registered group.">
              <Select id="bg" value={form.bloodGroupId} onChange={set('bloodGroupId')} placeholder="Use patient's group"
                      options={bloodGroups.map((g) => ({ value: g.bloodGroupId, label: g.groupCode }))} />
            </Field>
            <Field label="Urgency" htmlFor="u" required error={errors.urgency}>
              <Select id="u" value={form.urgency} onChange={set('urgency')} required placeholder={null}
                      options={URGENCIES.map((u) => ({ value: u, label: u }))} />
            </Field>
            <Field label={`Medical priority: ${form.medicalPriority}`} htmlFor="p" required error={errors.medicalPriority}
                   hint="0–100. Contributes 20% of the match score.">
              <input id="p" type="range" min="0" max="100" className="w-full accent-organ-600"
                     value={form.medicalPriority} onChange={set('medicalPriority')} />
            </Field>
            <Field label="Required by" htmlFor="by" error={errors.requiredBy}>
              <input id="by" type="date" className="input" value={form.requiredBy} onChange={set('requiredBy')} />
            </Field>
            <Field label="Clinical notes" htmlFor="n" className="sm:col-span-2" error={errors.notes}>
              <textarea id="n" rows={3} className="textarea" value={form.notes} onChange={set('notes')} />
            </Field>
          </div>
        </Card>

        <Disclaimer />

        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn-organ" disabled={busy}>
            {busy && <Spinner className="h-4 w-4 text-white" />} Create request
          </button>
          <Link to="/app/organs/requests" className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
