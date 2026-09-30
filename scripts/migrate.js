const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const envPath = path.join(process.cwd(), '.env.local');
  let env = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        env[match[1]] = (match[2] || '').trim();
      }
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
  const projectRef = supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] || '';
  const password = process.argv[2] || process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD;
  let connStr = process.env.DATABASE_URL || env.DATABASE_URL;

  if (!connStr && !password) {
    console.error('Error: Please provide your database password as an argument or set DATABASE_URL:');
    console.error('Usage: node scripts/migrate.js <your-supabase-db-password>');
    process.exit(1);
  }

  const schemaPath = path.join(process.cwd(), 'supabase', 'consolidated_schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error(`Error: Schema file not found at ${schemaPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');

  const configs = [];
  if (connStr) {
    configs.push(connStr);
  }
  if (password && projectRef) {
    configs.push({
      host: `db.${projectRef}.supabase.co`,
      port: 5432,
      user: 'postgres',
      password: password,
      database: 'postgres',
      ssl: { rejectUnauthorized: false }
    });
    configs.push({
      host: `db.${projectRef}.supabase.co`,
      port: 6543,
      user: `postgres.${projectRef}`,
      password: password,
      database: 'postgres',
      ssl: { rejectUnauthorized: false }
    });
  }

  let client = null;
  for (const cfg of configs) {
    try {
      console.log('Attempting connection to PostgreSQL...');
      const c = typeof cfg === 'string' ? new Client({ connectionString: cfg, ssl: { rejectUnauthorized: false } }) : new Client(cfg);
      await c.connect();
      client = c;
      console.log('Connected successfully!');
      break;
    } catch (err) {
      console.warn('Connection failed:', err.message);
    }
  }

  if (!client) {
    console.error('Failed to connect to Postgres database with the provided credentials.');
    process.exit(1);
  }

  try {
    console.log(`Executing schema (${sql.split('\n').length} lines)...`);
    await client.query(sql);
    console.log('Schema applied successfully!');

    console.log('Reloading PostgREST schema cache...');
    await client.query("NOTIFY pgrst, 'reload schema';");
    console.log('Schema cache reloaded! All done.');
  } catch (err) {
    console.error('Migration execution failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
