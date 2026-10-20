import { useState } from 'react';
import { Link } from 'react-router-dom';
import { organApi } from '../../services/api.js';
import { useReference } from '../../context/ReferenceContext.jsx';
import { useApi } from '../../hooks/useApi.js';
import {
  Badge, BloodChip, Card, DataState, Disclaimer, PageHeader, Pagination, Select, fmt,
} from '../../components/ui/index.jsx';

const REGIONS = ['North', 'South', 'East', 'West'];

export default function OrganAvailability() {
  const { organTypes, bloodGroups, cities } = useReference();
  const [filters, setFilters] = useState({ organTypeId: '', bloodGroupId: '', cityId: '', region: '' });
  const [page, setPage] = useState(1);

  const params = {
    page, limit: 15,
    ...(filters.organTypeId && { organTypeId: Number(filters.organTypeId) }),
    ...(filters.bloodGroupId && { bloodGroupId: Number(filters.bloodGroupId) }),
    ...(filters.cityId && { cityId: Number(filters.cityId) }),
    ...(filters.region && { region: filters.region }),
  };
  const { data, loading, error, reload } = useApi(() => organApi.availability(params), [JSON.stringify(params)]);

  const set = (key) => (event) => { setPage(1); setFilters((f) => ({ ...f, [key]: event.target.value })); };

  return (
    <>
      <PageHeader
        title="Organ availability"
        subtitle="Currently listed, viable organs. Donor identity is never exposed — only the clinical attributes needed to judge a match."
        actions={<Link to="/app/organs/requests/new" className="btn-organ btn-sm">Raise an organ request</Link>}
      />

      <Card title="Filters" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="ot">Organ type</label>
            <Select id="ot" value={filters.organTypeId} onChange={set('organTypeId')} placeholder="All organ types"
                    options={organTypes.map((o) => ({ value: o.organTypeId, label: o.name }))} />
          </div>
          <div>
            <label className="label" htmlFor="obg">Donor blood group</label>
            <Select id="obg" value={filters.bloodGroupId} onChange={set('bloodGroupId')} placeholder="All groups"
                    options={bloodGroups.map((g) => ({ value: g.bloodGroupId, label: g.groupCode }))} />
          </div>
          <div>
            <label className="label" htmlFor="oc">City</label>
            <Select id="oc" value={filters.cityId} onChange={set('cityId')} placeholder="All cities"
                    options={cities.map((c) => ({ value: c.cityId, label: c.name }))} />
          </div>
          <div>
            <label className="label" htmlFor="orx">Region</label>
            <Select id="orx" value={filters.region} onChange={set('region')} placeholder="All regions"
                    options={REGIONS.map((r) => ({ value: r, label: r }))} />
          </div>
        </div>
      </Card>

      <Card title={`${data?.meta?.total ?? 0} organ(s) listed`}>
        <DataState loading={loading} error={error} onRetry={reload} empty={!data?.rows?.length} loadingRows={6}
                   emptyProps={{ icon: '🫀', title: 'No organs match these filters',
                                 message: 'Try widening the search, or raise a request so the need is recorded and matched automatically when an organ is listed.',
                                 action: <Link to="/app/organs/requests/new" className="btn-organ btn-sm">Raise a request</Link> }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Organ code</th><th>Type</th><th>Blood group</th><th className="text-right">Donor age</th>
                  <th>Donor kind</th><th>Centre</th><th>City</th><th>Viable for</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((organ) => {
                  const hours = Number(organ.hoursRemaining);
                  return (
                    <tr key={organ.organId}>
                      <td className="font-mono text-xs text-slate-700">{organ.organCode}</td>
                      <td className="font-medium text-slate-800">{organ.organType}</td>
                      <td><BloodChip group={organ.bloodGroup} /></td>
                      <td className="text-right tabular-nums text-slate-600">{organ.donorAge}</td>
                      <td><Badge value={organ.donorKind} /></td>
                      <td className="text-slate-600">{organ.transplantCenter}</td>
                      <td className="text-slate-600">{organ.city}<span className="text-slate-400">, {organ.region}</span></td>
                      <td className={`tabular-nums text-xs font-medium ${
                        hours <= 6 ? 'text-brand-700' : hours <= 24 ? 'text-amber-700' : 'text-slate-500'}`}>
                        {hours > 0 ? `${hours}h` : 'expired'}
                      </td>
                      <td>
                        <Badge value={organ.availabilityStatus} />
                        {organ.medicalStatus !== 'VIABLE' && <Badge value={organ.medicalStatus} className="ml-1" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination meta={data?.meta} onPage={setPage} />
        </DataState>
      </Card>

      <Disclaimer className="mt-4" />
    </>
  );
}
