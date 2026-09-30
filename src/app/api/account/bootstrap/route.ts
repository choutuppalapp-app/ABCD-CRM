import { NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createClient as createAdminSupabase } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (!serviceKey || !supabaseUrl) {
      return NextResponse.json(
        { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const admin = createAdminSupabase(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // Check if profiles table exists and if user already has a row
    const { data: existingProfile, error: profileCheckErr } = await admin
      .from("profiles")
      .select("id, account_id, account_role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileCheckErr) {
      return NextResponse.json(
        {
          error: `Database error checking profile: ${profileCheckErr.message}`,
        },
        { status: 500 }
      );
    }

    if (existingProfile && existingProfile.account_id && existingProfile.account_role) {
      return NextResponse.json({
        success: true,
        alreadyBootstrapped: true,
        profile: existingProfile,
      });
    }

    let accountId = existingProfile?.account_id;

    if (!accountId) {
      // Create new personal account
      const fullName =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email ||
        "My account";

      const { data: newAccount, error: accountErr } = await admin
        .from("accounts")
        .insert({
          name: fullName,
          owner_user_id: user.id,
        })
        .select("id")
        .single();

      if (accountErr || !newAccount) {
        return NextResponse.json(
          {
            error: `Failed to create account: ${accountErr?.message || "Unknown error"}`,
          },
          { status: 500 }
        );
      }
      accountId = newAccount.id;
    }

    // Upsert profile
    const fullName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      "";

    const { data: updatedProfile, error: upsertErr } = await admin
      .from("profiles")
      .upsert({
        user_id: user.id,
        email: user.email || "",
        full_name: fullName,
        account_id: accountId,
        account_role: "owner",
      })
      .select("id, account_id, account_role")
      .single();

    if (upsertErr) {
      return NextResponse.json(
        { error: `Failed to update profile: ${upsertErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      profile: updatedProfile,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bootstrap failed" },
      { status: 500 }
    );
  }
}
