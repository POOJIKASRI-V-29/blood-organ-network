import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { referenceApi } from '../services/api.js';

const ReferenceContext = createContext(null);

/**
 * Lookup tables (cities, blood groups, components, organ types) are fetched
 * once and shared, so every dropdown in the app is populated from the database
 * rather than from hardcoded arrays.
 */
export function ReferenceProvider({ children }) {
  const [data, setData] = useState({ cities: [], bloodGroups: [], bloodComponents: [], organTypes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    referenceApi.bootstrap()
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const value = useMemo(() => ({
    ...data,
    loading,
    error,
    bloodGroupById: Object.fromEntries(data.bloodGroups.map((g) => [g.bloodGroupId, g.groupCode])),
    componentById:  Object.fromEntries(data.bloodComponents.map((c) => [c.componentId, c.name])),
    cityById:       Object.fromEntries(data.cities.map((c) => [c.cityId, c.name])),
    organTypeById:  Object.fromEntries(data.organTypes.map((o) => [o.organTypeId, o.name])),
  }), [data, loading, error]);

  return <ReferenceContext.Provider value={value}>{children}</ReferenceContext.Provider>;
}

export function useReference() {
  const context = useContext(ReferenceContext);
  if (!context) throw new Error('useReference must be used inside a ReferenceProvider');
  return context;
}
