import { useState } from 'react';
import { bloodApi, directoryApi } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useReference } from '../../context/ReferenceContext.jsx';
import {
  Badge, BloodChip, Card, ConfirmDialog, DataState, Detail, Field, Modal,
  PageHeader, Pagination, Select, Spinner, fmt,
} from '../../components/ui/index.jsx';
import { ROLES } from '../../constants/index.js';

function RecordDonationModal({ open, onClose, onSaved }) {
  const { bloodComponents } = useReference();
  const { hasRole, user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    donorId: '', bloodBankId: '', donationDate: new Date().toISOString().slice(0, 10),
    volumeMl: '450', hemoglobinGdl: '', notes: '',
  });
  const [componentIds, setComponentIds] = useState([2, 4]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const { data: donors } = useApi(() => (open ? directoryApi.donors({ limit: 100 }) : Promise.resolve(null)), [open]);
  const { data: banks } = useApi(
    () => (open && hasRole(ROLES.ADMIN) ? directoryApi.bloodBanks({ limit: 100, status: 'ACTIVE' }) : Promise.resolve(null)),
    [open]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const toggleComponent = (id) =>
    setComponentIds((current) => current.includes(id) ? current.filter((c) => c !== id) : [...current, id]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const payload = {
        donorId: Number(form.donorId),
        donationDate: form.donationDate,
        volumeMl: Number(form.volumeMl),
        hemoglobinGdl: form.hemoglobinGdl ? Number(form.hemoglobinGdl) : null,
        notes: form.notes.trim() || null,
        components: componentIds.map((id) => ({ componentId: id })),
      };
      if (hasRole(ROLES.ADMIN)) payload.bloodBankId = Number(form.bloodBankId);
      else payload.bloodBankId = user?.profile?.bloodBankId;

      const created = await bloodApi.createDonation(payload);
      toast.success(`Donation recorded — ${created.units.length} unit(s) created and quarantined pending screening.`);
      onSaved();
      onClose();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record a donation" width="max-w-2xl"
           footer={(
             <>
               <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
               <button className="btn-primary" onClick={submit} disabled={busy || !componentIds.length}>
                 {busy && <Spinner className="h-4 w-4 text-white" />} Record donation
               </button>
             </>
           )}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <div role="alert" className="rounded-lg bg-brand-50 border border-brand-200 text-brand-800 text-sm px-3 py-2">{error}</div>}

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Donor" htmlFor="donor" required
                 hint="A donor must wait 90 days between whole blood donations.">
            <Select id="donor" value={form.donorId} onChange={set('donorId')} required placeholder="Select a donor…"
                    options={(donors?.rows ?? []).map((d) => ({
                      value: d.donorId, label: `${d.donorName} (${d.bloodGroup}) — ${d.city}` }))} />
          </Field>
          {hasRole(ROLES.ADMIN) ? (
            <Field label="Blood bank" htmlFor="bank" required>
              <Select id="bank" value={form.bloodBankId} onChange={set('bloodBankId')} required placeholder="Select…"
                      options={(banks?.rows ?? []).map((b) => ({ value: b.bloodBankId, label: b.name }))} />
            </Field>
          ) : (
            <Field label="Blood bank">
              <input className="input" value={user?.profile?.name ?? ''} disabled />
            </Field>
          )}
          <Field label="Donation date" htmlFor="date" required>
            <input id="date" type="date" className="input" required max={new Date().toISOString().slice(0, 10)}
                   value={form.donationDate} onChange={set('donationDate')} />
          </Field>
          <Field label="Volume (ml)" htmlFor="vol" required>
            <input id="vol" type="number" min="100" max="600" className="input" required
                   value={form.volumeMl} onChange={set('volumeMl')} />
          </Field>
          <Field label="Haemoglobin (g/dL)" htmlFor="hb">
            <input id="hb" type="number" step="0.1" min="5" max="25" className="input"
                   value={form.hemoglobinGdl} onChange={set('hemoglobinGdl')} />
          </Field>
          <Field label="Notes" htmlFor="notes">
            <input id="notes" className="input" value={form.notes} onChange={set('notes')} />
          </Field>
        </div>

        <div>
          <p className="label">Separate into components</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {bloodComponents.map((component) => (
              <label key={component.componentId}
                     className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer text-sm transition ${
                       componentIds.includes(component.componentId)
                         ? 'border-brand-300 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="checkbox" className="mt-0.5" checked={componentIds.includes(component.componentId)}
                       onChange={() => toggleComponent(component.componentId)} />
                <span>
                  <span className="font-medium text-slate-800 block">{component.name}</span>
                  <span className="text-xs text-slate-500">{component.shelfLifeDays}-day shelf life · {component.storageTemp}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="hint">
            Each component becomes an individually tracked unit. Expiry dates are derived by a database
            trigger from the component's shelf life — they are never typed in.
          </p>
        </div>
      </form>
    </Modal>
  );
}

export default function Donations() {
  const { hasRole, user } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [screening, setScreening] = useState(null);
  const [busy, setBusy] = useState(false);

  const params = { page, limit: 15, ...(status && { screeningStatus: status }) };
  const { data, loading, error, reload } = useApi(() => bloodApi.donations(params), [JSON.stringify(params)]);

  const canRecord = hasRole(ROLES.ADMIN, ROLES.BLOOD_BANK);
  const isDonor = hasRole(ROLES.DONOR);

  const applyScreening = async () => {
    setBusy(true);
    try {
      await bloodApi.setScreening(screening.donationId, screening.result);
      toast.success(screening.result === 'PASSED'
        ? 'Screening passed — units released to available stock by the database trigger.'
        : 'Screening failed — all units from this donation were discarded by the database trigger.');
      setScreening(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader
        title={isDonor ? 'My donations' : 'Blood donations'}
        subtitle={isDonor
          ? 'Your complete donation history.'
          : 'Recording a donation creates individually tracked component units, quarantined until screening passes.'}
        actions={canRecord && <button className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>Record donation</button>}
      />

      <Card className="mb-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <Select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}
                  placeholder="All screening states"
                  options={[{ value: 'PENDING', label: 'Pending screening' },
                            { value: 'PASSED', label: 'Passed' },
                            { value: 'FAILED', label: 'Failed' }]} />
        </div>
      </Card>

      <Card>
        <DataState loading={loading} error={error} onRetry={reload} empty={!data?.rows?.length} loadingRows={6}
                   emptyProps={{ icon: '💉', title: 'No donations found',
                                 message: isDonor ? 'You have no recorded donations yet.' : 'No donations match this filter.' }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>{!isDonor && <th>Donor</th>}<th>Group</th><th>Blood bank</th>
                  <th className="text-right">Volume</th><th className="text-right">Units</th>
                  <th>Screening</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((row) => (
                  <tr key={row.donationId}>
                    <td className="text-slate-700">{fmt.date(row.donationDate)}</td>
                    {!isDonor && <td className="text-slate-700">{row.donorName}</td>}
                    <td><BloodChip group={row.bloodGroup} /></td>
                    <td className="text-slate-600">{row.bloodBank}<span className="text-slate-400">, {row.city}</span></td>
                    <td className="text-right tabular-nums text-slate-600">{fmt.ml(row.volumeMl)}</td>
                    <td className="text-right tabular-nums">{row.unitsProduced}</td>
                    <td><Badge value={row.screeningStatus} /></td>
                    <td className="whitespace-nowrap">
                      <button className="btn-secondary btn-sm" onClick={async () => {
                        try { setDetail(await bloodApi.donation(row.donationId)); }
                        catch (err) { toast.error(err.message); }
                      }}>View</button>
                      {canRecord && row.screeningStatus === 'PENDING' && (
                        <>
                          <button className="btn-secondary btn-sm ml-1"
                                  onClick={() => setScreening({ donationId: row.donationId, result: 'PASSED' })}>Pass</button>
                          <button className="btn-danger btn-sm ml-1"
                                  onClick={() => setScreening({ donationId: row.donationId, result: 'FAILED' })}>Fail</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={data?.meta} onPage={setPage} />
        </DataState>
      </Card>

      {canRecord && (
        <RecordDonationModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={reload} />
      )}

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={`Donation #${detail?.donationId ?? ''}`} width="max-w-2xl">
        {detail && (
          <>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
              <Detail label="Donor">{detail.donorName}</Detail>
              <Detail label="Blood group"><BloodChip group={detail.bloodGroup} /></Detail>
              <Detail label="Date">{fmt.date(detail.donationDate)}</Detail>
              <Detail label="Volume">{fmt.ml(detail.volumeMl)}</Detail>
              <Detail label="Haemoglobin">{detail.hemoglobinGdl ? `${detail.hemoglobinGdl} g/dL` : null}</Detail>
              <Detail label="Screening"><Badge value={detail.screeningStatus} /></Detail>
              <Detail label="Blood bank" className="col-span-2">{detail.bloodBank}, {detail.city}</Detail>
              {detail.notes && <Detail label="Notes" className="col-span-2 sm:col-span-3">{detail.notes}</Detail>}
            </dl>
            <p className="text-xs uppercase tracking-wide text-slate-500 font-medium mb-2">
              Units produced ({detail.units.length})
            </p>
            <div className="table-wrap">
              <table className="table min-w-[28rem]">
                <thead><tr><th>Unit code</th><th>Component</th><th className="text-right">Volume</th><th>Expiry</th><th>Status</th></tr></thead>
                <tbody>
                  {detail.units.map((unit) => (
                    <tr key={unit.bloodUnitId}>
                      <td className="font-mono text-xs">{unit.unitCode}</td>
                      <td className="text-slate-700">{unit.component}</td>
                      <td className="text-right tabular-nums text-slate-600">{fmt.ml(unit.volumeMl)}</td>
                      <td className="text-slate-600">{fmt.date(unit.expiryDate)}</td>
                      <td><Badge value={unit.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(screening)} busy={busy}
        title={screening?.result === 'PASSED' ? 'Pass screening?' : 'Fail screening?'}
        message={screening?.result === 'PASSED'
          ? 'Every unit from this donation that is still in date will be released to available stock. This is done by a database trigger and cannot be undone.'
          : 'Every unit produced from this donation will be permanently discarded by a database trigger. This cannot be undone.'}
        confirmLabel={screening?.result === 'PASSED' ? 'Pass screening' : 'Fail and discard'}
        onCancel={() => setScreening(null)} onConfirm={applyScreening}
      />
    </>
  );
}
