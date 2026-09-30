import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const isRaw = searchParams.get("raw") === "1" || searchParams.get("raw") === "true";
  const isDownload = searchParams.get("download") === "1" || searchParams.get("download") === "true";

  const schemaPath = path.join(process.cwd(), "supabase", "consolidated_schema.sql");
  let sql = "";
  try {
    sql = fs.readFileSync(schemaPath, "utf-8");
  } catch {
    return NextResponse.json(
      { error: "Could not read consolidated_schema.sql" },
      { status: 500 }
    );
  }

  if (isRaw || isDownload) {
    return new NextResponse(sql, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...(isDownload
          ? {
              "Content-Disposition":
                'attachment; filename="consolidated_schema.sql"',
            }
          : {}),
      },
    });
  }

  // Check current schema status in Supabase
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const projectRef =
    supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] || "";

  let initialized = false;
  let errorDetail: string | null = null;

  if (supabaseUrl && (serviceKey || anonKey)) {
    try {
      const client = createClient(supabaseUrl, serviceKey || anonKey, {
        auth: { persistSession: false },
      });
      const { data, error } = await client
        .from("profiles")
        .select("id")
        .limit(1);

      if (!error) {
        initialized = true;
      } else {
        errorDetail = error.message;
      }
    } catch (e) {
      errorDetail = e instanceof Error ? e.message : "Unknown connection error";
    }
  }

  return NextResponse.json({
    initialized,
    projectRef,
    supabaseUrl,
    errorDetail,
    sqlLines: sql.split("\n").length,
    sqlSize: sql.length,
    sqlEditorUrl: projectRef
      ? `https://supabase.com/dashboard/project/${projectRef}/sql/new`
      : "https://supabase.com/dashboard",
    schemaPath: "supabase/consolidated_schema.sql",
  });
}
