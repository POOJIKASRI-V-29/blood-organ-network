import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { bloodApi } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Badge, BloodChip, Card, ConfirmDialog, DataState, Detail, Disclaimer, EmptyState,
  Modal, PageHeader, Spinner, fmt,
} from '../../components/ui/index.jsx';
import { ROLES } from '../../constants/index.js';

const FLOW = ['PENDING', 'MATCHING', 'MATCHED', 'ALLOCATED', 'FULFILLED'];

function Timeline({ status }) {
  const terminal = ['REJECTED', 'CANCELLED', 'EXPIRED'];
  if (terminal.includes(status)) {
    return (
      <div className="flex items-center gap-2">
        <Badge value={status} />
        <span className="text-sm text-slate-500">This request is closed and cannot progress further.</span>
      </div>
    );
  }
  const current = FLOW.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {FLOW.map((step, index) => {
        const done = index <= current;
        return (
          <li key={step} className="flex items-center gap-1.5">
            <span className={`text-xs px-2 py-1 rounded-md font-medium ${
              done ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{step}</span>
            {index < FLOW.length - 1 && <span className={done ? 'text-brand-400' : 'text-slate-300'}>→</span>}
          </li>
        );
      })}
    </ol>
  );
}

export default function BloodRequestDetail() {
  const { id } = useParams();
  const { hasRole } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(() => bloodApi.request(id), [id]);

  const [preview, setPreview] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const canAct = hasRole(ROLES.ADMIN, ROLES.HOSPITAL, ROLES.BLOOD_BANK);

  const openPreview = async () => {
    setPreviewOpen(true); setPreviewLoading(true);
    try { setPreview(await bloodApi.previewMatches(id)); }
    catch (err) { toast.error(err.message); setPreviewOpen(false); }
    finally { setPreviewLoading(false); }
  };

  const runAllocate = async () => {
    setBusy(true);
    try {
      const result = await bloodApi.allocate(id);
      if (result.allocated > 0) toast.success(result.message);
      else toast.warn(result.message);
      setPreviewOpen(false);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const changeStatus = async (status) => {
    setBusy(true);
    try {
      await bloodApi.setRequestStatus(id, status);
      toast.success(`Request moved to ${status}.`);
      setConfirm(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  return (
    <DataState loading={loading} error={error} onRetry={reload} loadingRows={8}>
      {data && (
        <>
          <PageHeader
            title={data.requestCode}
            subtitle={`Raised ${fmt.dateTime(data.requestDate)}${data.createdByName ? ` by ${data.createdByName}` : ''}`}
            actions={(
              <>
                <Link to="/app/blood/requests" className="btn-ghost btn-sm">← All requests</Link>
                {canAct && ['PENDING', 'MATCHING', 'MATCHED', 'ALLOCATED'].includes(data.status) && (
                  <>
                    <button className="btn-secondary btn-sm" onClick={openPreview}>Preview matches</button>
                    <button className="btn-primary btn-sm" onClick={runAllocate} disabled={busy}>
                      {busy && <Spinner className="h-4 w-4 text-white" />} Allocate units
                    </button>
                  </>
                )}
              </>
            )}
          />

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Request" className="lg:col-span-2">
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Detail label="Blood group"><BloodChip group={data.bloodGroup} /></Detail>
                <Detail label="Component">{data.component}</Detail>
                <Detail label="Units">
                  <span className={data.unitsAllocated >= data.unitsRequired ? 'text-emerald-700 font-medium' : ''}>
                    {data.unitsAllocated} of {data.unitsRequired} allocated
                  </span>
                </Detail>
                <Detail label="Urgency"><Badge value={data.urgency} /></Detail>
                <Detail label="Status"><Badge value={data.status} /></Detail>
                <Detail label="Required by">{fmt.date(data.requiredBy)}</Detail>
                <Detail label="Patient">{data.patientName ?? data.recipientName}</Detail>
                <Detail label="Hospital">{data.hospital}</Detail>
                <Detail label="City">{data.city}</Detail>
                {data.notes && <Detail label="Clinical notes" className="col-span-2 sm:col-span-3">{data.notes}</Detail>}
              </dl>

              <div className="mt-5 pt-4 border-t border-slate-200">
                <p className="text-xs uppercase tracking-wide text-slate-500 font-medium mb-2">Workflow</p>
                <Timeline status={data.status} />
              </div>
            </Card>

            <Card title="Supply position">
              <p className="text-3xl font-semibold text-slate-900 tabular-nums">{data.compatibleUnitsInNetwork}</p>
              <p className="text-sm text-slate-500">
                compatible {data.component.toLowerCase()} unit(s) available across the network for a{' '}
                {data.bloodGroup} patient.
              </p>
              {data.compatibleUnitsInNetwork < (data.unitsRequired - data.unitsAllocated) && (
                <p className="mt-3 text-sm text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
                  Shortfall: the network cannot currently meet the outstanding{' '}
                  {data.unitsRequired - data.unitsAllocated} unit(s).
                </p>
              )}

              {canAct && (
                <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap gap-2">
                  {data.status === 'ALLOCATED' && (
                    <button className="btn-primary btn-sm"
                            onClick={() => setConfirm({ status: 'FULFILLED', title: 'Mark as fulfilled?',
                              message: 'This issues and transfuses every reserved unit. The units become terminal and cannot return to stock.' })}>
                      Mark fulfilled
                    </button>
                  )}
                  {!['FULFILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(data.status) && (
                    <>
                      <button className="btn-danger btn-sm"
                              onClick={() => setConfirm({ status: 'CANCELLED', title: 'Cancel this request?',
                                message: 'Any reserved units are returned to available stock.' })}>
                        Cancel request
                      </button>
                      <button className="btn-secondary btn-sm"
                              onClick={() => setConfirm({ status: 'REJECTED', title: 'Reject this request?',
                                message: 'Any reserved units are returned to available stock.' })}>
                        Reject
                      </button>
                    </>
                  )}
                </div>
              )}
            </Card>
          </div>

          <Card title={`Allocated units (${data.allocations.length})`}
                subtitle="Each row is one physically identified bag, reserved inside a database transaction."
                className="mt-4">
            {data.allocations.length === 0 ? (
              <EmptyState icon="📦" title="No units allocated yet"
                          message="Run allocation to reserve compatible, unexpired units for this request." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Unit code</th><th>Group</th><th>Expiry</th><th>Blood bank</th><th>City</th><th>Status</th><th>Allocated</th></tr>
                  </thead>
                  <tbody>
                    {data.allocations.map((a) => (
                      <tr key={a.allocationId}>
                        <td className="font-mono text-xs text-slate-700">{a.unitCode}</td>
                        <td><BloodChip group={a.unitBloodGroup} /></td>
                        <td className="text-slate-600">{fmt.date(a.expiryDate)}</td>
                        <td className="text-slate-700">{a.bloodBank}</td>
                        <td className="text-slate-600">{a.city}</td>
                        <td><Badge value={a.status} /></td>
                        <td className="text-slate-500 text-xs">{fmt.dateTime(a.allocatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Disclaimer className="mt-4" />

          {/* Candidate units preview */}
          <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} width="max-w-4xl"
                 title="Candidate units"
                 footer={(
                   <>
                     <button className="btn-secondary" onClick={() => setPreviewOpen(false)}>Close</button>
                     <button className="btn-primary" onClick={runAllocate} disabled={busy || !preview?.candidateUnits?.length}>
                       {busy && <Spinner className="h-4 w-4 text-white" />} Allocate now
                     </button>
                   </>
                 )}>
            {previewLoading ? <Spinner /> : !preview?.candidateUnits?.length ? (
              <EmptyState icon="🩸" title="No compatible units available"
                          message="No unexpired, available unit in the network matches this request's group and component." />
            ) : (
              <>
                <p className="text-sm text-slate-600 mb-3">{preview.note}</p>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>#</th><th>Unit</th><th>Group</th><th>Expiry</th><th>Bank</th><th>City</th><th>Why</th></tr>
                    </thead>
                    <tbody>
                      {preview.candidateUnits.map((unit, index) => (
                        <tr key={unit.blood_unit_id}>
                          <td className="text-slate-400 tabular-nums">{index + 1}</td>
                          <td className="font-mono text-xs">{unit.unit_code}</td>
                          <td>
                            <BloodChip group={unit.unit_blood_group} />
                            {Number(unit.exact_group_match) === 1 && <span className="ml-1 text-[0.65rem] text-emerald-700">exact</span>}
                          </td>
                          <td className="text-slate-600">{fmt.date(unit.expiry_date)} <span className="text-xs text-slate-400">({unit.days_to_expiry}d)</span></td>
                          <td className="text-slate-700">{unit.blood_bank}</td>
                          <td className="text-slate-600">
                            {unit.city}{Number(unit.same_city) === 1 && <span className="ml-1 text-[0.65rem] text-emerald-700">local</span>}
                          </td>
                          <td className="text-xs text-slate-500 max-w-xs">{unit.compatibility_reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Modal>

          <ConfirmDialog
            open={Boolean(confirm)} busy={busy}
            title={confirm?.title} message={confirm?.message}
            confirmLabel={confirm?.status === 'FULFILLED' ? 'Mark fulfilled' : 'Confirm'}
            onCancel={() => setConfirm(null)}
            onConfirm={() => changeStatus(confirm.status)}
          />
        </>
      )}
    </DataState>
  );
}
