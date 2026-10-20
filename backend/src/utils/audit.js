import { query } from '../config/db.js';

/**
 * Write an API-originated audit row.  Database triggers write their own rows
 * with source='TRIGGER'; this function is for actions that have no single
 * table write to hang a trigger on (logins, searches, exports).
 *
 * Auditing must never break the request it is auditing, so failures are logged
 * and swallowed rather than propagated.
 */
export async function recordAudit({ userId = null, action, entityName, entityId = null, description = null, ipAddress = null }) {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, entity_name, entity_id, description, source, ip_address)
       VALUES (?, ?, ?, ?, ?, 'API', ?)`,
      [userId, action, entityName, entityId, description, ipAddress],
    );
  } catch (error) {
    console.error('[audit] failed to record audit entry:', error.message);
  }
}

/** Generate a human-readable, unique-per-day reference code, e.g. BR-20260915-0007. */
export async function nextRequestCode(prefix, table, column) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const row = await query(
    `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${column}\` LIKE ?`,
    [`${prefix}-${stamp}-%`],
  );
  const sequence = String((row[0]?.n ?? 0) + 1).padStart(4, '0');
  return `${prefix}-${stamp}-${sequence}`;
}
