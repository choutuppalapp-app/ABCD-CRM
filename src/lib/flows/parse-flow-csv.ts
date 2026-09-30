/**
 * CSV parser and sample generator for Flows.
 *
 * Supports columns:
 * - name (required): Flow name
 * - trigger_type (required): 'keyword' | 'first_inbound_message' | 'manual'
 * - trigger_keywords (optional): Comma-separated trigger keywords (e.g. "hi,help,menu")
 * - initial_message (optional): Text greeting for the entry message
 * - button_options (optional): Semicolon-separated button titles (e.g. "Sales;Support;FAQ")
 * - template_slug (optional): Clones pre-built template graph ('welcome_menu', 'feedback_collector', 'lead_qualifier')
 * - description (optional): Brief summary of what this flow does
 */

export interface ParsedFlowRow {
  name: string;
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_keywords?: string[];
  initial_message?: string;
  button_options?: string[];
  template_slug?: string;
  description?: string;
  media_type?: "image" | "contact" | "none";
  media_url?: string;
  rawLineIndex: number;
}

export interface ParseFlowCsvResult {
  rows: ParsedFlowRow[];
  hasNameColumn: boolean;
  hasTriggerTypeColumn: boolean;
  errors: Array<{ line: number; message: string }>;
}

export const VALID_FLOW_TRIGGERS = ["keyword", "first_inbound_message", "manual"] as const;

export function parseFlowCsv(text: string): ParseFlowCsvResult {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return {
      rows: [],
      hasNameColumn: false,
      hasTriggerTypeColumn: false,
      errors: [{ line: 1, message: "File is empty or missing data rows." }],
    };
  }

  const headers = parseCsvLine(lines[0]).map((h) =>
    h.trim().toLowerCase().replace(/["']/g, "")
  );

  const nameIdx = headers.indexOf("name");
  const triggerTypeIdx = headers.indexOf("trigger_type");
  const triggerKeywordsIdx = headers.indexOf("trigger_keywords");
  const initialMessageIdx = headers.indexOf("initial_message");
  const buttonOptionsIdx = headers.indexOf("button_options");
  const templateSlugIdx = headers.indexOf("template_slug");
  const descriptionIdx = headers.indexOf("description");
  const mediaTypeIdx = headers.findIndex((h) => h === "media_type" || h === "media_kind" || h === "attachment_type");
  const mediaUrlIdx = headers.findIndex((h) => h === "media_url" || h === "media_link" || h === "image_url");

  const hasNameColumn = nameIdx !== -1;
  const hasTriggerTypeColumn = triggerTypeIdx !== -1;

  if (!hasNameColumn || !hasTriggerTypeColumn) {
    return {
      rows: [],
      hasNameColumn,
      hasTriggerTypeColumn,
      errors: [
        {
          line: 1,
          message: `Missing required columns: ${[!hasNameColumn && "'name'", !hasTriggerTypeColumn && "'trigger_type'"].filter(Boolean).join(", ")}`,
        },
      ],
    };
  }

  const rows: ParsedFlowRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    const values = parseCsvLine(rawLine);
    const name = values[nameIdx]?.replace(/^["']|["']$/g, "").trim();
    const rawTrigger = values[triggerTypeIdx]?.replace(/^["']|["']$/g, "").trim().toLowerCase();

    if (!name) {
      errors.push({ line: i + 1, message: "Flow name is empty." });
      continue;
    }

    if (!rawTrigger || !VALID_FLOW_TRIGGERS.includes(rawTrigger as typeof VALID_FLOW_TRIGGERS[number])) {
      errors.push({
        line: i + 1,
        message: `Invalid trigger_type "${rawTrigger}". Allowed: ${VALID_FLOW_TRIGGERS.join(", ")}`,
      });
      continue;
    }

    const trigger_type = rawTrigger as typeof VALID_FLOW_TRIGGERS[number];

    const rawKeywords = triggerKeywordsIdx >= 0 ? values[triggerKeywordsIdx]?.replace(/^["']|["']$/g, "").trim() : "";
    const trigger_keywords = rawKeywords
      ? rawKeywords.split(",").map((k) => k.trim()).filter(Boolean)
      : undefined;

    const initial_message = initialMessageIdx >= 0 ? values[initialMessageIdx]?.replace(/^["']|["']$/g, "").trim() : undefined;

    const rawButtons = buttonOptionsIdx >= 0 ? values[buttonOptionsIdx]?.replace(/^["']|["']$/g, "").trim() : "";
    const button_options = rawButtons
      ? rawButtons.split(";").map((b) => b.trim()).filter(Boolean).slice(0, 3)
      : undefined;

    const template_slug = templateSlugIdx >= 0 ? values[templateSlugIdx]?.replace(/^["']|["']$/g, "").trim() : undefined;
    const description = descriptionIdx >= 0 ? values[descriptionIdx]?.replace(/^["']|["']$/g, "").trim() : undefined;

    const rawMediaType = mediaTypeIdx >= 0 ? values[mediaTypeIdx]?.replace(/^["']|["']$/g, "").trim().toLowerCase() : undefined;
    const media_type: "image" | "contact" | "none" | undefined =
      rawMediaType === "image" || rawMediaType === "contact" || rawMediaType === "none"
        ? rawMediaType
        : undefined;

    const media_url = mediaUrlIdx >= 0 ? values[mediaUrlIdx]?.replace(/^["']|["']$/g, "").trim() : undefined;

    rows.push({
      name,
      trigger_type,
      trigger_keywords,
      initial_message,
      button_options,
      template_slug,
      description,
      media_type,
      media_url: media_url || undefined,
      rawLineIndex: i + 1,
    });
  }

  return {
    rows,
    hasNameColumn: true,
    hasTriggerTypeColumn: true,
    errors,
  };
}

/** Parses CSV line with quotation safety */
export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

/** Generates standard sample CSV content for flows */
export function getFlowSampleCsv(): string {
  return `name,trigger_type,trigger_keywords,initial_message,button_options,template_slug,description
"Welcome Menu & Routing",keyword,"hi,hello,menu,start","Welcome to our WhatsApp service! How can we assist you today?","Talk to Sales;Support Help;Book Demo",welcome_menu,"Multi-branch interactive greeting menu"
"Customer Feedback Bot",keyword,"feedback,review,rate","Thank you for your recent purchase! How was your experience with us?","5 Stars Excellent;3 Stars Good;1 Star Needs Work",feedback_collector,"Automated post-service survey flow"
"Lead Qualification Flow",keyword,"quote,pricing,buy","Hi there! To prepare a tailored quote, what best describes your needs?","Small Business;Mid-Market;Enterprise",lead_qualifier,"Qualifies inbound leads and gathers requirements"
"First Contact Onboarding",first_inbound_message,"","Hello! Welcome to our channel. Choose an option to get started:","Explore Catalog;Track Order;Chat with Agent",,"Greets brand new incoming phone numbers with interactive buttons"
"VIP Agent Handoff Flow",manual,"","Connecting you directly with a dedicated VIP representative...",,,"Manual trigger flow used by agents inside inbox"`;
}
