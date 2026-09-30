/**
 * CSV parser and sample generator for Automations.
 *
 * Supports columns:
 * - name (required): Name of the automation
 * - trigger_type (required): 'new_message_received' | 'first_inbound_message' | 'keyword_match' | 'interactive_reply' | 'new_contact_created' | 'conversation_assigned' | 'tag_added' | 'time_based'
 * - trigger_value (optional): keyword(s) for keyword_match, tag name or id for tag_added, reply_ids for interactive_reply, schedule/time for time_based
 * - action_type (optional): first step action e.g. 'send_message', 'add_tag', 'close_conversation', 'wait'
 * - action_value (optional): message text, tag name, wait duration (e.g. "10m", "1h", "2d")
 * - is_active (optional): 'true' | 'false' (defaults to false for draft safety)
 * - description (optional): Brief summary
 * - template_slug (optional): pre-built template to populate full steps ('welcome_message', 'out_of_office', 'lead_qualifier', 'follow_up_reminder')
 */

import type { AutomationTriggerType, AutomationStepType } from "@/types";

export interface ParsedAutomationRow {
  name: string;
  trigger_type: AutomationTriggerType;
  trigger_value?: string;
  action_type?: AutomationStepType;
  action_value?: string;
  is_active: boolean;
  description?: string;
  template_slug?: string;
  rawLineIndex: number;
}

export interface ParseAutomationCsvResult {
  rows: ParsedAutomationRow[];
  hasNameColumn: boolean;
  hasTriggerTypeColumn: boolean;
  errors: Array<{ line: number; message: string }>;
}

export const VALID_AUTOMATION_TRIGGERS: AutomationTriggerType[] = [
  "new_message_received",
  "first_inbound_message",
  "keyword_match",
  "interactive_reply",
  "new_contact_created",
  "conversation_assigned",
  "tag_added",
  "time_based",
];

export const VALID_AUTOMATION_ACTIONS: AutomationStepType[] = [
  "send_message",
  "send_buttons",
  "send_list",
  "send_template",
  "add_tag",
  "remove_tag",
  "assign_conversation",
  "update_contact_field",
  "create_deal",
  "wait",
  "condition",
  "send_webhook",
  "close_conversation",
];

export function parseAutomationCsv(text: string): ParseAutomationCsvResult {
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
  const triggerValueIdx = headers.indexOf("trigger_value");
  const actionTypeIdx = headers.indexOf("action_type");
  const actionValueIdx = headers.indexOf("action_value");
  const isActiveIdx = headers.indexOf("is_active");
  const descriptionIdx = headers.indexOf("description");
  const templateSlugIdx = headers.indexOf("template_slug");

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

  const rows: ParsedAutomationRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    const values = parseCsvLine(rawLine);
    const name = values[nameIdx]?.replace(/^["']|["']$/g, "").trim();
    const rawTrigger = values[triggerTypeIdx]?.replace(/^["']|["']$/g, "").trim().toLowerCase();

    if (!name) {
      errors.push({ line: i + 1, message: "Name is empty." });
      continue;
    }

    if (!rawTrigger || !VALID_AUTOMATION_TRIGGERS.includes(rawTrigger as AutomationTriggerType)) {
      errors.push({
        line: i + 1,
        message: `Invalid trigger_type "${rawTrigger}". Allowed: ${VALID_AUTOMATION_TRIGGERS.join(", ")}`,
      });
      continue;
    }

    const trigger_type = rawTrigger as AutomationTriggerType;
    const trigger_value = triggerValueIdx >= 0 ? values[triggerValueIdx]?.replace(/^["']|["']$/g, "").trim() : undefined;
    const rawAction = actionTypeIdx >= 0 ? values[actionTypeIdx]?.replace(/^["']|["']$/g, "").trim().toLowerCase() : undefined;
    const action_value = actionValueIdx >= 0 ? values[actionValueIdx]?.replace(/^["']|["']$/g, "").trim() : undefined;
    const rawActive = isActiveIdx >= 0 ? values[isActiveIdx]?.replace(/^["']|["']$/g, "").trim().toLowerCase() : "false";
    const description = descriptionIdx >= 0 ? values[descriptionIdx]?.replace(/^["']|["']$/g, "").trim() : undefined;
    const template_slug = templateSlugIdx >= 0 ? values[templateSlugIdx]?.replace(/^["']|["']$/g, "").trim() : undefined;

    let action_type: AutomationStepType | undefined = undefined;
    if (rawAction) {
      if (VALID_AUTOMATION_ACTIONS.includes(rawAction as AutomationStepType)) {
        action_type = rawAction as AutomationStepType;
      } else {
        errors.push({
          line: i + 1,
          message: `Unknown action_type "${rawAction}". Defaulting to empty step.`,
        });
      }
    }

    rows.push({
      name,
      trigger_type,
      trigger_value,
      action_type,
      action_value,
      is_active: rawActive === "true" || rawActive === "1" || rawActive === "yes",
      description,
      template_slug,
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

/** Parses CSV line taking quotation marks and commas into account */
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

/** Generates standard sample CSV content for automations */
export function getAutomationSampleCsv(): string {
  return `name,trigger_type,trigger_value,action_type,action_value,is_active,description,template_slug
"Instant Welcome Reply",first_inbound_message,"",send_message,"Hello! Thanks for reaching out to us on WhatsApp. How can we help you today?",false,"Auto-reply to first-time WhatsApp inquiries",welcome_message
"Pricing Inquiry Auto-Reply",keyword_match,"pricing,quote,cost",send_message,"Here is our pricing: Starter $29/mo, Pro $79/mo. Would you like a demo?",false,"Answers pricing keywords instantly",
"VIP Lead Tagging",keyword_match,"enterprise,vip,contract",add_tag,"VIP Lead",false,"Tag hot leads when mentioned in conversation",
"After Hours Auto-Responder",time_based,"18:00-09:00",send_message,"Our office is currently closed (hours 9am-6pm). We will respond first thing tomorrow morning!",false,"Out of office auto response",out_of_office
"Support Handoff",interactive_reply,"support_agent,talk_human",assign_conversation,"round_robin",false,"Assigns chat to agent when customer taps Support button",
"Order Status Lookup",keyword_match,"order,track,tracking",send_message,"Please provide your 6-digit Order ID and we will check it for you.",false,"Help customers check their order",
"Wrap up & Close",keyword_match,"bye,done,thank you",close_conversation,"",false,"Closes conversation after resolved inquiry",`;
}
