# 藏书阁

藏书阁是一个面向个人研究者的本地资料研究工作台。它把 PDF、网页、TXT、Markdown
和粘贴文本整理进相互隔离的 Notebook，在后台建立检索索引，基于当前 Notebook 的证据
生成带精确 Citation 的流式回答，并可把回答连同出处保存为 Markdown Note。

MVP 借鉴 [Open Notebook](docs/research/open-notebook.md) 的研究闭环，以及
[DeepSeek Harness](docs/research/deepseek-harness.md) 的“所有皆插件”装配思想。这里的 Plugin
是随仓库静态发布、进程内受信任的模块；当前版本不提供第三方 Plugin ABI、动态安装、热替换
或非可信代码沙箱。

## 快速启动

### Docker Compose（推荐）

前置条件：Docker Desktop 或 Docker Engine，以及 Compose v2。

```powershell
Copy-Item .env.example .env
# 编辑 .env，至少把 CANGSHU_SHARED_PASSWORD 换成 12 个字符以上的随机密码。
docker compose up --build -d
docker compose ps
```

打开 <http://127.0.0.1:4100>，使用 `.env` 中的共享密码登录。Compose 只把 HTTP 和
PostgreSQL 端口发布到宿主机 `127.0.0.1`；Server 在容器内监听非回环地址，因此仍按远程模式
强制认证。不要把示例密码用于真实部署。

停止服务：

```powershell
docker compose down
```

`docker compose down` 默认保留 `postgres-data` 和 `application-data` 卷。不要在没有备份时
运行带 `--volumes` 的命令。

### 源码开发

前置条件：Node.js 24+、pnpm 11+、PostgreSQL 17 + pgvector。先安装依赖并准备数据库：

```powershell
corepack enable
pnpm install --frozen-lockfile
$env:DATABASE_URL = "postgres://cangshu:cangshu@127.0.0.1:5432/cangshu"
pnpm --filter @cangshu/infrastructure db:migrate
```

分别启动三个终端：

```powershell
pnpm dev:server
pnpm dev:worker
pnpm dev:web
```

开发工作台位于 <http://127.0.0.1:4173>，Vite 会把 `/api` 代理到
<http://127.0.0.1:4100>。默认回环地址模式不要求登录。

## Provider 配置

Chat 与 Embedding 是两套独立的 OpenAI-compatible 配置。可在“模型设置”中分别填写
接口地址、模型和 API Key，先执行“测试”，再保存。API Key 使用数据卷中的主密钥进行
AES-256-GCM 加密；HTTP 响应和日志不会回显密钥。

也可以使用环境变量覆盖数据库配置：

| 用途 | 接口地址 | 模型 | 密钥 |
| --- | --- | --- | --- |
| Chat | `CANGSHU_CHAT_BASE_URL` | `CANGSHU_CHAT_MODEL` | `CANGSHU_CHAT_API_KEY` |
| Embedding | `CANGSHU_EMBEDDING_BASE_URL` | `CANGSHU_EMBEDDING_MODEL` | `CANGSHU_EMBEDDING_API_KEY` |

一组环境变量只有在接口地址和模型都存在时才生效。环境配置优先于数据库配置，界面会标记为
“环境变量”并禁止保存覆盖。`CANGSHU_MASTER_KEY` 可设置为恰好 32 字节的规范 Base64；未设置
时，系统会在 `CANGSHU_DATA_DIR` 下原子生成权限受限的 `master.key`。

更换 Embedding 接口地址或模型后，旧 Passage 不会与新模型向量混合检索；系统会自动把已有的
`ready` Source 重新排队并建立索引。仅更新 API Key 不会触发重索引。

## 支持范围

| Source | 支持情况 | 定位方式 |
| --- | --- | --- |
| PDF | 只支持已有文本层的 PDF | 页码与字符范围 |
| 网页 | 普通 HTTP/HTTPS 正文页 | 最终 URL、段落与字符范围 |
| TXT / 粘贴文本 | UTF-8 文本 | 行号与字符范围 |
| Markdown | UTF-8 Markdown 原文 | 行号与字符范围 |

- 上传文件上限为 50 MiB；粘贴文本上限为 5 MiB。
- 网页抓取限制为 10 MiB、15 秒和最多 3 次重定向，并在每次跳转执行 DNS 固定与 SSRF 校验。
- 不支持 OCR、扫描 PDF、登录网页、依赖复杂 JavaScript 的网页、音视频和 Podcast。
- 单个 Notebook 是检索、Conversation、Citation 和 Note 的硬隔离边界。
- Worker 固定使用两个并发任务；任务保存在 PostgreSQL 中，可在进程重启后继续处理。
- 模型只返回临时 `[P#]` 标签。最终 Citation 的 Source、locator 和 excerpt 均由服务端从本轮
  检索候选生成；无有效证据时返回固定的证据不足结果。

## 本地与远程安全

- `CANGSHU_HOST` 默认为 `127.0.0.1`，回环模式无需登录。
- 绑定 `0.0.0.0`、局域网地址或其他非回环地址时，必须设置至少 12 个字符的
  `CANGSHU_SHARED_PASSWORD`，否则 Server 会在监听端口前拒绝启动。
- 远程模式使用限速登录、恒定时间密码比较、签名 HttpOnly SameSite Cookie、有限会话寿命和
  同源校验。它是单研究者的暴露保护，不是多用户权限系统。
- 建议通过可信反向代理提供 HTTPS；不要直接把 PostgreSQL 端口暴露到公网。
- 所有 Plugin 都与 Server/Worker 进程同权。只运行已审查的仓库内 Plugin。

## 备份与恢复

Provider 密钥的密文位于 PostgreSQL，而解密主密钥、上传原件位于 `application-data`。两者必须
作为同一个恢复点一起备份。执行一致性备份前先停止写入：

```powershell
docker compose stop server worker
New-Item -ItemType Directory -Force backup | Out-Null
docker compose exec -T db pg_dump -U cangshu -d cangshu --clean --if-exists > backup/cangshu.sql
docker compose cp server:/app/data backup/application-data
docker compose start worker server
```

恢复会覆盖目标部署中的数据库对象和应用数据。先停止服务，并确认备份目录与目标环境：

```powershell
docker compose stop server worker
Get-Content -Raw backup/cangshu.sql | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U cangshu -d cangshu
docker compose cp backup/application-data/. server:/app/data
docker compose start worker server
```

恢复后检查 `/api/health/ready`，再测试 Chat/Embedding Provider 和一条已有 Citation。跨主机恢复时
应使用加密传输和受限目录保存备份；缺少原 `master.key` 时，已保存的 Provider 密钥无法解密。

## 故障排查

**Source 长时间停留在“等待处理”**

检查 `docker compose ps` 和 `docker compose logs worker`。Worker 启动时会重新排队陈旧任务；
确认数据库可用并且 Embedding 配置测试通过。

**Source 显示处理失败**

界面会显示稳定、脱敏的失败信息。可重试的失败会出现重试按钮。扫描 PDF、空文本和不受支持的
网页属于不可重试输入，应换用带文本层的 PDF 或直接粘贴正文。

**回答始终提示证据不足**

确认至少一份 Source 为“可检索”，Embedding 模型未在索引后更换，并检查 Chat 输出是否使用了
提供的 `[P#]` 标签。系统不会用模型常识替代当前 Notebook 的证据。

**远程部署无法启动或反复 401**

非回环绑定必须配置 12+ 字符共享密码。清除该站点 Cookie 后重新登录，并确认反向代理保留
`Host`/`Origin` 且使用同源访问。健康检查不要求登录。

**Provider 配置无法保存**

环境变量配置具有最高优先级，界面中标记“环境变量”时保存按钮会禁用。要改用数据库配置，删除
对应的完整环境变量组并重启进程。

## 架构导航

| 路径 | 职责 |
| --- | --- |
| `packages/plugin-kernel` | boot-once Plugin 计划、Capability 依赖、回滚和逆序清理 |
| `packages/application` | Notebook、Source、Grounded Answer、Citation、Note、Provider 深 Capability |
| `packages/infrastructure` | PostgreSQL/pgvector、Graphile、Blob、提取器、模型与加密 Adapter |
| `apps/server` | Fastify JSON/multipart/SSE、认证、静态 Web Host 与生产组合根 |
| `apps/worker` | 两并发 Graphile Worker Host 与生产组合根 |
| `apps/web` | React/Vite 简体中文研究工作台 |
| `CONTEXT.md` | 统一领域语言、目标、非目标和架构决策摘要 |
| `docs/adr` | 12 项关键架构决策 |
| `docs/research` | Open Notebook 与 DeepSeek Harness 的锁定提交源码调研 |
| `openspec/changes/build-plugin-research-mvp` | 本次 MVP 的 proposal、design、capability specs 和 tasks |

Kernel 只认识少量深 Capability。Repository、Blob、队列、提取器和模型由生产组合根注入业务
Plugin，不作为全局 service locator 暴露。Server 与 Worker 使用相同的资源工厂，但挂载不同的
Host Plugin；新增内部能力时应优先扩展深 Capability 或其专用 registry，而不是把每个 pipeline
步骤拆成浅 Plugin。

## 质量门禁

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

PostgreSQL 集成测试需要 `TEST_DATABASE_URL`。其中
`runtime-restart.integration.test.ts` 会关闭并重建 RuntimeResources，核对 Notebook、Source、
Conversation、Message、Note、Provider 密文、原件和未完成任务，并启动两代 WorkerHost 验证任务消费：

```powershell
$env:TEST_DATABASE_URL = "postgres://cangshu:cangshu@127.0.0.1:5432/postgres"
pnpm --filter @cangshu/infrastructure test:integration
```

完整研究闭环端到端测试需要四个终端。先显式指定 E2E 数据库和可复用数据目录并执行迁移：

```powershell
$env:DATABASE_URL = "postgres://cangshu:cangshu@127.0.0.1:5432/cangshu_e2e"
$env:CANGSHU_DATA_DIR = "$env:TEMP/cangshu-mvp-e2e"
pnpm --filter @cangshu/infrastructure db:migrate
```

然后分别启动确定性 Provider、Server 和 Worker：

```powershell
pnpm exec tsx apps/server/test/fixtures/openai-compatible-server.ts
```

```powershell
$env:DATABASE_URL = "postgres://cangshu:cangshu@127.0.0.1:5432/cangshu_e2e"
$env:CANGSHU_DATA_DIR = "$env:TEMP/cangshu-mvp-e2e"
pnpm exec tsx apps/server/test/fixtures/start-e2e-runtime.ts server
```

```powershell
$env:DATABASE_URL = "postgres://cangshu:cangshu@127.0.0.1:5432/cangshu_e2e"
$env:CANGSHU_DATA_DIR = "$env:TEMP/cangshu-mvp-e2e"
pnpm exec tsx apps/server/test/fixtures/start-e2e-runtime.ts worker
```

最后执行：

```powershell
$env:E2E_BASE_URL = "http://127.0.0.1:4100"
pnpm --filter @cangshu/server test:e2e
```
