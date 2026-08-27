## Context

仓库目前是绿地项目，已经完成 Open Notebook 与 DeepSeek Harness 的固定版本源码调研、领域语言、十二项 ADR、GitHub Issue #1 规格，以及 TypeScript workspace、Plugin Kernel 和初始 PostgreSQL schema 的骨架。目标用户是控制单机部署的一个 Researcher；系统要在约 100 个 Source/Notebook、约 10,000 文本页、50 MiB/文件和两个并发处理任务的个人规模下可靠工作。

最重要的技术约束是：Notebook 必须成为检索和引用的硬隔离键；Grounded Answer 不能把任意模型文本当成 Citation；Source 处理必须跨重启保留；Provider 是 true external；PostgreSQL 与本地文件是 local-substitutable；MVP 的 Plugin 全部受信任并随仓库静态发布。

## Goals / Non-Goals

**Goals:**

- 交付从 Source 导入、持久处理、Notebook 内跨 Source 问答、精确 Citation 到 Note 的完整闭环。
- 用少数深 Capability 隔离领域规则，以最小自有 Kernel 统一装配、配置预检与生命周期。
- 让 Notebook 归属、Citation 有效性、任务幂等、密钥保护和远程访问默认值成为可测试约束。
- 用一套 TypeScript 工具链和 Docker Compose 提供可复现的本地开发与部署路径。

**Non-Goals:**

- 不提供 OCR、扫描 PDF、音视频、Podcast、图谱、全局 Ask、自动洞察或 Source 转换工作流。
- 不提供多用户、租户、团队权限、公开注册或外部身份 Provider。
- 不提供第三方 Plugin ABI、动态安装、运行时替换、HMR、UI Plugin、realm 或非可信代码沙箱。
- 不提供 Provider 市场、模型自动发现、本地模型进程管理、SSR、移动原生应用或浏览器离线同步。

## Decisions

### 1. 使用 boot-once closed Plugin Plan

composition root 向自有 Kernel 一次性交付完整 Plugin 清单和配置。每个 Plugin 声明一个深 Capability、具名 `requires`、配置 decoder 与 `setup`；Kernel 在副作用前校验全部配置、Plugin/Capability 唯一性、Provider 完整性和依赖环，再按声明顺序稳定拓扑排序并串行启动。Plugin 通过 `defer`/`own` 立即登记资源，失败时先 LIFO 清理当前 Plugin，再逆序清理已启动 Plugin；`stop` 幂等并聚合所有清理错误；snapshot 只暴露状态与标识。

选择它而不是直接引入 Cordis，是因为 MVP 只需要静态可信组合，不需要 effect tree、动态 scope、HMR 或代码加载。选择单 Provider、无 hooks/multi-binding 的窄 Interface，是为了避免 Kernel 成为全局 service locator；提取器或策略的多实现由拥有规则的深 Module 暴露专用 registry。

### 2. 按深业务 Capability 组织代码

Kernel 可见的主要 Capability 是 `NotebookManagement`、`SourceIngestion`、`ResearchAnswering`、`NoteManagement`、`ProviderSettingsManagement`、`HttpHost` 与 `WorkerHost`。PostgreSQL Repository、本地 blob、Graphile queue、Source extractor 和模型 Adapter 由 factory 注入业务 Module，类型不会穿过业务 Interface。

相比“每个 pipeline stage 都是 Plugin”，这种粒度把提取、Passage、Embedding 幂等与失败语义保持在 `SourceIngestion`，把检索、prompt、引用校验与 Conversation 状态保持在 `ResearchAnswering`，减少跨 Module 协调协议。

### 3. PostgreSQL/pgvector 是唯一系统记录

Drizzle schema 持久化 Notebook、Source、SourceProcessingAttempt、Passage、Conversation、Message、Citation、Note 与 ProviderConfiguration。关键子记录携带 `notebook_id`，并用组合唯一键/外键把 Message 绑定到同 Notebook 的 Conversation，把 Passage 绑定到同 Notebook 的 Source，把 Citation 同时绑定到同 Notebook 的 Message 与 Passage/Source。

初版用无固定维度的 pgvector 列和当前 embedding model fingerprint 过滤，再执行 cosine 精确检索。个人规模不预设 HNSW/IVFFlat；只有基准显示精确检索达不到目标时才增加近似索引。相比把向量放在独立系统中，这减少一致性和运维面。

### 4. Graphile Worker 提供至少一次的持久任务

Server 只创建 Source、保存原件并以 `source:<id>` job key 入队；独立 Worker 执行提取、Passage 切分、Embedding 和事务性替换。Source 状态与 Attempt 记录是用户可见投影，Graphile 表是调度实现。处理器把已完成 Source 视为成功，把 Passage 替换与 `ready` 更新放在同一事务中，使重复投递可安全重放。

选择 Graphile Worker 而不是内存队列，是为了跨重启保留任务；相较引入 Redis 队列，它复用已有 PostgreSQL。任务语义明确按至少一次设计，不依赖“恰好一次”假设。

### 5. 原始 Source 使用内容寻址本地存储

上传字节以 SHA-256 作为 storage key，在同一持久卷中原子写入；数据库保存哈希、key、大小和 MIME。相同内容复用一个 blob，只有数据库中没有 Source 引用时才删除。网页 Source 在受控抓取后进入相同提取流程。

网页抓取仅允许 HTTP/HTTPS，拒绝凭据 URL、loopback、link-local、私网、保留网段和云 metadata 目标；每次重定向重新校验，并把已验证 DNS 地址钉到连接以降低 rebinding 风险，同时限制重定向、响应大小和超时。

### 6. Passage 保存可验证 locator

PDF extractor 按页产生文本 block；网页按正文段落；Text/Markdown 按行段。Passage splitter 在 block 内按字符上限和重叠切分，并保存页码/段落/行范围与字符范围。Embedding 只是检索索引，原文和 locator 始终保留在 PostgreSQL。

这比只保存自由文本 chunk metadata 多占少量空间，但让 Citation 可以由服务端从已检索 Passage 生成，而不是信任模型输出的 Source id、页码或 excerpt。

### 7. Grounded Answer 使用候选标签协议

`ResearchAnswering` 对问题 Embedding 后，只调用强制要求 `notebookId` 的检索 Interface，按 Source 多样性选取有限 Passage，并赋予本轮临时标签 `P1...Pn`。Chat Adapter 流式返回文本并收集标签；应用只接受同时属于本轮候选集的标签，再从数据库记录生成持久 Citation。未知标签、无有效标签或无候选证据会把最终答案归一为“当前 Notebook 中的材料不足以可靠回答这个问题”。

SSE 可以先展示 token，但客户端在 `answer.completed` 时必须用服务端最终 Message 替换临时缓冲；因此引用校验失败不会留下伪完成内容。Assistant Message 在模型调用前写为 `pending`，成功时与 Citation 原子完成，异常或断开路径标记 `failed`。

### 8. Provider 配置加密并按调用解析

Chat 与 Embedding 各保存 `baseUrl`、`model` 和 AES-256-GCM 加密的 key。主密钥优先来自环境变量，否则在数据卷生成权限受限的 key file。完整环境变量组覆盖数据库配置且 UI 只显示来源和“已配置”；运行时每次解析当前配置，因此保存设置无需重启。

Provider 测试执行最小 Chat/Embedding 调用，不依赖可选的 models 列表 Interface。日志、HTTP 错误、Kernel snapshot 和公共配置投影不含 key、完整 prompt、完整 Source 或完整 Provider 响应。

### 9. React/Vite SPA 与 Fastify 同源 Host

Fastify 提供带稳定 envelope 的 JSON/multipart Interface 和答案 SSE，生产时同源提供 Vite 静态构建。SPA 使用简体中文 message catalog，左侧 Notebook 导航和 Source/对话/Note 紧凑 tabs；Citation 打开 Source 查看器并定位、高亮 excerpt。

默认绑定 `127.0.0.1` 且无需登录。非回环绑定若没有共享密码则启动失败；远程模式用 HttpOnly、SameSite Cookie 的签名会话和登录限速保护所有变更 Interface。该模型不是多用户权限系统，只是防止显式远程暴露时无认证。

## Risks / Trade-offs

- [模型仍可能把错误陈述附到有效 Passage 标签] → 严格 prompt、服务端候选校验、可见 excerpt 与“无有效标签即拒绝”；把更细的 claim-to-span verifier 延后到有真实评测数据后。
- [无固定维度 vector 列允许旧模型与新模型向量并存] → Passage 保存 model fingerprint，查询只比较当前 fingerprint；Provider 变更后把 Source 标为待重新索引，不跨维度比较。
- [Graphile 至少一次会重复执行昂贵 Embedding] → job key 去重、`ready` 快速返回、事务性 Passage 替换；接受崩溃窗口内少量重复外部调用。
- [本地数据卷同时保存密钥文件和 blob] → 数据库 key 仍使用独立 AEAD 主密钥；文档要求保护卷权限和备份，不把本地管理员攻击错误描述为可防御场景。
- [网页结构和 PDF 文本层质量差异大] → 失败状态保留稳定错误码并允许重试；MVP 明确不承诺 JavaScript 页面、登录页面和 OCR。
- [单进程 Plugin 没有安全隔离] → 只装载随仓库发布的可信静态 Plugin；任何第三方生态必须先另行设计签名、权限、兼容性和进程隔离。
- [先流式显示后校验 Citation 会短暂显示被拒内容] → `answer.completed` 是唯一权威结果，UI 明确区分生成中与已验证，并在完成事件原子替换。

## Migration Plan

1. 从空数据卷启动 PostgreSQL/pgvector，运行 Drizzle 初始迁移和 Graphile schema 迁移。
2. 启动 Worker，再启动 Server/SPA；readiness 在数据库迁移、队列和静态资源可用后才成功。
3. 在 localhost 完成 Provider 配置，导入两份 fixture Source，验证处理、跨 Source Answer、Citation 和 Note。
4. 需要远程访问时先设置共享密码，再显式修改绑定地址并重新部署。
5. MVP 没有既有生产数据；回滚通过停止新容器、恢复部署前 PostgreSQL 与数据卷快照完成。数据库迁移在确认备份前不执行破坏性 down migration。

## Open Questions

当前没有阻塞实现的开放问题。近似向量索引、claim-level verifier、OCR、多用户和第三方 Plugin 均需在 MVP 使用数据与独立规格出现后再决策。
