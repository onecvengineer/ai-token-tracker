import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { IAccountConfig } from './types.js';

export type ProviderAuthType = 'auth-token' | 'api-key';

export interface ProviderModels {
  sonnet?: string;
  opus?: string;
  haiku?: string;
}

export interface ProviderConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  authType: ProviderAuthType;
  models: ProviderModels;
}

export interface ProvidersData {
  providers: Record<string, ProviderConfig>;
  activeProvider: string;
}

const KNOWN_ENV_VARS = [
  { tier: 'sonnet', envVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL' },
  { tier: 'opus', envVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL' },
  { tier: 'haiku', envVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL' },
] as const;

const KNOWN_PROVIDERS: { match: string; id: string; name: string }[] = [
  { match: 'deepseek.com', id: 'deepseek', name: 'DeepSeek' },
  { match: 'bigmodel.cn', id: 'glm', name: '智谱 GLM' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProviderId(name: string): string {
  const id = name.trim();
  if (!id) {
    throw new Error('Provider name is required');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error('Provider name may only contain letters, numbers, dots, underscores, and hyphens');
  }
  return id;
}

function normalizeBaseUrl(value: unknown): string {
  const baseUrl = cleanString(value).replace(/\/+$/, '');
  if (!baseUrl) return '';

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid Claude Code provider base URL: ${baseUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Claude Code provider base URL must start with http:// or https://');
  }
  return baseUrl;
}

function normalizeAuthType(value: unknown, fallback: ProviderAuthType): ProviderAuthType {
  return value === 'api-key' || value === 'auth-token' ? value : fallback;
}

function parseAuthType(value: unknown, fallback: ProviderAuthType): ProviderAuthType {
  if (value == null || value === '') return fallback;
  if (value === 'api-key' || value === 'auth-token') return value;
  throw new Error('Claude Code provider auth type must be "auth-token" or "api-key"');
}

function normalizeModels(config: Record<string, unknown>): ProviderModels {
  return {
    sonnet: cleanString(config.sonnetModel ?? config.sonnet) || undefined,
    opus: cleanString(config.opusModel ?? config.opus) || undefined,
    haiku: cleanString(config.haikuModel ?? config.haiku) || undefined,
  };
}

function readModelsFromSettings(settings: Record<string, any>): ProviderModels {
  const models: ProviderModels = {};
  for (const { tier, envVar } of KNOWN_ENV_VARS) {
    const val = cleanString(settings.env?.[envVar]);
    if (val) models[tier] = val;
  }
  return models;
}

function inferAuthTypeFromSettings(settings: Record<string, any>, baseUrl: string): ProviderAuthType {
  if (settings.env?.ANTHROPIC_AUTH_TOKEN) return 'auth-token';
  if (settings.env?.ANTHROPIC_API_KEY) return 'api-key';
  return baseUrl ? 'auth-token' : 'api-key';
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  let mode = 0o600;
  try {
    mode = (await stat(path)).mode & 0o777;
  } catch {}

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(tempPath, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf-8', mode });
  await rename(tempPath, path);
}

export class ClaudeProviderConfig implements IAccountConfig {
  private readonly providersPath: string;
  private readonly settingsPath: string;
  private cache: ProvidersData | null = null;

  constructor(attDir?: string, claudeDir?: string) {
    const attBase = attDir ?? join(homedir(), '.att');
    const claudeBase = claudeDir ?? join(homedir(), '.claude');
    this.providersPath = join(attBase, 'claude-providers.json');
    this.settingsPath = join(claudeBase, 'settings.json');
  }

  private async load(): Promise<ProvidersData> {
    if (this.cache) return this.cache;

    if (!existsSync(this.providersPath)) {
      const autoDetected = await this.detectFromSettings();
      if (autoDetected) {
        this.cache = autoDetected;
        await this.save(autoDetected);
        return this.cache;
      }
      this.cache = { providers: {}, activeProvider: '' };
      return this.cache;
    }

    const raw = await readFile(this.providersPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const { data, changed } = this.normalizeProvidersData(parsed);
    let shouldSave = changed;

    // If providers exist but no active one, try auto-detecting from settings
    if (Object.keys(data.providers).length > 0 && !data.activeProvider) {
      const settings = await this.loadSettings();
      const detected = this.matchProviderFromSettings(settings, data.providers);
      if (detected) {
        data.activeProvider = detected;
        shouldSave = true;
      }
    }

    if (shouldSave) {
      await this.save(data);
    }

    this.cache = data;
    return this.cache;
  }

  private normalizeProvidersData(raw: unknown): { data: ProvidersData; changed: boolean } {
    if (!isRecord(raw)) {
      throw new Error(`Invalid Claude Code providers file: ${this.providersPath}`);
    }

    const providers: Record<string, ProviderConfig> = {};
    const rawProviders = isRecord(raw.providers) ? raw.providers : {};
    let changed = !isRecord(raw.providers);

    for (const [id, rawProvider] of Object.entries(rawProviders)) {
      if (!isRecord(rawProvider)) {
        changed = true;
        continue;
      }

      const providerId = normalizeProviderId(id);
      const baseUrl = normalizeBaseUrl(rawProvider.baseUrl);
      const apiKey = cleanString(rawProvider.apiKey);
      const provider: ProviderConfig = {
        name: cleanString(rawProvider.name) || providerId,
        apiKey,
        baseUrl,
        authType: normalizeAuthType(rawProvider.authType, baseUrl ? 'auth-token' : 'api-key'),
        models: normalizeModels(isRecord(rawProvider.models) ? rawProvider.models : rawProvider),
      };

      if (providerId !== id || provider.name !== rawProvider.name || provider.authType !== rawProvider.authType) {
        changed = true;
      }
      providers[providerId] = provider;
    }

    let activeProvider = cleanString(raw.activeProvider);
    if (activeProvider && !providers[activeProvider]) {
      activeProvider = '';
      changed = true;
    }

    return { data: { providers, activeProvider }, changed };
  }

  private async detectFromSettings(): Promise<ProvidersData | null> {
    const settings = await this.loadSettings();
    const baseUrl = normalizeBaseUrl(settings.env?.ANTHROPIC_BASE_URL);
    const authType = inferAuthTypeFromSettings(settings, baseUrl);
    const apiKey = cleanString(authType === 'auth-token'
      ? settings.env?.ANTHROPIC_AUTH_TOKEN
      : settings.env?.ANTHROPIC_API_KEY);
    if (!apiKey) return null;

    const known = KNOWN_PROVIDERS.find((p) => baseUrl.includes(p.match));
    const id = known?.id ?? (baseUrl ? 'custom' : 'anthropic');
    const name = known?.name ?? (baseUrl ? 'Custom Claude Provider' : 'Anthropic');

    return {
      providers: {
        [id]: {
          name,
          apiKey,
          baseUrl,
          authType,
          models: readModelsFromSettings(settings),
        },
      },
      activeProvider: id,
    };
  }

  private matchProviderFromSettings(
    settings: Record<string, any>,
    existingProviders: Record<string, ProviderConfig>,
  ): string | null {
    const baseUrl = normalizeBaseUrl(settings.env?.ANTHROPIC_BASE_URL);
    const authToken = cleanString(settings.env?.ANTHROPIC_AUTH_TOKEN);
    const apiKey = cleanString(settings.env?.ANTHROPIC_API_KEY);
    for (const [id, provider] of Object.entries(existingProviders)) {
      if (baseUrl === provider.baseUrl) {
        if (provider.authType === 'auth-token' && authToken && authToken === provider.apiKey) return id;
        if (provider.authType === 'api-key' && apiKey && apiKey === provider.apiKey) return id;
        if (!authToken && !apiKey) return id;
      }
      if (!baseUrl && !provider.baseUrl && provider.authType === 'api-key' && apiKey === provider.apiKey) {
        return id;
      }
    }
    return null;
  }

  private async save(data: ProvidersData): Promise<void> {
    await writeJsonAtomic(this.providersPath, data);
    this.cache = data;
  }

  private async loadSettings(): Promise<Record<string, any>> {
    if (!existsSync(this.settingsPath)) return {};
    const raw = await readFile(this.settingsPath, 'utf-8');
    return JSON.parse(raw) as Record<string, any>;
  }

  private async saveSettings(settings: Record<string, any>): Promise<void> {
    await writeJsonAtomic(this.settingsPath, settings);
  }

  async listAccounts(): Promise<{ id: string; name: string; isActive: boolean }[]> {
    const data = await this.load();
    return Object.entries(data.providers).map(([id, provider]) => ({
      id,
      name: provider.name || id,
      isActive: id === data.activeProvider,
    }));
  }

  async addAccount(name: string, config: Record<string, unknown>): Promise<void> {
    const providerId = normalizeProviderId(name);
    const data = await this.load();
    if (data.providers[providerId]) {
      throw new Error(`Provider "${providerId}" already exists`);
    }

    const baseUrl = normalizeBaseUrl(config.baseUrl);
    const provider: ProviderConfig = {
      name: cleanString(config.name) || providerId,
      apiKey: cleanString(config.apiKey),
      baseUrl,
      authType: parseAuthType(config.authType, baseUrl ? 'auth-token' : 'api-key'),
      models: normalizeModels(config),
    };

    if (!provider.apiKey) {
      throw new Error('API key is required');
    }

    data.providers[providerId] = provider;
    await this.save(data);
  }

  async switchAccount(name: string): Promise<void> {
    const providerId = normalizeProviderId(name);
    const data = await this.load();
    if (!data.providers[providerId]) {
      throw new Error(`Provider "${providerId}" not found. Available: ${Object.keys(data.providers).join(', ') || '(none)'}`);
    }

    const provider = data.providers[providerId];
    const settings = await this.loadSettings();
    if (!isRecord(settings.env)) settings.env = {};

    // Set env vars from provider config
    delete settings.env['ANTHROPIC_API_KEY'];
    delete settings.env['ANTHROPIC_AUTH_TOKEN'];
    if (provider.authType === 'api-key') {
      settings.env['ANTHROPIC_API_KEY'] = provider.apiKey;
    } else {
      settings.env['ANTHROPIC_AUTH_TOKEN'] = provider.apiKey;
    }

    if (provider.baseUrl) {
      settings.env['ANTHROPIC_BASE_URL'] = provider.baseUrl;
    } else {
      delete settings.env['ANTHROPIC_BASE_URL'];
    }

    for (const { tier, envVar } of KNOWN_ENV_VARS) {
      const modelValue = provider.models[tier];
      if (modelValue) {
        settings.env[envVar] = modelValue;
      } else {
        delete settings.env[envVar];
      }
    }

    await this.saveSettings(settings);

    data.activeProvider = providerId;
    await this.save(data);
  }

  async removeAccount(name: string): Promise<void> {
    const providerId = normalizeProviderId(name);
    const data = await this.load();
    if (!data.providers[providerId]) {
      throw new Error(`Provider "${providerId}" not found`);
    }
    if (providerId === data.activeProvider) {
      throw new Error(`Cannot remove active provider "${providerId}". Switch to another provider first.`);
    }

    delete data.providers[providerId];
    await this.save(data);
  }

  async verifyAccount(name: string): Promise<boolean> {
    const providerId = normalizeProviderId(name);
    const data = await this.load();
    const provider = data.providers[providerId];
    if (!provider) return false;
    return !!provider.apiKey;
  }

  async getActiveProvider(): Promise<ProviderConfig | null> {
    const data = await this.load();
    if (!data.activeProvider) return null;
    return data.providers[data.activeProvider] || null;
  }

  async getActiveProviderEntry(): Promise<{ id: string; provider: ProviderConfig } | null> {
    const data = await this.load();
    if (!data.activeProvider) return null;
    const provider = data.providers[data.activeProvider];
    return provider ? { id: data.activeProvider, provider } : null;
  }

  async getProvider(name: string): Promise<ProviderConfig | null> {
    const providerId = normalizeProviderId(name);
    const data = await this.load();
    return data.providers[providerId] || null;
  }

  async listProvidersWithStatus(): Promise<{
    id: string;
    name: string;
    baseUrl: string;
    authType: ProviderAuthType;
    isActive: boolean;
    models: ProviderModels;
  }[]> {
    const data = await this.load();
    return Object.entries(data.providers).map(([id, provider]) => ({
      id,
      name: provider.name || id,
      baseUrl: provider.baseUrl,
      authType: provider.authType,
      isActive: id === data.activeProvider,
      models: provider.models,
    }));
  }
}
