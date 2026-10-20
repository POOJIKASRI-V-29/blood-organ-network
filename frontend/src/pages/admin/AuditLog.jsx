import { useState } from 'react';
import { directoryApi } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { Badge, Card, DataState, PageHeader, Pagination, Select, fmt } from '../../components/ui/index.jsx';

const SOURCES = [
  { value: 'API', label: 'API (application code)' },
  { value: 'TRIGGER', label: 'TRIGGER (written by the database)' },
  { value: 'PROCEDURE', label: 'PROCEDURE (stored procedure)' },
];

export default function AuditLog() {
  const [source, setSource] = useState('');
  const [entityName, setEntityName] = useState('');
  const [page, setPage] = useState(1);

  const params = { page, limit: 25, ...(source && { source }), ...(entityName && { entityName }) };
  const { data, loading, error, reload } = useApi(() => directoryApi.auditLogs(params), [JSON.stringify(params)]);

  const ENTITIES = ['users', 'blood_units', 'blood_donations', 'blood_requests',
                    'organ_requests', 'organ_matches', 'available_organs', 'hospitals', 'system'];

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Immutable history of every significant change. Rows marked TRIGGER were written by the database itself, not by application code."
      />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select value={source} onChange={(e) => { setPage(1); setSource(e.target.value); }}
                  placeholder="All sources" options={SOURCES} />
          <Select value={entityName} onChange={(e) => { setPage(1); setEntityName(e.target.value); }}
                  placeholder="All entities" options={ENTITIES.map((e) => ({ value: e, label: e }))} />
        </div>
      </Card>

      <Card>
        <DataState loading={loading} error={error} onRetry={reload} empty={!data?.rows?.length} loadingRows={10}
                   emptyProps={{ icon: '🧾', title: 'No audit entries match these filters' }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>When</th><th>Source</th><th>Action</th><th>Entity</th><th>Description</th><th>By</th></tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((row) => (
                  <tr key={row.auditId}>
                    <td className="text-slate-500 text-xs whitespace-nowrap">{fmt.dateTime(row.createdAt)}</td>
                    <td>
                      <Badge value={row.source}
                             tone={row.source === 'TRIGGER' ? 'violet' : row.source === 'PROCEDURE' ? 'blue' : 'slate'} />
                    </td>
                    <td className="font-mono text-xs text-slate-700">{row.action}</td>
                    <td className="text-slate-600 text-xs">
                      {row.entityName}{row.entityId ? <span className="text-slate-400"> #{row.entityId}</span> : null}
                    </td>
                    <td className="text-slate-700">{row.description}</td>
                    <td className="text-slate-500 text-xs">{row.userName ?? <span className="italic">system</span>}</td>
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
