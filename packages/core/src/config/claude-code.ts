import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IModelConfig } from './types.js';

const KNOWN_MODELS = [
  { id: 'sonnet', name: 'Claude Sonnet', envVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL' },
  { id: 'opus', name: 'Claude Opus', envVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL' },
  { id: 'haiku', name: 'Claude Haiku', envVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL' },
];

export class ClaudeCodeConfig implements IModelConfig {
  private readonly settingsPath: string;
  private cache: Record<string, any> | null = null;

  constructor(claudeDir?: string) {
    this.settingsPath = join(claudeDir ?? join(homedir(), '.claude'), 'settings.json');
  }

  private async load(): Promise<Record<string, any>> {
    if (this.cache) return this.cache;
    if (!existsSync(this.settingsPath)) {
      this.cache = {};
      return this.cache;
    }
    const raw = await readFile(this.settingsPath, 'utf-8');
    this.cache = JSON.parse(raw) as Record<string, any>;
    return this.cache;
  }

  private async save(data: Record<string, any>): Promise<void> {
    await writeFile(this.settingsPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    this.cache = data;
  }

  async listModels(): Promise<{ id: string; name: string; isCurrent: boolean }[]> {
    const settings = await this.load();
    const currentValues = new Set<string>();

    for (const m of KNOWN_MODELS) {
      const val = settings.env?.[m.envVar];
      if (val) currentValues.add(val);
    }

    return KNOWN_MODELS.map(m => {
      const currentValue = settings.env?.[m.envVar] || '';
      return {
        id: m.id,
        name: `${m.name} (${currentValue || m.id})`,
        isCurrent: !!currentValue,
      };
    });
  }

  async setModel(modelId: string): Promise<void> {
    const settings = await this.load();
    if (!settings.env) settings.env = {};

    const model = KNOWN_MODELS.find(m => m.id === modelId);
    if (model) {
      // Setting a known model tier - just clear the override
      delete settings.env[model.envVar];
    } else {
      // Custom model - set as sonnet override (most commonly used tier)
      settings.env['ANTHROPIC_DEFAULT_SONNET_MODEL'] = modelId;
    }

    await this.save(settings);
  }

  async getCurrentModel(): Promise<string> {
    const settings = await this.load();
    // Return the first model that has an env var set
    for (const m of KNOWN_MODELS) {
      const val = settings.env?.[m.envVar];
      if (val) return val;
    }
    return 'default';
  }

  async setCustomModel(modelName: string, tier: 'sonnet' | 'opus' | 'haiku' = 'sonnet'): Promise<void> {
    const settings = await this.load();
    if (!settings.env) settings.env = {};

    const model = KNOWN_MODELS.find(m => m.id === tier);
    if (model) {
      settings.env[model.envVar] = modelName;
    }

    await this.save(settings);
  }
}
