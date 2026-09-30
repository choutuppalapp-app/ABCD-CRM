import { describe, expect, it } from 'vitest';
import { getFlowTemplate, buildTemplateWithOverrides } from './templates';
import { validateFlowForActivation } from './validate';

describe('buildTemplateWithOverrides', () => {
  it('returns null for unknown template slug', () => {
    const res = buildTemplateWithOverrides('non_existent', {});
    expect(res).toBeNull();
  });

  it('preserves base template when no overrides provided', () => {
    const base = getFlowTemplate('welcome_menu');
    const overridden = buildTemplateWithOverrides('welcome_menu', {});
    expect(overridden?.name).toBe(base?.name);
    expect(overridden?.description).toBe(base?.description);
    expect(overridden?.nodes.length).toBe(base?.nodes.length);
  });

  it('correctly overrides Telugu initial_message, button_options, and description', () => {
    const teluguMessage = 'చౌటుప్పల్ యాప్ సర్వీసులకు స్వాగతం! క్రింది బటన్ నొక్కండి.';
    const teluguButton = 'సేవలు ప్రారంభించండి';
    const teluguDesc = 'చౌటుప్పల్ కస్టమర్ వెల్‌కమ్ ఫ్లో';

    const flow = buildTemplateWithOverrides('welcome_menu', {
      name: 'Choutuppal Test Welcome',
      description: teluguDesc,
      initial_message: teluguMessage,
      button_options: [teluguButton],
      trigger_keywords: ['hi', 'నమస్కారం'],
    });

    expect(flow).not.toBeNull();
    if (!flow) return;

    expect(flow.name).toBe('Choutuppal Test Welcome');
    expect(flow.description).toBe(teluguDesc);
    expect(flow.trigger_config).toEqual({
      keywords: ['hi', 'నమస్కారం'],
      match_type: 'contains',
    });

    // Root message node 'welcome' should contain the Telugu text and button
    const welcomeNode = flow.nodes.find((n) => n.node_key === 'welcome');
    expect(welcomeNode).toBeDefined();
    expect(welcomeNode?.node_type).toBe('send_buttons');
    const cfg = welcomeNode?.config as { text: string; buttons: Array<{ title: string; next_node_key: string }> };
    expect(cfg.text).toBe(teluguMessage);
    expect(cfg.buttons.length).toBe(1);
    expect(cfg.buttons[0].title).toBe(teluguButton);

    // Connected terminal node must exist
    const handoffKey = cfg.buttons[0].next_node_key;
    const handoffNode = flow.nodes.find((n) => n.node_key === handoffKey);
    expect(handoffNode).toBeDefined();
    expect(handoffNode?.node_type).toBe('handoff');

    // Graph must pass full validation
    const issues = validateFlowForActivation(
      {
        name: flow.name,
        trigger_type: flow.trigger_type,
        trigger_config: flow.trigger_config,
        entry_node_id: flow.entry_node_id,
      },
      flow.nodes
    );
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('correctly sets media_type and media_url in welcome node config', () => {
    const flow = buildTemplateWithOverrides('welcome_menu', {
      name: 'Choutuppal Test with Contact Card',
      initial_message: 'దయచేసి కాంటాక్ట్‌ను సేవ్ చేసుకోండి.',
      button_options: ['సేవలు ప్రారంభించండి'],
      media_type: 'contact',
      media_url: 'https://choutuppal.in/card.vcf',
    });

    expect(flow).not.toBeNull();
    const welcomeNode = flow?.nodes.find((n) => n.node_key === 'welcome');
    expect(welcomeNode).toBeDefined();
    const cfg = welcomeNode?.config as Record<string, unknown>;
    expect(cfg.media_type).toBe('contact');
    expect(cfg.media_url).toBe('https://choutuppal.in/card.vcf');
  });

  it('correctly sets image header for media_type image', () => {
    const flow = buildTemplateWithOverrides('welcome_menu', {
      name: 'Choutuppal Image Banner Flow',
      initial_message: 'స్వాగతం!',
      button_options: ['ప్రారంభించండి'],
      media_type: 'image',
      media_url: 'https://example.com/banner.png',
    });

    expect(flow).not.toBeNull();
    const welcomeNode = flow?.nodes.find((n) => n.node_key === 'welcome');
    expect(welcomeNode).toBeDefined();
    const cfg = welcomeNode?.config as Record<string, unknown>;
    expect(cfg.media_type).toBe('image');
    expect(cfg.media_url).toBe('https://example.com/banner.png');
    expect(cfg.header_image_url).toBe('https://example.com/banner.png');
  });
});
