import { useState } from 'react';
import { Link } from 'react-router-dom';
import { bloodApi } from '../../services/api.js';
import { useReference } from '../../context/ReferenceContext.jsx';
import { useApi } from '../../hooks/useApi.js';
import {
  Badge, BloodChip, Card, DataState, Disclaimer, PageHeader, Select, fmt,
} from '../../components/ui/index.jsx';

/**
 * Searches live stock. Filtering by "recipient blood group" runs the query
 * through the compatibility matrix, so it returns everything that COULD be
 * given to that patient, not only their own group.
 */
export default function BloodAvailability() {
  const { cities, bloodGroups, bloodComponents } = useReference();
  const [filters, setFilters] = useState({
    recipientBloodGroupId: '', componentId: '', cityId: '', minUnits: '',
  });

  const params = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== '').map(([k, v]) => [k, Number(v)]),
  );
  const { data, loading, error, reload } = useApi(() => bloodApi.availability(params), [JSON.stringify(params)]);

  const set = (key) => (event) => setFilters((f) => ({ ...f, [key]: event.target.value }));
  const clear = () => setFilters({ recipientBloodGroupId: '', componentId: '', cityId: '', minUnits: '' });
  const anyFilter = Object.values(filters).some(Boolean);

  const totalUnits = (data ?? []).reduce((sum, row) => sum + Number(row.available_units), 0);
  const chosenGroup = bloodGroups.find((g) => g.bloodGroupId === Number(filters.recipientBloodGroupId));

  return (
    <>
      <PageHeader
        title="Blood availability"
        subtitle="Live stock across the network. Donor identities are never exposed on this page."
        actions={<Link to="/app/blood/requests/new" className="btn-primary btn-sm">Raise a request</Link>}
      />

      <Card title="Search" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="label" htmlFor="rbg">Compatible with patient group</label>
            <Select id="rbg" value={filters.recipientBloodGroupId} onChange={set('recipientBloodGroupId')}
                    placeholder="Any group"
                    options={bloodGroups.map((g) => ({ value: g.bloodGroupId, label: g.groupCode }))} />
          </div>
          <div>
            <label className="label" htmlFor="comp">Component</label>
            <Select id="comp" value={filters.componentId} onChange={set('componentId')} placeholder="All components"
                    options={bloodComponents.map((c) => ({ value: c.componentId, label: c.name }))} />
          </div>
          <div>
            <label className="label" htmlFor="city">City</label>
            <Select id="city" value={filters.cityId} onChange={set('cityId')} placeholder="All cities"
                    options={cities.map((c) => ({ value: c.cityId, label: c.name }))} />
          </div>
          <div>
            <label className="label" htmlFor="min">Minimum units</label>
            <input id="min" type="number" min="1" className="input" placeholder="Any"
                   value={filters.minUnits} onChange={set('minUnits')} />
          </div>
          <div className="flex items-end">
            <button className="btn-secondary w-full" onClick={clear} disabled={!anyFilter}>Clear filters</button>
          </div>
        </div>
        {chosenGroup && (
          <p className="hint mt-3">
            Showing stock that can be transfused to a <strong>{chosenGroup.groupCode}</strong> patient —
            this includes compatible groups, not just {chosenGroup.groupCode}.{' '}
            <Link to="/compatibility" className="link">See the matrix</Link>
          </p>
        )}
      </Card>

      <Card
        title={`${data?.length ?? 0} stock line${data?.length === 1 ? '' : 's'}`}
        subtitle={data?.length ? `${totalUnits} usable unit(s) matching your filters` : undefined}
        bodyClass="card-pad"
      >
        <DataState
          loading={loading} error={error} onRetry={reload} empty={!data?.length} loadingRows={5}
          emptyProps={{
            icon: '🩸',
            title: 'No matching stock',
            message: anyFilter
              ? 'No blood bank currently holds unexpired units matching these filters. Try widening the search, or raise a request so the shortfall is recorded.'
              : 'There is no available stock in the network.',
            action: <Link to="/app/blood/requests/new" className="btn-primary btn-sm">Raise a request</Link>,
          }}
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Group</th><th>Component</th><th className="text-right">Units</th>
                  <th className="text-right">Volume</th><th>Blood bank</th><th>City</th>
                  <th>Earliest expiry</th><th>Expiring ≤7d</th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((row, index) => (
                  <tr key={`${row.blood_bank_id}-${row.blood_group}-${row.component}-${index}`}>
                    <td><BloodChip group={row.blood_group} /></td>
                    <td className="text-slate-700">{row.component}</td>
                    <td className="text-right font-semibold tabular-nums">{row.available_units}</td>
                    <td className="text-right tabular-nums text-slate-600">{fmt.ml(row.total_volume_ml)}</td>
                    <td className="text-slate-700">{row.blood_bank}</td>
                    <td className="text-slate-600">{row.city}<span className="text-slate-400">, {row.state}</span></td>
                    <td className="text-slate-600">{fmt.date(row.earliest_expiry)}</td>
                    <td>
                      {Number(row.expiring_within_7_days) > 0
                        ? <Badge value="WARNING" tone="amber">{row.expiring_within_7_days} unit(s)</Badge>
                        : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </Card>

      <Disclaimer className="mt-4" />
    </>
  );
}
