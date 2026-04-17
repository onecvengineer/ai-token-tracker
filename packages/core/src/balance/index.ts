import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import type { Source } from '../collectors/types.js';

interface BalanceResult {
  balance: number | null;
  balanceUnit: string;
  source: Source;
  accountName: string;
  model: string;
  status: 'active' | 'inactive' | 'unknown';
  rateLimits?: {
    planType: string | null;
    primaryUsedPercent: number | null;
    primaryResetAfter: number | null;
    secondaryUsedPercent: number | null;
    secondaryResetAfter: number | null;
  };
  balanceInfo?: {
    balance: number;
    totalSpend: number;
    rechargeAmount: number;
  };
}

export async function getAllBalances(): Promise<BalanceResult[]> {
  const results = await Promise.allSettled([
    getClaudeCodeBalance(),
    getCodexBalances(),
    getHermesBalance(),
  ]);
  const flat: BalanceResult[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const val = r.value;
      if (Array.isArray(val)) flat.push(...val);
      else flat.push(val);
    } else {
      flat.push({ balance: null, balanceUnit: 'tokens', source: 'unknown' as Source, accountName: 'default', model: '-', status: 'unknown' as const });
    }
  }
  return flat;
}

async function getClaudeCodeBalance(): Promise<BalanceResult> {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  if (!existsSync(settingsPath)) {
    return { balance: null, balanceUnit: 'tokens', source: 'claude-code', accountName: 'default', model: '-', status: 'inactive' };
  }

  try {
    const settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
    const authToken = settings.env?.ANTHROPIC_AUTH_TOKEN || settings.env?.ANTHROPIC_API_KEY;
    const hasToken = !!authToken;
    const model = settings.env?.ANTHROPIC_DEFAULT_SONNET_MODEL || settings.env?.ANTHROPIC_DEFAULT_OPUS_MODEL || '-';
    const baseUrl = settings.env?.ANTHROPIC_BASE_URL || '';

    // If using Zhipu (智谱) proxy, query their API for quota and balance
    if (baseUrl.includes('bigmodel.cn') && authToken) {
      const [quotaData, balanceData] = await Promise.allSettled([
        fetchZhipuQuota(authToken),
        fetchZhipuBalance(authToken),
      ]);

      const quota = quotaData.status === 'fulfilled' ? quotaData.value : null;
      const bal = balanceData.status === 'fulfilled' ? balanceData.value : null;

      const tokensLimit = quota?.limits?.find((l: any) => l.type === 'TOKENS_LIMIT');
      const tokensResetAfter = tokensLimit?.nextResetTime
        ? Math.max(0, Math.round((tokensLimit.nextResetTime - Date.now()) / 1000))
        : null;

      return {
        balance: bal?.availableBalance ?? null,
        balanceUnit: 'CNY',
        source: 'claude-code',
        accountName: 'zhipu',
        model,
        status: hasToken ? 'active' : 'unknown',
        rateLimits: tokensLimit ? {
          planType: quota?.level ?? null,
          primaryUsedPercent: tokensLimit.percentage ?? null,
          primaryResetAfter: tokensResetAfter,
          secondaryUsedPercent: null,
          secondaryResetAfter: null,
        } : undefined,
        balanceInfo: bal ? {
          balance: bal.availableBalance,
          totalSpend: bal.totalSpendAmount,
          rechargeAmount: bal.rechargeAmount,
        } : undefined,
      };
    }

    return {
      balance: null,
      balanceUnit: 'tokens',
      source: 'claude-code',
      accountName: 'default',
      model,
      status: hasToken ? 'active' : 'unknown',
    };
  } catch {
    return { balance: null, balanceUnit: 'tokens', source: 'claude-code', accountName: 'default', model: '-', status: 'unknown' };
  }
}

async function fetchZhipuQuota(authToken: string): Promise<any> {
  const resp = await fetch('https://open.bigmodel.cn/api/monitor/usage/quota/limit', {
    headers: { Authorization: authToken },
  });
  if (!resp.ok) return null;
  const json = await resp.json() as any;
  return json.success ? json.data : null;
}

async function fetchZhipuBalance(authToken: string): Promise<any> {
  const resp = await fetch('https://www.bigmodel.cn/api/biz/account/query-customer-account-report', {
    headers: { Authorization: authToken },
  });
  if (!resp.ok) return null;
  const json = await resp.json() as any;
  return json.success ? json.data : null;
}

async function getCodexBalances(): Promise<BalanceResult[]> {
  const codexDir = join(homedir(), '.codex');
  const authPath = join(codexDir, 'auth.json');
  const accountsPath = join(codexDir, 'accounts.json');
  if (!existsSync(authPath)) {
    return [{ balance: null, balanceUnit: 'tokens', source: 'codex', accountName: 'default', model: '-', status: 'inactive' }];
  }

  try {
    // Get model from config.toml
    let model = '-';
    try {
      const configToml = readFileSync(join(codexDir, 'config.toml'), 'utf-8');
      const modelMatch = configToml.match(/^model\s*=\s*"(.+)"/m);
      if (modelMatch) model = modelMatch[1];
    } catch {}

    // Load all accounts
    let accountsData: { accounts: Record<string, any>; activeAccount: string } | null = null;
    if (existsSync(accountsPath)) {
      try { accountsData = JSON.parse(await readFile(accountsPath, 'utf-8')); } catch {}
    }

    if (!accountsData || Object.keys(accountsData.accounts).length === 0) {
      // No accounts.json — use auth.json directly
      const auth = JSON.parse(await readFile(authPath, 'utf-8'));
      const idToken = auth.tokens?.id_token || auth.id_token;
      const accessToken = auth.tokens?.access_token || auth.access_token;
      let accountName = 'default';
      try {
        const decoded = JSON.parse(Buffer.from((idToken || accessToken || '').split('.')[1], 'base64url').toString());
        accountName = decoded.email || 'default';
      } catch {}
      const rateLimits = await fetchCodexRateLimits(accessToken, idToken);
      return [{ balance: null, balanceUnit: 'tokens', source: 'codex', accountName, model, status: accessToken ? 'active' : 'unknown', rateLimits }];
    }

    // Iterate all accounts sequentially
    const results: BalanceResult[] = [];
    for (const [name, auth] of Object.entries(accountsData.accounts)) {
      const accessToken = auth.tokens?.access_token || auth.access_token;
      const idToken = auth.tokens?.id_token || auth.id_token;
      const isActive = name === accountsData.activeAccount;
      const status: BalanceResult['status'] = !accessToken ? 'inactive' : isActive ? 'active' : 'inactive';
      let email = name;
      try {
        const decoded = JSON.parse(Buffer.from((idToken || '').split('.')[1], 'base64url').toString());
        email = decoded.email || name;
      } catch {}
      const rateLimits = await fetchCodexRateLimits(accessToken, idToken);
      results.push({
        balance: null,
        balanceUnit: 'tokens',
        source: 'codex',
        accountName: email,
        model,
        status,
        rateLimits,
      });
    }
    return results;
  } catch {
    return [{ balance: null, balanceUnit: 'tokens', source: 'codex', accountName: 'default', model: '-', status: 'unknown' }];
  }
}

interface ChatGPTUsageResponse {
  plan_type?: string;
  rate_limit?: {
    primary_window?: { used_percent: number; reset_after_seconds: number };
    secondary_window?: { used_percent: number; reset_after_seconds: number };
  };
}

function proxiedHttpsGet(urlStr: string, headers: Record<string, string>, timeout = 8000): Promise<string> {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  const target = new URL(urlStr);

  if (proxyUrl) {
    // Use HTTP CONNECT proxy tunnel
    const proxy = new URL(proxyUrl);
    return new Promise((resolve, reject) => {
      const connectReq = http.request({
        host: proxy.hostname,
        port: proxy.port || 80,
        method: 'CONNECT',
        path: `${target.hostname}:443`,
        timeout,
      });
      connectReq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          return reject(new Error(`CONNECT ${res.statusCode}`));
        }
        // Upgrade to TLS over the CONNECT tunnel
        const tlsSocket = tls.connect({
          socket,
          servername: target.hostname,
        }, () => {
          const req = https.request({
            hostname: target.hostname,
            path: target.pathname,
            method: 'GET',
            headers,
            createConnection: () => tlsSocket,
            timeout,
          }, (tlsRes) => {
            const chunks: Buffer[] = [];
            tlsRes.on('data', (c) => chunks.push(c));
            tlsRes.on('end', () => resolve(Buffer.concat(chunks).toString()));
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('tls timeout')); });
          req.end();
        });
        tlsSocket.on('error', reject);
      });
      connectReq.on('error', reject);
      connectReq.on('timeout', () => { connectReq.destroy(); reject(new Error('proxy timeout')); });
      connectReq.end();
    });
  }

  // Direct connection
  return new Promise((resolve, reject) => {
    const req = https.get(urlStr, { headers, family: 4, timeout }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

export async function fetchCodexRateLimits(accessToken: string | undefined, idToken: string | undefined): Promise<BalanceResult['rateLimits']> {
  if (!accessToken) return undefined;

  try {
    // Extract chatgpt_account_id from id_token JWT
    let accountId = '';
    if (idToken) {
      try {
        const decoded = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());
        accountId = decoded['https://api.openai.com/auth']?.chatgpt_account_id || '';
      } catch {}
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
    if (accountId) {
      headers['ChatGPT-Account-Id'] = accountId;
    }

    const body = await proxiedHttpsGet('https://chatgpt.com/backend-api/wham/usage', headers);
    const json = JSON.parse(body) as ChatGPTUsageResponse;
    const rl = json.rate_limit;
    if (!rl) return undefined;

    return {
      planType: json.plan_type || null,
      primaryUsedPercent: rl.primary_window?.used_percent ?? null,
      primaryResetAfter: rl.primary_window?.reset_after_seconds ?? null,
      secondaryUsedPercent: rl.secondary_window?.used_percent ?? null,
      secondaryResetAfter: rl.secondary_window?.reset_after_seconds ?? null,
    };
  } catch {
    return undefined;
  }
}

async function getHermesBalance(): Promise<BalanceResult> {
  const configPath = join(homedir(), '.hermes', 'config.yaml');
  if (!existsSync(configPath)) {
    return { balance: null, balanceUnit: 'tokens', source: 'hermes', accountName: 'default', model: '-', status: 'inactive' };
  }

  try {
    const raw = await readFile(configPath, 'utf-8');
    const providerMatch = raw.match(/provider:\s*(.+)/);
    const modelMatch = raw.match(/default:\s*(.+)/);
    return {
      balance: null,
      balanceUnit: 'tokens',
      source: 'hermes',
      accountName: providerMatch?.[1]?.trim() || 'default',
      model: modelMatch?.[1]?.trim() || '-',
      status: 'active',
    };
  } catch {
    return { balance: null, balanceUnit: 'tokens', source: 'hermes', accountName: 'default', model: '-', status: 'unknown' };
  }
}
