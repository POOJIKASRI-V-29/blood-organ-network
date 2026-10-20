import { useState } from 'react';
import { directoryApi } from '../services/api.js';
import { useApi } from '../hooks/useApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { Badge, Card, DataState, PageHeader, Pagination, fmt } from '../components/ui/index.jsx';

export default function Notifications() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const params = { page, limit: 20, ...(unreadOnly && { unread: 'true' }) };
  const { data, loading, error, reload } = useApi(() => directoryApi.notifications(params), [JSON.stringify(params)]);

  const refreshBadge = () => window.dispatchEvent(new CustomEvent('bon:notifications-changed'));

  const markOne = async (id) => {
    try { await directoryApi.markRead(id); reload(); refreshBadge(); }
    catch (err) { toast.error(err.message); }
  };

  const markAll = async () => {
    try {
      const result = await directoryApi.markAllRead();
      toast.success(`${result.updated} notification(s) marked as read.`);
      reload(); refreshBadge();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Most of these are generated inside the database, in the same transaction as the change they describe."
        actions={(
          <>
            <button className={unreadOnly ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                    onClick={() => { setPage(1); setUnreadOnly((v) => !v); }}>
              {unreadOnly ? 'Showing unread' : 'Show unread only'}
            </button>
            <button className="btn-secondary btn-sm" onClick={markAll}>Mark all read</button>
          </>
        )}
      />

      <Card>
        <DataState loading={loading} error={error} onRetry={reload} empty={!data?.rows?.length} loadingRows={6}
                   emptyProps={{ icon: '🔔', title: unreadOnly ? 'No unread notifications' : 'No notifications yet',
                                 message: 'Updates about your requests, donations and matches will appear here.' }}>
          <ul className="divide-y divide-slate-100 -my-1">
            {(data?.rows ?? []).map((item) => (
              <li key={item.notificationId}
                  className={`py-3 flex items-start gap-3 ${item.isRead ? '' : 'bg-brand-50/30 -mx-4 sm:-mx-5 px-4 sm:px-5'}`}>
                <Badge value={item.type} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${item.isRead ? 'text-slate-700' : 'text-slate-900 font-medium'}`}>
                    {item.title}
                  </p>
                  <p className="text-sm text-slate-600 mt-0.5">{item.message}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {fmt.dateTime(item.createdAt)}
                    {item.entityName && <span> · {item.entityName}{item.entityId ? ` #${item.entityId}` : ''}</span>}
                  </p>
                </div>
                {!item.isRead && (
                  <button className="btn-ghost btn-sm shrink-0" onClick={() => markOne(item.notificationId)}>
                    Mark read
                  </button>
                )}
              </li>
            ))}
          </ul>
          <Pagination meta={data?.meta} onPage={setPage} />
        </DataState>
      </Card>
    </>
  );
}
