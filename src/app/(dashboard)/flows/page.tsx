"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Workflow,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  MessageSquare,
  PlayCircle,
  PauseCircle,
  Archive,
  HelpCircle,
  UserPlus,
  FileText,
  Upload,
} from "lucide-react";

import { useTranslations } from "next-intl";
import { useCan } from "@/hooks/use-can";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FlowImportModal } from "@/components/flows/flow-import-modal";

/**
 * Flows list page.
 *
 * Open to every authenticated user. Flows is in soft-GA — the "Beta"
 * chip in the header is the only remaining signal that the surface
 * is new. The previous per-account beta gate was removed in PR #134.
 */

interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: { keywords?: string[] } | Record<string, unknown>;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS = (t: ReturnType<typeof useTranslations>): Record<FlowRow["status"], string> => ({
  draft: t("statusDraft"),
  active: t("statusActive"),
  archived: t("statusArchived"),
});

const STATUS_COLORS: Record<FlowRow["status"], string> = {
  draft: "border-border bg-muted text-muted-foreground",
  active: "border-emerald-600/40 bg-emerald-500/10 text-emerald-300",
  archived: "border-border bg-muted/50 text-muted-foreground",
};

interface TemplateSummary {
  slug: string;
  name: string;
  description: string;
  icon: "MessageSquare" | "HelpCircle" | "UserPlus";
  trigger_type: string;
  node_count: number;
}

const TEMPLATE_ICONS = {
  MessageSquare,
  HelpCircle,
  UserPlus,
} as const;

export default function FlowsPage() {
  const router = useRouter();
  const canCreate = useCan("send-messages");
  const t = useTranslations("Flows.list");
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [importOpen, setImportOpen] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FlowRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadFlows = async () => {
    try {
      const [flowsRes, tmplRes] = await Promise.all([
        fetch("/api/flows"),
        fetch("/api/flows/templates"),
      ]);
      if (flowsRes.ok) {
        const flowsJson = (await flowsRes.json()) as { flows: FlowRow[] };
        const fetchedFlows = flowsJson.flows ?? [];
        setFlows(fetchedFlows);
        setSelected((prev) => {
          const ids = new Set(fetchedFlows.map((f) => f.id));
          const next = new Set<string>();
          for (const id of prev) {
            if (ids.has(id)) next.add(id);
          }
          return next;
        });
      }
      if (tmplRes.ok) {
        const tmplJson = (await tmplRes.json()) as {
          templates: TemplateSummary[];
        };
        setTemplates(tmplJson.templates ?? []);
      }
    } catch (err) {
      console.error(err);
      toast.error(t("loadError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFlows();
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          trigger_type: "keyword",
          trigger_config: { keywords: [] },
        }),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      setNewName("");
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      console.error(err);
      toast.error(t("createError"));
    } finally {
      setCreating(false);
    }
  }

  async function handleUseTemplate(slug: string) {
    setCreating(true);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_slug: slug }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Clone failed: ${res.status}`);
      }
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("cloneError");
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function confirmSingleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/flows/${pendingDelete.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setFlows((prev) => prev.filter((f) => f.id !== pendingDelete.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(pendingDelete.id);
        return next;
      });
      toast.success(t("deleteSuccess"));
      setPendingDelete(null);
    } catch (err) {
      console.error(err);
      toast.error(t("deleteError"));
    } finally {
      setDeleting(false);
    }
  }

  async function confirmBulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/flows/${id}`, { method: "DELETE" }).then((r) => r.ok),
        ),
      );
      const successCount = results.filter(Boolean).length;
      if (successCount > 0) {
        toast.success(t("bulkDeleteSuccess", { count: successCount }));
      } else {
        toast.error(t("bulkDeleteError"));
      }
      setSelected(new Set());
      setBulkDeleteOpen(false);
      loadFlows();
    } catch {
      toast.error(t("bulkDeleteError"));
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelectAll() {
    if (flows.length === 0) return;
    if (selected.size === flows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(flows.map((f) => f.id)));
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const allSelected = flows.length > 0 && selected.size === flows.length;
  const isIndeterminate = selected.size > 0 && selected.size < flows.length;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
            <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
              {t("beta")}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GatedButton
            variant="outline"
            canAct={canCreate}
            gateReason="create flows"
            onClick={() => setImportOpen(true)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            <Upload className="h-4 w-4" />
            Import CSV
          </GatedButton>
          <GatedButton
            canAct={canCreate}
            gateReason="create flows"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />
            {t("newFlow")}
          </GatedButton>
        </div>
      </header>

      {flows.length === 0 ? (
        <EmptyState
          onCreate={() => setCreateOpen(true)}
          canCreate={canCreate}
          t={t}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border bg-card/60 px-4 py-2.5">
            <div className="flex items-center gap-3">
              <Checkbox
                checked={allSelected}
                indeterminate={isIndeterminate}
                onCheckedChange={toggleSelectAll}
                aria-label={t("selectAll")}
              />
              <span className="text-xs font-medium text-muted-foreground">
                {selected.size > 0
                  ? t("selectedCount", { count: selected.size })
                  : t("selectAll")}
              </span>
            </div>
            {selected.size > 0 && (
              <GatedButton
                size="sm"
                variant="destructive"
                canAct={canCreate}
                gateReason="delete flows"
                onClick={() => setBulkDeleteOpen(true)}
                className="h-8 gap-1.5 px-3 text-xs"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("deleteSelected", { count: selected.size })}
              </GatedButton>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {flows.map((flow) => (
              <FlowCard
                key={flow.id}
                flow={flow}
                selected={selected.has(flow.id)}
                onSelectChange={() => toggleSelect(flow.id)}
                onEdit={() => router.push(`/flows/${flow.id}`)}
                onDelete={() => setPendingDelete(flow)}
                t={t}
              />
            ))}
          </div>
        </div>
      )}

      {/* Single Delete Dialog */}
      <Dialog open={!!pendingDelete} onOpenChange={(v) => !v && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delete")}</DialogTitle>
            <DialogDescription>
              {t("deleteConfirm", { name: pendingDelete?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmSingleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Dialog */}
      <Dialog open={bulkDeleteOpen} onOpenChange={(v) => !v && setBulkDeleteOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("bulkDeleteTitle", { count: selected.size })}</DialogTitle>
            <DialogDescription>
              {t("bulkDeleteDesc", { count: selected.size })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={deleting}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmBulkDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t("deleteSelected", { count: selected.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-4xl bg-popover text-popover-foreground">
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t("createDesc")}
            </DialogDescription>
          </DialogHeader>

          {templates.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("startTemplate")}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((template) => {
                  const Icon = TEMPLATE_ICONS[template.icon] ?? FileText;
                  return (
                    <button
                      key={template.slug}
                      type="button"
                      onClick={() => handleUseTemplate(template.slug)}
                      disabled={creating}
                      className="flex flex-col gap-2.5 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted disabled:opacity-50"
                    >
                      <Icon className="h-5 w-5 text-primary" />
                      <span className="text-sm font-semibold text-popover-foreground">
                        {template.name}
                      </span>
                      <span className="text-xs leading-relaxed text-muted-foreground">
                        {template.description}
                      </span>
                      <span className="mt-auto border-t border-border pt-2 text-[11px] text-muted-foreground">
                        {t("nodeCount", { count: template.node_count })}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("startBlank")}
            </p>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("placeholderName")}
              className="bg-muted"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              {t("cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("createBlank")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FlowImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => loadFlows()}
      />
    </div>
  );
}

function EmptyState({
  onCreate,
  canCreate,
  t,
}: {
  onCreate: () => void;
  canCreate: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Workflow className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-base font-medium text-foreground">
        {t("emptyTitle")}
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {t("emptyDesc")}
      </p>
      <GatedButton
        canAct={canCreate}
        gateReason="create flows"
        onClick={onCreate}
        className="mt-5"
      >
        <Plus className="h-4 w-4" />
        {t("createFirst")}
      </GatedButton>
    </div>
  );
}

function FlowCard({
  flow,
  selected,
  onSelectChange,
  onEdit,
  onDelete,
  t,
}: {
  flow: FlowRow;
  selected: boolean;
  onSelectChange: () => void;
  onEdit: () => void;
  onDelete: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const triggerSummary = describeTrigger(flow, t);
  const StatusIcon =
    flow.status === "active"
      ? PlayCircle
      : flow.status === "archived"
        ? Archive
        : PauseCircle;
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-border",
        selected && "border-primary/50 bg-primary/[0.02]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Checkbox
            checked={selected}
            onCheckedChange={onSelectChange}
            aria-label={`Select ${flow.name}`}
          />
          <Workflow className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {flow.name}
          </h3>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 gap-1 text-[10px]",
            STATUS_COLORS[flow.status],
          )}
        >
          <StatusIcon className="h-3 w-3" />
          {STATUS_LABELS(t)[flow.status]}
        </Badge>
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {flow.description || triggerSummary}
      </p>

      <div className="mt-4 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {t("runCount", { count: flow.execution_count })}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          {t("edit")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("delete")}
        </Button>
      </div>
    </div>
  );
}

function describeTrigger(flow: FlowRow, t: ReturnType<typeof useTranslations>): string {
  if (flow.trigger_type === "keyword") {
    const keywords = Array.isArray(flow.trigger_config.keywords)
      ? (flow.trigger_config.keywords as string[])
      : [];
    if (keywords.length === 0) return t("triggerKeywordNone");
    return t("triggerKeyword", { keywords: keywords.join(", ") });
  }
  if (flow.trigger_type === "first_inbound_message") {
    return t("triggerFirstInbound");
  }
  return t("triggerManual");
}
