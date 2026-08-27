## Why

个人研究者需要把分散材料组织成可核验的答案与长期笔记，但普通对话产品会混用模型常识、弱化出处，也缺少可恢复的材料处理流程。现在需要先建立一个边界清晰的 MVP，验证“导入多份材料、Notebook 内问答、精确引用、保存 Note”这条核心闭环，并为以后替换模型、提取器和存储实现保留受控扩展能力。

## What Changes

- 新建简体中文优先的本地 Web 工作台“藏书阁”，面向单个 Researcher 管理 Notebook、Source、Conversation 与 Note。
- 支持文本 PDF、普通网页、粘贴文本、TXT 与 Markdown Source，并以 PostgreSQL 持久任务在独立 Worker 中完成提取、Passage 切分和 Embedding。
- 在当前 Notebook 的硬边界内检索多份 Source，流式生成只基于证据的 Grounded Answer，并把模型引用解析为服务端校验、可定位原文的 Citation。
- 支持创建、编辑和删除 Markdown Note，以及把完成的 Grounded Answer 连同 Citation 保存为 Note。
- 在 UI 中分别配置 OpenAI-compatible Chat 与 Embedding Provider；密钥加密落库，并允许环境变量覆盖。
- 建立仓库自有的 boot-once Plugin Kernel，以静态可信 Plugin、显式 Capability 依赖、全量预检、失败回滚和逆序停止装配应用。
- 通过 Docker Compose 提供 PostgreSQL/pgvector、迁移、Server、Worker 与 Web 的单机部署，默认只绑定 localhost；远程绑定必须启用共享密码。
- 明确延后 OCR、多用户、Podcast、全局检索、第三方 Plugin、动态加载、HMR、UI Plugin 与非可信代码执行。

## Capabilities

### New Capabilities

- `plugin-application-runtime`: 静态可信 Plugin 的 Capability 声明、依赖预检、确定性启动、资源回滚、停止和脱敏诊断契约。
- `notebook-research-library`: Notebook 与 Source 的管理、受支持导入格式、内容寻址原件、持久后台处理、状态与 Notebook 隔离契约。
- `grounded-answering`: Notebook 范围检索、流式 Grounded Answer、证据不足行为、Citation 校验与 Conversation 持久化契约。
- `research-notes`: Markdown Note 的创建、编辑、删除，以及从已完成答案保存带 Citation Note 的契约。
- `provider-configuration`: Chat/Embedding Provider 的独立配置、加密密钥、环境覆盖、连通性测试与泄密防护契约。
- `local-web-experience`: 简体中文 SPA、HTTP/SSE Interface、localhost/远程访问模式、主要研究工作流与响应式交互契约。

### Modified Capabilities

无。当前仓库没有既有 OpenSpec 主规格。

## Impact

- 新增 TypeScript pnpm workspace：`packages/plugin-kernel`、`packages/application`、`packages/infrastructure`、`apps/server`、`apps/worker` 与 `apps/web`。
- 新增 PostgreSQL/pgvector schema、Drizzle 迁移、Graphile Worker 队列表、本地内容寻址数据卷和 Docker Compose 运行形态。
- 新增 Fastify JSON/multipart/SSE Interface 与 React/Vite SPA；引入 OpenAI-compatible 外部模型调用。
- 配置新增数据库连接、绑定地址、共享密码、数据目录以及可选 Provider 环境覆盖变量。
- 领域语言以根目录 `CONTEXT.md` 为准，架构取舍以 `docs/adr/` 为准，详细背景证据见 `docs/research/` 和 GitHub Issue #1。
