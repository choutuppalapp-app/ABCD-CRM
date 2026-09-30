/**
 * Translate our local template row shape into the `components` array
 * shape that Meta's POST /{waba_id}/message_templates endpoint expects.
 *
 * Keep this function pure and JSON-shaped — the submit route and the
 * (future) edit route both call it, and unit tests assert the exact
 * payload by snapshot.
 *
 * Spec reference:
 *   https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/components
 */

import { extractVariableIndices, type TemplatePayload } from './template-validators';
import type { TemplateButton } from '@/types';

export interface MetaComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  text?: string;
  buttons?: MetaButtonPayload[];
  example?: {
    header_text?: string[];
    header_url?: string[];
    header_handle?: string[];
    body_text?: string[][];
  };
}

interface MetaButtonPayload {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';
  text: string;
  url?: string;
  phone_number?: string;
  example?: string[];
}

function buildHeaderComponent(payload: TemplatePayload): MetaComponent | null {
  const { header_type, header_content, header_media_url, header_handle } = payload;
  if (!header_type || (header_type as string) === 'none') return null;

  if (header_type === 'text') {
    if (!header_content?.trim()) return null;
    const headerVars = extractVariableIndices(header_content);
    const headerSample = payload.sample_values?.header;
    const component: MetaComponent = {
      type: 'HEADER',
      format: 'TEXT',
      text: header_content.trim(),
    };
    // Meta rule: header example must ONLY be included if header has {{1}} variable
    if (headerVars.length > 0 && headerSample && headerSample.length > 0 && headerSample[0]?.trim()) {
      component.example = { header_text: [headerSample[0].trim()] };
    }
    return component;
  }

  const format =
    header_type === 'image'
      ? 'IMAGE'
      : header_type === 'video'
        ? 'VIDEO'
        : 'DOCUMENT';
  const component: MetaComponent = { type: 'HEADER', format };
  if (header_handle) {
    component.example = { header_handle: [header_handle] };
  } else if (header_media_url) {
    component.example = { header_url: [header_media_url] };
  }
  return component;
}

function buildBodyComponent(payload: TemplatePayload): MetaComponent {
  const component: MetaComponent = {
    type: 'BODY',
    text: payload.body_text,
  };
  const bodyVars = extractVariableIndices(payload.body_text);
  const bodySample = payload.sample_values?.body;
  // Meta rule: body example must ONLY be included if body has variables ({{1}}, {{2}}, etc.)
  if (bodyVars.length > 0 && bodySample && bodySample.length >= bodyVars.length) {
    const validSamples = bodySample.slice(0, bodyVars.length).map((s) => s.trim());
    if (validSamples.every((s) => s.length > 0)) {
      component.example = { body_text: [validSamples] };
    }
  }
  return component;
}

function buildFooterComponent(payload: TemplatePayload): MetaComponent | null {
  if (!payload.footer_text?.trim()) return null;
  return { type: 'FOOTER', text: payload.footer_text.trim() };
}

function buildButtonPayload(b: TemplateButton): MetaButtonPayload {
  switch (b.type) {
    case 'QUICK_REPLY':
      return { type: 'QUICK_REPLY', text: b.text.trim() };
    case 'URL': {
      const payload: MetaButtonPayload = {
        type: 'URL',
        text: b.text.trim(),
        url: b.url?.trim() || '',
      };
      const urlVars = extractVariableIndices(b.url || '');
      // Meta rule: URL example must ONLY be present if url contains {{1}}
      if (urlVars.length > 0 && b.example?.trim()) {
        payload.example = [b.example.trim()];
      }
      return payload;
    }
    case 'PHONE_NUMBER':
      return { type: 'PHONE_NUMBER', text: b.text.trim(), phone_number: b.phone_number?.trim() || '' };
    case 'COPY_CODE':
      return {
        type: 'COPY_CODE',
        text: b.text?.trim() || 'Copy Code',
        example: b.example?.trim() ? [b.example.trim()] : undefined,
      };
  }
}

function buildButtonsComponent(payload: TemplatePayload): MetaComponent | null {
  if (!payload.buttons || payload.buttons.length === 0) return null;
  const validButtons = payload.buttons.filter((b) => b && b.text?.trim());
  if (validButtons.length === 0) return null;
  return {
    type: 'BUTTONS',
    buttons: validButtons.map(buildButtonPayload),
  };
}

export interface MetaTemplateSubmitPayload {
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;
  components: MetaComponent[];
}

/**
 * Assemble the full submit payload (name + category + language +
 * components in canonical order: HEADER → BODY → FOOTER → BUTTONS).
 */
export function buildMetaTemplatePayload(
  payload: TemplatePayload,
): MetaTemplateSubmitPayload {
  const components: MetaComponent[] = [];
  const header = buildHeaderComponent(payload);
  if (header) components.push(header);
  components.push(buildBodyComponent(payload));
  const footer = buildFooterComponent(payload);
  if (footer) components.push(footer);
  const buttons = buildButtonsComponent(payload);
  if (buttons) components.push(buttons);

  const rawCat = String(payload.category || 'Marketing').toUpperCase();
  const category: MetaTemplateSubmitPayload['category'] =
    rawCat === 'UTILITY'
      ? 'UTILITY'
      : rawCat === 'AUTHENTICATION'
        ? 'AUTHENTICATION'
        : 'MARKETING';

  return {
    name: payload.name.trim(),
    category,
    language: payload.language?.trim() || 'te',
    components,
  };
}
