# Open Notebook 实现调研与 MVP 切片建议

> 调研日期：2026-08-27（Asia/Shanghai）
>
> 上游仓库：[lfnovo/open-notebook](https://github.com/lfnovo/open-notebook)
>
> 调研分支：`main`
>
> 锁定提交：[`a7de90d38aaf18ee85fd661854d35c11e44613e2`](https://github.com/lfnovo/open-notebook/commit/a7de90d38aaf18ee85fd661854d35c11e44613e2)
>
> 上游版本：`1.14.0`（见 [`pyproject.toml`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/pyproject.toml#L1-L15)）

本文只使用一手资料：锁定提交下的源码、迁移、上游 README/官方文档、上游 CI 结果，以及项目直接声明的依赖。为避免把愿景当成现状，正文使用以下标记：

- **[事实]**：可由锁定提交中的代码或官方文档直接验证。
- **[推断]**：依据多个实现事实得出的工程判断，不是上游承诺。
- **[建议]**：面向“做一个类似产品的 MVP”的取舍。
- **[待确认]**：源码无法确定、需要产品选择或实际运行验证的事项。

## 1. 先给结论

1. **[事实] 它的核心不是“NotebookLM 全量复刻”，而是一个自托管的研究资料工作台。** 上游把自己定义为隐私优先、可自托管、模型供应商无关的 NotebookLM 替代品，同时明确说它不是通用聊天、文件存储或完整编辑器（[`VISION.md`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/VISION.md#L9-L31)）。
2. **[事实] 真正闭环是：Notebook → Source → 处理/洞察/索引 → 对话或搜索 → Note；Podcast 是同一上下文的下游生成物。** Source、Insight、Note、ChatSession、Episode 都有独立持久化对象，而不是一条单体 RAG 流程（[`notebook.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/notebook.py#L16-L68)、[`podcasts/models.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/podcasts/models.py#L218-L249)）。
3. **[事实] “Notebook Chat”本身并不是经典检索增强生成。** 它由前端显式选择来源的“全文/洞察”和笔记全文，把组装后的上下文连同历史消息一次性交给模型；真正做向量检索的是全局 Search/Ask 流程（[`use-notebook-chat.ts`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/frontend/src/lib/hooks/use-notebook-chat.ts#L132-L175)、[`ask.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/graphs/ask.py#L73-L117)）。
4. **[事实] 后台任务是 SurrealDB 驱动的 `surreal-commands` worker。** Source 处理、Embedding、Insight 和 Podcast 都通过命令提交；生产容器内由 Supervisor 同时运行 API、worker、Next.js，SurrealDB 是独立容器（[`supervisord.conf`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/supervisord.conf#L11-L43)、[`docker-compose.yml`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/docker-compose.yml#L1-L61)）。
5. **[事实] 数据不在一个地方。** 领域数据、向量和任务状态在 SurrealDB；聊天消息/checkpoint 在 SQLite；上传文件、Podcast 音频和缓存落本地卷（[`config.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/config.py#L3-L25)）。
6. **[事实] Provider 抽象很深，但也带来明显配置面。** 当前注册表有 22 个 provider spec，覆盖 LLM、Embedding、STT、TTS；Credential、Model、DefaultModels 分层，再由 Esperanto 创建具体模型并在语言模型场景转成 LangChain（[`provider_registry.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/ai/provider_registry.py#L68-L289)、[`models.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/ai/models.py#L173-L285)）。
7. **[事实] 实时边界比较克制且不统一。** Ask 用 SSE 输出策略/分支答案/最终答案；Source Chat 用 SSE，但模型调用完成后才发完整 AI 消息，不是 token 流；Notebook Chat 是同步请求；Source/Podcast 后台状态靠轮询（[`search.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/api/routers/search.py#L69-L174)、[`source_chat.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/api/routers/source_chat.py#L332-L445)、[`chat.ts`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/frontend/src/lib/api/chat.ts#L50-L68)）。
8. **[事实] 当前代码比部分官方概念文档更新。** 概念文档写“一份 Source 只属于一个 Notebook”“自动索引”“Source 不可变”，但 API 支持一份 Source 关联最多 50 个 Notebook、Embedding 默认关闭、Source 标题/主题可更新（[`notebooks-sources-notes.md`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/docs/2-CORE-CONCEPTS/notebooks-sources-notes.md#L36-L75)、[`api/models.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/api/models.py#L303-L351)）。实现判断应以源码为准。
9. **[推断] 上游的主要复杂度不在 RAG 算法，而在“能力矩阵”。** 多 provider、多提取引擎、同步/异步双路径、三种聊天/问答路径、Transformation、Embedding 重建和 Podcast 配置共同放大了状态空间。
10. **[建议] MVP 不应复制这套完整矩阵。** 先做“单用户、单 Notebook 范围内、多资料、后台处理、带出处的流式问答、保存笔记”这一条可验收闭环；Podcast、多语音、多 provider、OCR/视觉和独立 Ask/Search 均后置。

## 2. 产品闭环与对象模型

### 2.1 目标用户和边界

**[事实]** 上游的目标用户是愿意自托管、重视资料控制权、希望自由选择云端或本地模型的研究/知识工作者。其设计原则包括隐私优先、provider agnostic、API-first 和 async-first；当前阶段强调先把 sources、chat、search、notes、podcasts 等基本面做稳（[`VISION.md`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/VISION.md#L34-L53)）。产品当前明确是 single-user first，多用户仍只是兼容性考虑（[`VISION.md`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/VISION.md#L55-L69)）。

**[推断]** 这意味着它的首要价值不是团队协作，而是“把私有资料交给自己选择的模型，并保留可追溯的研究产物”。因此，MVP 的北极星指标应是一次完整研究任务能否完成，而不是导入格式数、provider 数或生成媒体类型数。

### 2.2 当前实现中的核心对象

| 对象 | 当前职责 | 关键关系/状态 |
|---|---|---|
| `Notebook` | 研究主题的工作空间 | name、description、archived、last_viewed；通过 relation 取 Source、Note、ChatSession（[`notebook.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/notebook.py#L16-L68)） |
| `Source` | 一份输入资产及其提取后全文 | asset（URL/文件）、title、topics、full_text、command；可关联多个 Notebook（[`notebook.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/notebook.py#L402-L447)） |
| `SourceEmbedding` | Source 的有序文本块及向量 | source、order、content、embedding（[`1.surrealql`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/database/migrations/1.surrealql#L16-L20)） |
| `SourceInsight` | Transformation 对 Source 生成的结构化文本产物 | insight_type、content、可选 embedding；可另存为 Note（[`notebook.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/notebook.py#L342-L399)） |
| `Transformation` | 可复用的提示词动作 | name/title/description/prompt/apply_default/model_id（[`5.surrealql`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/database/migrations/5.surrealql#L8-L14)、[`17.surrealql`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/database/migrations/17.surrealql#L1-L3)） |
| `Note` | 人工或 AI 研究笔记 | human/ai 类型、title、content、embedding；属于 Notebook（[`notebook.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/notebook.py#L683-L735)） |
| `ChatSession` | 会话元数据 | title、model_override；关联 Notebook 或 Source（[`notebook.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/notebook.py#L750-L764)） |
| `Credential` / `Model` / `DefaultModels` | provider 凭证、可选模型、用途默认模型 | Credential 连接多个 Model；默认用途包括 chat、transformation、large-context、TTS、STT、embedding、tools（[`credential.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/credential.py#L28-L83)、[`models.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/ai/models.py#L55-L62)） |
| `EpisodeProfile` / `SpeakerProfile` / `PodcastEpisode` | Podcast 的节目规则、声音角色和一次生成结果 | Episode 保存 profile 快照、原始 content、outline、transcript、audio_file、command（[`podcasts/models.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/podcasts/models.py#L36-L116)、[`podcasts/models.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/podcasts/models.py#L218-L249)） |

当前关系方向为：`source -reference-> notebook`、`note -artifact-> notebook`、`chat_session -refers_to-> notebook|source`（[`1.surrealql`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/database/migrations/1.surrealql#L54-L60)、[`8.surrealql`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/database/migrations/8.surrealql#L1-L12)）。它是便于查询的图关系，但没有用户/租户边界。

### 2.3 用户闭环

**[事实] 当前闭环：**

1. 创建 Notebook。
2. 以 URL、上传文件或纯文本创建 Source；可同时选择多个 Notebook、Transformation、是否生成 Embedding、是否异步处理（[`api/models.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/api/models.py#L303-L351)）。
3. 提取正文并保存 Source；按选择启动 Embedding，并并行执行 Transformations 生成 SourceInsight（[`source.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/graphs/source.py#L196-L293)）。
4. 用户可以：
   - 在 Notebook Chat 中显式选全文/洞察/笔记作为上下文；
   - 在 Source Chat 中围绕单一 Source 对话；
   - 用全局 text/vector Search，或用 Ask 做多查询检索和综合回答。
5. 用户创建人工/AI Note，或把 Insight 转成 Note；Note 保存后尽力异步生成 embedding（[`notebook.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/notebook.py#L390-L399)、[`notebook.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/notebook.py#L696-L729)）。
6. 可选地，把 Notebook 全部 Source 全文/洞察和 Note 全文组装成 Podcast 输入，后台生成 outline、transcript 和音频（[`notebook.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/notebook.py#L70-L134)、[`podcast_service.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/api/podcast_service.py#L58-L101)）。

**[推断]** Insight 与 Note 的分离是合理的：前者是“某来源的机器衍生结果”，后者是“用户纳入知识空间的研究产物”。但 MVP 若没有多 Transformation 管理需求，可以先合并为一个 `generated_note`，待用户确实需要“生成但未采纳”的中间态时再拆。

## 3. 总体架构与数据流

### 3.1 进程和技术栈

**[事实]** 当前栈由以下部分构成：

- Web：Next.js `16.2.6`、React `19.2.3`，TanStack Query 管服务端状态、Zustand 管本地状态（[`frontend/package.json`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/frontend/package.json#L34-L61)）。部分架构文档仍称 Next.js 15，应以依赖锁定声明为准。
- API：Python `>=3.11,<3.13`、FastAPI、Pydantic；AI 编排使用 LangChain/LangGraph（[`pyproject.toml`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/pyproject.toml#L14-L39)）。
- 内容与模型：`content-core` 做提取，`esperanto` 做多 provider 模型适配，`podcast-creator` 做播客生成（[`pyproject.toml`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/pyproject.toml#L40-L45)）。
- 数据库：SurrealDB v2，Docker Compose 使用 RocksDB 持久卷（[`docker-compose.yml`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/docker-compose.yml#L1-L22)）。
- 任务：`surreal-commands`；worker 默认最多并发 5 个任务（[`supervisord.conf`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/supervisord.conf#L22-L32)）。
- 媒体：运行镜像包含 ffmpeg；Docker 多阶段构建前端和 Python 后端，并有 regular/single 两个目标（[`Dockerfile`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/Dockerfile#L1-L13)、[`Dockerfile`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/Dockerfile#L66-L91)）。

```text
Browser
  │ HTTP /api/*, selected SSE routes
  ▼
Next.js :8502 (dev :3000)
  │ rewrite/proxy
  ▼
FastAPI :5055 ──────────────┐
  │ CRUD / submit command   │ direct model calls for chat/search
  ▼                         │
SurrealDB :8000             │
  │ domain + vectors + jobs │
  ▼                         ▼
surreal-commands worker   LLM/Embedding/STT/TTS providers
  │ extraction / embedding / transformations / podcast
  ├── data/uploads
  └── data/podcasts

LangGraph chat checkpoints ──> data/sqlite-db/checkpoints.sqlite
```

Next.js 把 `/api/:path*` 重写到内部 FastAPI 地址（[`next.config.ts`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/frontend/next.config.ts#L25-L41)）。生产 app 容器由 Supervisor 启动 API、worker 和前端三个进程（[`supervisord.conf`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/supervisord.conf#L11-L43)）。

### 3.2 持久化边界

| 存储 | 内容 | 影响 |
|---|---|---|
| SurrealDB | Notebook、Source、chunks/vectors、Insight、Note、ChatSession 元数据、模型/凭证、Podcast 元数据、命令状态 | 核心领域状态和搜索都在此 |
| SQLite checkpoint | Notebook/Source Chat 的历史消息和 LangGraph checkpoint | 会话元数据与消息跨两种数据库 |
| 本地文件卷 | 上传原文件、Podcast 音频、tokenizer cache | 备份必须同时覆盖 DB 和 `data/` |

路径定义可直接见 [`config.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/config.py#L3-L25)。SurrealDB repository 当前每次操作创建并关闭一个 `AsyncSurreal` 连接，并未使用连接池（[`repository.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/database/repository.py#L85-L118)）。

**[推断]** 这种拆分对单用户桌面式部署可工作，但增加了备份一致性、会话删除和故障恢复成本。MVP 更适合让领域数据、消息、任务和向量先进入同一个数据库，原文件单独进受控卷。

### 3.3 Source ingest 的精确数据流

**[事实] 输入约束。** Source API 接受 link/upload/text；最多关联 50 个 Notebook、最多选 50 个 Transformation；`embed` 默认 `false`，`async_processing` 默认 `false`（[`api/models.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/api/models.py#L303-L351)）。后端在创建命令前做 URL SSRF 校验、上传目录 containment 和文件类型支持校验（[`sources.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/api/routers/sources.py#L427-L476)）。

**[事实] 异步路径。** API 先创建 placeholder Source、立刻关联 Notebook、提交 `process_source`，然后把 command id 写回 Source；客户端得到 `new` 状态（[`sources.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/api/routers/sources.py#L479-L545)）。同步路径没有另一套业务实现，而是在工作线程里调用同一个 command，等待最多 300 秒（[`sources.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/api/routers/sources.py#L566-L631)）。

**[事实] worker 内部。** Source LangGraph 是：

```text
content_process
  ├─ URL / file / text -> content-core.extract_content
  ├─ 选择 URL/document engine、OCR/vision/STT 配置
  └─ 可删除上传原文件
      │
      ▼
save_source
  ├─ 写 asset/full_text/title
  └─ 若 embed=true，提交 embed_source 子命令
      │
      └──────────> transform_content × N（并行）
                         └─ 生成 SourceInsight
```

提取配置和 `extract_content` 调用见 [`source.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/graphs/source.py#L75-L193)，图结构见 [`source.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/graphs/source.py#L277-L293)。`process_source` 对暂时性错误/数据库冲突最多重试 15 次，但对配置和输入错误停止重试（[`source_commands.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/commands/source_commands.py#L38-L146)）。

**[推断] 关键状态风险。** `process_source` 只负责“提交” Embedding/Insight 的后续命令，因此父命令完成不等于所有派生产物可用。这会造成 UI 看见 Source 已完成，但向量搜索仍无结果。MVP 应把 `extracting → chunking → embedding → ready` 变成一个明确的父状态机，或显式聚合子任务状态。

## 4. 各能力如何串起来

### 4.1 解析与内容提取

**[事实]** `content-core` 是解析边界。URL 可选 auto/simple/Firecrawl/Jina/Crawl4AI，文档可选 auto/Docling/simple；Docling 有 OCR、公式和视觉理解选项，音频提取时读取默认 STT 模型（[`source.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/graphs/source.py#L75-L151)）。因此 Open Notebook 自身主要负责校验、配置、编排和持久化，而不是实现所有 parser。

**[推断]** 这一边界值得借鉴，但引擎矩阵不值得在 MVP 复制。每多一个 parser 都会引入系统依赖、异常类型、结果质量差异和缓存策略。首版只支持文本型 PDF、Markdown/TXT 和普通网页即可。

### 4.2 Chunk、Embedding 与检索

**[事实]** `Source.vectorize()` 只提交 `embed_source` 命令（[`notebook.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/notebook.py#L532-L576)）。命令会读取全文、删除旧 chunks、识别内容类型、切块、批量生成向量，再 bulk insert `source_embedding`（[`embedding_commands.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/commands/embedding_commands.py#L303-L403)）。

切块策略按内容类型分流：Markdown/HTML 优先尊重标题结构，再递归二次切分；纯文本直接递归切分并过滤过小块（[`chunking.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/utils/chunking.py#L365-L494)）。Embedding 默认批量 50、带重试；超长单段还可先切块再对向量做归一化均值池化（[`embedding.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/utils/embedding.py#L106-L269)）。

**[事实]** 文本检索使用 SurrealDB BM25 索引（[`1.surrealql`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/database/migrations/1.surrealql#L64-L72)）。当前向量函数对 Source chunks、Insight 和 Note 计算 cosine similarity，再合并排序；没有 notebook id 参数（[`9.surrealql`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/database/migrations/9.surrealql#L1-L66)）。领域层 `text_search` / `vector_search` 同样是全局函数（[`notebook.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/notebook.py#L767-L839)）。迁移中未见专用向量近邻索引，当前函数表现为对候选记录计算相似度。

**[推断] 重要偏差。** 官方概念文档强调 Notebook 隔离，但当前 Search/Ask 是全局检索；单用户也会产生跨项目资料泄漏和错误引用。类似产品必须在 SQL/向量查询层强制 `notebook_id`/tenant filter，不能只靠 prompt 约束。

### 4.3 Notebook Chat、Source Chat 与 Ask/RAG

这三个入口看起来都叫“聊天”，实现却不同：

| 能力 | 上下文来源 | 模型调用 | 响应方式 |
|---|---|---|---|
| Notebook Chat | 前端显式选择 Source `insights`/`full content` 和 Note `full content`，后端拼完整上下文（[`context_builder.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/utils/context_builder.py#L264-L361)） | LangGraph + SQLiteSaver，`model.invoke`；不检索 chunks（[`chat.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/graphs/chat.py#L22-L98)） | 同步、非流式 |
| Source Chat | 单一 Source 全文 + Insights，最多约 50k token 并截断 | `model.invoke`（[`source_chat.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/graphs/source_chat.py#L69-L205)） | SSE 包装，但模型完成后发完整 AI message |
| Search/Ask | 策略模型生成搜索词；每个词全局 vector top 10；分支回答后综合 | LangGraph `Send` 并行 fan-out/fan-in（[`ask.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/graphs/ask.py#L20-L155)） | SSE 发 strategy、answer、final_answer、complete |

聊天 prompt 要求输出 `[record:id]` 形式的引用（[`system.jinja`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/prompts/chat/system.jinja#L30-L47)），但 Notebook/Source Chat 的“引用”依赖整段上下文中的 record 标记，不等同于检索 chunk 的页码/段落证据。

**[建议]** MVP 只保留一个 Notebook-scoped RAG Chat：每次问题检索该 Notebook 的 chunks，返回可点击到 Source + 页码/段落 locator 的引用，并用真正的 token SSE 输出。不要同时实现 Notebook Chat、Source Chat、Global Ask 三条近似路径。

### 4.4 Transformation、Insight 与 Note

**[事实]** Transformation 是保存的 prompt 配方，可选择 model，并在 Source 图中生成 `SourceInsight`；它不是直接生成 Note。用户再通过 `save_as_note` 把洞察纳入 Notebook（[`notebook.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/notebook.py#L342-L399)）。Note 可以人工创建，也可以 AI 生成标题，保存成功后异步 embedding；embedding 失败不会让 Note 保存失败（[`notebook.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/notebook.py#L683-L735)）。

**[建议]** MVP 保留“保存回答为 Note”和 Note CRUD；Transformation 系统后置。若必须展示 AI 摘要，只做一个固定的“生成摘要”动作，不先建设模板市场、默认应用规则和每模板模型覆盖。

### 4.5 Podcast / TTS / STT

**[事实]** Podcast 创建请求需要 episode profile、speaker profile、名称，以及直接 content 或 notebook_id（[`podcast_service.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/api/podcast_service.py#L12-L20)）。Notebook 输入会包含其 Source 全文/洞察和 Note 全文。EpisodeProfile 选择 outline/transcript LLM、语言、段数、token 上限；SpeakerProfile 选择 TTS 模型和 1–4 位 speaker 的 voice/backstory/personality（[`podcasts/models.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/podcasts/models.py#L36-L116)、[`podcasts/models.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/podcasts/models.py#L129-L215)）。

worker 解析各模型凭证、把 profile 映射给 `podcast_creator`、先保存 Episode 快照，再生成 outline/transcript/audio 并写相对音频路径；该命令 `max_attempts=1`，不自动重试（[`podcast_commands.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/commands/podcast_commands.py#L65-L145)、[`podcast_commands.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/commands/podcast_commands.py#L249-L358)）。

**[推断]** Podcast 是很好的演示/增长功能，但不是研究可信度闭环的一部分；它同时引入多模型编排、声音目录、长任务、ffmpeg、媒体存储和失败重试。MVP 首版推迟它能显著降低交付风险。

## 5. Provider、模型和配置抽象

### 5.1 三层抽象

**[事实]** 当前实现可以概括为：

1. `ProviderSpec`：后端 provider 元数据的单一来源，前端通过 `GET /api/providers` 消费。锁定提交注册了 22 个 spec，覆盖 OpenAI、Anthropic、Google、Ollama、OpenAI-compatible、Azure、Vertex，以及语音/embedding 专用 provider 等（[`provider_registry.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/ai/provider_registry.py#L1-L24)、[`provider_registry.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/ai/provider_registry.py#L68-L289)）。
2. `Credential` + `Model`：Credential 保存 API key/base URL/endpoint/project/location 等连接配置；Model 保存 provider、模型名、模态和 credential 引用（[`credential.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/credential.py#L28-L141)、[`models.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/ai/models.py#L55-L62)）。
3. `DefaultModels`：按 chat/transformation/large_context/TTS/STT/embedding/tools 用途选择默认 Model；transformation/tools/large_context 有 chat fallback（[`models.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/ai/models.py#L137-L146)、[`models.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/ai/models.py#L330-L373)）。

`ModelManager` 优先读取关联 Credential，仍支持环境变量 fallback，然后交给 Esperanto `AIFactory.create_language/embedding/speech_to_text/text_to_speech`（[`models.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/ai/models.py#L173-L285)）。LLM 图再把 Esperanto LanguageModel 转为 LangChain model；上下文超过约 105k token 时可切换 large-context model（[`provision.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/ai/provision.py#L10-L61)）。

### 5.2 凭证安全

**[事实]** Credential 在保存前加密 API key、读取时解密；缺少加密 key 时 API 会警告，但不是所有部署都强制拒绝启动（[`credential.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/domain/credential.py#L220-L280)、[`main.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/api/main.py#L184-L210)）。应用认证则是可选的单一共享密码 Bearer token；未设置 `OPEN_NOTEBOOK_PASSWORD` 时认证完全关闭（[`auth.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/api/auth.py#L12-L81)）。

**[建议]** MVP 只支持一个 chat provider + 一个 embedding provider，优先做 OpenAI-compatible 接口，并把 provider adapter 限定为两个小接口：`stream_chat()` 与 `embed()`。Credential 必须加密，生产模式下缺少 encryption key 应 fail fast。模型发现、按任务默认模型、STT/TTS 和 provider 能力矩阵后置。

## 6. 数据模型与 Schema

### 6.1 SurrealDB 表

**[事实]** 迁移定义的主要表如下：

- `SCHEMAFULL`：`source`、`source_embedding`、`source_insight`、`note`、`notebook`、`transformation`、`credential`、`episode_profile`、`speaker_profile`、`episode`。
- `SCHEMALESS`：`chat_session`、`podcast_config`。
- relation：`reference`、`artifact`、`refers_to`。
- `model` 被业务代码和字段引用，但在当前 migrations 中没有独立的 `DEFINE TABLE model SCHEMAFULL`；它实际依赖 SurrealDB 的宽松记录行为。
- `command` 由 `surreal-commands` 管理，不在本项目初始领域迁移里。

基础表/关系见 [`1.surrealql`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/database/migrations/1.surrealql#L1-L62)，ChatSession 关系见 [`3.surrealql`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/database/migrations/3.surrealql#L1-L8)，Podcast 表见 [`7.surrealql`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/database/migrations/7.surrealql#L1-L48)，Credential/Model 关联见 [`12.surrealql`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/open_notebook/database/migrations/12.surrealql#L1-L29)。

API 启动时等待 SurrealDB、自动执行迁移；迁移失败会阻止正常启动（[`main.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/api/main.py#L129-L210)）。

### 6.2 建模上的重要含义

- **[事实] 一份 Source 可共享到多个 Notebook。** `SourceCreate.notebook_ids` 允许多个 id，使用 graph relation 表达关联，而不是 `source.notebook_id` 外键。
- **[事实] ChatSession 与消息分离。** SurrealDB 只保存会话元数据/关系，LangGraph 消息放 SQLite checkpoint。
- **[事实] Embedding 直接保存在领域表的 float array 字段。** Source chunk 独立成多行，Insight/Note 自带可选 embedding。
- **[事实] Podcast profile 被快照进 Episode。** 后续修改 profile 不会重写既有 episode 的配置记录。
- **[推断] Source 多 Notebook 共享让删除、权限和检索范围复杂化。** 当前单用户尚可，多用户化前必须给所有查询加 tenant ownership，并定义 unlink 与 physical delete 的区别。

### 6.3 建议的 MVP Schema

**[建议]** 用一个关系数据库承载元数据、消息、任务和向量；若目标是可部署的 Web MVP，优先 PostgreSQL + pgvector，原文件放本地持久卷。最小表：

| 表 | 最小字段 |
|---|---|
| `notebook` | id, title, created_at, updated_at |
| `source` | id, notebook_id, kind, title, original_uri, extracted_text, status, error, embedding_model, created_at |
| `source_chunk` | id, source_id, ordinal, text, locator_json, embedding |
| `conversation` | id, notebook_id, title, created_at |
| `message` | id, conversation_id, role, content, citations_json, created_at |
| `note` | id, notebook_id, title, content, source_message_id, created_at, updated_at |
| `job` | id, kind, subject_id, status, progress, attempt, error, created_at, updated_at |
| `credential` | id, provider, encrypted_secret, config_json |

首版用 `source.notebook_id` 一对多，而不是共享 Source；只有出现真实的跨 Notebook 复用需求后才引入关联表。`locator_json` 在解析时保留页码、标题路径或 URL fragment，是可信引用能否落地的关键。

## 7. API、消息和实时更新边界

### 7.1 API 边界

**[事实]** FastAPI 所有业务 router 都挂在 `/api`，健康检查在 `/health`；覆盖 notebooks、sources、search、models、transformations、notes、embeddings、insights、commands、podcasts、chat、credentials/providers 等（[`main.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/api/main.py#L382-L416)）。没有 `/api/v1` 版本边界。

前端 axios 默认 600 秒超时以容纳慢 LLM 请求，并动态选择 base URL、添加 Bearer token（[`client.ts`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/frontend/src/lib/api/client.ts#L5-L55)）。专门的 Next route handler 透传 SSE body，避免普通代理缓冲（[`_sse-proxy.ts`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/frontend/src/app/api/_sse-proxy.ts#L1-L35)）。

### 7.2 当前“实时”能力矩阵

| 场景 | 当前机制 | 是否 token streaming |
|---|---|---|
| Ask | SSE：strategy/answer/final_answer/complete | 否，按图节点/分支结果 |
| Source Chat | SSE：user/完整 AI/context/complete | 否 |
| Notebook Chat | 普通同步 HTTP | 否 |
| Source 处理状态 | TanStack Query `refetchInterval` | 不适用（[`use-sources.ts`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/frontend/src/lib/hooks/use-sources.ts#L236-L249)） |
| Podcast 状态 | TanStack Query polling | 不适用（[`use-podcasts.ts`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/frontend/src/lib/hooks/use-podcasts.ts#L37-L48)） |

未发现 WebSocket 或 SurrealDB changefeed 直接推前端。README roadmap 仍把 Live Front-End Updates 和 Async Processing 列为未来项（[`README.md`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/README.md#L303-L310)）；源码已经有异步任务，但 UI 状态更新仍是轮询，因此该 roadmap 不能按字面理解为“完全没有异步处理”。

**[事实] 不完整边界。** 通用 command service 的 list jobs 当前直接返回空列表，cancel 对任意 job id 返回 `True`，说明 API 表面有 generic job 管理，但底层仍是占位实现（[`command_service.py`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/api/command_service.py#L70-L89)）。

**[建议]** MVP 定义清晰的异步契约：创建 Source 返回 `202 + source_id + job_id`；`GET /sources/:id` 返回稳定状态机和错误；聊天用单一 SSE endpoint 真正流 token；后台进度先用 1–2 秒 polling 即可，不必先上 WebSocket。

## 8. 部署与本地开发

### 8.1 推荐部署形态

**[事实]** 官方推荐 Docker Compose：独立 SurrealDB + app；app 内运行 API/worker/frontend，并把 `./data` 挂入容器；SurrealDB 和 app 都有持久卷（[`docker-compose.yml`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/docker-compose.yml#L1-L61)、[`docker-compose.md`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/docs/1-INSTALLATION/docker-compose.md#L1-L80)）。单容器镜像已经标记 deprecated，计划在 v2 移除（[`single-container.md`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/docs/1-INSTALLATION/single-container.md#L1-L9)）。

默认端口：生产 UI `8502`、API `5055`、SurrealDB `8000`；Next dev 通常 `3000`。可选的 Docling/Crawl4AI 等重依赖会增加镜像和启动复杂度。

### 8.2 本地开发

**[事实]** 源码开发需要 Python 3.11+、Node、`uv` 和 SurrealDB。需要分别启动 DB、API、`surreal-commands-worker --import-modules commands` 和前端；官方特别警告没有 worker 时 Source 会一直停在 `NEW`（[`from-source.md`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/docs/1-INSTALLATION/from-source.md#L5-L12)、[`from-source.md`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/docs/1-INSTALLATION/from-source.md#L53-L105)）。模型凭证和默认模型在启动后通过 UI 配置。

**[推断]** 对 MVP 而言，四个开发进程仍可接受，但必须提供一条 `docker compose up` 路径和明确 health/readiness。更重要的是确保“worker 未运行”在 UI 上呈现为系统异常，而不是 Source 永久 processing。

## 9. 测试、成熟度和风险信号

### 9.1 正向信号

**[事实]** 当前 CI 覆盖：

- backend pytest + coverage；
- Ruff；
- mypy；
- frontend Vitest + coverage；
- ESLint；
- Next.js production build。

定义见 [`.github/workflows/test.yml`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/.github/workflows/test.yml#L16-L159)。锁定 SHA 的这些 job 均成功，包括 regular/single 两种 Docker 镜像构建，可在[该提交的测试运行](https://github.com/lfnovo/open-notebook/actions/runs/30719593981)和[镜像构建运行](https://github.com/lfnovo/open-notebook/actions/runs/30719593990)核验。

仓库在该 SHA 有 46 个后端 `test_*.py` 文件和 23 个前端测试文件；这说明已经有实质性自动化覆盖，而不是 demo-only 项目。版本为 1.14.0，迁移已演进到多轮 schema 修订。

### 9.2 需要谨慎的信号

1. **[事实] 文档漂移。** Next.js 版本、Source/Notebook 关系、自动 embedding、聊天流式行为等概念文档与代码不完全一致。
2. **[事实] Generic command list/cancel 仍是 stub。** 任务管理能力没有完全收口。
3. **[事实] Search/Ask 无 Notebook filter。** 与“Notebook 是隔离工作区”的产品心智冲突。
4. **[事实] 任务完成语义分层。** Source 父任务会提交 embedding/insight 子任务，而不是等待整体 ready。
5. **[事实] DB 连接无 pooling，消息/元数据双存储。** 当前规模可用，但会成为并发和运维复杂度来源。
6. **[事实] 安全审查明确把 credential endpoints rate limiting 列为待办；目前有 SSRF、防路径穿越、凭证加密和可选密码保护，但无完整多用户安全边界（[`SECURITY_REVIEW.md`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/docs/SECURITY_REVIEW.md#L25-L40)、[`SECURITY_REVIEW.md`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/docs/SECURITY_REVIEW.md#L76-L95)）。
7. **[推断] 最近提交仍在修 Source Chat 上下文回归。** 本次锁定提交本身就是 “include source content in Source Chat context” 修复，说明聊天上下文路径仍在快速演进，不适合照搬而不做端到端验收。

**[建议]** 类似产品的首轮测试重点应放在跨组件契约，而不是只测 CRUD：解析失败恢复、重复任务幂等、重启持久化、Notebook 检索隔离、引用 locator 正确、embedding 模型变更、删除级联、流中断和 provider 错误映射。

## 10. 许可证与可复用约束

**[事实]** Open Notebook 使用 MIT License，版权声明为 `Copyright (c) 2024 Luis Novo`。许可证允许使用、复制、修改、合并、发布、分发、再许可和销售软件副本，但在软件副本或实质性部分中必须保留版权和许可声明；软件按“原样”提供且无担保（[`LICENSE`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/LICENSE#L1-L21)）。

**[推断/建议]** 可复用边界：

- 可以在闭源或商业产品中复用 MIT 代码，但复制“实质性部分”时必须保留原 MIT notice。
- MIT 文本授权的是软件版权，不包含明确的商标许可；产品应使用自己的名称、Logo 和视觉识别。
- 本仓库许可证不自动替第三方依赖、模型权重、provider 服务、用户导入内容或生成音频授权。正式发布前应分别审计 `content-core`、`esperanto`、`podcast-creator`、所有传递依赖和选定模型/provider 条款。上游依赖边界可从 [`pyproject.toml`](https://github.com/lfnovo/open-notebook/blob/a7de90d38aaf18ee85fd661854d35c11e44613e2/pyproject.toml#L16-L97)开始追踪。
- 若只借鉴架构思想而不复制代码，仍应在设计记录中注明参考来源；若复制 prompt、迁移或 UI 组件，按实质性代码复用处理并保留 notice。

> 本节是工程层面的许可证阅读，不构成法律意见。

## 11. 类似产品的 MVP 最小切片

### 11.1 一句话定义

**[建议]** 做一个单用户、自托管的“资料问答笔记本”：用户创建 Notebook，导入 PDF/网页/文本，看到可靠的后台处理状态，在 Notebook 范围内发问，得到带可点击出处的流式答案，并把答案保存为 Note。

### 11.2 必须保留

| 能力 | MVP 定义 | 为什么保留 |
|---|---|---|
| Notebook | 创建、重命名、删除、列表 | 明确检索和数据边界 |
| Source ingest | PDF、URL、纯文本；每 Source 属于一个 Notebook | 构成真实输入闭环 |
| Background job | queued/running/succeeded/failed、错误、重试；可恢复/幂等 | 解析和 embedding 不应阻塞 UI |
| Parsing | 文本 PDF + 简单网页 + TXT/Markdown | 覆盖最常见资料，控制依赖面 |
| Chunk + embedding | 保留 source_id、ordinal、页码/标题路径 locator、embedding model/version | RAG 和引用的基础 |
| Notebook-scoped retrieval | 在数据库查询层强制 notebook filter，top-k 可配置 | 防止跨 Notebook 泄漏 |
| 一个 Chat | 统一 RAG 问答；保存消息；token SSE；回答携带 citations | 核心价值，不分三条聊天路径 |
| Note | 手工笔记、把一条回答保存为笔记 | 完成“问答 → 知识产物”闭环 |
| Provider | 一个 OpenAI-compatible chat adapter + 一个 embedding adapter | 可接云端或本地，配置面最小 |
| 运维 | Docker Compose、health/readiness、一个持久卷策略、备份说明 | 自托管产品必须可恢复 |
| 安全 | 可选单用户密码、加密 provider secret、SSRF/LFI/上传大小保护 | 导入 URL 和保存密钥的最低线 |

### 11.3 明确推迟

| 推迟项 | 推迟理由 | 何时再做 |
|---|---|---|
| 22-provider 矩阵、模型发现、按任务默认模型 | 配置/测试组合爆炸 | 有第二个真实 provider 需求后抽象 |
| Notebook Chat / Source Chat / Global Ask 三分 | 重复上下文、状态和 UI | 一个 RAG Chat 被验证不足时再拆 |
| Podcast、TTS、STT、speaker/episode profiles | 媒体管线和长任务复杂，非核心可信问答 | 核心留存稳定后作为独立里程碑 |
| OCR、公式、视觉、Docling、Crawl4AI/Firecrawl/Jina | 大镜像、系统依赖、质量差异 | 用户反馈显示扫描件/复杂网页占比高时 |
| Transformation/Insight 管理系统 | 首版可用固定摘要替代 | 用户需要重复自动化动作时 |
| Source 跨 Notebook 共享 | 增加 unlink/delete/permission 复杂度 | 有明确复用与去重价值时 |
| 全局 Search 页面、BM25 hybrid | 首版问答可先用向量检索 | 召回评测证明关键词检索必要时 |
| Embedding rebuild coordinator | 首版只允许一个 embedding model/version | 模型迁移出现后补后台重建 |
| 多用户/团队/RBAC | 与上游当前产品阶段也不一致 | 单用户闭环和数据边界稳定后 |
| WebSocket/changefeed | polling + SSE 已足够 | 需要大量并发任务或多人协作时 |

### 11.4 最小 API 契约

**[建议]** 首版只需要以下主路径：

```text
POST   /api/v1/notebooks
GET    /api/v1/notebooks
POST   /api/v1/notebooks/{id}/sources        -> 202 {source_id, job_id}
GET    /api/v1/sources/{id}                  -> status/progress/error
POST   /api/v1/sources/{id}/retry
DELETE /api/v1/sources/{id}
POST   /api/v1/notebooks/{id}/chat/stream    -> SSE token/citation/done/error
GET    /api/v1/conversations/{id}/messages
POST   /api/v1/notebooks/{id}/notes
GET    /api/v1/notebooks/{id}/notes
GET    /health
GET    /ready
```

SSE 事件建议固定为：`message_start`、`token`、`citation`、`message_end`、`error`。Citation 至少包含 `source_id`、`chunk_id`、`title`、`locator` 和引用片段；后端保存最终 message 与 citations，客户端断线重连后可读取完整结果。

### 11.5 建议的单一状态机

```text
queued
  -> extracting
  -> chunking
  -> embedding
  -> ready

任一步 -> failed {stage, code, safe_message, retryable}
failed --retry--> queued
```

**[建议]** Source 只有到 `ready` 才进入检索；若先允许无 embedding 的全文聊天，应把它定义为另一种明确能力，不要让“Source 已完成”和“Source 可检索”含义漂移。

### 11.6 MVP 验收标准

1. 用户能创建 Notebook，导入至少 3 份 PDF/URL/文本资料，并看到每份资料的稳定处理阶段和可理解错误。
2. 导入任务重复提交或 worker 重启不会产生重复 chunks；失败任务可以重试。
3. 用户询问一个需要综合至少两份资料的问题，回答只使用当前 Notebook 的资料。
4. 每个关键结论至少有一个可点击 citation，能打开具体 Source 的页码或段落并看到匹配文本。
5. 答案以 token SSE 流式显示；断线不会产生无法恢复的半条消息。
6. 用户能把回答保存为 Note，刷新和重启 Docker 后仍存在。
7. 备份/恢复覆盖数据库、上传文件和加密配置，恢复后问答与引用仍可用。
8. 不配置 Podcast、OCR 或第二个 provider，也能完成完整闭环。

## 12. 建议的实现顺序

**[建议]**

1. 先实现 Notebook/Source/Job schema 和上传安全边界。
2. 接通一种 PDF parser、网页提取和纯文本，持久化 locator。
3. 完成可重试、幂等的 extract → chunk → embed 状态机。
4. 做 Notebook-scoped retrieval，并用固定问题集验证召回和隔离。
5. 接 token SSE Chat、citations 和会话持久化。
6. 做“保存回答为 Note”以及 Source/Notebook 删除级联。
7. 最后补 Docker Compose、备份恢复、端到端测试和错误 UX。

这一顺序刻意把“引用和隔离”放在 UI 花活之前，因为它们决定产品是否可信；把 Podcast 和 provider 矩阵推迟，因为它们不验证核心假设。

## 13. 尚未确认事项

1. **[待确认] 产品目标是个人本地工具，还是从 MVP 起就要支持团队/多租户。** 这会决定 auth、所有权字段、检索 filter 和存储选型。
2. **[待确认] 首发资料类型和中文文档占比。** 若扫描 PDF/中文复杂排版是主场景，OCR/Docling 不能完全后置，需要先做小规模 parser 质量评测。
3. **[待确认] 首发模型路径。** 云端 OpenAI-compatible、本地 Ollama/LM Studio，还是二者都必须支持；这会影响模型发现、超时和 embedding dimension 管理。
4. **[待确认] 数据规模目标。** 单 Notebook 的 Source 数、总页数、并发用户与查询延迟目标会决定 SQLite/pgvector、索引和 worker 策略。
5. **[待确认] 引用精度。** 只需回到 Source，还是必须定位 PDF 页码、网页标题/段落并高亮原文。建议把后者作为 MVP 可信度要求。
6. **[待确认] 是否需要离线/全本地。** 若必须完全离线，parser、embedding、LLM 和字体/模型缓存都要纳入镜像与容量规划。
7. **[待确认] 是否复用上游代码。** 仅参考架构与直接 fork/复制代码对应不同的许可证 notice、升级和安全补丁策略。
8. **[待确认] 当前上游在真实目标数据集上的解析质量、召回质量和长时间运行稳定性。** 本次是源码级调研，未用生产资料做端到端基准。

## 14. 对 Open Notebook 的最终判断

**[事实]** Open Notebook 已经是有真实产品面、数据迁移、任务系统、CI 和部署路径的成熟开源应用，而不是一个 RAG 教程。它最值得借鉴的是：Source/Insight/Note 的领域分层、内容提取作为独立边界、持久化后台任务、provider 与 model/credential 分离、以及 API-first 的产品结构。

**[推断]** 它最不值得原样复制的是当前累积出的能力矩阵和边界分叉：全局 Ask 与 Notebook 隔离不一致，三条聊天路径语义不同，任务完成与派生索引 ready 不完全一致，聊天状态跨 SurrealDB/SQLite，实时更新混合同步、SSE 和 polling。

**[建议]** 类似产品的 MVP 应比它更“窄但完整”：只做一个 Notebook 范围、一个可靠 ingest 状态机、一个检索聊天、一种可核验 citation 和一个 Note 出口。只要这条闭环能在重启、失败重试和多资料交叉提问下稳定工作，后续再加 Podcast、Transformation 和 provider 扩展才有坚实基础。
