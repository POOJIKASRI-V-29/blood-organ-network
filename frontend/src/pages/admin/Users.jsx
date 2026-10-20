import { useState } from 'react';
import { directoryApi, bloodApi } from '../../services/api.js';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Badge, Card, ConfirmDialog, DataState, PageHeader, Pagination, SearchInput, Select, fmt,
} from '../../components/ui/index.jsx';
import { ROLE_LABELS } from '../../constants/index.js';

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));
const STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'];

export default function AdminUsers() {
  const toast = useToast();
  const [filters, setFilters] = useState({ role: '', status: '' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const debounced = useDebounced(search);

  const params = {
    page, limit: 15,
    ...(filters.role && { role: filters.role }),
    ...(filters.status && { status: filters.status }),
    ...(debounced && { search: debounced }),
  };
  const { data, loading, error, reload } = useApi(() => directoryApi.users(params), [JSON.stringify(params)]);
  const set = (key) => (e) => { setPage(1); setFilters((f) => ({ ...f, [key]: e.target.value })); };

  const changeStatus = async (userId, status) => {
    try {
      await directoryApi.setUserStatus(userId, status);
      toast.success(`Account set to ${status}.`);
      reload();
    } catch (err) { toast.error(err.message); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await directoryApi.deleteUser(confirm.userId);
      toast.success('Account deleted.');
      setConfirm(null);
      reload();
    } catch (err) {
      toast.error(err.message);
      setConfirm(null);
    } finally { setBusy(false); }
  };

  const runHousekeeping = async () => {
    try {
      const result = await bloodApi.runExpiry();
      toast.success(
        `Housekeeping complete: ${result.unitsExpired} unit(s), ${result.organsExpired} organ(s), ` +
        `${result.requestsExpired} request(s) retired.`);
    } catch (err) { toast.error(err.message); }
  };

  return (
    <>
      <PageHeader title="Manage users"
                  subtitle="Approve registrations, suspend accounts and run network housekeeping."
                  actions={<button className="btn-secondary btn-sm" onClick={runHousekeeping}>Run expiry housekeeping</button>} />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SearchInput value={search} onChange={(v) => { setPage(1); setSearch(v); }} placeholder="Name or email…" />
          <Select value={filters.role} onChange={set('role')} placeholder="All roles" options={ROLE_OPTIONS} />
          <Select value={filters.status} onChange={set('status')} placeholder="All statuses"
                  options={STATUSES.map((s) => ({ value: s, label: s }))} />
        </div>
      </Card>

      <Card>
        <DataState loading={loading} error={error} onRetry={reload} empty={!data?.rows?.length} loadingRows={8}
                   emptyProps={{ icon: '👥', title: 'No users found' }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Registered</th>
                    <th>Last sign-in</th><th>Change status</th><th></th></tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((row) => (
                  <tr key={row.userId}>
                    <td className="font-medium text-slate-800">{row.fullName}</td>
                    <td className="text-slate-600 font-mono text-xs">{row.email}</td>
                    <td className="text-slate-600">{ROLE_LABELS[row.role] ?? row.role}</td>
                    <td><Badge value={row.status} /></td>
                    <td className="text-slate-500 text-xs">{fmt.date(row.createdAt)}</td>
                    <td className="text-slate-500 text-xs">{row.lastLoginAt ? fmt.dateTime(row.lastLoginAt) : 'Never'}</td>
                    <td>
                      <Select value={row.status} placeholder={null}
                              onChange={(e) => changeStatus(row.userId, e.target.value)}
                              options={STATUSES.map((s) => ({ value: s, label: s }))} />
                    </td>
                    <td>
                      <button className="btn-danger btn-sm"
                              onClick={() => setConfirm({ userId: row.userId, name: row.fullName })}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={data?.meta} onPage={setPage} />
        </DataState>
      </Card>

      <ConfirmDialog
        open={Boolean(confirm)} busy={busy}
        title="Delete this account?"
        message={`This permanently removes ${confirm?.name}'s account and profile. Accounts with donation history cannot be deleted — the database refuses it, because medical records must survive. Suspend the account instead.`}
        confirmLabel="Delete account"
        onCancel={() => setConfirm(null)} onConfirm={remove}
      />
    </>
  );
}
