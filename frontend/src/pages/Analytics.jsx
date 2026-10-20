import { useState } from 'react';
import { analyticsApi } from '../services/api.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  BloodChip, Card, DataState, PageHeader, Select, StatCard, fmt,
} from '../components/ui/index.jsx';
import { BarChartCard, LineChartCard, DonutChartCard } from '../components/charts/index.jsx';
import { ROLES } from '../constants/index.js';

export default function Analytics() {
  const { hasRole } = useAuth();
  const [months, setMonths] = useState(6);
  const overview = useApi(() => analyticsApi.overview(), []);
  const blood = useApi(() => analyticsApi.blood(months), [months]);
  const organs = useApi(() => analyticsApi.organs(), []);
  const hospitals = useApi(
    () => (hasRole(ROLES.ADMIN, ROLES.HOSPITAL, ROLES.TRANSPLANT_CENTER)
      ? analyticsApi.hospitals() : Promise.resolve(null)), []);

  const o = overview.data;

  return (
    <>
      <PageHeader
        title="Network analytics"
        subtitle="Every figure is computed by SQL aggregation in the database — COUNT, SUM, AVG, CASE, GROUP BY and HAVING — not in JavaScript."
        actions={(
          <Select value={months} placeholder={null} onChange={(e) => setMonths(Number(e.target.value))}
                  options={[{ value: 3, label: 'Last 3 months' }, { value: 6, label: 'Last 6 months' },
                            { value: 12, label: 'Last 12 months' }]} />
        )}
      />

      <DataState loading={overview.loading} error={overview.error} onRetry={overview.reload} loadingRows={4}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
          <StatCard label="Blood units available" value={fmt.number(o?.availableBloodUnits)} tone="red"
                    hint={`${o?.unitsExpiringSoon ?? 0} expiring within 7 days`} />
          <StatCard label="Request fulfilment" value={fmt.pct(o?.fulfilmentRatePct)} tone="green"
                    hint={`${o?.fulfilled ?? 0} of ${o?.totalRequests ?? 0}`} />
          <StatCard label="Stock wastage" value={fmt.pct(o?.wastage?.wastagePct)} tone="amber"
                    hint={`${o?.wastage?.expiredUnused ?? 0} units expired unused`} />
          <StatCard label="Organs listed" value={fmt.number(o?.availableOrgans)} tone="teal"
                    hint={`${o?.pendingOrganRequests ?? 0} requests waiting`} />
        </div>
      </DataState>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Usable units by blood group"
              subtitle="Compared with the share of the population carrying each group">
          <DataState loading={blood.loading} error={blood.error} onRetry={blood.reload} loadingRows={4}>
            <BarChartCard data={blood.data?.byGroup ?? []} xKey="bloodGroup"
                          bars={[{ key: 'availableUnits', label: 'Units available' },
                                 { key: 'populationPct', label: 'Population %', color: '#94a3b8' }]} />
          </DataState>
        </Card>

        <Card title="Donations per month">
          <DataState loading={blood.loading} error={blood.error} onRetry={blood.reload} loadingRows={4}>
            <LineChartCard data={blood.data?.donations ?? []} xKey="month"
                           lines={[{ key: 'donations', label: 'Donations' },
                                   { key: 'distinctDonors', label: 'Distinct donors', color: '#178385' }]} />
          </DataState>
        </Card>

        <Card title="Requests per month" subtitle="Raised versus fulfilled">
          <DataState loading={blood.loading} error={blood.error} onRetry={blood.reload} loadingRows={4}>
            <BarChartCard data={blood.data?.requests ?? []} xKey="month"
                          bars={[{ key: 'requests', label: 'Raised' },
                                 { key: 'fulfilled', label: 'Fulfilled', color: '#059669' },
                                 { key: 'critical', label: 'Critical', color: '#d97706' }]} />
          </DataState>
        </Card>

        <Card title="Requests by status">
          <DataState loading={blood.loading} error={blood.error} onRetry={blood.reload} loadingRows={4}>
            <DonutChartCard data={blood.data?.statusBreakdown ?? []} nameKey="status" valueKey="count" />
          </DataState>
        </Card>

        <Card title="Inventory by city">
          <DataState loading={blood.loading} error={blood.error} onRetry={blood.reload} loadingRows={4}>
            <BarChartCard data={blood.data?.byCity ?? []} xKey="city" stacked
                          bars={[{ key: 'availableUnits', label: 'Available', color: '#059669' },
                                 { key: 'reservedUnits', label: 'Reserved', color: '#6366f1' },
                                 { key: 'expiredUnits', label: 'Expired', color: '#cf2048' }]} />
          </DataState>
        </Card>

        <Card title="Wastage by component"
              subtitle="Short shelf lives drive wastage — platelets last only five days">
          <DataState loading={blood.loading} error={blood.error} onRetry={blood.reload} loadingRows={4}>
            <BarChartCard data={blood.data?.wastage ?? []} xKey="component"
                          bars={[{ key: 'wastagePct', label: 'Wastage %' }]} />
          </DataState>
        </Card>

        <Card title="Organ availability vs demand">
          <DataState loading={organs.loading} error={organs.error} onRetry={organs.reload} loadingRows={4}>
            <BarChartCard data={organs.data?.byType ?? []} xKey="organType"
                          bars={[{ key: 'available', label: 'Listed', color: '#178385' },
                                 { key: 'openRequests', label: 'Waiting', color: '#cf2048' }]} />
          </DataState>
        </Card>

        <Card title="Organ requests by urgency">
          <DataState loading={organs.loading} error={organs.error} onRetry={organs.reload} loadingRows={4}>
            <BarChartCard data={organs.data?.byUrgency ?? []} xKey="urgency"
                          bars={[{ key: 'requests', label: 'Requests' },
                                 { key: 'avgMedicalPriority', label: 'Avg priority', color: '#6366f1' }]} />
          </DataState>
        </Card>
      </div>

      <Card title="Most requested blood groups"
            subtitle="Demand ranking, with the share of requested units actually met" className="mt-4">
        <DataState loading={blood.loading} error={blood.error} onRetry={blood.reload}
                   empty={!blood.data?.mostRequested?.length} loadingRows={4}
                   emptyProps={{ title: 'No requests recorded yet' }}>
          <div className="table-wrap">
            <table className="table min-w-[32rem]">
              <thead>
                <tr><th>Group</th><th className="text-right">Requests</th><th className="text-right">Units requested</th>
                    <th className="text-right">Units allocated</th><th className="text-right">Met</th></tr>
              </thead>
              <tbody>
                {(blood.data?.mostRequested ?? []).map((row) => (
                  <tr key={row.bloodGroup}>
                    <td><BloodChip group={row.bloodGroup} /></td>
                    <td className="text-right tabular-nums">{row.requestCount}</td>
                    <td className="text-right tabular-nums">{row.unitsRequested}</td>
                    <td className="text-right tabular-nums">{row.unitsAllocated}</td>
                    <td className={`text-right tabular-nums font-medium ${
                      Number(row.metPct) >= 100 ? 'text-emerald-700' : Number(row.metPct) > 0 ? 'text-amber-700' : 'text-brand-700'}`}>
                      {fmt.pct(row.metPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </Card>

      {hospitals.data && (
        <Card title="Hospital request summary" subtitle="Read from the v_hospital_request_summary view" className="mt-4">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Hospital</th><th>City</th><th className="text-right">Blood requests</th>
                    <th className="text-right">Open</th><th className="text-right">Critical</th>
                    <th className="text-right">Fulfilment</th><th className="text-right">Organ requests</th></tr>
              </thead>
              <tbody>
                {(hospitals.data ?? []).map((row) => (
                  <tr key={row.hospitalId}>
                    <td className="text-slate-800">{row.hospital}</td>
                    <td className="text-slate-600">{row.city}</td>
                    <td className="text-right tabular-nums">{row.bloodRequestsTotal}</td>
                    <td className="text-right tabular-nums">{row.bloodRequestsOpen}</td>
                    <td className="text-right tabular-nums">{row.bloodRequestsCritical}</td>
                    <td className="text-right tabular-nums">{fmt.pct(row.fulfilmentRatePct)}</td>
                    <td className="text-right tabular-nums">{row.organRequestsTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
