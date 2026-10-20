import { useState } from 'react';
import { Link } from 'react-router-dom';
import { organApi } from '../../services/api.js';
import { useReference } from '../../context/ReferenceContext.jsx';
import { useApi } from '../../hooks/useApi.js';
import {
  Badge, BloodChip, Card, DataState, PageHeader, Pagination, Select, fmt,
} from '../../components/ui/index.jsx';
import { URGENCIES } from '../../constants/index.js';

const STATUSES = ['PENDING','MATCHING','MATCH_FOUND','ALLOCATED','TRANSPLANT_COMPLETED','REJECTED','CANCELLED','EXPIRED'];

export default function OrganRequests() {
  const { organTypes } = useReference();
  const [filters, setFilters] = useState({ status: '', urgency: '', organTypeId: '' });
  const [page, setPage] = useState(1);

  const params = {
    page, limit: 15,
    ...(filters.status && { status: filters.status }),
    ...(filters.urgency && { urgency: filters.urgency }),
    ...(filters.organTypeId && { organTypeId: Number(filters.organTypeId) }),
  };
  const { data, loading, error, reload } = useApi(() => organApi.requests(params), [JSON.stringify(params)]);
  const set = (key) => (event) => { setPage(1); setFilters((f) => ({ ...f, [key]: event.target.value })); };

  return (
    <>
      <PageHeader
        title="Organ requests"
        subtitle="Requests are scored against listed organs by a simplified academic matching algorithm."
        actions={<Link to="/app/organs/requests/new" className="btn-organ btn-sm">New request</Link>}
      />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select value={filters.status} onChange={set('status')} placeholder="All statuses"
                  options={STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} />
          <Select value={filters.urgency} onChange={set('urgency')} placeholder="All urgencies"
                  options={URGENCIES.map((u) => ({ value: u, label: u }))} />
          <Select value={filters.organTypeId} onChange={set('organTypeId')} placeholder="All organ types"
                  options={organTypes.map((o) => ({ value: o.organTypeId, label: o.name }))} />
        </div>
      </Card>

      <Card>
        <DataState loading={loading} error={error} onRetry={reload} empty={!data?.rows?.length} loadingRows={6}
                   emptyProps={{ icon: '🗂️', title: 'No organ requests found',
                                 action: <Link to="/app/organs/requests/new" className="btn-organ btn-sm">Raise a request</Link> }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th><th>Recipient</th><th>Organ</th><th>Blood group</th>
                  <th className="text-right">Age</th><th className="text-right">Priority</th>
                  <th>Urgency</th><th>Status</th><th className="text-right">Matches</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((row) => (
                  <tr key={row.organRequestId}>
                    <td><Link to={`/app/organs/requests/${row.organRequestId}`} className="link font-medium">{row.requestCode}</Link></td>
                    <td className="text-slate-700">{row.recipientName}</td>
                    <td className="font-medium text-slate-800">{row.organType}</td>
                    <td><BloodChip group={row.bloodGroup} /></td>
                    <td className="text-right tabular-nums text-slate-600">{row.recipientAge}</td>
                    <td className="text-right tabular-nums font-medium">{row.medicalPriority}</td>
                    <td><Badge value={row.urgency} /></td>
                    <td><Badge value={row.status} /></td>
                    <td className="text-right tabular-nums">
                      {row.matchCount > 0
                        ? <span className="text-organ-700 font-medium">{row.matchCount}</span>
                        : <span className="text-slate-400">0</span>}
                    </td>
                    <td><Link to={`/app/organs/requests/${row.organRequestId}`} className="btn-secondary btn-sm">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={data?.meta} onPage={setPage} />
        </DataState>
      </Card>
    </>
  );
}
