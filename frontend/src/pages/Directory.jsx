import { useState } from 'react';
import { directoryApi } from '../services/api.js';
import { useApi, useDebounced } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  Badge, BloodChip, Card, DataState, PageHeader, Pagination, SearchInput, Select, fmt,
} from '../components/ui/index.jsx';
import { ROLES } from '../constants/index.js';

const TABS = [
  { key: 'hospitals', label: 'Hospitals', roles: 'ALL' },
  { key: 'bloodBanks', label: 'Blood banks', roles: 'ALL' },
  { key: 'transplantCenters', label: 'Transplant centres', roles: 'ALL' },
  { key: 'donors', label: 'Donors', roles: [ROLES.ADMIN, ROLES.BLOOD_BANK, ROLES.HOSPITAL] },
  { key: 'recipients', label: 'Patients', roles: [ROLES.ADMIN, ROLES.HOSPITAL, ROLES.TRANSPLANT_CENTER] },
];

export default function Directory() {
  const { hasRole, user } = useAuth();
  const toast = useToast();
  const tabs = TABS.filter((tab) => tab.roles === 'ALL' || tab.roles.includes(user?.role));
  const [tab, setTab] = useState(tabs[0]?.key ?? 'hospitals');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const isAdmin = hasRole(ROLES.ADMIN);

  const params = { page, limit: 15, ...(debounced && { search: debounced }) };
  const { data, loading, error, reload } = useApi(
    () => directoryApi[tab](params), [tab, JSON.stringify(params)]);

  const setStatus = async (kind, id, status) => {
    try {
      const fn = { hospitals: 'setHospitalStatus', bloodBanks: 'setBloodBankStatus', transplantCenters: 'setCenterStatus' }[kind];
      await directoryApi[fn](id, status);
      toast.success(`Status set to ${status}.`);
      reload();
    } catch (err) { toast.error(err.message); }
  };

  const switchTab = (key) => { setTab(key); setPage(1); setSearch(''); };

  return (
    <>
      <PageHeader title="Network directory"
                  subtitle="Every institution and participant registered on the network." />

      <div className="flex flex-wrap gap-1 mb-4 border-b border-slate-200">
        {tabs.map((item) => (
          <button key={item.key} onClick={() => switchTab(item.key)}
                  className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition ${
                    tab === item.key
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {item.label}
          </button>
        ))}
      </div>

      <Card className="mb-4">
        <SearchInput value={search} onChange={(v) => { setPage(1); setSearch(v); }}
                     placeholder={`Search ${tabs.find((t) => t.key === tab)?.label.toLowerCase()}…`}
                     className="max-w-md" />
      </Card>

      <Card>
        <DataState loading={loading} error={error} onRetry={reload} empty={!data?.rows?.length} loadingRows={6}
                   emptyProps={{ icon: '🏥', title: 'Nothing found', message: 'No records match this search.' }}>
          <div className="table-wrap">
            {tab === 'hospitals' && (
              <table className="table">
                <thead><tr><th>Name</th><th>Registration no.</th><th>City</th><th>Phone</th>
                           <th className="text-right">Beds</th><th>Status</th>{isAdmin && <th></th>}</tr></thead>
                <tbody>
                  {(data?.rows ?? []).map((row) => (
                    <tr key={row.hospitalId}>
                      <td className="font-medium text-slate-800">{row.name}</td>
                      <td className="font-mono text-xs text-slate-600">{row.registrationNumber}</td>
                      <td className="text-slate-600">{row.city}, {row.state}</td>
                      <td className="text-slate-600">{row.phone}</td>
                      <td className="text-right tabular-nums text-slate-600">{row.bedCapacity ?? '—'}</td>
                      <td><Badge value={row.status} /></td>
                      {isAdmin && (
                        <td>
                          <Select value={row.status} placeholder={null} className="text-xs"
                                  onChange={(e) => setStatus('hospitals', row.hospitalId, e.target.value)}
                                  options={[{ value: 'PENDING', label: 'Pending' }, { value: 'ACTIVE', label: 'Active' },
                                            { value: 'SUSPENDED', label: 'Suspended' }]} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'bloodBanks' && (
              <table className="table">
                <thead><tr><th>Name</th><th>Registration no.</th><th>City</th><th>Phone</th>
                           <th className="text-right">Units in stock</th><th>Status</th>{isAdmin && <th></th>}</tr></thead>
                <tbody>
                  {(data?.rows ?? []).map((row) => (
                    <tr key={row.bloodBankId}>
                      <td className="font-medium text-slate-800">{row.name}</td>
                      <td className="font-mono text-xs text-slate-600">{row.registrationNumber}</td>
                      <td className="text-slate-600">{row.city}, {row.state}</td>
                      <td className="text-slate-600">{row.phone}</td>
                      <td className="text-right tabular-nums font-medium">{row.availableUnits}</td>
                      <td><Badge value={row.status} /></td>
                      {isAdmin && (
                        <td>
                          <Select value={row.status} placeholder={null}
                                  onChange={(e) => setStatus('bloodBanks', row.bloodBankId, e.target.value)}
                                  options={[{ value: 'PENDING', label: 'Pending' }, { value: 'ACTIVE', label: 'Active' },
                                            { value: 'SUSPENDED', label: 'Suspended' }]} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'transplantCenters' && (
              <table className="table">
                <thead><tr><th>Name</th><th>Licence</th><th>Host hospital</th><th>City</th>
                           <th className="text-right">Organs held</th><th>Status</th>{isAdmin && <th></th>}</tr></thead>
                <tbody>
                  {(data?.rows ?? []).map((row) => (
                    <tr key={row.centerId}>
                      <td className="font-medium text-slate-800">{row.name}</td>
                      <td className="font-mono text-xs text-slate-600">{row.licenseNumber}</td>
                      <td className="text-slate-600">{row.hospitalName}</td>
                      <td className="text-slate-600">{row.city}</td>
                      <td className="text-right tabular-nums font-medium">{row.organsHeld}</td>
                      <td><Badge value={row.status} /></td>
                      {isAdmin && (
                        <td>
                          <Select value={row.status} placeholder={null}
                                  onChange={(e) => setStatus('transplantCenters', row.centerId, e.target.value)}
                                  options={[{ value: 'PENDING', label: 'Pending' }, { value: 'ACTIVE', label: 'Active' },
                                            { value: 'SUSPENDED', label: 'Suspended' }]} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'donors' && (
              <table className="table">
                <thead><tr><th>Donor</th><th>Group</th><th>City</th><th className="text-right">Age</th>
                           <th className="text-right">Donations</th><th className="text-right">Volume</th>
                           <th>Last donated</th><th>Eligibility</th><th>Organ donor</th></tr></thead>
                <tbody>
                  {(data?.rows ?? []).map((row) => (
                    <tr key={row.donorId}>
                      <td className="font-medium text-slate-800">{row.donorName}</td>
                      <td><BloodChip group={row.bloodGroup} /></td>
                      <td className="text-slate-600">{row.city}</td>
                      <td className="text-right tabular-nums text-slate-600">{row.age}</td>
                      <td className="text-right tabular-nums font-medium">{row.totalDonations}</td>
                      <td className="text-right tabular-nums text-slate-600">{fmt.ml(row.totalVolumeMl)}</td>
                      <td className="text-slate-600">{fmt.date(row.lastDonationDate)}</td>
                      <td><Badge value={row.eligibilityStatus} /></td>
                      <td>{Number(row.isOrganDonor) === 1
                        ? <Badge value={row.organConsentStatus} tone="teal" />
                        : <span className="text-slate-400">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'recipients' && (
              <table className="table">
                <thead><tr><th>Patient</th><th>Group</th><th>City</th><th className="text-right">Age</th>
                           <th className="text-right">Blood requests</th><th className="text-right">Organ requests</th>
                           <th>Clinical notes</th></tr></thead>
                <tbody>
                  {(data?.rows ?? []).map((row) => (
                    <tr key={row.recipientId}>
                      <td className="font-medium text-slate-800">{row.recipientName}</td>
                      <td><BloodChip group={row.bloodGroup} /></td>
                      <td className="text-slate-600">{row.city}</td>
                      <td className="text-right tabular-nums text-slate-600">{row.age}</td>
                      <td className="text-right tabular-nums">{row.bloodRequests}</td>
                      <td className="text-right tabular-nums">{row.organRequests}</td>
                      <td className="text-slate-500 text-xs max-w-sm truncate">{row.medicalNotes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Pagination meta={data?.meta} onPage={setPage} />
        </DataState>
      </Card>
    </>
  );
}
