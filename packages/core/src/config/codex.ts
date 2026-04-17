import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IAccountConfig } from './types.js';

interface CodexAuth {
  auth_mode: string;
  OPENAI_API_KEY?: string | null;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
  };
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  account_id?: string;
  last_refresh?: string;
}

interface DecodedJWT {
  email?: string;
  name?: string;
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string;
    chatgpt_plan_type?: string;
    chatgpt_subscription_active_start?: string;
    chatgpt_subscription_active_until?: string;
  };
}

interface CodexAccounts {
  accounts: Record<string, CodexAuth>;
  activeAccount: string;
}

function decodeJWT(token: string | undefined): DecodedJWT {
  if (!token) return {};
  try {
    const parts = token.split('.');
    if (parts.length < 2) return {};
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function extractAuthFields(auth: CodexAuth): { accountId: string; email: string; planType: string; lastRefresh: string } {
  // Try id_token first (richer claims), then access_token
  const idToken = auth.tokens?.id_token || auth.id_token;
  const accessToken = auth.tokens?.access_token || auth.access_token;
  const decoded = decodeJWT(idToken);
  const accessDecoded = decodeJWT(accessToken);

  const openaiAuth = decoded['https://api.openai.com/auth'] || accessDecoded['https://api.openai.com/auth'];
  const email = decoded.email || accessDecoded.email || '-';
  const planType = openaiAuth?.chatgpt_plan_type || '-';
  const accountId = auth.account_id || auth.tokens?.id_token ? (openaiAuth?.chatgpt_account_id || '-') : '-';
  const lastRefresh = auth.last_refresh || '-';

  return { accountId, email, planType, lastRefresh };
}

export class CodexConfig implements IAccountConfig {
  private readonly codexDir: string;
  private readonly authPath: string;
  private readonly accountsPath: string;
  private _newAccountDetected: string | null = null;

  constructor(codexDir?: string) {
    this.codexDir = codexDir ?? join(homedir(), '.codex');
    this.authPath = join(this.codexDir, 'auth.json');
    this.accountsPath = join(this.codexDir, 'accounts.json');
  }

  private async loadAccounts(): Promise<CodexAccounts> {
    let accounts: CodexAccounts;

    if (!existsSync(this.accountsPath)) {
      accounts = { accounts: {}, activeAccount: 'default' };
      if (existsSync(this.authPath)) {
        const auth = JSON.parse(await readFile(this.authPath, 'utf-8'));
        accounts.accounts['default'] = auth;
        accounts.activeAccount = 'default';
        await this.saveAccounts(accounts);
      }
      return accounts;
    }

    accounts = JSON.parse(await readFile(this.accountsPath, 'utf-8'));

    const currentAuth = await this.loadAuth();
    if (currentAuth) {
      const currentAccessToken = currentAuth.tokens?.access_token || currentAuth.access_token;
      const currentInfo = extractAuthFields(currentAuth);

      if (currentAccessToken) {
        // Check if this auth matches any existing account by identity (email)
        const activeName = accounts.activeAccount;
        const stored = accounts.accounts[activeName];
        const storedInfo = stored ? extractAuthFields(stored) : null;
        const sameIdentity = storedInfo && storedInfo.email !== '-'
          ? storedInfo.email === currentInfo.email
          : (stored?.tokens?.access_token || stored?.access_token) === currentAccessToken;

        if (sameIdentity) {
          // Same account, just refresh the token
          const storedAccessToken = stored?.tokens?.access_token || stored?.access_token;
          if (storedAccessToken !== currentAccessToken) {
            accounts.accounts[activeName] = currentAuth;
            await this.saveAccounts(accounts);
          }
        } else {
          // Different account detected — find if it already exists
          const existingName = Object.entries(accounts.accounts).find(([, a]) => {
            const info = extractAuthFields(a);
            return info.email !== '-' && info.email === currentInfo.email;
          })?.[0];

          if (existingName) {
            // Update existing account's token and set as active
            accounts.accounts[existingName] = currentAuth;
            accounts.activeAccount = existingName;
            await this.saveAccounts(accounts);
          } else {
            // Brand new account
            let name = currentInfo.email || 'new-account';
            let finalName = name;
            let suffix = 2;
            while (accounts.accounts[finalName]) {
              finalName = `${name}-${suffix++}`;
            }
            accounts.accounts[finalName] = currentAuth;
            accounts.activeAccount = finalName;
            await this.saveAccounts(accounts);
            this._newAccountDetected = finalName;
          }
        }
      }
    }

    return accounts;
  }

  private async saveAccounts(accounts: CodexAccounts): Promise<void> {
    await writeFile(this.accountsPath, JSON.stringify(accounts, null, 2) + '\n', 'utf-8');
  }

  private async loadAuth(): Promise<CodexAuth | null> {
    if (!existsSync(this.authPath)) return null;
    return JSON.parse(await readFile(this.authPath, 'utf-8'));
  }

  private async saveAuth(auth: CodexAuth): Promise<void> {
    await writeFile(this.authPath, JSON.stringify(auth, null, 2) + '\n', 'utf-8');
  }

  async listAccounts(): Promise<{
    id: string;
    name: string;
    isActive: boolean;
    email: string;
    planType: string;
    accountId: string;
    lastRefresh: string;
  }[]> {
    this._newAccountDetected = null;
    const accounts = await this.loadAccounts();
    return Object.entries(accounts.accounts).map(([name, auth]) => {
      const info = extractAuthFields(auth);
      return {
        id: name,
        name,
        isActive: name === accounts.activeAccount,
        email: info.email,
        planType: info.planType,
        accountId: info.accountId,
        lastRefresh: info.lastRefresh,
      };
    });
  }

  get newAccountDetected(): string | null {
    return this._newAccountDetected;
  }

  async addAccount(name: string, config: Record<string, unknown>): Promise<void> {
    const accounts = await this.loadAccounts();
    if (accounts.accounts[name]) {
      throw new Error(`Account "${name}" already exists`);
    }

    const auth: CodexAuth = {
      auth_mode: (config.auth_mode as string) || 'chatgpt',
      tokens: {
        id_token: config.id_token as string,
        access_token: config.access_token as string,
        refresh_token: config.refresh_token as string,
      },
      account_id: config.account_id as string,
    };

    accounts.accounts[name] = auth;
    await this.saveAccounts(accounts);
  }

  async switchAccount(name: string): Promise<void> {
    const accounts = await this.loadAccounts();
    if (!accounts.accounts[name]) {
      throw new Error(`Account "${name}" not found. Available: ${Object.keys(accounts.accounts).join(', ')}`);
    }

    const currentAuth = await this.loadAuth();
    if (currentAuth && accounts.accounts[accounts.activeAccount]) {
      accounts.accounts[accounts.activeAccount] = currentAuth;
    }

    accounts.activeAccount = name;
    await this.saveAuth(accounts.accounts[name]);
    await this.saveAccounts(accounts);
  }

  async removeAccount(name: string): Promise<void> {
    const accounts = await this.loadAccounts();
    if (!accounts.accounts[name]) {
      throw new Error(`Account "${name}" not found`);
    }
    if (name === accounts.activeAccount) {
      throw new Error(`Cannot remove active account "${name}". Switch to another account first.`);
    }

    delete accounts.accounts[name];
    await this.saveAccounts(accounts);
  }

  async renameAccount(oldName: string, newName: string): Promise<void> {
    const accounts = await this.loadAccounts();
    if (!accounts.accounts[oldName]) {
      throw new Error(`Account "${oldName}" not found. Available: ${Object.keys(accounts.accounts).join(', ')}`);
    }
    if (accounts.accounts[newName]) {
      throw new Error(`Account "${newName}" already exists`);
    }

    accounts.accounts[newName] = accounts.accounts[oldName];
    delete accounts.accounts[oldName];

    if (accounts.activeAccount === oldName) {
      accounts.activeAccount = newName;
    }

    await this.saveAccounts(accounts);
  }

  async verifyAccount(name: string): Promise<boolean> {
    const accounts = await this.loadAccounts();
    const auth = accounts.accounts[name];
    if (!auth) return false;

    const accessToken = auth.tokens?.access_token || auth.access_token;
    return !!accessToken;
  }
}
