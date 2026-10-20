import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);
let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((message, tone = 'info', timeout = 4500) => {
    const id = nextId++;
    setToasts((current) => [...current, { id, message, tone }]);
    if (timeout) setTimeout(() => dismiss(id), timeout);
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({
    toast: {
      success: (message) => push(message, 'success'),
      error:   (message) => push(message, 'error', 6500),
      info:    (message) => push(message, 'info'),
      warn:    (message) => push(message, 'warning'),
    },
  }), [push]);

  const tones = {
    success: 'bg-emerald-600',
    error:   'bg-brand-600',
    warning: 'bg-amber-600',
    info:    'bg-slate-800',
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(22rem,calc(100vw-2rem))]"
           role="status" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id}
               className={`${tones[item.tone]} text-white rounded-lg shadow-pop px-4 py-3 text-sm flex items-start gap-3 animate-slide-in`}>
            <span className="flex-1">{item.message}</span>
            <button onClick={() => dismiss(item.id)} aria-label="Dismiss"
                    className="opacity-70 hover:opacity-100 leading-none text-lg">&times;</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context.toast;
}
