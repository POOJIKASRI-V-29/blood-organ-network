import { useEffect, useState } from 'react';
import { organApi } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useReference } from '../../context/ReferenceContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Badge, Card, DataState, Detail, Disclaimer, Field, PageHeader, Select, Spinner, fmt,
} from '../../components/ui/index.jsx';

export default function MyOrganDonation() {
  const { organTypes } = useReference();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(() => organApi.myDonation(), []);

  const [form, setForm] = useState({ donorKind: 'LIVING', consentStatus: 'CONSENTED', nextOfKin: '', notes: '' });
  const [pledged, setPledged] = useState([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    if (data) {
      setForm({
        donorKind: data.donorKind,
        consentStatus: data.consentStatus,
        nextOfKin: data.nextOfKin ?? '',
        notes: data.notes ?? '',
      });
      setPledged((data.pledges ?? []).map((p) => p.organTypeId));
    }
  }, [data]);

  const toggle = (id) => setPledged((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setFormError(null);
    try {
      await organApi.saveMyDonation({
        donorKind: form.donorKind,
        consentStatus: form.consentStatus,
        nextOfKin: form.nextOfKin.trim() || null,
        notes: form.notes.trim() || null,
        organTypeIds: pledged,
      });
      toast.success('Your organ donation preferences have been saved.');
      reload();
    } catch (err) { setFormError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="My organ pledge"
                  subtitle="Record your consent and choose which organs you wish to pledge. You may withdraw at any time." />

      <DataState loading={loading} error={error} onRetry={reload}>
        {data && (
          <Card title="Current registration" className="mb-4">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Detail label="Consent"><Badge value={data.consentStatus} /></Detail>
              <Detail label="Donor kind"><Badge value={data.donorKind} /></Detail>
              <Detail label="Medical status"><Badge value={data.medicalStatus} /></Detail>
              <Detail label="Registered">{fmt.date(data.registrationDate)}</Detail>
            </dl>
          </Card>
        )}

        <form onSubmit={submit} className="space-y-4" noValidate>
          {formError && (
            <div role="alert" className="rounded-lg bg-brand-50 border border-brand-200 text-brand-800 text-sm px-3 py-2">{formError}</div>
          )}

          <Card title={data ? 'Update your pledge' : 'Register as an organ donor'}>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Consent" htmlFor="c" required
                     hint="Withdrawing consent removes your organs from all future matching.">
                <Select id="c" value={form.consentStatus} placeholder={null}
                        onChange={(e) => setForm({ ...form, consentStatus: e.target.value })}
                        options={[{ value: 'CONSENTED', label: 'I consent to organ donation' },
                                  { value: 'PENDING', label: 'Undecided — pending counselling' },
                                  { value: 'WITHDRAWN', label: 'Withdraw my consent' }]} />
              </Field>
              <Field label="Donor kind" htmlFor="k" required>
                <Select id="k" value={form.donorKind} placeholder={null}
                        onChange={(e) => setForm({ ...form, donorKind: e.target.value })}
                        options={[{ value: 'LIVING', label: 'Living donor' },
                                  { value: 'DECEASED', label: 'After death' }]} />
              </Field>
              <Field label="Next of kin" htmlFor="k2">
                <input id="k2" className="input" value={form.nextOfKin}
                       onChange={(e) => setForm({ ...form, nextOfKin: e.target.value })} />
              </Field>
              <Field label="Notes" htmlFor="n">
                <input id="n" className="input" value={form.notes}
                       onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>

            <div className="mt-4">
              <p className="label">Organs I wish to pledge ({pledged.length} selected)</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {organTypes.map((organ) => (
                  <label key={organ.organTypeId}
                         className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer text-sm transition ${
                           pledged.includes(organ.organTypeId)
                             ? 'border-organ-300 bg-organ-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <input type="checkbox" className="mt-0.5 accent-organ-600"
                           checked={pledged.includes(organ.organTypeId)} onChange={() => toggle(organ.organTypeId)} />
                    <span>
                      <span className="font-medium text-slate-800 block">{organ.name}</span>
                      <span className="text-xs text-slate-500">
                        {organ.livingDonationPossible ? 'Living donation possible' : 'After death only'}
                        {' · '}{organ.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </Card>

          <Disclaimer />

          <button type="submit" className="btn-organ" disabled={busy}>
            {busy && <Spinner className="h-4 w-4 text-white" />} Save my pledge
          </button>
        </form>
      </DataState>
    </div>
  );
}
