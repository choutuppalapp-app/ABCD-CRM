"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  TriangleAlert,
  Database,
  Copy,
  Check,
  ExternalLink,
  Play,
  KeyRound,
  Download,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

export function AccountAccessAlert() {
  const { accountStatus, accountStatusDetail, refreshProfile } = useAuth();
  const t = useTranslations("AccountAccess");
  const [retrying, setRetrying] = useState(false);

  // Direct migration state
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [dbPassword, setDbPassword] = useState("");
  const [migrating, setMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [showDirectRun, setShowDirectRun] = useState(false);

  if (accountStatus === "loading" || accountStatus === "ready") return null;

  const retry = async () => {
    setRetrying(true);
    try {
      await refreshProfile();
      toast.info("Refreshed account status");
    } finally {
      setRetrying(false);
    }
  };

  const isMissingSchema = Boolean(
    accountStatusDetail &&
      (accountStatusDetail.toLowerCase().includes("schema cache") ||
        accountStatusDetail.toLowerCase().includes("profiles") ||
        accountStatusDetail.includes("PGRST205") ||
        accountStatusDetail.includes("PGRST200"))
  );

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const projectRef =
    supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] || "";
  const sqlEditorUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/sql/new`
    : "https://supabase.com/dashboard";

  const handleCopySql = async () => {
    setCopying(true);
    try {
      const res = await fetch("/api/setup/schema?raw=1");
      if (!res.ok) throw new Error("Failed to fetch schema SQL");
      const sqlText = await res.text();
      await navigator.clipboard.writeText(sqlText);
      setCopied(true);
      toast.success("Consolidated SQL schema copied to clipboard! (5,200+ lines)");
      setTimeout(() => setCopied(false), 4000);
    } catch (err) {
      toast.error("Failed to copy SQL: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCopying(false);
    }
  };

  const handleRunMigration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbPassword) {
      setMigrationError("Please enter your Supabase database password.");
      return;
    }

    setMigrating(true);
    setMigrationError(null);

    try {
      const res = await fetch("/api/setup/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: dbPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Migration failed");
      }

      toast.success("Database schema created and synchronized successfully!");
      setDbPassword("");
      await refreshProfile();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMigrationError(msg);
      toast.error(msg);
    } finally {
      setMigrating(false);
    }
  };

  if (isMissingSchema) {
    return (
      <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 shadow-xs text-foreground">
        <div className="flex items-start gap-3.5">
          <div className="rounded-lg bg-amber-500/20 p-2 text-amber-600 dark:text-amber-400 mt-0.5">
            <Database className="h-5 w-5" />
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">
                  Supabase Database Setup Required
                </h3>
                {projectRef ? (
                  <span className="inline-flex items-center rounded-md bg-amber-500/20 px-2 py-0.5 font-mono text-xs font-medium text-amber-700 dark:text-amber-300">
                    Project: {projectRef}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Your Supabase project is connected, but the database tables (such as{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  public.profiles
                </code>
                ) have not been created yet.
              </p>
            </div>

            {/* Option 1: Supabase SQL Editor */}
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">
                  Recommended: Apply Schema in Supabase Dashboard
                </h4>
                <a
                  href="/api/setup/schema?download=1"
                  download="consolidated_schema.sql"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download .sql file
                </a>
              </div>

              <ol className="list-decimal list-inside space-y-1.5 text-xs text-muted-foreground pl-1">
                <li>
                  Click <strong>Copy Schema SQL</strong> below to grab the consolidated database script.
                </li>
                <li>
                  Open the <strong>Supabase SQL Editor</strong> for this project and paste the script.
                </li>
                <li>
                  Click <strong>Run</strong> in Supabase, then return here and click <strong>Verify & Reload</strong>.
                </li>
              </ol>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="default"
                  onClick={handleCopySql}
                  disabled={copying}
                  className="gap-1.5"
                >
                  {copying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : copied ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied ? "SQL Copied to Clipboard!" : "1. Copy Schema SQL"}
                </Button>

                <a
                  href={sqlEditorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({
                    size: "sm",
                    variant: "outline",
                    className: "gap-1.5",
                  })}
                >
                  <ExternalLink className="h-4 w-4" />
                  2. Open Supabase SQL Editor
                </a>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={retry}
                  disabled={retrying}
                  className="gap-1.5"
                >
                  {retrying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  3. Verify & Reload
                </Button>
              </div>
            </div>

            {/* Option 2: Direct Migration Toggle */}
            <div className="rounded-lg border bg-card/60 p-3.5">
              <button
                type="button"
                onClick={() => setShowDirectRun(!showDirectRun)}
                className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5" />
                  Alternative: Run Migration Directly Using Database Password
                </span>
                {showDirectRun ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>

              {showDirectRun && (
                <form onSubmit={handleRunMigration} className="mt-3 space-y-2.5 pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    Enter the database password you chose when creating your Supabase project. The app will connect directly to Postgres and execute the schema.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      type="password"
                      placeholder="Supabase Database Password"
                      value={dbPassword}
                      onChange={(e) => setDbPassword(e.target.value)}
                      disabled={migrating}
                      className="h-9 text-xs"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={migrating || !dbPassword}
                      className="gap-1.5 shrink-0"
                    >
                      {migrating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      Run Migration Now
                    </Button>
                  </div>
                  {migrationError && (
                    <p className="text-xs text-destructive font-mono break-all">
                      {migrationError}
                    </p>
                  )}
                </form>
              )}
            </div>

            {accountStatusDetail && (
              <div className="text-xs font-mono text-muted-foreground opacity-80">
                Original error: {accountStatusDetail}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Alert variant="destructive" className="mb-4">
      <TriangleAlert />
      <AlertTitle>
        {accountStatus === "unlinked" ? t("unlinkedTitle") : t("errorTitle")}
      </AlertTitle>
      <AlertDescription>
        {accountStatus === "unlinked" ? t("unlinkedBody") : t("errorBody")}
        {accountStatusDetail ? (
          <span className="mt-1 block font-mono text-xs opacity-70">
            {accountStatusDetail}
          </span>
        ) : null}
      </AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" onClick={retry} disabled={retrying}>
          {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t("retry")}
        </Button>
      </AlertAction>
    </Alert>
  );
}
