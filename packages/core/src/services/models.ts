import { ClaudeCodeConfig } from '../config/claude-code.js';
import type { ModelOption, Source } from '../collectors/types.js';

export interface ModelQueryOptions {
  source?: Source;
}

export interface SetModelOptions extends ModelQueryOptions {
  tier?: 'sonnet' | 'opus' | 'haiku';
}

function requireClaudeSource(source?: Source): 'claude-code' {
  const resolvedSource = source ?? 'claude-code';
  if (resolvedSource !== 'claude-code') {
    throw new Error(`Model management is not supported for source "${resolvedSource}" yet`);
  }
  return 'claude-code';
}

export async function listModels(options?: ModelQueryOptions): Promise<ModelOption[]> {
  requireClaudeSource(options?.source);
  const config = new ClaudeCodeConfig();
  const models = await config.listModels();
  return models.map((model) => ({
    ...model,
    source: 'claude-code' as const,
  }));
}

export async function setModel(model: string, options?: SetModelOptions): Promise<void> {
  requireClaudeSource(options?.source);
  const config = new ClaudeCodeConfig();
  if (['sonnet', 'opus', 'haiku'].includes(model)) {
    await config.setModel(model);
    return;
  }
  await config.setCustomModel(model, options?.tier ?? 'sonnet');
}
