import { Link } from 'react-router-dom';
import { analyticsApi } from '../services/api.js';
import { useApi } from '../hooks/useApi.js';
import { BloodChip, Card, DataState, fmt } from '../components/ui/index.jsx';

const STEPS = [
  { n: 1, title: 'Register', body: 'Donors, patients, hospitals, blood banks and transplant centres each register with a role-specific profile. Institutions are verified by an administrator before they can act.' },
  { n: 2, title: 'Contribute', body: 'Blood banks record donations and separate them into components. Each unit is tracked individually with its own expiry date. Donors pledge organs and record consent.' },
  { n: 3, title: 'Request', body: 'A hospital or patient raises a request stating blood group, component, quantity and urgency — or the organ type and clinical priority.' },
  { n: 4, title: 'Match', body: 'The system joins the request against live inventory using a stored ABO/Rh compatibility matrix, preferring exact group, local stock, and units closest to expiry.' },
  { n: 5, title: 'Allocate', body: 'Units are reserved inside a database transaction with row-level locking, so the same unit can never be issued twice. Every state change is audited.' },
];

export default function Landing() {
  const { data, loading, error, reload } = useApi(() => analyticsApi.publicStats(), []);
  const stats = data?.stats;

  const tiles = [
    { label: 'Registered donors', value: stats?.registeredDonors },
    { label: 'Blood units available', value: stats?.bloodUnitsAvailable },
    { label: 'Organs listed', value: stats?.organsAvailable },
    { label: 'Organ donor pledges', value: stats?.organDonors },
    { label: 'Hospitals', value: stats?.hospitals },
    { label: 'Blood banks', value: stats?.bloodBanks },
    { label: 'Transplant centres', value: stats?.transplantCenters },
    { label: 'Cities covered', value: stats?.citiesCovered },
  ];

  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-b from-white to-slate-50 border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-14 sm:py-20 grid lg:grid-cols-[1.1fr_0.9fr] gap-10 items-center">
          <div>
            <span className="badge bg-brand-50 text-brand-700 ring-brand-200">Database Systems course project</span>
            <h1 className="mt-4 text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-slate-900 leading-[1.1]">
              One network for blood and organ availability.
            </h1>
            <p className="mt-4 text-slate-600 text-base sm:text-lg max-w-xl leading-relaxed">
              A centralised coordination platform connecting donors, patients, hospitals, blood banks
              and transplant centres — built on a normalised relational database that tracks every
              unit and every organ individually, from donation to transfusion.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/register" className="btn-primary">Register as a donor</Link>
              <Link to="/login" className="btn-secondary">Sign in</Link>
              <Link to="/compatibility" className="btn-ghost">View compatibility matrix →</Link>
            </div>
            <p className="mt-6 text-xs text-slate-500 max-w-xl leading-relaxed">
              Academic simulation. Matching and allocation here are simplified demonstrations of
              database and software engineering concepts and must not be used for real-world medical
              decision-making. All data shown is fictitious.
            </p>
          </div>

          {/* Live availability panel */}
          <Card title="Live network availability" subtitle="Read directly from the database" className="w-full">
            <DataState loading={loading} error={error} onRetry={reload} loadingRows={4}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-5">
                {tiles.slice(0, 4).map((tile) => (
                  <div key={tile.label}>
                    <p className="text-2xl font-semibold text-slate-900 tabular-nums">{fmt.number(tile.value)}</p>
                    <p className="text-xs text-slate-500">{tile.label}</p>
                  </div>
                ))}
              </div>

              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                Usable units by blood group
              </p>
              <div className="grid grid-cols-4 gap-2">
                {(data?.bloodByGroup ?? []).map((row) => {
                  const units = Number(row.availableUnits);
                  return (
                    <div key={row.bloodGroup}
                         className={`rounded-lg border p-2 text-center ${
                           units === 0 ? 'border-brand-200 bg-brand-50/60'
                                       : 'border-slate-200 bg-white'}`}>
                      <BloodChip group={row.bloodGroup} />
                      <p className={`mt-1 text-lg font-semibold tabular-nums ${units === 0 ? 'text-brand-700' : 'text-slate-900'}`}>
                        {units}
                      </p>
                    </div>
                  );
                })}
              </div>
            </DataState>
          </Card>
        </div>
      </section>

      {/* Organ availability */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-12">
        <h2 className="text-xl font-semibold text-slate-900">Organ availability overview</h2>
        <p className="text-sm text-slate-500 mt-1">Listed organs and open requests, by organ type.</p>
        <DataState loading={loading} error={error} onRetry={reload} loadingRows={3}>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(data?.organsByType ?? []).map((row) => (
              <div key={row.organTypeCode} className="card card-pad">
                <p className="font-medium text-slate-900">{row.organType}</p>
                <div className="mt-2 flex items-baseline gap-4">
                  <span>
                    <span className="text-2xl font-semibold text-organ-600 tabular-nums">{row.available}</span>
                    <span className="text-xs text-slate-500 ml-1">listed</span>
                  </span>
                  <span>
                    <span className="text-lg font-semibold text-slate-700 tabular-nums">{row.openRequests}</span>
                    <span className="text-xs text-slate-500 ml-1">waiting</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </DataState>
      </section>

      {/* How it works */}
      <section className="bg-white border-y border-slate-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12">
          <h2 className="text-xl font-semibold text-slate-900">How the network works</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n} className="card card-pad">
                <div className="flex items-center gap-2.5">
                  <span className="h-7 w-7 shrink-0 rounded-full bg-brand-600 text-white grid place-items-center text-sm font-semibold">
                    {step.n}
                  </span>
                  <h3 className="font-medium text-slate-900">{step.title}</h3>
                </div>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-14 text-center">
        <h2 className="text-2xl font-semibold text-slate-900">Every unit tracked. Nothing wasted.</h2>
        <p className="mt-2 text-slate-600 max-w-2xl mx-auto">
          Create an account to search availability, raise requests and follow them through matching,
          allocation and fulfilment.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 justify-center">
          <Link to="/register" className="btn-primary">Create an account</Link>
          <Link to="/login" className="btn-secondary">Sign in</Link>
        </div>
      </section>
    </>
  );
}
