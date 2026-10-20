import { useState } from 'react';
import { referenceApi } from '../services/api.js';
import { useReference } from '../context/ReferenceContext.jsx';
import { useApi } from '../hooks/useApi.js';
import { BloodChip, Card, DataState, Disclaimer, PageHeader, Select } from '../components/ui/index.jsx';

const ORDER = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];

/**
 * Renders the blood_compatibility table straight from the database, so the
 * matrix shown to users is provably the same data the matching engine joins on.
 */
export default function Compatibility() {
  const { bloodComponents } = useReference();
  const [componentId, setComponentId] = useState(2);   // packed red cells
  const { data, loading, error, reload } = useApi(() => referenceApi.compatibility(componentId), [componentId]);

  const lookup = {};
  (data ?? []).forEach((row) => { lookup[`${row.donorGroup}|${row.recipientGroup}`] = row; });
  const component = data?.[0];

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
      <PageHeader
        title="Blood compatibility matrix"
        subtitle="Generated from the blood_groups antigen flags and stored in the blood_compatibility relation. The matching engine joins against exactly this table."
      />

      <Card
        title={component ? component.componentName : 'Compatibility'}
        subtitle={component
          ? (component.matchDirection === 'PLASMA'
              ? 'Plasma carries donor ANTIBODIES, so the ABO rule is reversed: AB is the universal plasma donor.'
              : 'Cellular components carry donor ANTIGENS: O− is the universal red cell donor.')
          : undefined}
        actions={(
          <Select value={componentId} placeholder={null}
                  onChange={(e) => setComponentId(Number(e.target.value))}
                  options={bloodComponents.map((c) => ({ value: c.componentId, label: c.name }))} />
        )}
      >
        <DataState loading={loading} error={error} onRetry={reload} loadingRows={6}>
          <div className="table-wrap">
            <table className="table min-w-[34rem]">
              <caption className="sr-only">
                Rows are donor blood groups, columns are recipient blood groups.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 bg-slate-50 z-10">Donor ↓ / Recipient →</th>
                  {ORDER.map((group) => <th key={group} scope="col" className="text-center">{group}</th>)}
                </tr>
              </thead>
              <tbody>
                {ORDER.map((donor) => (
                  <tr key={donor}>
                    <th scope="row" className="sticky left-0 bg-white z-10 px-3 py-2.5 border-b border-slate-100">
                      <BloodChip group={donor} />
                    </th>
                    {ORDER.map((recipient) => {
                      const cell = lookup[`${donor}|${recipient}`];
                      const okay = cell?.isCompatible;
                      return (
                        <td key={recipient} className="text-center" title={cell?.ruleNote ?? ''}>
                          {okay ? (
                            <span className="inline-grid place-items-center h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs">✓</span>
                          ) : (
                            <span className="inline-grid place-items-center h-6 w-6 rounded-full bg-slate-100 text-slate-300 text-xs">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint mt-3">Hover any cell to see the rule the database recorded for that pair.</p>
        </DataState>
      </Card>

      <Disclaimer className="mt-5" />
    </div>
  );
}
