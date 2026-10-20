import mysql from 'mysql2/promise';
import env from './env.js';

/**
 * A single shared connection pool.  Every query in the application goes through
 * here, and every one of them is parameterised -- string concatenation of user
 * input into SQL does not appear anywhere in this codebase.
 */
export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: env.db.connectionLimit,
  queueLimit: 0,
  multipleStatements: false,   // defence in depth against stacked-query injection
  dateStrings: ['DATE'],       // keep DATE columns as 'YYYY-MM-DD', no TZ drift
  timezone: 'Z',
});

/** Run a parameterised query and return the rows. */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Run a query and return only the first row (or null). */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

/**
 * Call a stored procedure.  mysql2 returns an array of result sets; the last
 * element is the OK packet, so the caller usually wants element 0.
 */
export async function callProcedure(sql, params = []) {
  const [resultSets] = await pool.query(sql, params);
  return resultSets;
}

/**
 * Run `fn` inside a transaction on a dedicated connection.
 * Commits on success, rolls back on any thrown error, always releases.
 *
 * Used for multi-statement writes that must be atomic -- see
 * services/bloodService.js (issuing units) and services/organService.js
 * (accepting a match).  Single-statement writes do not need this; MySQL
 * already makes them atomic.
 */
export async function withTransaction(fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function healthCheck() {
  const row = await queryOne('SELECT DATABASE() AS db, VERSION() AS version');
  return row;
}

export async function closePool() {
  await pool.end();
}
