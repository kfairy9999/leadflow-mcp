import { afterEach, describe, expect, it } from 'vitest';

import { openLeadClient } from './mcp-harness.js';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers) await close();
  closers.length = 0;
});

describe('MCP contract', () => {
  it('snapshots tools/list, resources/list, and prompts/list', async () => {
    const opened = await openLeadClient('auto');
    closers.push(() => opened.close());
    const tools = await opened.client.listTools();
    const resources = await opened.client.listResources();
    const templates = await opened.client.listResourceTemplates();
    const prompts = await opened.client.listPrompts();

    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'create_lead',
      'update_lead',
      'get_lead',
      'search_leads',
      'score_lead',
      'log_interaction',
      'schedule_follow_up',
      'set_follow_up_status',
      'list_due_follow_ups',
      'pipeline_summary',
      'export_leads_csv',
    ]);

    expect({
      tools: sortBy(tools.tools, (tool) => tool.name),
      resources: sortBy(resources.resources, (resource) => resource.uri),
      resourceTemplates: sortBy(templates.resourceTemplates, (template) => template.uriTemplate),
      prompts: sortBy(prompts.prompts, (prompt) => prompt.name),
    }).toMatchSnapshot();
  });
});

function sortBy<T>(items: readonly T[], key: (item: T) => string): unknown[] {
  return [...items]
    .sort((left, right) => key(left).localeCompare(key(right)))
    .map((item) => sortKeys(JSON.parse(JSON.stringify(item)) as unknown));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortKeys(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, inner]) => [key, sortKeys(inner)]),
    );
  }
  return value;
}
