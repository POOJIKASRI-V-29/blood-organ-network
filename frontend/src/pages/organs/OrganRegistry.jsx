import { useState } from 'react';
import { organApi, directoryApi } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useReference } from '../../context/ReferenceContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Badge, BloodChip, Card, DataState, Field, Modal, PageHeader, Pagination, Select, Spinner, fmt,
} from '../../components/ui/index.jsx';
import { ROLES } from '../../constants/index.js';

const AVAILABILITY = ['AVAILABLE','RESERVED','ALLOCATED','TRANSPLANTED','EXPIRED','DISCARDED'];
const MEDICAL = ['UNDER_EVALUATION','VIABLE','NOT_VIABLE'];

function ListOrganModal({ open, onClose, onSaved }) {
  const { organTypes, bloodGroups, cities } = useReference();
  const { hasRole } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    organDonorId: '', organTypeId: '', bloodGroupId: '', centerId: '', cityId: '',
    donorAge: '', hlaType: '', medicalStatus: 'UNDER_EVALUATION',
    recoveredAt: new Date().toISOString().slice(0, 16), notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Only consented donors may have an organ listed; the API enforces this too.
  const { data: donors } = useApi(() => (open ? directoryApi.donors({ limit: 100 }) : Promise.resolve(null)), [open]);
  const { data: centers } = useApi(
    () => (open && hasRole(ROLES.ADMIN) ? directoryApi.transplantCenters({ limit: 50 }) : Promise.resolve(null)), [open]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const organDonors = (donors?.rows ?? []).filter((d) => d.isOrganDonor && d.organConsentStatus === 'CONSENTED');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const payload = {
        organDonorId: Number(form.organDonorId),
        organTypeId: Number(form.organTypeId),
        bloodGroupId: Number(form.bloodGroupId),
        donorAge: Number(form.donorAge),
        hlaType: form.hlaType.trim() || null,
        medicalStatus: form.medicalStatus,
        recoveredAt: form.recoveredAt.replace('T', ' ') + ':00',
        notes: form.notes.trim() || null,
      };
      if (form.cityId) payload.cityId = Number(form.cityId);
      if (hasRole(ROLES.ADMIN) && form.centerId) payload.centerId = Number(form.centerId);

      const created = await organApi.createOrgan(payload);
      toast.success(`Organ ${created.organCode} listed. Viability deadline derived by the database.`);
      onSaved(); onClose();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="List a recovered organ" width="max-w-2xl"
           footer={(
             <>
               <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
               <button className="btn-organ" onClick={submit} disabled={busy}>
                 {busy && <Spinner className="h-4 w-4 text-white" />} List organ
               </button>
             </>
           )}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <div role="alert" className="rounded-lg bg-brand-50 border border-brand-200 text-brand-800 text-sm px-3 py-2">{error}</div>}
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Organ donor" htmlFor="od" required className="sm:col-span-2"
                 hint="Only donors who have recorded consent appear here.">
            <Select id="od" value={form.organDonorId} onChange={set('organDonorId')} required placeholder="Select a consented donor…"
                    options={organDonors.map((d) => ({ value: d.donorId, label: `${d.donorName} (${d.bloodGroup}, ${d.age}y) — ${d.city}` }))} />
          </Field>
          <Field label="Organ type" htmlFor="ot" required>
            <Select id="ot" value={form.organTypeId} onChange={set('organTypeId')} required placeholder="Select…"
                    options={organTypes.map((o) => ({ value: o.organTypeId, label: `${o.name} (${o.maxColdIschemiaHours}h)` }))} />
          </Field>
          <Field label="Donor blood group" htmlFor="bg" required>
            <Select id="bg" value={form.bloodGroupId} onChange={set('bloodGroupId')} required placeholder="Select…"
                    options={bloodGroups.map((g) => ({ value: g.bloodGroupId, label: g.groupCode }))} />
          </Field>
          <Field label="Donor age" htmlFor="age" required>
            <input id="age" type="number" min="1" max="100" className="input" required value={form.donorAge} onChange={set('donorAge')} />
          </Field>
          <Field label="Recovered at" htmlFor="rec" required
                 hint="The viability deadline is derived from this by a database trigger.">
            <input id="rec" type="datetime-local" className="input" required value={form.recoveredAt} onChange={set('recoveredAt')} />
          </Field>
          {hasRole(ROLES.ADMIN) && (
            <Field label="Transplant centre" htmlFor="ctr" required>
              <Select id="ctr" value={form.centerId} onChange={set('centerId')} required placeholder="Select…"
                      options={(centers?.rows ?? []).map((c) => ({ value: c.centerId, label: c.name }))} />
            </Field>
          )}
          <Field label="City" htmlFor="cty" hint="Defaults to the centre's city.">
            <Select id="cty" value={form.cityId} onChange={set('cityId')} placeholder="Use centre's city"
                    options={cities.map((c) => ({ value: c.cityId, label: c.name }))} />
          </Field>
          <Field label="Medical status" htmlFor="ms" required>
            <Select id="ms" value={form.medicalStatus} onChange={set('medicalStatus')} placeholder={null}
                    options={MEDICAL.map((m) => ({ value: m, label: m.replace(/_/g, ' ') }))} />
          </Field>
          <Field label="HLA type" htmlFor="hla">
            <input id="hla" className="input" placeholder="e.g. A2,B7,DR15" value={form.hlaType} onChange={set('hlaType')} />
          </Field>
          <Field label="Notes" htmlFor="nt" className="sm:col-span-2">
            <input id="nt" className="input" value={form.notes} onChange={set('notes')} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

export default function OrganRegistry() {
  const { organTypes } = useReference();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [organTypeId, setOrganTypeId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const params = {
    page, limit: 15, onlyViable: false,
    ...(status && { status }),
    ...(organTypeId && { organTypeId: Number(organTypeId) }),
  };
  const { data, loading, error, reload } = useApi(() => organApi.availability(params), [JSON.stringify(params)]);

  const save = async () => {
    setBusy(true);
    try {
      await organApi.setOrganStatus(editing.organId, {
        availabilityStatus: editing.availabilityStatus,
        medicalStatus: editing.medicalStatus,
      });
      toast.success('Organ status updated.');
      setEditing(null); reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Organ registry"
                  subtitle="List recovered organs and maintain their clinical and availability status."
                  actions={<button className="btn-organ btn-sm" onClick={() => setCreateOpen(true)}>List an organ</button>} />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}
                  placeholder="All availability states"
                  options={AVAILABILITY.map((s) => ({ value: s, label: s }))} />
          <Select value={organTypeId} onChange={(e) => { setPage(1); setOrganTypeId(e.target.value); }}
                  placeholder="All organ types"
                  options={organTypes.map((o) => ({ value: o.organTypeId, label: o.name }))} />
        </div>
      </Card>

      <Card>
        <DataState loading={loading} error={error} onRetry={reload} empty={!data?.rows?.length} loadingRows={6}
                   emptyProps={{ icon: '🧬', title: 'No organs listed',
                                 action: <button className="btn-organ btn-sm" onClick={() => setCreateOpen(true)}>List an organ</button> }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th><th>Type</th><th>Group</th><th className="text-right">Age</th>
                  <th>Recovered</th><th>Viable until</th><th>Centre</th>
                  <th>Medical</th><th>Availability</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((organ) => (
                  <tr key={organ.organId}>
                    <td className="font-mono text-xs">{organ.organCode}</td>
                    <td className="font-medium text-slate-800">{organ.organType}</td>
                    <td><BloodChip group={organ.bloodGroup} /></td>
                    <td className="text-right tabular-nums text-slate-600">{organ.donorAge}</td>
                    <td className="text-slate-600 text-xs">{fmt.dateTime(organ.recoveredAt)}</td>
                    <td className="text-slate-600 text-xs">{fmt.dateTime(organ.viableUntil)}</td>
                    <td className="text-slate-600">{organ.transplantCenter}</td>
                    <td><Badge value={organ.medicalStatus} /></td>
                    <td><Badge value={organ.availabilityStatus} /></td>
                    <td><button className="btn-secondary btn-sm" onClick={() => setEditing({ ...organ })}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={data?.meta} onPage={setPage} />
        </DataState>
      </Card>

      <ListOrganModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={reload} />

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Update ${editing?.organCode ?? ''}`}
             footer={(
               <>
                 <button className="btn-secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                 <button className="btn-organ" onClick={save} disabled={busy}>
                   {busy && <Spinner className="h-4 w-4 text-white" />} Save
                 </button>
               </>
             )}>
        {editing && (
          <div className="grid gap-4">
            <Field label="Medical status" htmlFor="ems">
              <Select id="ems" value={editing.medicalStatus} placeholder={null}
                      onChange={(e) => setEditing({ ...editing, medicalStatus: e.target.value })}
                      options={MEDICAL.map((m) => ({ value: m, label: m.replace(/_/g, ' ') }))} />
            </Field>
            <Field label="Availability status" htmlFor="eas"
                   hint="Only VIABLE organs marked AVAILABLE are considered by the matching algorithm.">
              <Select id="eas" value={editing.availabilityStatus} placeholder={null}
                      onChange={(e) => setEditing({ ...editing, availabilityStatus: e.target.value })}
                      options={AVAILABILITY.map((s) => ({ value: s, label: s }))} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
