import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Client } from "pg";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    let body: {
      password?: string;
      connectionString?: string;
    } = {};

    try {
      body = await request.json();
    } catch {
      // Body is optional if DATABASE_URL is set in env
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const projectRef =
      supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] || "";

    let connStr = body.connectionString || process.env.DATABASE_URL;

    if (!connStr) {
      if (!body.password) {
        return NextResponse.json(
          {
            error:
              "Missing database password or connection string. Please provide your Supabase database password or DATABASE_URL.",
          },
          { status: 400 }
        );
      }
      if (!projectRef) {
        return NextResponse.json(
          {
            error:
              "Could not determine Supabase project ref from NEXT_PUBLIC_SUPABASE_URL.",
          },
          { status: 400 }
        );
      }
      // Construct Supabase Postgres connection string
      const encodedPassword = encodeURIComponent(body.password);
      connStr = `postgresql://postgres.${projectRef}:${encodedPassword}@aws-0-asia-southeast-1.pooler.supabase.com:6543/postgres`;
    }

    const schemaPath = path.join(process.cwd(), "supabase", "consolidated_schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf-8");

    // Try connecting with pg
    // We try the direct host or pooler with SSL
    let client: Client;
    let connected = false;
    let lastError: Error | null = null;

    // List of candidate connection options
    const candidates: (string | { host: string; port: number; user: string; password?: string; database: string; ssl: { rejectUnauthorized: boolean } })[] = [];

    if (body.connectionString || process.env.DATABASE_URL) {
      candidates.push(connStr!);
    } else if (body.password) {
      // 1. Direct connection to db.<ref>.supabase.co:5432
      candidates.push({
        host: `db.${projectRef}.supabase.co`,
        port: 5432,
        user: "postgres",
        password: body.password,
        database: "postgres",
        ssl: { rejectUnauthorized: false },
      });
      // 2. Pooler port 6543 on db.<ref>.supabase.co
      candidates.push({
        host: `db.${projectRef}.supabase.co`,
        port: 6543,
        user: `postgres.${projectRef}`,
        password: body.password,
        database: "postgres",
        ssl: { rejectUnauthorized: false },
      });
      // 3. Fallback connection string
      candidates.push(connStr!);
    }

    let activeClient: Client | null = null;

    for (const config of candidates) {
      try {
        const c = typeof config === "string" 
          ? new Client({ connectionString: config, ssl: { rejectUnauthorized: false } })
          : new Client(config);
        await c.connect();
        activeClient = c;
        connected = true;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    if (!activeClient || !connected) {
      return NextResponse.json(
        {
          error: `Could not connect to PostgreSQL database: ${lastError?.message || "Connection refused"}. Please check your database password or use the Supabase SQL Editor.`,
        },
        { status: 400 }
      );
    }

    try {
      // Execute the consolidated schema
      await activeClient.query(sql);

      // Force PostgREST schema cache reload
      try {
        await activeClient.query("NOTIFY pgrst, 'reload schema';");
      } catch {
        // notification error is non-fatal
      }

      await activeClient.end();

      return NextResponse.json({
        success: true,
        message:
          "Successfully applied all database migrations and reloaded PostgREST schema cache!",
      });
    } catch (queryErr) {
      await activeClient.end();
      return NextResponse.json(
        {
          error: `Failed during schema execution: ${queryErr instanceof Error ? queryErr.message : String(queryErr)}`,
        },
        { status: 500 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Migration failed",
      },
      { status: 500 }
    );
  }
}
