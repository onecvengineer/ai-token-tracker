import { open as openFile, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import type { Source } from '../collectors/types.js';

export interface BalanceRateLimits {
  planType: string | null;
  primaryUsedPercent: number | null;
  primaryResetAfter: number | null;
  secondaryUsedPercent: number | null;
  secondaryResetAfter: number | null;
}

export interface BalanceResult {
  balance: number | null;
  balanceUnit: string;
  source: Source;
  accountName: string;
  model: string;
  status: 'active' | 'inactive' | 'unknown';
  rateLimits?: BalanceRateLimits;
  balanceInfo?: {
    balance: number;
    totalSpend: number;
    rechargeAmount: number;
  };
}

export interface CodexAccountStatus {
  id: string;
  name: string;
  email: string;
  model: string;
  planType: string;
  isActive: boolean;
  status: 'active' | 'inactive' | 'unknown';
  rateLimits?: BalanceRateLimits;
}

interface CodexAccountAuthRow {
  id: string;
  name: string;
  email: string;
  model: string;
  planType: string;
  isActive: boolean;
  status: 'active' | 'inactive' | 'unknown';
  accessToken: string | undefined;
  idToken: string | undefined;
  refreshToken: string | undefined;
}

interface DecodedJWT {
  client_id?: string;
  exp?: number;
  email?: string;
  'https://api.openai.com/auth'?: {
    chatgpt_plan_type?: string;
    chatgpt_account_id?: string;
  };
}

interface CodexAuth {
  auth_mode?: string;
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

interface CodexAccountsData {
  accounts: Record<string, CodexAuth>;
  activeAccount: string;
}

const DEFAULT_CODEX_RATE_LIMIT_CONCURRENCY = 2;
const DEFAULT_CODEX_RATE_LIMIT_TIMEOUT_MS = 8000;
const DEFAULT_CODEX_RATE_LIMIT_RETRIES = 1;
const DEFAULT_CODEX_RATE_LIMIT_FALLBACK_TIMEOUT_MS = 12000;
const CODEX_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const CODEX_TOKEN_REFRESH_LOCK_STALE_MS = 2 * 60 * 1000;
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

function decodeJWT(token: string | undefined): DecodedJWT {
  if (!token) return {};
  try {
    const payload = Buffer.from(token.split('.')[1], 'base64url').toString('utf-8');
    return JSON.parse(payload) as DecodedJWT;
  } catch {
    return {};
  }
}

function getCodexModel(codexDir: string): string {
  try {
    const configToml = readFileSync(join(codexDir, 'config.toml'), 'utf-8');
    const modelMatch = configToml.match(/^model\s*=\s*"(.+)"/m);
    return modelMatch?.[1] || '-';
  } catch {
    return '-';
  }
}

function getAuthAccessToken(auth: CodexAuth): string | undefined {
  return auth.tokens?.access_token || auth.access_token;
}

function getAuthIdToken(auth: CodexAuth): string | undefined {
  return auth.tokens?.id_token || auth.id_token;
}

function getAuthRefreshToken(auth: CodexAuth): string | undefined {
  return auth.tokens?.refresh_token || auth.refresh_token;
}

function isTokenExpiredOrExpiring(token: string | undefined): boolean {
  const exp = decodeJWT(token).exp;
  if (!exp) return false;
  return exp * 1000 <= Date.now() + CODEX_TOKEN_REFRESH_SKEW_MS;
}

function setAuthTokens(auth: CodexAuth, refreshed: Required<Pick<CodexRefreshResponse, 'access_token'>> & CodexRefreshResponse): CodexAuth {
  const next: CodexAuth = { ...auth };
  const tokens = { ...(next.tokens ?? {}) };
  tokens.access_token = refreshed.access_token;
  if (refreshed.id_token) tokens.id_token = refreshed.id_token;
  if (refreshed.refresh_token) tokens.refresh_token = refreshed.refresh_token;
  next.tokens = tokens;
  next.access_token = undefined;
  next.id_token = undefined;
  next.refresh_token = undefined;
  next.last_refresh = new Date().toISOString();
  return next;
}

function buildCodexAccountRow(
  name: string,
  auth: CodexAuth,
  model: string,
  activeAccount: string | null,
): CodexAccountAuthRow {
  const idToken = getAuthIdToken(auth);
  const accessToken = getAuthAccessToken(auth);
  const refreshToken = getAuthRefreshToken(auth);
  const decoded = decodeJWT(idToken || accessToken);

  return {
    id: name,
    name,
    email: decoded.email || name,
    model,
    planType: decoded['https://api.openai.com/auth']?.chatgpt_plan_type || '-',
    isActive: name === activeAccount,
    status: !accessToken ? 'inactive' : name === activeAccount ? 'active' : 'inactive',
    accessToken,
    idToken,
    refreshToken,
  };
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  let mode = 0o600;
  try {
    mode = (await stat(path)).mode & 0o777;
  } catch {}

  await writeFile(tempPath, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf-8', mode });
  await rename(tempPath, path);
}

async function loadCodexAccountAuthRows(): Promise<CodexAccountAuthRow[]> {
  const codexDir = join(homedir(), '.codex');
  const authPath = join(codexDir, 'auth.json');
  const accountsPath = join(codexDir, 'accounts.json');

  if (!existsSync(authPath)) {
    return [];
  }

  const model = getCodexModel(codexDir);
  let accountsData: CodexAccountsData | null = null;

  if (existsSync(accountsPath)) {
    try {
      accountsData = JSON.parse(await readFile(accountsPath, 'utf-8'));
    } catch {}
  }

  if (!accountsData || Object.keys(accountsData.accounts).length === 0) {
    const auth = JSON.parse(await readFile(authPath, 'utf-8')) as CodexAuth;
    return [buildCodexAccountRow('default', auth, model, 'default')];
  }

  return Object.entries(accountsData.accounts).map(([name, auth]) => {
    return buildCodexAccountRow(name, auth, model, accountsData?.activeAccount ?? null);
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) break;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  };

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function getAllBalances(): Promise<BalanceResult[]> {
  return getBalancesBySource(['claude-code', 'codex', 'hermes']);
}

export async function getBalancesBySource(sources: Source[]): Promise<BalanceResult[]> {
  const results = await Promise.allSettled([
    ...sources.map((source) => getBalanceBySource(source)),
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

async function getBalanceBySource(source: Source): Promise<BalanceResult | BalanceResult[]> {
  switch (source) {
    case 'claude-code':
      return getClaudeCodeBalance();
    case 'codex':
      return getCodexBalances();
    case 'hermes':
      return getHermesBalance();
  }
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
  try {
    const accounts = await getCodexAccountStatuses();
    if (accounts.length === 0) {
      return [{ balance: null, balanceUnit: 'tokens', source: 'codex', accountName: 'default', model: '-', status: 'inactive' }];
    }

    return accounts.map((account) => ({
      balance: null,
      balanceUnit: 'tokens',
      source: 'codex',
      accountName: account.email,
      model: account.model,
      status: account.status,
      rateLimits: account.rateLimits,
    }));
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

interface CodexRefreshResponse {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function debugCodexBalance(message: string, detail?: Record<string, unknown>): void {
  if (!process.env.ATT_DEBUG_BALANCE) return;
  const suffix = detail ? ` ${JSON.stringify(detail)}` : '';
  console.warn(`[att:codex-balance] ${message}${suffix}`);
}

function proxiedHttpsRequest(
  urlStr: string,
  options: {
    method?: string;
    headers?: Record<string, string | number>;
    body?: string;
    timeout?: number;
  } = {},
): Promise<{ statusCode: number | undefined; body: string }> {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  const target = new URL(urlStr);
  const method = options.method ?? 'GET';
  const timeout = options.timeout ?? 8000;
  const headers = options.headers ?? {};
  const body = options.body;

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
            path: `${target.pathname}${target.search}`,
            method,
            headers,
            createConnection: () => tlsSocket,
            timeout,
          }, (tlsRes) => {
            const chunks: Buffer[] = [];
            tlsRes.on('data', (c) => chunks.push(c));
            tlsRes.on('end', () => resolve({
              statusCode: tlsRes.statusCode,
              body: Buffer.concat(chunks).toString(),
            }));
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('tls timeout')); });
          req.end(body);
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
    const req = https.request(urlStr, { method, headers, family: 4, timeout }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        body: Buffer.concat(chunks).toString(),
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end(body);
  });
}

function proxiedHttpsGet(urlStr: string, headers: Record<string, string>, timeout = 8000): Promise<string> {
  return proxiedHttpsRequest(urlStr, { headers, timeout }).then((response) => response.body);
}

async function fetchCodexJson<T>(
  urlStr: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<T | undefined> {
  try {
    const response = await withTimeout(
      proxiedHttpsRequest(urlStr, { headers, timeout: timeoutMs }),
      timeoutMs,
    );
    let json: T & { error?: unknown; detail?: unknown; message?: unknown };
    try {
      json = JSON.parse(response.body) as T & { error?: unknown; detail?: unknown; message?: unknown };
    } catch {
      debugCodexBalance('usage response was not JSON', {
        statusCode: response.statusCode,
        bodyPrefix: response.body.slice(0, 80),
      });
      return undefined;
    }
    if (response.statusCode && response.statusCode >= 400) {
      debugCodexBalance('usage request failed', {
        statusCode: response.statusCode,
        error: json.error,
        detail: json.detail,
        message: json.message,
      });
      return undefined;
    }
    return json;
  } catch (error) {
    debugCodexBalance('usage request threw', {
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

async function refreshCodexAuthTokens(
  refreshToken: string | undefined,
  timeoutMs: number,
  clientId: string,
): Promise<CodexRefreshResponse | undefined> {
  if (!refreshToken) return undefined;

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString();
    const response = await withTimeout(
      proxiedHttpsRequest('https://auth.openai.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        body,
        timeout: timeoutMs,
      }),
      timeoutMs,
    );
    let refreshed: CodexRefreshResponse;
    try {
      refreshed = JSON.parse(response.body) as CodexRefreshResponse;
    } catch {
      debugCodexBalance('refresh response was not JSON', {
        statusCode: response.statusCode,
        bodyPrefix: response.body.slice(0, 80),
      });
      return undefined;
    }
    if (response.statusCode && response.statusCode >= 400) {
      debugCodexBalance('refresh request failed', {
        statusCode: response.statusCode,
        error: refreshed.error,
        errorDescription: refreshed.error_description,
      });
      return undefined;
    }
    if (!refreshed.access_token) {
      debugCodexBalance('refresh response missing access_token', {
        statusCode: response.statusCode,
        error: refreshed.error,
        errorDescription: refreshed.error_description,
      });
    }
    return refreshed.access_token ? refreshed : undefined;
  } catch (error) {
    debugCodexBalance('refresh request threw', {
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

async function reloadCodexAccountRow(row: CodexAccountAuthRow): Promise<CodexAccountAuthRow> {
  const codexDir = join(homedir(), '.codex');
  const authPath = join(codexDir, 'auth.json');
  const accountsPath = join(codexDir, 'accounts.json');
  const model = row.model || getCodexModel(codexDir);

  if (existsSync(accountsPath)) {
    try {
      const accountsData = JSON.parse(await readFile(accountsPath, 'utf-8')) as CodexAccountsData;
      const auth = accountsData.accounts[row.id];
      if (auth) {
        return buildCodexAccountRow(row.id, auth, model, accountsData.activeAccount);
      }
    } catch {}
  }

  if (row.id === 'default' && existsSync(authPath)) {
    try {
      const auth = JSON.parse(await readFile(authPath, 'utf-8')) as CodexAuth;
      return buildCodexAccountRow('default', auth, model, 'default');
    } catch {}
  }

  return row;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function codexRefreshLockPath(accountId: string): string {
  const safeAccountId = accountId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(homedir(), '.codex', `.att-refresh-${safeAccountId}.lock`);
}

async function removeStaleLock(lockPath: string): Promise<void> {
  try {
    const lockStat = await stat(lockPath);
    if (Date.now() - lockStat.mtimeMs > CODEX_TOKEN_REFRESH_LOCK_STALE_MS) {
      await unlink(lockPath);
    }
  } catch {}
}

async function acquireCodexRefreshLock(accountId: string, timeoutMs: number): Promise<() => Promise<void>> {
  const lockPath = codexRefreshLockPath(accountId);
  const startedAt = Date.now();

  while (true) {
    try {
      const handle = await openFile(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({
        pid: process.pid,
        accountId,
        createdAt: new Date().toISOString(),
      }));
      await handle.close();
      return async () => {
        try {
          await unlink(lockPath);
        } catch {}
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      await removeStaleLock(lockPath);
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`timeout waiting for refresh lock: ${accountId}`);
      }
      await sleep(150);
    }
  }
}

async function withCodexRefreshLock<T>(
  accountId: string,
  action: () => Promise<T>,
  fallback: T,
): Promise<T> {
  let release: (() => Promise<void>) | undefined;
  try {
    release = await acquireCodexRefreshLock(accountId, DEFAULT_CODEX_RATE_LIMIT_FALLBACK_TIMEOUT_MS);
    return await action();
  } catch (error) {
    debugCodexBalance('refresh lock failed', {
      accountId,
      message: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  } finally {
    await release?.();
  }
}

async function refreshCodexAccountRow(row: CodexAccountAuthRow, timeoutMs: number): Promise<CodexAccountAuthRow> {
  return withCodexRefreshLock(row.id, async () => {
    const latestRow = await reloadCodexAccountRow(row);
    if (!isTokenExpiredOrExpiring(latestRow.accessToken)) {
      return latestRow;
    }

    const clientId = decodeJWT(latestRow.accessToken).client_id || CODEX_OAUTH_CLIENT_ID;
    const refreshed = await refreshCodexAuthTokens(latestRow.refreshToken, timeoutMs, clientId);
    if (!refreshed?.access_token) return latestRow;

    const nextRow = {
      ...latestRow,
      accessToken: refreshed.access_token,
      idToken: refreshed.id_token || latestRow.idToken,
      refreshToken: refreshed.refresh_token || latestRow.refreshToken,
      email: decodeJWT(refreshed.id_token || latestRow.idToken || refreshed.access_token).email || latestRow.email,
      planType: decodeJWT(refreshed.id_token || latestRow.idToken || refreshed.access_token)['https://api.openai.com/auth']?.chatgpt_plan_type || latestRow.planType,
    };
    await persistRefreshedCodexAccount(nextRow);
    return nextRow;
  }, row);
}

async function persistRefreshedCodexAccount(row: CodexAccountAuthRow): Promise<void> {
  const codexDir = join(homedir(), '.codex');
  const authPath = join(codexDir, 'auth.json');
  const accountsPath = join(codexDir, 'accounts.json');

  if (existsSync(accountsPath)) {
    try {
      const accountsData = JSON.parse(await readFile(accountsPath, 'utf-8')) as CodexAccountsData;
      const auth = accountsData.accounts[row.id];
      if (!auth) return;
      accountsData.accounts[row.id] = setAuthTokens(auth, { access_token: row.accessToken!, id_token: row.idToken, refresh_token: row.refreshToken });
      await writeJsonAtomic(accountsPath, accountsData);
      if (accountsData.activeAccount === row.id) {
        await writeJsonAtomic(authPath, accountsData.accounts[row.id]);
      }
      return;
    } catch {
      return;
    }
  }

  if (row.id === 'default' && existsSync(authPath)) {
    try {
      const auth = JSON.parse(await readFile(authPath, 'utf-8')) as CodexAuth;
      const next = setAuthTokens(auth, { access_token: row.accessToken!, id_token: row.idToken, refresh_token: row.refreshToken });
      await writeJsonAtomic(authPath, next);
    } catch {}
  }
}

export async function getCodexAccountStatuses(options?: {
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
}): Promise<CodexAccountStatus[]> {
  const authRows = await loadCodexAccountAuthRows();
  const concurrency = options?.concurrency ?? DEFAULT_CODEX_RATE_LIMIT_CONCURRENCY;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_CODEX_RATE_LIMIT_TIMEOUT_MS;
  const retries = options?.retries ?? DEFAULT_CODEX_RATE_LIMIT_RETRIES;
  const rateLimitsByAccountId = new Map<string, BalanceResult['rateLimits']>();
  const refreshedRowsByAccountId = new Map<string, CodexAccountAuthRow>();

  await mapWithConcurrency(authRows, concurrency, async (row) => {
    const result = await fetchCodexRateLimitsWithRetry(row, {
      timeoutMs,
      retries,
    });
    rateLimitsByAccountId.set(row.id, result.rateLimits);
    if (result.row !== row) {
      refreshedRowsByAccountId.set(row.id, result.row);
    }
  });

  if (concurrency > 1) {
    for (const row of authRows) {
      const currentRow = refreshedRowsByAccountId.get(row.id) || row;
      if (!currentRow.accessToken || rateLimitsByAccountId.get(row.id)) continue;
      if (isTokenExpiredOrExpiring(currentRow.accessToken)) continue;
      const result = await fetchCodexRateLimitsWithRetry(currentRow, {
        timeoutMs: Math.max(timeoutMs, DEFAULT_CODEX_RATE_LIMIT_FALLBACK_TIMEOUT_MS),
        retries,
      });
      rateLimitsByAccountId.set(row.id, result.rateLimits);
      if (result.row !== currentRow) {
        refreshedRowsByAccountId.set(row.id, result.row);
      }
    }
  }

  return authRows.map((row) => {
    const currentRow = refreshedRowsByAccountId.get(row.id) || row;
    const rateLimits = rateLimitsByAccountId.get(currentRow.id);
    return {
      id: currentRow.id,
      name: currentRow.name,
      email: currentRow.email,
      model: currentRow.model,
      planType: rateLimits?.planType || currentRow.planType,
      isActive: currentRow.isActive,
      status: currentRow.status,
      rateLimits,
    };
  });
}

async function fetchCodexRateLimitsWithRetry(
  row: CodexAccountAuthRow,
  options?: { timeoutMs?: number; retries?: number },
): Promise<{ row: CodexAccountAuthRow; rateLimits: BalanceResult['rateLimits'] }> {
  const retries = Math.max(options?.retries ?? DEFAULT_CODEX_RATE_LIMIT_RETRIES, 0);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_CODEX_RATE_LIMIT_TIMEOUT_MS;
  let currentRow = row;

  if (isTokenExpiredOrExpiring(currentRow.accessToken)) {
    const nextRow = await refreshCodexAccountRow(currentRow, timeoutMs);
    if (nextRow !== currentRow) {
      currentRow = nextRow;
    } else {
      return { row: currentRow, rateLimits: undefined };
    }
  }

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const rateLimits = await fetchCodexRateLimits(currentRow.accessToken, currentRow.idToken, {
      timeoutMs,
    });
    if (rateLimits) {
      return { row: currentRow, rateLimits };
    }
  }

  return { row: currentRow, rateLimits: undefined };
}

export async function fetchCodexRateLimits(
  accessToken: string | undefined,
  idToken: string | undefined,
  options?: { timeoutMs?: number },
): Promise<BalanceResult['rateLimits']> {
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

    const timeoutMs = options?.timeoutMs ?? 8000;
    const json = await fetchCodexJson<ChatGPTUsageResponse>('https://chatgpt.com/backend-api/wham/usage', headers, timeoutMs);
    if (!json) return undefined;
    const rl = json.rate_limit;
    if (!rl) {
      debugCodexBalance('usage response missing rate_limit', {
        planType: json.plan_type,
      });
      return undefined;
    }

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
