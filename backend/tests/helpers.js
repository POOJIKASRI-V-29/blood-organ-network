import request from 'supertest';
import app from '../src/app.js';
import { query, queryOne, closePool } from '../src/config/db.js';

export const api = () => request(app);

export const CREDENTIALS = {
  admin:      { email: 'admin@bon.health',      password: 'Admin@123' },
  donor:      { email: 'donor@bon.health',      password: 'Password@123' },
  recipient:  { email: 'recipient@bon.health',  password: 'Password@123' },
  hospital:   { email: 'hospital@bon.health',   password: 'Password@123' },
  bloodBank:  { email: 'bloodbank@bon.health',  password: 'Password@123' },
  transplant: { email: 'transplant@bon.health', password: 'Password@123' },
};

const tokens = new Map();

/** Sign in once per role and cache the token for the rest of the run. */
export async function tokenFor(role) {
  if (tokens.has(role)) return tokens.get(role);
  const response = await api().post('/api/auth/login').send(CREDENTIALS[role]);
  if (response.status !== 200) {
    throw new Error(`Could not sign in as ${role}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  tokens.set(role, response.body.data.token);
  return tokens.get(role);
}

export async function authed(role) {
  const token = await tokenFor(role);
  return { Authorization: `Bearer ${token}` };
}

export { query, queryOne, closePool };
