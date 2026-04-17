# AI Token Tracker (`att`)

统一追踪 Claude Code、Codex、Hermes 的 Token 用量，提供实时额度查询、多账号管理和模型切换。

命令按任务组织，而不是按内部模块组织。

## 快速开始

```bash
# 安装依赖并构建
pnpm install && pnpm -r build

# 同步数据
att sync

# 查看用量汇总
att usage --preset 7d

# 查看账号
att accounts

# 查看所有来源的实时额度
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

## 命令参考

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
att usage                                # 汇总
att usage --preset today                 # 今天
att usage --preset 7d                    # 最近 7 天
att usage --preset 30d                   # 最近 30 天
att usage --preset this_month            # 本月
att usage --start 2026-04-01 --end 2026-04-15

# 按来源筛选
att usage --preset 7d --source claude-code
att usage --preset 7d --source codex

# 每日明细
att usage daily --preset 7d
att usage daily --preset 7d --source codex

# 导出
att usage export -f json
att usage export -f csv --preset 30d --source claude-code
```

### 账号管理

```bash
# 查看所有来源账号
att accounts

# 只看 Codex
att accounts --source codex

# 切换 Codex 账号
att accounts switch <账号名> --source codex

# 添加 Codex 账号
att accounts add <账号名> \
  --source codex \
  --access-token "eyJ..." \
  --id-token "eyJ..." \
  --refresh-token "eyJ..."

# 验证 / 重命名 / 删除
att accounts verify <账号名> --source codex
att accounts rename <旧名> <新名> --source codex
att accounts remove <账号名> --source codex
```

当前写操作支持：

- `codex`：支持多账号查看、切换、增删改、验证
- `claude-code`：当前只展示账号/额度状态
- `hermes`：当前只展示账号/额度状态

### 额度总览

```bash
att balance
```

展示内容：

- Claude Code：智谱账号 Plan、剩余额度百分比、刷新时间
- Codex：所有账号的 5h / 7d 窗口额度、刷新时间、活跃状态
- Hermes：账号状态

### 模型管理

```bash
# 列出当前支持的模型来源
att model
att model list --source claude-code

# 重置为默认模型
att model set sonnet --source claude-code
att model set opus --source claude-code
att model set haiku --source claude-code

# 设置自定义模型
att model set glm-5.0 --source claude-code --tier sonnet
att model set glm-5.0 --source claude-code --tier opus
```

当前模型写操作支持：

- `claude-code`

### 启动 API 服务

```bash
att serve
att serve --port 8080
```

### 启动 Web 前端

```bash
att serve &
cd packages/web && pnpm dev
# 浏览器访问 http://localhost:3457
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

- 智谱 API 集成：自动检测 `~/.claude/settings.json` 中的智谱代理配置，查询用量配额和历史 token 数据
- Codex 实时额度：通过 ChatGPT backend API 获取实时 rate limits，支持 `HTTPS_PROXY`
- 多账号自动检测：基于 JWT email 匹配，自动识别 `codex login` 后的新账号
- 实时并发额度查询：Codex 多账号走受控并发和超时控制，避免串行拖慢 CLI
