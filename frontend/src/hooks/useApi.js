import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Run an async loader and expose { data, loading, error, reload }.
 *
 * Every list and detail page in the app uses this, which is why loading,
 * empty and error states are handled consistently everywhere.
 * `deps` works like a useEffect dependency array.
 */
export function useApi(loader, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  const run = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loader();
      // Ignore a response that a newer request has already superseded.
      if (current === requestId.current) setData(result);
    } catch (err) {
      if (current === requestId.current) setError(err.message || 'Something went wrong');
    } finally {
      if (current === requestId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); }, [run]);

  return { data, loading, error, reload: run, setData };
}

/** Debounce a rapidly-changing value (search boxes). */
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
