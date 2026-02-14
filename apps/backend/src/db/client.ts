import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const connectionTimeoutMillis = toPositiveInt(process.env.DB_CONNECTION_TIMEOUT_MS, 15_000);
const idleTimeoutMillis = toPositiveInt(process.env.DB_IDLE_TIMEOUT_MS, 30_000);
const maxPoolSize = toPositiveInt(process.env.DB_POOL_MAX, 20);
const shouldUseSsl = Boolean(
    connectionString
    && (
        connectionString.includes('sslmode=require')
        || connectionString.includes('supabase.co')
        || connectionString.includes('pooler.supabase.com')
    )
);

const pool = new Pool({
    connectionString,
    max: maxPoolSize,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
});

// Test connection
pool.on('connect', () => {
    console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

export default pool;

function toPositiveInt(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }

    return parsed;
}
