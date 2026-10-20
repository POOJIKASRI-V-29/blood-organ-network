import { useState } from 'react';
import { bloodApi } from '../../services/api.js';
import { useReference } from '../../context/ReferenceContext.jsx';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import {
  Badge, BloodChip, Card, DataState, PageHeader, Pagination, SearchInput, Select, StatCard, fmt,
} from '../../components/ui/index.jsx';

const UNIT_STATUSES = ['AVAILABLE','RESERVED','ISSUED','TRANSFUSED','QUARANTINED','EXPIRED','DISCARDED'];

export default function Inventory() {
  const { bloodGroups, bloodComponents } = useReference();
  const [filters, setFilters] = useState({ status: '', bloodGroupId: '', componentId: '' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);

  const params = {
    page, limit: 20,
    ...(filters.status && { status: filters.status }),
    ...(filters.bloodGroupId && { bloodGroupId: Number(filters.bloodGroupId) }),
    ...(filters.componentId && { componentId: Number(filters.componentId) }),
    ...(debounced && { search: debounced }),
  };
  const { data, loading, error, reload } = useApi(() => bloodApi.units(params), [JSON.stringify(params)]);
  const expiring = useApi(() => bloodApi.expiring(), []);

  const set = (key) => (event) => { setPage(1); setFilters((f) => ({ ...f, [key]: event.target.value })); };

  const soon = (expiring.data ?? []).filter((u) => Number(u.daysToExpiry) <= 7 && Number(u.daysToExpiry) >= 0).length;
  const overdue = (expiring.data ?? []).filter((u) => Number(u.daysToExpiry) < 0).length;

  return (
    <>
      <PageHeader title="Blood inventory"
                  subtitle="Every bag is tracked individually, with its own expiry date and lifecycle status." />

      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <StatCard label="Units matching filters" value={fmt.number(data?.meta?.total)} />
        <StatCard label="Expiring within 7 days" value={soon} tone="amber" />
        <StatCard label="Past expiry, not yet retired" value={overdue} tone="red"
                  hint="Cleared by the housekeeping procedure" />
      </div>

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput value={search} onChange={(v) => { setPage(1); setSearch(v); }} placeholder="Unit code…" />
          <Select value={filters.status} onChange={set('status')} placeholder="All statuses"
                  options={UNIT_STATUSES.map((s) => ({ value: s, label: s }))} />
          <Select value={filters.bloodGroupId} onChange={set('bloodGroupId')} placeholder="All groups"
                  options={bloodGroups.map((g) => ({ value: g.bloodGroupId, label: g.groupCode }))} />
          <Select value={filters.componentId} onChange={set('componentId')} placeholder="All components"
                  options={bloodComponents.map((c) => ({ value: c.componentId, label: c.name }))} />
        </div>
      </Card>

      <Card>
        <DataState loading={loading} error={error} onRetry={reload} empty={!data?.rows?.length} loadingRows={8}
                   emptyProps={{ icon: '📦', title: 'No units found', message: 'No blood units match these filters.' }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Unit code</th><th>Group</th><th>Component</th><th className="text-right">Volume</th>
                  <th>Collected</th><th>Expires</th><th>Days left</th><th>Blood bank</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((unit) => {
                  const days = Number(unit.daysToExpiry);
                  return (
                    <tr key={unit.bloodUnitId}>
                      <td className="font-mono text-xs text-slate-700">{unit.unitCode}</td>
                      <td><BloodChip group={unit.bloodGroup} /></td>
                      <td className="text-slate-600">{unit.component}</td>
                      <td className="text-right tabular-nums text-slate-600">{fmt.ml(unit.volumeMl)}</td>
                      <td className="text-slate-600">{fmt.date(unit.collectionDate)}</td>
                      <td className="text-slate-600">{fmt.date(unit.expiryDate)}</td>
                      <td className={`tabular-nums text-xs font-medium ${
                        days < 0 ? 'text-brand-700' : days <= 7 ? 'text-amber-700' : 'text-slate-500'}`}>
                        {fmt.relativeDays(days)}
                      </td>
                      <td className="text-slate-600">{unit.bloodBank}</td>
                      <td><Badge value={unit.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination meta={data?.meta} onPage={setPage} />
        </DataState>
      </Card>
    </>
  );
}
