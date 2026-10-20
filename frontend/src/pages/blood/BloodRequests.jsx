import { useState } from 'react';
import { Link } from 'react-router-dom';
import { bloodApi } from '../../services/api.js';
import { useReference } from '../../context/ReferenceContext.jsx';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  Badge, BloodChip, Card, DataState, PageHeader, Pagination, SearchInput, Select, fmt,
} from '../../components/ui/index.jsx';
import { ROLES, URGENCIES } from '../../constants/index.js';

const STATUSES = ['PENDING','MATCHING','MATCHED','ALLOCATED','FULFILLED','REJECTED','CANCELLED','EXPIRED'];

export default function BloodRequests() {
  const { hasRole } = useAuth();
  const { bloodGroups } = useReference();
  const [filters, setFilters] = useState({ status: '', urgency: '', bloodGroupId: '' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search);

  const params = {
    page, limit: 15,
    ...(filters.status && { status: filters.status }),
    ...(filters.urgency && { urgency: filters.urgency }),
    ...(filters.bloodGroupId && { bloodGroupId: Number(filters.bloodGroupId) }),
    ...(debouncedSearch && { search: debouncedSearch }),
  };
  const { data, loading, error, reload } = useApi(() => bloodApi.requests(params), [JSON.stringify(params)]);

  const set = (key) => (event) => { setPage(1); setFilters((f) => ({ ...f, [key]: event.target.value })); };
  const canCreate = hasRole(ROLES.ADMIN, ROLES.HOSPITAL, ROLES.RECIPIENT);

  return (
    <>
      <PageHeader
        title="Blood requests"
        subtitle="Requests move PENDING → MATCHING → MATCHED → ALLOCATED → FULFILLED. Transitions are validated by the API."
        actions={canCreate && <Link to="/app/blood/requests/new" className="btn-primary btn-sm">New request</Link>}
      />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput value={search} onChange={(v) => { setPage(1); setSearch(v); }}
                       placeholder="Request code or patient…" />
          <Select value={filters.status} onChange={set('status')} placeholder="All statuses"
                  options={STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} />
          <Select value={filters.urgency} onChange={set('urgency')} placeholder="All urgencies"
                  options={URGENCIES.map((u) => ({ value: u, label: u }))} />
          <Select value={filters.bloodGroupId} onChange={set('bloodGroupId')} placeholder="All blood groups"
                  options={bloodGroups.map((g) => ({ value: g.bloodGroupId, label: g.groupCode }))} />
        </div>
      </Card>

      <Card>
        <DataState loading={loading} error={error} onRetry={reload} empty={!data?.rows?.length} loadingRows={6}
                   emptyProps={{
                     icon: '📋', title: 'No requests found',
                     message: 'No blood requests match these filters.',
                     action: canCreate && <Link to="/app/blood/requests/new" className="btn-primary btn-sm">Raise a request</Link>,
                   }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th><th>Patient</th><th>Group</th><th>Component</th>
                  <th className="text-right">Units</th><th>Urgency</th><th>Status</th>
                  <th>Hospital</th><th>Required by</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((row) => (
                  <tr key={row.bloodRequestId}>
                    <td><Link to={`/app/blood/requests/${row.bloodRequestId}`} className="link font-medium">{row.requestCode}</Link></td>
                    <td className="text-slate-700">{row.patientName ?? <span className="text-slate-400">—</span>}</td>
                    <td><BloodChip group={row.bloodGroup} /></td>
                    <td className="text-slate-600">{row.component}</td>
                    <td className="text-right tabular-nums">
                      <span className={row.unitsAllocated >= row.unitsRequired ? 'text-emerald-700 font-medium' : 'text-slate-700'}>
                        {row.unitsAllocated}/{row.unitsRequired}
                      </span>
                    </td>
                    <td><Badge value={row.urgency} /></td>
                    <td><Badge value={row.status} /></td>
                    <td className="text-slate-600">{row.hospital}</td>
                    <td className="text-slate-600">{fmt.date(row.requiredBy)}</td>
                    <td><Link to={`/app/blood/requests/${row.bloodRequestId}`} className="btn-secondary btn-sm">Open</Link></td>
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
