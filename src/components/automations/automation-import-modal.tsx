'use client';

import { useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  parseAutomationCsv,
  getAutomationSampleCsv,
  type ParsedAutomationRow,
} from '@/lib/automations/parse-automation-csv';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Download,
  HelpCircle,
  Zap,
} from 'lucide-react';
import type { AutomationTriggerType, AutomationStepType } from '@/types';

const PREVIEW_LIMIT = 5;

interface AutomationImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function AutomationImportModal({
  open,
  onOpenChange,
  onImported,
}: AutomationImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedAutomationRow[]>([]);
  const [parseErrors, setParseErrors] = useState<Array<{ line: number; message: string }>>([]);
  const [importing, setImporting] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    failed: number;
    errors: string[];
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setParsedRows([]);
    setParseErrors([]);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setResult(null);

    const text = await selected.text();
    const parsed = parseAutomationCsv(text);

    if (parsed.rows.length === 0) {
      toast.error('No valid automation rows found in CSV.');
      setParsedRows([]);
      setParseErrors(parsed.errors);
      return;
    }

    setParsedRows(parsed.rows);
    setParseErrors(parsed.errors);
  }

  function handleDownloadSample() {
    const csvContent = getAutomationSampleCsv();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sample_automations.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Sample automations CSV downloaded');
  }

  async function handleImport() {
    if (parsedRows.length === 0) return;
    setImporting(true);

    let imported = 0;
    let failed = 0;
    const errors: string[] = [];

    // Pre-fetch tags and pipelines to resolve human-friendly names if possible
    const supabase = createClient();
    const { data: tags } = await supabase.from('tags').select('id, name');
    const tagMap = new Map<string, string>();
    (tags ?? []).forEach((t) => tagMap.set(t.name.trim().toLowerCase(), t.id));

    for (const row of parsedRows) {
      try {
        let trigger_config: Record<string, unknown> = {};
        if (row.trigger_type === 'keyword_match') {
          const kws = row.trigger_value
            ? row.trigger_value.split(',').map((k) => k.trim()).filter(Boolean)
            : ['hello'];
          trigger_config = { keywords: kws, match_type: 'contains' };
        } else if (row.trigger_type === 'tag_added') {
          const rawVal = row.trigger_value?.trim() || '';
          const resolvedTagId = tagMap.get(rawVal.toLowerCase()) || rawVal;
          trigger_config = { tag_id: resolvedTagId };
        } else if (row.trigger_type === 'interactive_reply') {
          const ids = row.trigger_value
            ? row.trigger_value.split(',').map((id) => id.trim()).filter(Boolean)
            : [];
          trigger_config = { reply_ids: ids };
        } else if (row.trigger_type === 'time_based') {
          trigger_config = { schedule: row.trigger_value?.trim() || '09:00' };
        }

        // Prepare steps if action_type is provided and no template
        const steps: Array<{
          step_type: string;
          step_config: Record<string, unknown>;
        }> = [];

        if (row.action_type) {
          if (row.action_type === 'send_message') {
            steps.push({
              step_type: 'send_message',
              step_config: { text: row.action_value || 'Hello! How can we help you?' },
            });
          } else if (row.action_type === 'add_tag' || row.action_type === 'remove_tag') {
            const rawVal = row.action_value?.trim() || '';
            const resolvedTagId = tagMap.get(rawVal.toLowerCase()) || rawVal;
            steps.push({
              step_type: row.action_type,
              step_config: { tag_id: resolvedTagId },
            });
          } else if (row.action_type === 'close_conversation') {
            steps.push({
              step_type: 'close_conversation',
              step_config: {},
            });
          } else if (row.action_type === 'assign_conversation') {
            steps.push({
              step_type: 'assign_conversation',
              step_config: { mode: 'round_robin' },
            });
          } else if (row.action_type === 'wait') {
            const match = row.action_value?.match(/(\d+)\s*(m|min|h|hour|d|day)?/i);
            const amt = match ? parseInt(match[1], 10) : 10;
            const unitCode = match?.[2]?.toLowerCase();
            const unit = unitCode?.startsWith('h') ? 'hours' : unitCode?.startsWith('d') ? 'days' : 'minutes';
            steps.push({
              step_type: 'wait',
              step_config: { amount: amt, unit },
            });
          }
        }

        const payload: Record<string, unknown> = {
          name: row.name,
          description: row.description || null,
          trigger_type: row.trigger_type,
          trigger_config,
          is_active: row.is_active,
        };

        if (row.template_slug) {
          payload.template = row.template_slug;
        } else if (steps.length > 0) {
          payload.steps = steps;
        }

        const res = await fetch('/api/automations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `HTTP ${res.status}`);
        }

        imported++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : 'Creation failed';
        errors.push(`"${row.name}": ${msg}`);
      }
    }

    setResult({ imported, failed, errors });
    setImporting(false);

    if (imported > 0) {
      toast.success(`Successfully imported ${imported} automation(s).`);
      onImported();
    }
    if (failed > 0) {
      toast.error(`Failed to import ${failed} automation(s).`);
    }
  }

  const preview = parsedRows.slice(0, PREVIEW_LIMIT);

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[min(92vh,740px)] flex-col gap-0 overflow-hidden border-border/80 bg-popover p-0 text-popover-foreground sm:max-w-2xl">
          <div className="shrink-0 space-y-4 border-b border-border/80 px-6 pt-6 pb-4">
            <div className="flex items-start justify-between gap-4">
              <DialogHeader className="gap-1.5 text-left">
                <DialogTitle className="flex items-center gap-2 text-lg text-popover-foreground">
                  <Zap className="h-5 w-5 text-amber-500" />
                  Import Automations from CSV
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Bulk import automations, triggers, and workflow actions via CSV spreadsheet.
                </DialogDescription>
              </DialogHeader>

              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadSample}
                  className="h-8 text-xs gap-1.5 border-border bg-background hover:bg-muted"
                  title="Download ready-to-use sample CSV template"
                >
                  <Download className="h-3.5 w-3.5 text-primary" />
                  Sample CSV
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setGuideOpen(true)}
                  className="h-8 text-xs gap-1 text-muted-foreground hover:text-foreground"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  Guide
                </Button>
              </div>
            </div>

            {/* Dropzone */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
              className={cn(
                'group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 transition-all',
                file
                  ? 'border-primary/40 bg-primary/[0.04]'
                  : 'hover:border-primary/40 border-border/80 bg-background/50 hover:bg-background/80'
              )}
            >
              {file ? (
                <>
                  <div className="bg-primary/15 ring-primary/25 flex size-9 items-center justify-center rounded-lg ring-1">
                    <FileText className="text-primary size-5" />
                  </div>
                  <p className="max-w-full truncate px-2 text-sm font-medium text-popover-foreground">
                    {file.name}
                  </p>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {parsedRows.length} automation(s) ready to import
                  </span>
                </>
              ) : (
                <>
                  <div className="flex size-9 items-center justify-center rounded-lg bg-muted/80 ring-1 ring-border/80 group-hover:bg-muted">
                    <Upload className="size-4 text-muted-foreground group-hover:text-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground">Click to browse or drop CSV file here</p>
                  <p className="text-xs text-muted-foreground">
                    Required headers: <code className="text-[11px] bg-muted px-1 rounded">name</code>,{' '}
                    <code className="text-[11px] bg-muted px-1 rounded">trigger_type</code>
                  </p>
                </>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Validation issues / errors */}
            {parseErrors.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-amber-200">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  CSV Warnings ({parseErrors.length})
                </div>
                <ul className="list-disc pl-5 space-y-0.5 max-h-24 overflow-y-auto">
                  {parseErrors.slice(0, 5).map((err, idx) => (
                    <li key={idx}>Line {err.line}: {err.message}</li>
                  ))}
                  {parseErrors.length > 5 && (
                    <li>...and {parseErrors.length - 5} more issues</li>
                  )}
                </ul>
              </div>
            )}

            {/* Preview table */}
            {preview.length > 0 && !result && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Preview (showing {preview.length} of {parsedRows.length})
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {parsedRows.filter((r) => r.is_active).length} active,{' '}
                    {parsedRows.filter((r) => !r.is_active).length} drafts
                  </span>
                </div>

                <div className="rounded-lg border border-border/80 overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-muted/60 text-muted-foreground border-b border-border/70">
                      <tr>
                        <th className="p-2.5 font-medium">Name</th>
                        <th className="p-2.5 font-medium">Trigger</th>
                        <th className="p-2.5 font-medium">Action / Value</th>
                        <th className="p-2.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {preview.map((row, idx) => (
                        <tr key={idx} className="hover:bg-muted/30">
                          <td className="p-2.5 font-medium text-foreground max-w-[140px] truncate">
                            {row.name}
                            {row.template_slug && (
                              <span className="block text-[10px] text-primary">
                                Template: {row.template_slug}
                              </span>
                            )}
                          </td>
                          <td className="p-2.5">
                            <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0">
                              {row.trigger_type}
                            </Badge>
                            {row.trigger_value && (
                              <span className="block text-[11px] text-muted-foreground truncate max-w-[120px]" title={row.trigger_value}>
                                {row.trigger_value}
                              </span>
                            )}
                          </td>
                          <td className="p-2.5 max-w-[160px]">
                            {row.action_type ? (
                              <div>
                                <span className="font-semibold text-foreground text-[11px]">
                                  {row.action_type}
                                </span>
                                {row.action_value && (
                                  <p className="text-[11px] text-muted-foreground truncate" title={row.action_value}>
                                    {row.action_value}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground italic text-[11px]">
                                {row.template_slug ? 'Full template graph' : 'Empty draft'}
                              </span>
                            )}
                          </td>
                          <td className="p-2.5">
                            <span
                              className={cn(
                                'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium',
                                row.is_active
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : 'bg-muted text-muted-foreground'
                              )}
                            >
                              {row.is_active ? 'Active' : 'Draft'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Results feedback */}
            {result && (
              <div className="rounded-xl border border-border bg-background/50 p-4 space-y-3">
                <p className="text-sm font-semibold text-foreground">Import Finished</p>
                <div className="flex flex-wrap gap-4 text-sm">
                  {result.imported > 0 && (
                    <div className="flex items-center gap-1.5 text-emerald-400">
                      <CheckCircle className="size-4 shrink-0" />
                      {result.imported} created
                    </div>
                  )}
                  {result.failed > 0 && (
                    <div className="flex items-center gap-1.5 text-red-400">
                      <XCircle className="size-4 shrink-0" />
                      {result.failed} failed
                    </div>
                  )}
                </div>
                {result.errors.length > 0 && (
                  <div className="mt-2 text-xs text-red-300 bg-red-500/10 p-2.5 rounded border border-red-500/20 max-h-32 overflow-y-auto space-y-1">
                    {result.errors.map((e, idx) => (
                      <div key={idx}>{e}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t border-border/80 bg-background/50 px-6 py-3.5 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {result ? 'Close' : 'Cancel'}
            </Button>
            {!result && (
              <Button
                type="button"
                disabled={parsedRows.length === 0 || importing}
                onClick={handleImport}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {importing && <Loader2 className="size-4 animate-spin mr-1.5" />}
                Import {parsedRows.length > 0 ? `${parsedRows.length} Automations` : ''}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Guide Modal */}
      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <HelpCircle className="size-5 text-primary" />
              Automations CSV Format Guide
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Learn what columns you can provide and how they map into automations.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-xs leading-relaxed text-foreground">
            <div>
              <h4 className="font-semibold text-sm mb-1 text-primary">Required Columns</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <strong className="font-mono">name</strong>: Name of the automation (e.g. &quot;Welcome Message&quot;, &quot;VIP Inquiry Tagging&quot;).
                </li>
                <li>
                  <strong className="font-mono">trigger_type</strong>: Supported triggers:
                  <div className="mt-1 grid grid-cols-2 gap-1 text-[11px] font-mono text-muted-foreground bg-muted p-2 rounded">
                    <div>• new_message_received</div>
                    <div>• first_inbound_message</div>
                    <div>• keyword_match</div>
                    <div>• interactive_reply</div>
                    <div>• new_contact_created</div>
                    <div>• conversation_assigned</div>
                    <div>• tag_added</div>
                    <div>• time_based</div>
                  </div>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-1 text-primary">Optional Columns</h4>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  <strong className="font-mono">trigger_value</strong>: Depends on trigger:
                  <span className="block text-muted-foreground">
                    - For <code>keyword_match</code>: comma-separated keywords e.g. <code>pricing,quote,buy</code><br />
                    - For <code>tag_added</code>: tag name or tag id e.g. <code>VIP Lead</code><br />
                    - For <code>interactive_reply</code>: button id e.g. <code>support_agent</code><br />
                    - For <code>time_based</code>: time range e.g. <code>18:00-09:00</code>
                  </span>
                </li>
                <li>
                  <strong className="font-mono">action_type</strong>: Initial workflow action:
                  <span className="block text-muted-foreground">
                    <code>send_message</code>, <code>add_tag</code>, <code>remove_tag</code>, <code>assign_conversation</code>, <code>close_conversation</code>, <code>wait</code>
                  </span>
                </li>
                <li>
                  <strong className="font-mono">action_value</strong>: The payload for action:
                  <span className="block text-muted-foreground">
                    - For <code>send_message</code>: The WhatsApp reply text<br />
                    - For <code>add_tag</code>: Tag name or tag ID<br />
                    - For <code>wait</code>: Duration like <code>10m</code>, <code>2h</code>, <code>1d</code>
                  </span>
                </li>
                <li>
                  <strong className="font-mono">is_active</strong>: <code>true</code> or <code>false</code> (draft). Defaults to <code>false</code>.
                </li>
                <li>
                  <strong className="font-mono">template_slug</strong>: Automatically fills complete workflow template:
                  <span className="block text-muted-foreground">
                    <code>welcome_message</code>, <code>out_of_office</code>, <code>lead_qualifier</code>, <code>follow_up_reminder</code>
                  </span>
                </li>
                <li>
                  <strong className="font-mono">description</strong>: Optional note or description.
                </li>
              </ul>
            </div>

            <div className="pt-2 border-t flex justify-between items-center">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadSample}
                className="gap-1.5"
              >
                <Download className="size-4 text-primary" />
                Download Sample CSV
              </Button>
              <Button size="sm" onClick={() => setGuideOpen(false)}>
                Got it
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
