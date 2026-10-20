import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { analyticsApi, bloodApi, organApi, directoryApi } from '../services/api.js';
import { useApi } from '../hooks/useApi.js';
import {
  Badge, BloodChip, Card, DataState, Detail, Disclaimer, PageHeader, StatCard, fmt,
} from '../components/ui/index.jsx';
import { BarChartCard } from '../components/charts/index.jsx';
import { ROLES, ROLE_LABELS } from '../constants/index.js';

/* ----------------------------------------------------------- shared bits */

function RecentActivity({ items }) {
  if (!items?.length) return <p className="text-sm text-slate-500">No recorded activity yet.</p>;
  return (
    <ol className="divide-y divide-slate-100 -my-1">
      {items.map((item) => (
        <li key={item.auditId} className="py-2.5 flex items-start gap-3">
          <Badge value={item.source} tone={item.source === 'TRIGGER' ? 'violet' : item.source === 'PROCEDURE' ? 'blue' : 'slate'} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-800 leading-snug">{item.description ?? item.action}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {item.userName ?? 'System'} · {fmt.dateTime(item.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function StockByGroup({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
      {rows.map((row) => {
        const units = Number(row.availableUnits);
        return (
          <div key={row.bloodGroup}
               className={`rounded-lg border p-2 text-center ${units === 0 ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200'}`}>
            <BloodChip group={row.bloodGroup} />
            <p className={`mt-1 text-lg font-semibold tabular-nums ${units === 0 ? 'text-brand-700' : 'text-slate-900'}`}>{units}</p>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- ADMIN */

function AdminDashboard() {
  const { data, loading, error, reload } = useApi(() => analyticsApi.overview(), []);
  const blood = useApi(() => analyticsApi.blood(6), []);

  return (
    <DataState loading={loading} error={error} onRetry={reload} loadingRows={6}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total users" value={fmt.number(data?.totalUsers)} hint={`${data?.pendingUsers ?? 0} awaiting approval`} />
        <StatCard label="Donors eligible now" value={fmt.number(data?.eligibleDonors)} tone="green"
                  hint={`of ${data?.totalDonors ?? 0} registered — the rest are inside the 90-day interval`} />
        <StatCard label="Blood units available" value={fmt.number(data?.availableBloodUnits)} tone="red"
                  hint={`${data?.unitsExpiringSoon ?? 0} expiring within 7 days`} />
        <StatCard label="Organs listed" value={fmt.number(data?.availableOrgans)} tone="teal"
                  hint={`${data?.proposedOrganMatches ?? 0} proposed matches`} />
        <StatCard label="Hospitals" value={fmt.number(data?.activeHospitals)} />
        <StatCard label="Blood banks" value={fmt.number(data?.activeBloodBanks)} />
        <StatCard label="Pending blood requests" value={fmt.number(data?.pendingBloodRequests)} tone="amber"
                  hint={`${data?.criticalBloodRequests ?? 0} critical`} />
        <StatCard label="Pending organ requests" value={fmt.number(data?.pendingOrganRequests)} tone="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mt-4">
        <StatCard label="Request fulfilment rate" value={fmt.pct(data?.fulfilmentRatePct)} tone="green"
                  hint={`${data?.fulfilled ?? 0} of ${data?.totalRequests ?? 0} requests fulfilled`} />
        <StatCard label="Stock wastage" value={fmt.pct(data?.wastage?.wastagePct)} tone="red"
                  hint={`${data?.wastage?.expiredUnused ?? 0} units expired unused`} />
        <StatCard label="Consented organ donors" value={fmt.number(data?.consentedOrganDonors)} tone="teal" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mt-4">
        <Card title="Usable stock by blood group">
          <StockByGroup rows={blood.data?.byGroup} />
        </Card>
        <Card title="Requests by status">
          <BarChartCard data={blood.data?.statusBreakdown ?? []} xKey="status"
                        bars={[{ key: 'count', label: 'Requests' }]} height={220} />
        </Card>
      </div>

      <Card title="Recent network activity" subtitle="From the audit trail — TRIGGER rows were written by the database itself"
            className="mt-4" actions={<Link to="/app/admin/audit" className="btn-secondary btn-sm">View all</Link>}>
        <RecentActivity items={data?.recentActivity} />
      </Card>
    </DataState>
  );
}

/* --------------------------------------------------------------- DONOR */

function DonorDashboard({ profile }) {
  const donations = useApi(() => bloodApi.donations({ limit: 5 }), []);
  const organ = useApi(() => organApi.myDonation().catch(() => null), []);
  const notifications = useApi(() => directoryApi.notifications({ limit: 5 }), []);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Your blood group" value={profile?.bloodGroup} tone="red" hint={`${profile?.city ?? ''}`} />
        <StatCard label="Lifetime donations" value={fmt.number(profile?.totalDonations)} tone="green" />
        <StatCard label="Eligibility" value={(profile?.eligibilityStatus ?? '').replace(/_/g, ' ')}
                  tone={profile?.eligibilityStatus === 'ELIGIBLE' ? 'green' : 'amber'}
                  hint={profile?.lastDonationDate ? `Last donated ${fmt.date(profile.lastDonationDate)}` : 'No donations recorded'} />
        <StatCard label="Organ pledge" value={organ.data ? organ.data.consentStatus.replace(/_/g, ' ') : 'Not registered'}
                  tone={organ.data?.consentStatus === 'CONSENTED' ? 'teal' : 'slate'}
                  hint={organ.data ? `${organ.data.pledges?.length ?? 0} organ(s) pledged` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mt-4">
        <Card title="Your donation history"
              actions={<Link to="/app/blood/donations" className="btn-secondary btn-sm">View all</Link>}>
          <DataState loading={donations.loading} error={donations.error} onRetry={donations.reload}
                     empty={!donations.data?.rows?.length}
                     emptyProps={{ icon: '💉', title: 'No donations recorded yet',
                                   message: 'Once a blood bank records a donation for you it will appear here.' }}
                     loadingRows={3}>
            <ul className="divide-y divide-slate-100 -my-1">
              {donations.data?.rows.map((row) => (
                <li key={row.donationId} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{fmt.date(row.donationDate)}</p>
                    <p className="text-xs text-slate-500 truncate">{row.bloodBank}, {row.city} · {fmt.ml(row.volumeMl)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-slate-500">{row.unitsProduced} units</span>
                    <Badge value={row.screeningStatus} />
                  </div>
                </li>
              ))}
            </ul>
          </DataState>
        </Card>

        <Card title="Organ donation status"
              actions={<Link to="/app/organs/my-donation" className="btn-secondary btn-sm">Manage</Link>}>
          {organ.loading ? <div className="skeleton h-20" /> : organ.data ? (
            <>
              <dl className="grid grid-cols-2 gap-3">
                <Detail label="Consent"><Badge value={organ.data.consentStatus} /></Detail>
                <Detail label="Donor kind"><Badge value={organ.data.donorKind} /></Detail>
                <Detail label="Medical status"><Badge value={organ.data.medicalStatus} /></Detail>
                <Detail label="Registered">{fmt.date(organ.data.registrationDate)}</Detail>
              </dl>
              <p className="text-xs uppercase tracking-wide text-slate-500 font-medium mt-4 mb-1.5">Pledged organs</p>
              <div className="flex flex-wrap gap-1.5">
                {organ.data.pledges?.length
                  ? organ.data.pledges.map((p) => <Badge key={p.pledgeId} value={p.organType} tone="teal" />)
                  : <span className="text-sm text-slate-500">None pledged yet.</span>}
              </div>
            </>
          ) : (
            <div className="text-center py-6">
              <p className="text-3xl mb-2" aria-hidden="true">🤝</p>
              <p className="font-medium text-slate-800">You have not registered as an organ donor</p>
              <p className="text-sm text-slate-500 mt-1 mb-4">Record your consent and choose which organs to pledge.</p>
              <Link to="/app/organs/my-donation" className="btn-organ btn-sm">Register now</Link>
            </div>
          )}
        </Card>
      </div>

      <Card title="Recent notifications" className="mt-4"
            actions={<Link to="/app/notifications" className="btn-secondary btn-sm">View all</Link>}>
        <DataState loading={notifications.loading} error={notifications.error} onRetry={notifications.reload}
                   empty={!notifications.data?.rows?.length}
                   emptyProps={{ icon: '🔔', title: 'No notifications' }} loadingRows={2}>
          <ul className="divide-y divide-slate-100 -my-1">
            {notifications.data?.rows.map((n) => (
              <li key={n.notificationId} className="py-2.5 flex items-start gap-3">
                <Badge value={n.type} />
                <div className="min-w-0">
                  <p className={`text-sm ${n.isRead ? 'text-slate-600' : 'text-slate-900 font-medium'}`}>{n.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{fmt.dateTime(n.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        </DataState>
      </Card>
    </>
  );
}

/* ----------------------------------------------------------- RECIPIENT */

function RecipientDashboard({ profile }) {
  const bloodRequests = useApi(() => bloodApi.requests({ limit: 5 }), []);
  const organRequests = useApi(() => organApi.requests({ limit: 5 }), []);
  const summary = useApi(() => bloodApi.availabilitySummary(), []);

  const open = (bloodRequests.data?.rows ?? []).filter((r) =>
    ['PENDING', 'MATCHING', 'MATCHED', 'ALLOCATED'].includes(r.status));

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Your blood group" value={profile?.bloodGroup} tone="red" hint={profile?.city} />
        <StatCard label="Open blood requests" value={open.length} tone="amber" />
        <StatCard label="Organ requests" value={fmt.number(organRequests.data?.meta?.total)} tone="teal" />
        <StatCard label="Compatible units in network"
                  value={fmt.number((summary.data ?? [])
                    .filter((s) => s.componentCode === 'RED_CELLS')
                    .reduce((sum, s) => sum + Number(s.availableUnits), 0))}
                  hint="Red cells, all groups" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mt-4">
        <Card title="Your blood requests"
              actions={<Link to="/app/blood/requests/new" className="btn-primary btn-sm">New request</Link>}>
          <DataState loading={bloodRequests.loading} error={bloodRequests.error} onRetry={bloodRequests.reload}
                     empty={!bloodRequests.data?.rows?.length}
                     emptyProps={{ icon: '📋', title: 'No blood requests yet',
                                   action: <Link to="/app/blood/requests/new" className="btn-primary btn-sm">Raise a request</Link> }}
                     loadingRows={3}>
            <ul className="divide-y divide-slate-100 -my-1">
              {bloodRequests.data?.rows.map((row) => (
                <li key={row.bloodRequestId} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/app/blood/requests/${row.bloodRequestId}`} className="link text-sm font-medium">
                      {row.requestCode}
                    </Link>
                    <p className="text-xs text-slate-500 truncate">
                      {row.bloodGroup} {row.component} · {row.unitsAllocated}/{row.unitsRequired} units · {row.hospital}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge value={row.urgency} /><Badge value={row.status} />
                  </div>
                </li>
              ))}
            </ul>
          </DataState>
        </Card>

        <Card title="Your organ requests"
              actions={<Link to="/app/organs/requests/new" className="btn-organ btn-sm">New request</Link>}>
          <DataState loading={organRequests.loading} error={organRequests.error} onRetry={organRequests.reload}
                     empty={!organRequests.data?.rows?.length}
                     emptyProps={{ icon: '🫀', title: 'No organ requests yet' }} loadingRows={3}>
            <ul className="divide-y divide-slate-100 -my-1">
              {organRequests.data?.rows.map((row) => (
                <li key={row.organRequestId} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/app/organs/requests/${row.organRequestId}`} className="link text-sm font-medium">
                      {row.requestCode}
                    </Link>
                    <p className="text-xs text-slate-500 truncate">
                      {row.organType} · priority {row.medicalPriority} · {row.matchCount} match(es)
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge value={row.urgency} /><Badge value={row.status} />
                  </div>
                </li>
              ))}
            </ul>
          </DataState>
        </Card>
      </div>
      <Disclaimer className="mt-4" />
    </>
  );
}

/* ------------------------------------------------------------ HOSPITAL */

function HospitalDashboard({ profile }) {
  const bloodRequests = useApi(() => bloodApi.requests({ limit: 6 }), []);
  const organRequests = useApi(() => organApi.requests({ limit: 6 }), []);
  const stats = useApi(() => analyticsApi.hospitals(), []);

  const mine = (stats.data ?? []).find((h) => h.hospitalId === profile?.hospitalId);

  return (
    <>
      {profile?.status !== 'ACTIVE' && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3 mb-4">
          <strong>Your hospital is {profile?.status}.</strong> An administrator must approve it before
          you can raise requests.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Blood requests raised" value={fmt.number(mine?.bloodRequestsTotal)} />
        <StatCard label="Currently open" value={fmt.number(mine?.bloodRequestsOpen)} tone="amber"
                  hint={`${mine?.bloodRequestsCritical ?? 0} critical`} />
        <StatCard label="Fulfilment rate" value={fmt.pct(mine?.fulfilmentRatePct)} tone="green"
                  hint={`${mine?.unitsAllocated ?? 0}/${mine?.unitsRequested ?? 0} units allocated`} />
        <StatCard label="Organ requests" value={fmt.number(mine?.organRequestsTotal)} tone="teal"
                  hint={`${mine?.organTransplantsCompleted ?? 0} completed`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mt-4">
        <Card title="Blood requests"
              actions={<Link to="/app/blood/requests/new" className="btn-primary btn-sm">New</Link>}>
          <DataState loading={bloodRequests.loading} error={bloodRequests.error} onRetry={bloodRequests.reload}
                     empty={!bloodRequests.data?.rows?.length}
                     emptyProps={{ icon: '📋', title: 'No requests raised yet' }} loadingRows={4}>
            <ul className="divide-y divide-slate-100 -my-1">
              {bloodRequests.data?.rows.map((row) => (
                <li key={row.bloodRequestId} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/app/blood/requests/${row.bloodRequestId}`} className="link text-sm font-medium">{row.requestCode}</Link>
                    <p className="text-xs text-slate-500 truncate">
                      {row.patientName ?? '—'} · {row.bloodGroup} {row.component} · {row.unitsAllocated}/{row.unitsRequired}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0"><Badge value={row.urgency} /><Badge value={row.status} /></div>
                </li>
              ))}
            </ul>
          </DataState>
        </Card>

        <Card title="Organ requests"
              actions={<Link to="/app/organs/requests/new" className="btn-organ btn-sm">New</Link>}>
          <DataState loading={organRequests.loading} error={organRequests.error} onRetry={organRequests.reload}
                     empty={!organRequests.data?.rows?.length}
                     emptyProps={{ icon: '🫀', title: 'No organ requests yet' }} loadingRows={4}>
            <ul className="divide-y divide-slate-100 -my-1">
              {organRequests.data?.rows.map((row) => (
                <li key={row.organRequestId} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/app/organs/requests/${row.organRequestId}`} className="link text-sm font-medium">{row.requestCode}</Link>
                    <p className="text-xs text-slate-500 truncate">
                      {row.organType} · {row.recipientName} · {row.matchCount} match(es)
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0"><Badge value={row.urgency} /><Badge value={row.status} /></div>
                </li>
              ))}
            </ul>
          </DataState>
        </Card>
      </div>
    </>
  );
}

/* ---------------------------------------------------------- BLOOD BANK */

function BloodBankDashboard({ profile }) {
  const expiring = useApi(() => bloodApi.expiring(), []);
  const donations = useApi(() => bloodApi.donations({ limit: 6 }), []);
  const summary = useApi(() => bloodApi.availabilitySummary(), []);
  const blood = useApi(() => analyticsApi.blood(6), []);

  const myStock = (summary.data ?? []).reduce((sum, row) => sum + Number(row.availableUnits), 0);
  const pendingScreen = (donations.data?.rows ?? []).filter((d) => d.screeningStatus === 'PENDING').length;

  return (
    <>
      {profile?.status !== 'ACTIVE' && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3 mb-4">
          <strong>Your blood bank is {profile?.status}.</strong> An administrator must approve it before you can record donations.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Network stock (units)" value={fmt.number(myStock)} tone="red" />
        <StatCard label="Expiring soon" value={fmt.number(expiring.data?.length)} tone="amber" hint="Within 14 days" />
        <StatCard label="Donations recorded" value={fmt.number(donations.data?.meta?.total)} />
        <StatCard label="Awaiting screening" value={pendingScreen} tone="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mt-4">
        <Card title="Expiring units" subtitle="Prioritise these for allocation to reduce wastage"
              actions={<Link to="/app/blood/inventory" className="btn-secondary btn-sm">Inventory</Link>}>
          <DataState loading={expiring.loading} error={expiring.error} onRetry={expiring.reload}
                     empty={!expiring.data?.length}
                     emptyProps={{ icon: '✅', title: 'Nothing expiring in the next 14 days' }} loadingRows={4}>
            <ul className="divide-y divide-slate-100 -my-1">
              {expiring.data?.slice(0, 6).map((unit) => (
                <li key={unit.bloodUnitId} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-2">
                    <BloodChip group={unit.bloodGroup} />
                    <div className="min-w-0">
                      <p className="text-sm font-mono text-slate-700 truncate">{unit.unitCode}</p>
                      <p className="text-xs text-slate-500 truncate">{unit.component}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-medium shrink-0 ${Number(unit.daysToExpiry) <= 3 ? 'text-brand-700' : 'text-amber-700'}`}>
                    {fmt.relativeDays(unit.daysToExpiry)}
                  </span>
                </li>
              ))}
            </ul>
          </DataState>
        </Card>

        <Card title="Recent donations"
              actions={<Link to="/app/blood/donations" className="btn-primary btn-sm">Record donation</Link>}>
          <DataState loading={donations.loading} error={donations.error} onRetry={donations.reload}
                     empty={!donations.data?.rows?.length}
                     emptyProps={{ icon: '💉', title: 'No donations recorded yet' }} loadingRows={4}>
            <ul className="divide-y divide-slate-100 -my-1">
              {donations.data?.rows.map((row) => (
                <li key={row.donationId} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-2">
                    <BloodChip group={row.bloodGroup} />
                    <div className="min-w-0">
                      <p className="text-sm text-slate-800 truncate">{row.donorName}</p>
                      <p className="text-xs text-slate-500">{fmt.date(row.donationDate)} · {row.unitsProduced} units</p>
                    </div>
                  </div>
                  <Badge value={row.screeningStatus} />
                </li>
              ))}
            </ul>
          </DataState>
        </Card>
      </div>

      <Card title="Wastage by component" subtitle="Expired unused, as a share of units created" className="mt-4">
        <BarChartCard data={blood.data?.wastage ?? []} xKey="component"
                      bars={[{ key: 'wastagePct', label: 'Wastage %' }]} height={220} />
      </Card>
    </>
  );
}

/* --------------------------------------------------- TRANSPLANT CENTRE */

function TransplantDashboard({ profile }) {
  const organs = useApi(() => organApi.availability({ limit: 8, centerId: profile?.centerId }), [profile?.centerId]);
  const requests = useApi(() => organApi.requests({ limit: 6 }), []);
  const stats = useApi(() => analyticsApi.organs(), []);

  return (
    <>
      {profile?.status !== 'ACTIVE' && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3 mb-4">
          <strong>Your centre is {profile?.status}.</strong> An administrator must approve it before you can list organs.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Organs held" value={fmt.number(organs.data?.meta?.total)} tone="teal" />
        <StatCard label="Open organ requests" value={fmt.number(requests.data?.meta?.total)} tone="amber" />
        <StatCard label="Host hospital" value={profile?.hospitalName ?? '—'} />
        <StatCard label="Licence" value={profile?.licenseNumber ?? '—'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mt-4">
        <Card title="Organs at your centre"
              actions={<Link to="/app/organs/registry" className="btn-organ btn-sm">Manage registry</Link>}>
          <DataState loading={organs.loading} error={organs.error} onRetry={organs.reload}
                     empty={!organs.data?.rows?.length}
                     emptyProps={{ icon: '🫀', title: 'No organs currently listed' }} loadingRows={4}>
            <ul className="divide-y divide-slate-100 -my-1">
              {organs.data?.rows.map((organ) => (
                <li key={organ.organId} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{organ.organType} <span className="font-mono text-xs text-slate-500">{organ.organCode}</span></p>
                    <p className="text-xs text-slate-500">{organ.bloodGroup} · donor age {organ.donorAge} · {organ.hoursRemaining}h viable</p>
                  </div>
                  <Badge value={organ.availabilityStatus} />
                </li>
              ))}
            </ul>
          </DataState>
        </Card>

        <Card title="Organ requests awaiting matching">
          <DataState loading={requests.loading} error={requests.error} onRetry={requests.reload}
                     empty={!requests.data?.rows?.length}
                     emptyProps={{ icon: '🗂️', title: 'No open requests' }} loadingRows={4}>
            <ul className="divide-y divide-slate-100 -my-1">
              {requests.data?.rows.map((row) => (
                <li key={row.organRequestId} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/app/organs/requests/${row.organRequestId}`} className="link text-sm font-medium">{row.requestCode}</Link>
                    <p className="text-xs text-slate-500 truncate">{row.organType} · {row.bloodGroup} · priority {row.medicalPriority}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0"><Badge value={row.urgency} /><Badge value={row.status} /></div>
                </li>
              ))}
            </ul>
          </DataState>
        </Card>
      </div>

      <Card title="Organ availability vs demand" className="mt-4">
        <BarChartCard data={stats.data?.byType ?? []} xKey="organType"
                      bars={[{ key: 'available', label: 'Listed', color: '#178385' },
                             { key: 'openRequests', label: 'Waiting', color: '#cf2048' }]} height={240} />
      </Card>
      <Disclaimer className="mt-4" />
    </>
  );
}

/* --------------------------------------------------------------- shell */

export default function Dashboard() {
  const { user } = useAuth();
  const profile = user?.profile;

  const byRole = {
    [ROLES.ADMIN]: <AdminDashboard />,
    [ROLES.DONOR]: <DonorDashboard profile={profile} />,
    [ROLES.RECIPIENT]: <RecipientDashboard profile={profile} />,
    [ROLES.HOSPITAL]: <HospitalDashboard profile={profile} />,
    [ROLES.BLOOD_BANK]: <BloodBankDashboard profile={profile} />,
    [ROLES.TRANSPLANT_CENTER]: <TransplantDashboard profile={profile} />,
  };

  return (
    <>
      <PageHeader
        title={`Welcome, ${user?.fullName?.split(' ')[0] ?? 'there'}`}
        subtitle={`${ROLE_LABELS[user?.role] ?? user?.role} dashboard${profile?.city ? ` · ${profile.city}` : ''}`}
      />
      {byRole[user?.role] ?? <p className="text-sm text-slate-500">No dashboard is configured for this role.</p>}
    </>
  );
}
