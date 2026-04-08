import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:pwd@localhost:5432/modelscope_db',
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err.message);
});

export default pool;
