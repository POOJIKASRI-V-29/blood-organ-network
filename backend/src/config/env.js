import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

/** Read a variable, falling back to a default; throw if neither exists. */
function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}. Copy .env.example to .env.`);
  }
  return value;
}

const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),

  db: {
    host: required('DB_HOST', '127.0.0.1'),
    port: Number(required('DB_PORT', '3306')),
    user: required('DB_USER', 'root'),
    password: process.env.DB_PASSWORD ?? '',
    database: required('DB_NAME', 'blood_organ_network'),
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 10),
  },

  jwt: {
    secret: required('JWT_SECRET', 'dev_only_insecure_secret_change_me'),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  },

  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 10),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
};

export const isProduction = env.nodeEnv === 'production';

if (isProduction && env.jwt.secret.startsWith('dev_only')) {
  throw new Error('JWT_SECRET must be set to a real secret in production.');
}

export default env;
