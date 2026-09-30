'use client';

import { useRef, useState } from 'react';
import {
  parseFlowCsv,
  getFlowSampleCsv,
  type ParsedFlowRow,
} from '@/lib/flows/parse-flow-csv';
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
  Workflow,
} from 'lucide-react';

const PREVIEW_LIMIT = 5;

interface FlowImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function FlowImportModal({
  open,
  onOpenChange,
  onImported,
}: FlowImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedFlowRow[]>([]);
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
    const parsed = parseFlowCsv(text);

    if (parsed.rows.length === 0) {
      toast.error('No valid flow rows found in CSV.');
      setParsedRows([]);
      setParseErrors(parsed.errors);
      return;
    }

    setParsedRows(parsed.rows);
    setParseErrors(parsed.errors);
  }

  function handleDownloadSample() {
    const csvContent = getFlowSampleCsv();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sample_flows.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Sample flows CSV downloaded');
  }

  async function handleImport() {
    if (parsedRows.length === 0) return;
    setImporting(true);

    let imported = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const row of parsedRows) {
      try {
        let trigger_config: Record<string, unknown> = {};
        if (row.trigger_type === 'keyword') {
          trigger_config = {
            keywords: row.trigger_keywords && row.trigger_keywords.length > 0
              ? row.trigger_keywords
              : ['hi', 'hello'],
            match_type: 'contains',
          };
        }

        const payload: Record<string, unknown> = {
          name: row.name,
          description: row.description || null,
          trigger_type: row.trigger_type,
          trigger_config,
          initial_message: row.initial_message,
          button_options: row.button_options,
          trigger_keywords: row.trigger_keywords,
          media_type: row.media_type,
          media_url: row.media_url,
        };

        if (row.template_slug) {
          payload.template_slug = row.template_slug;
        }

        const res = await fetch('/api/flows', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `HTTP ${res.status}`);
        }

        const json = await res.json();
        const flowId = json?.flow?.id;

        // If not using a template, but initial message or button options are provided,
        // construct start + interactive message nodes and save to flow via PUT!
        if (flowId && !row.template_slug && (row.initial_message || (row.button_options && row.button_options.length > 0) || row.media_type)) {
          const nodes = [];
          nodes.push({
            node_key: 'start',
            node_type: 'start',
            config: { next_node_key: 'welcome_msg' },
            position_x: 100,
            position_y: 100,
          });

          if (row.button_options && row.button_options.length > 0) {
            const buttons = row.button_options.slice(0, 3).map((title, i) => ({
              reply_id: `btn_${i + 1}`,
              title: title.slice(0, 20),
              next_node_key: `action_${i + 1}`,
            }));

            nodes.push({
              node_key: 'welcome_msg',
              node_type: 'send_buttons',
              config: {
                text: row.initial_message || 'Welcome! Please select an option below:',
                media_type: row.media_type || undefined,
                media_url: row.media_url || undefined,
                header_image_url: row.media_type === 'image' ? row.media_url : undefined,
                buttons,
              },
              position_x: 100,
              position_y: 220,
            });

            buttons.forEach((b, i) => {
              nodes.push({
                node_key: b.next_node_key,
                node_type: 'send_message',
                config: {
                  text: `You selected "${b.title}". An agent will be in touch shortly!`,
                  next_node_key: '',
                },
                position_x: 240 * (i + 1),
                position_y: 380,
              });
            });
          } else {
            nodes.push({
              node_key: 'welcome_msg',
              node_type: 'send_message',
              config: {
                text: row.initial_message || 'Hello! Thank you for reaching out.',
                next_node_key: '',
              },
              position_x: 100,
              position_y: 220,
            });
          }

          await fetch(`/api/flows/${flowId}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              entry_node_id: 'start',
              nodes,
            }),
          });
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
      toast.success(`Successfully imported ${imported} flow(s).`);
      onImported();
    }
    if (failed > 0) {
      toast.error(`Failed to import ${failed} flow(s).`);
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
                  <Workflow className="h-5 w-5 text-primary" />
                  Import Flows from CSV
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Bulk create conversational WhatsApp flows, keyword triggers, and interactive menus via CSV spreadsheet.
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
                    {parsedRows.length} flow(s) ready to import
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
                </div>

                <div className="rounded-lg border border-border/80 overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-muted/60 text-muted-foreground border-b border-border/70">
                      <tr>
                        <th className="p-2.5 font-medium">Flow Name</th>
                        <th className="p-2.5 font-medium">Trigger</th>
                        <th className="p-2.5 font-medium">Keywords / Template</th>
                        <th className="p-2.5 font-medium">Buttons / Menu</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {preview.map((row, idx) => (
                        <tr key={idx} className="hover:bg-muted/30">
                          <td className="p-2.5 font-medium text-foreground max-w-[140px] truncate">
                            {row.name}
                            {row.description && (
                              <span className="block text-[10px] text-muted-foreground truncate" title={row.description}>
                                {row.description}
                              </span>
                            )}
                          </td>
                          <td className="p-2.5">
                            <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0">
                              {row.trigger_type}
                            </Badge>
                          </td>
                          <td className="p-2.5 max-w-[150px]">
                            {row.template_slug ? (
                              <span className="text-primary font-medium text-[11px]">
                                Template: {row.template_slug}
                              </span>
                            ) : row.trigger_keywords && row.trigger_keywords.length > 0 ? (
                              <span className="text-muted-foreground text-[11px] truncate block" title={row.trigger_keywords.join(', ')}>
                                {row.trigger_keywords.join(', ')}
                              </span>
                            ) : (
                              <span className="text-muted-foreground italic text-[11px]">—</span>
                            )}
                          </td>
                          <td className="p-2.5 max-w-[170px]">
                            {row.button_options && row.button_options.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {row.button_options.map((btn, bIdx) => (
                                  <span key={bIdx} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                                    {btn}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground italic text-[11px]">
                                {row.template_slug ? 'Pre-configured tree' : 'Single message'}
                              </span>
                            )}
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
                      {result.imported} flow(s) created
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
                Import {parsedRows.length > 0 ? `${parsedRows.length} Flows` : ''}
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
              Flows CSV Format Guide
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Guide to building and importing interactive WhatsApp flows from CSV spreadsheets.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-xs leading-relaxed text-foreground">
            <div>
              <h4 className="font-semibold text-sm mb-1 text-primary">Required Columns</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <strong className="font-mono">name</strong>: The title of your flow (e.g. &quot;Welcome Menu&quot;, &quot;Order Status Bot&quot;).
                </li>
                <li>
                  <strong className="font-mono">trigger_type</strong>: Supported trigger types:
                  <div className="mt-1 flex gap-2 text-[11px] font-mono text-muted-foreground bg-muted p-2 rounded">
                    <span>• keyword</span>
                    <span>• first_inbound_message</span>
                    <span>• manual</span>
                  </div>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-1 text-primary">Optional Columns</h4>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  <strong className="font-mono">trigger_keywords</strong>: Comma-separated keywords that trigger this flow (e.g. <code>hi,help,menu,pricing</code>).
                </li>
                <li>
                  <strong className="font-mono">initial_message</strong>: Greeting message shown to the customer when the flow starts.
                </li>
                <li>
                  <strong className="font-mono">button_options</strong>: Semicolon-separated button options (up to 3 buttons per WhatsApp rules) e.g. <code>Sales;Support;Pricing</code>. Creates interactive buttons automatically.
                </li>
                <li>
                  <strong className="font-mono">template_slug</strong>: Automatically clones complete pre-built flow graph:
                  <span className="block text-muted-foreground">
                    <code>welcome_menu</code> (multi-branch triage), <code>feedback_collector</code> (ratings survey), <code>lead_qualifier</code> (intake)
                  </span>
                </li>
                <li>
                  <strong className="font-mono">description</strong>: Optional description for internal team reference.
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
