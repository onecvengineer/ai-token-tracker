# AI Token Tracker (att)

统一追踪 Claude Code、Codex、Hermes 的 Token 用量，提供模型切换、多账号管理和实时额度查询。

## 快速开始

```bash
# 安装依赖并构建
pnpm install && pnpm -r build

# 同步数据
att sync

# 查看用量
att usage show --preset 7d

# 查看所有账号额度
att balance
```

## 安装与构建

```bash
pnpm install
pnpm -r build

# 仅构建特定包
pnpm --filter @att/core build
pnpm --filter @att/api build
pnpm --filter @att/cli build
pnpm --filter @att/web build
```

全局命令链接：

```bash
ln -sf /home/haibare/project/ai-token-tracker/packages/cli/dist/index.js ~/.local/bin/att
```

## 全部命令参考

### 数据同步

```bash
att sync

# 数据来源：
#   Claude Code  → ~/.claude/stats-cache.json + 智谱 API
#   Codex        → ~/.codex/state_5.sqlite + rollout 文件
#   Hermes       → ~/.hermes/state.db + sessions
# 存储：~/.att/data.db
```

### 用量查看

```bash
att usage show                          # 全部
att usage show --preset today           # 今天
att usage show --preset 7d              # 最近 7 天
att usage show --preset 30d             # 最近 30 天
att usage show --preset this_month      # 本月
att usage show --start 2026-04-01 --end 2026-04-15

# 按来源筛选
att usage show --preset 7d --source claude-code
att usage show --preset 7d --source codex

# 每日明细
att usage daily --preset 7d

# 导出
att usage export -f json
att usage export -f csv --start 2026-04-01
```

### 账号额度查询

```bash
# 查看所有工具的账号状态和实时额度
att balance
```

展示内容：
- Claude Code：智谱账号 Plan、剩余额度百分比、刷新时间
- Codex：所有账号的 5h/7d 窗口额度、刷新时间、活跃状态
- Hermes：账号状态

### Claude Code 模型配置

```bash
att config claude list-models

# 重置为默认模型
att config claude set-model sonnet
att config claude set-model opus
att config claude set-model haiku

# 设置自定义模型
att config claude set-model glm-5.0 --tier sonnet
att config claude set-model glm-5.0 --tier opus
```

### Codex 多账号管理

```bash
# 列出所有账号（含实时额度）
att config codex accounts list

# 重命名账号
att config codex accounts rename <旧名> <新名>

# 切换账号
att config codex accounts switch <账号名>

# 添加账号
att config codex accounts add <账号名> \
  --access-token "eyJ..." \
  --id-token "eyJ..." \
  --refresh-token "eyJ..."

# 验证账号
att config codex accounts verify <账号名>

# 删除账号
att config codex accounts remove <账号名>
```

**自动检测新账号**：运行 `codex login` 登录新账号后，执行 `att config codex accounts list` 会自动识别并添加新账号（通过 email 匹配）。

账号数据存储：
- `~/.codex/accounts.json` — 所有账号
- `~/.codex/auth.json` — 当前激活账号

### 启动 API 服务

```bash
att serve              # 默认端口 3456
att serve --port 8080
```

### 启动 Web 前端

```bash
att serve &
cd packages/web && pnpm dev
# 浏览器访问 http://localhost:3457
```

## 项目结构

```
ai-token-tracker/
├── packages/
│   ├── core/           # 核心库
│   │   └── src/
│   │       ├── collectors/    # 数据采集
│   │       ├── db/            # SQLite 存储 (Drizzle ORM)
│   │       ├── config/        # 配置管理（模型切换、多账号）
│   │       └── balance/       # 实时额度查询
│   ├── api/            # Hono REST API (端口 3456)
│   ├── cli/            # Commander.js CLI (att)
│   └── web/            # Next.js 前端 (端口 3457)
├── pnpm-workspace.yaml
└── turbo.json
```

## 数据存储

| 文件 | 说明 |
|------|------|
| `~/.att/data.db` | 主数据库 |
| `~/.claude/stats-cache.json` | Claude Code 用量（只读） |
| `~/.codex/state_5.sqlite` | Codex 用量（只读） |
| `~/.codex/accounts.json` | Codex 多账号配置 |
| `~/.codex/auth.json` | Codex 当前账号 |

## 技术要点

- **智谱 API 集成**：自动检测 `~/.claude/settings.json` 中的智谱代理配置，查询用量配额和历史 token 数据
- **Codex 实时额度**：通过 ChatGPT backend API 获取实时 rate limits，支持 HTTPS_PROXY 代理
- **多账号自动检测**：基于 JWT email 匹配，自动识别 `codex login` 后的新账号
- **并行余额查询**：三个数据源并行请求，Codex 多账号串行查询避免代理冲突
