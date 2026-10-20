import { query, queryOne } from '../config/db.js';
import { getPagination } from '../utils/pagination.js';
import ApiError from '../utils/ApiError.js';

export async function list(userId, queryParams) {
  const { page, limit, offset } = getPagination(queryParams);
  const onlyUnread = String(queryParams.unread ?? '') === 'true';
  const where = onlyUnread ? 'WHERE user_id = ? AND is_read = FALSE' : 'WHERE user_id = ?';

  const rows = await query(
    `SELECT notification_id AS notificationId, title, message, type,
            entity_name AS entityName, entity_id AS entityId,
            is_read AS isRead, created_at AS createdAt
       FROM notifications ${where}
      ORDER BY created_at DESC, notification_id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    [userId],
  );
  const countRow = await queryOne(`SELECT COUNT(*) AS total FROM notifications ${where}`, [userId]);
  return { rows, page, limit, total: countRow.total };
}

export async function unreadCount(userId) {
  // Answered entirely from idx_notif_user_read -- this runs on every page load.
  const row = await queryOne(
    'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = FALSE', [userId],
  );
  return { unread: row.unread };
}

export async function markRead(notificationId, userId) {
  const row = await queryOne(
    'SELECT user_id FROM notifications WHERE notification_id = ?', [notificationId],
  );
  if (!row) throw ApiError.notFound('Notification not found');
  if (row.user_id !== userId) throw ApiError.forbidden('That notification belongs to another account');

  await query('UPDATE notifications SET is_read = TRUE WHERE notification_id = ?', [notificationId]);
  return { notificationId, isRead: true };
}

export async function markAllRead(userId) {
  const result = await query(
    'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE', [userId],
  );
  return { updated: result.affectedRows ?? 0 };
}
