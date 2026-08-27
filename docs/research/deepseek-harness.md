# DeepSeek Harness 的“所有皆插件”架构调研

- 调研日期：2026-08-27
- 上游仓库：<https://github.com/deepseek-ai/deepseek-harness>
- 默认分支：`master`
- 锁定 commit：[`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`](https://github.com/deepseek-ai/deepseek-harness/commit/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)
- commit 时间：2026-08-21 20:03:37 +08:00
- 上游版本字段：`0.1.1-rc.2`
- 证据范围：锁定 SHA 下的仓库源码、README、官方架构/教程文档，以及仓库内 vendored Cordis/Loader 源码。本文不以博客、新闻稿或第三方解读作为事实来源。

## 结论先行

DeepSeek Harness 的“everything is a plugin”不是“在一个传统应用旁边留几个插件钩子”，而是把**产品行为的装配单位**统一成 Cordis Plugin：模型适配器、Agent 注册表与默认 loop、会话日志、工具注册表、系统提示词、持久化、审批、沙箱、Web Host 和浏览器 UI 都通过同一种生命周期容器挂载。官方架构文档明确把这些能力称为可由配置替换的插件，并把服务、typed event、reversible effect 作为共同机制。[源码事实：架构总述](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/architecture.md#L9-L13)

但“没有特权核心”应理解为**没有必须修改的产品行为核心**，而不是字面上的“没有内核”。实际仍存在四层不可忽略的底座：

1. Cordis 的 `Context`、服务反射、事件总线、Plugin Registry、Fiber/effect 生命周期和 logger。根 `Context` 构造时直接安装这些内建服务。[源码事实：Context 构造](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/context.ts#L70-L83)
2. Host boot 代码先创建 `Context`、提供启动期值并挂载 `Loader`，之后才加载配置树；失败时它负责销毁部分启动的树。[源码事实：boot](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/boot/app-boot/src/index.ts#L757-L800)
3. npm/pnpm、ESM 动态加载、bundle/profile manifest、构建和进程权限模型不属于插件协议本身。
4. TypeScript 的领域类型、事件声明与各服务契约仍是编译期共享协议；“可替换实现”不等于“无稳定领域模型”。

对 Open Notebook 类 MVP，最值得迁移的不是它现在的包数量或完整 Cordis 功能，而是以下最小集合：

- 一个极小的生命周期内核；
- 显式命名的 capability/service；
- `requires`/`inject` 依赖声明；
- 注册即返回 disposer，Plugin 停止时自动撤销；
- 一个可审计的 composition root；
- Definition / Provider / Consumer 三角色拆分；
- 对启动错误、重复注册和缺失依赖 fail fast；
- 真实组合测试，而不只测孤立 Plugin。

MVP 不应照搬动态安装不可信代码、`node:vm` 动态插件、Host/Client 双运行时插件图、HMR、profile/bundle 多层覆盖、`!!js` 配置表达式、服务 realm 隔离和数百个细粒度包。它们解决的是生态、热更新、多部署形态和自修改 Agent 的问题，不是 Notebook MVP 的核心风险。

## 一、它所说的“所有皆插件”到底是什么

### 1.1 可验证的含义

**源码事实**

Cordis 对 Plugin 的统一抽象很薄：Plugin 可以是函数、构造器，或带 `apply(ctx, config)` 的对象；可带 `name`、运行时 `Config` schema、`inject`、`provide` 和 `intercept` 元数据。[Plugin 类型定义](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/registry.ts#L91-L145)

Harness 在这层之上把产品能力统一成以下贡献方式：

- 通过 `Service` 在 `ctx.<key>` 提供能力；
- 通过 `inject` 声明硬依赖；
- 通过 typed event 观察、拦截或包装流程；
- 通过 registry method 注册 provider、tool、prompt section、UI slot 等成员；
- 通过 `ctx.effect()` 或 effect-aware registry 把贡献绑定到 Plugin 生命周期。

官方 primer 把这五点概括为 Plugin、Context/service、`inject`、typed event、reversible effect。[Cordis 五个概念](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/cordis-primer.md#L7-L13)

因此，“都是 Plugin”指的是**统一的装配、依赖和撤销模型**，不意味着所有能力都实现同一个业务接口。LLM adapter 注册到 `ctx.llm`，工具注册到 `ctx.tools`，策略监听 `tools/pre-execute`，UI 监听 durable `session/event` 或注册浏览器 slot；它们共享 Cordis 生命周期，但使用各自的领域协议。[扩展点映射](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/architecture.md#L106-L129)

### 1.2 真正的核心与 Plugin 边界

| 层 | 是否是普通产品 Plugin | 职责 | 边界判断 |
|---|---:|---|---|
| Cordis microkernel | 否 | `Context`、service resolver、event bus、Registry、Fiber、effect | 真正的运行时内核 |
| Loader / boot / Include | 部分 | Loader 自身以 Plugin 挂载，但 boot、模块解析和根配置装配先于产品树 | composition kernel |
| Harness 领域定义 | 是 | `sessions`、`agents`、`tools`、`systemPrompt`、`llm` 等 service | 稳定 capability contract，仍是内置 Plugin |
| Provider / consumer / policy | 是 | LLM provider、存储、文件系统、工具、审批、策略、持久化 | 可替换或可组合产品行为 |
| Profile / bundle / package manager | 否 | 安装依赖、排列 patch layer、解析 npm package | 分发与部署层 |
| Web Client module runtime | 是，但有第二套运行时 | Host 扫描 `dsh.client`，浏览器加载 bundle 并挂载 browser Plugin | Web 专属扩展系统 |
| 动态 Agent 自编写 Plugin | 可选子系统 | 定义、审批、`node:vm` 执行、浏览器 half 协调 | 高风险高级功能，不是基础模型 |

`Context` 本身是 Proxy-backed service repository；`isolate()` 只是为某个 service name 换一个 symbol label，使下级 context 解析到另一份实现。[Context 与 isolate](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/context.ts#L35-L41) [具体实现](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/context.ts#L109-L125)

**推断**

它更准确的描述是：**产品是 Plugin tree，运行时是 microkernel，领域契约是稳定边界，部署是 layer composition。** 这比“所有代码都可随意替换”严格，也更适合迁移到 Notebook 产品。

## 二、Plugin 接口、注册、发现、加载与生命周期

### 2.1 Plugin 形态与协议

**源码事实**

Cordis 支持三种入口：

```ts
type Plugin =
  | ((ctx, config) => Effect | void)
  | (new (ctx, config) => unknown)
  | { apply(ctx, config): Effect | void }
```

这三种形态由 registry 的 `resolve()` 归一化为一个 callback，并以 callback identity 作为 runtime registry key；同一个 callback 可以在不同 context 下有多个 Fiber 实例。[resolve 与 Runtime](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/registry.ts#L216-L266) [plugin 创建 Fiber](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/registry.ts#L293-L336)

一个 `Service` 子类在构造时调用 `ctx.reflect.provide(name, instance, check)`，服务会随所属 Fiber 自动撤销；服务可通过 TypeScript declaration merging 增加 `Context` 类型，但 declaration merging 不产生运行时代码。[Service 注册](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/service.ts#L29-L63) [教程说明](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/cordis-tutorial/03-services.md#L7-L40)

这不是一个跨语言或跨进程 Plugin ABI，而是 TypeScript/JavaScript 同进程协议。跨进程能力另有 ACP、SDK、API gateway、MCP 等适配层，它们自身又以 Cordis Plugin 形式接入。

### 2.2 注册与发现

**源码事实**

存在四种不同层级的“发现”，不能混为一谈：

1. **代码内注册**：`ctx.plugin(plugin, config)` 直接挂载，并返回 `Fiber & PromiseLike<Fiber>`。[Registry API](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/registry.ts#L164-L186)
2. **配置发现**：Loader entry 的 `name` 是相对路径或 npm module specifier；Loader 动态 `import()`，再把 ESM/CJS/default export 形态归一化后交给 registry。[动态 import](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/loader/src/config/tree.ts#L144-L161) [export 归一化](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/loader/src/index.ts#L191-L199)
3. **产品安装/激活**：`dsh plugin` 实际是 profile 目录内的 pnpm 前置器。安装后，它扫描 dependency 的 `package.json` 是否声明 `dsh.bundle.patch`，再把该 package 放入 `dsh.profile.bundles`。[CLI 调和逻辑](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/apps/cli/src/plugin.ts#L1-L9) [bundle 判定与列表更新](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/apps/cli/src/plugin.ts#L30-L90)
4. **社会化发现**：README 只建议发布者给仓库加 `dsh-plugin` GitHub topic；源码中未见官方 marketplace/远程 catalog 是常规 Plugin 加载的前提。[README](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/README.md#L39-L43)

Web 还有独立的 browser Plugin 发现：Host 扫描已加载 entry 对应 package 的 `dsh.client` manifest 和 `exports["./client"]`，构造带 hash/revision 的 boot graph，并在浏览器端加载。[Client module 官方说明](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/subsystems/client-modules.md#L1-L18)

**推断**

“自动发现”不是内核必须能力。它是 package distribution 与 Web 运行时的产品决策。Notebook MVP 可先用显式静态 registry，保留 descriptor 形状，等确实需要第三方生态时再加入目录扫描/包安装。

### 2.3 加载与启动顺序

**源码事实**

Loader entry 含 `id`、`name`、`config`、`group`、`disabled` 和 `inject`；它先 patch context，再由 `ctx.registry.plugin()` 创建 Fiber 并 `await fiber.await()`。入口 import、apply、dispose、rollback 错误都会带 entry id/name 和阶段包装。[EntryOptions](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/loader/src/config/entry.ts#L8-L27) [entry 启动](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/loader/src/config/entry.ts#L258-L301)

同组 entry 并发创建，配置列表位置不保证激活顺序；真正的启动约束由 `inject` 的 service availability 决定。[教程](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/cordis-tutorial/01-first-plugin.md#L23-L31) Loader group 使用 `Promise.allSettled` 启动候选项，聚合错误并在失败时撤销新 entry、恢复旧配置。[Group 更新事务](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/loader/src/config/group.ts#L59-L105)

### 2.4 生命周期和 effect

**源码事实**

每次 Plugin 激活对应一个 Fiber，状态机为：

```text
PENDING -> LOADING -> ACTIVE -> UNLOADING -> DISPOSED
                    \-> FAILED
```

状态含义在源码中明确：`PENDING` 等待依赖，`FAILED` 表示 config 或 callback 失败，卸载会运行 disposer。[FiberState](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/fiber.ts#L139-L154)

`ctx.effect(fn)` 立即执行 acquire body，收集一个或多个同步/异步 disposer。所属 Fiber 卸载时 effect 被撤销；`ctx.on()`、`ctx.plugin(child)`、service 注册和 Harness registry 注册本身也是 effect-aware。[effect 教程](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/cordis-tutorial/02-lifecycle-and-effects.md#L5-L43) [已经是 effect 的 API](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/cordis-tutorial/02-lifecycle-and-effects.md#L69-L78)

Fiber 根据所注入 service 的实现 Fiber uid 生成 epoch。依赖缺失时进入 inactive/PENDING；依赖实现变化时先 unload，再按新实现 reload。Plugin startup 的错误被记录并由 `fiber.await()` 重抛；disposer 错误被 logger 记录并继续清理其他资源。[依赖刷新](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/fiber.ts#L597-L639) [reload/unload/await](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/fiber.ts#L641-L709)

**可迁移原则**

Notebook MVP 最值得直接借鉴的是“注册与生命周期绑定”：导入器注册的 file watcher、向量库连接、定时同步任务、事件 listener 和 provider registration 都必须由一个 owner handle 统一释放。比起 HMR，这一机制更重要，因为它直接决定测试隔离、重复启动和 graceful shutdown 是否可靠。

### 2.5 配置

**源码事实**

Plugin 可以导出符合 Standard Schema 的 `Config`；Fiber 在执行 Plugin 前同步校验并返回 normalized value，schema issues 聚合为 `ValidationError`。异步 schema validation 当前不支持。[配置校验源码](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/fiber.ts#L16-L61)

仓库通常使用 Schemastery。默认值在校验时补齐，错误配置使 Fiber `FAILED`，不会带着半合法配置启动。[配置教程](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/cordis-tutorial/05-config.md#L5-L67)

Loader/Include 另外支持 `!!js` 配置表达式；entry 的 `config` 在依赖已经激活后、以该 Plugin context 为求值环境插值，`disabled` 则在 mount decision 时求值。[Loader 配置语义](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/cordis-primer.md#L36-L38)

**推断**

Schema validation 应迁移；`!!js` 不应迁移到 MVP。后者把配置升级成代码执行面，增加可复现性、安全和运维诊断成本。Notebook MVP 用环境变量引用、secret reference 和有限模板变量即可。

### 2.6 依赖与组合

**源码事实**

`inject` 支持数组或 service-name-to-intercept-config map。硬依赖缺失时 Plugin 不执行；provider 消失时依赖者卸载，provider 恢复时依赖者重载。可选依赖不放在 `inject`，而在调用点用 `ctx.get(name)` 探测。[硬依赖与重载](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/cordis-tutorial/03-services.md#L42-L87) [可选依赖](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/cordis-tutorial/03-services.md#L89-L101)

一个运行实例是 ordered patch layers 在空 entry list 上组合出的 Plugin tree：bundle list、profile patch、home patch、CLI overlay 依次应用；patch 通过稳定 entry `id` 替换整段 config 或插入 row。[Profile/bundle 语义](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/architecture.md#L15-L35)

能力边界使用三角色模型：Service Definition 声明接口，Service Provider 实现它，Consumer 使用它；例如 filesystem 定义、local/sandbox provider、面向模型的 file tools 可以独立替换和演进。[Capability seam](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/architecture.md#L98-L102)

**推断**

三角色模型应迁移，但不必把每个角色立刻拆成一个 npm package。MVP 可先在同一仓库的独立 module 内保持接口边界；只有存在两个 provider、独立发布需求或明显不同的演进速度时再拆包。

### 2.7 Typed event 与组合方式

**源码事实**

Cordis 支持 `emit`、`parallel`、`serial`、`bail`、`waterfall` 五种 runtime dispatch；Harness 文档重点公开 `emit`、`parallel`、`serial`、`waterfall`。`waterfall` 是 around-middleware：listener 必须调用 `next()` 才继续，否则可短路；`parallel` 聚合 listener rejection；event listener 注册本身是 effect。[dispatch 类型](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/events.ts#L24-L32) [dispatch 实现](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/events.ts#L177-L243) [listener effect](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/events.ts#L245-L301)

Harness 把 durable session events 和 live interception events 分开：`turn/*`、`step/*`、message、tool call/result 写入 append-only log；`agent/*`、`llm/stream`、`tools/*` 用于在途拦截。[事件分类与 turn flow](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/architecture.md#L53-L96)

**可迁移原则**

Notebook MVP 也应区分：

- durable domain event：`source.imported`、`source.versioned`、`document.indexed`、`note.created`、`artifact.generated`；
- live hook：`ingest.beforeExtract`、`retrieval.beforeSearch`、`answer.beforeModel`、`answer.afterModel`。

但 MVP 只需 `notify` 与 `around` 两类，避免一开始复制五种 dispatch mode。

### 2.8 错误处理

**源码事实**

- 无效 Plugin shape 立即 throw；config/startup error 使 Fiber `FAILED`，`await()` 重抛。[Registry 校验](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/registry.ts#L304-L335) [Fiber await](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/fiber.ts#L698-L709)
- Loader 给 import/apply/dispose/rollback error 增加 entry identity 与 stage；更新失败时尝试恢复旧 Plugin。[Entry 更新](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/loader/src/config/entry.ts#L181-L246)
- Group 更新并发执行并聚合错误，失败时回滚新 entry 和旧配置。[Group 事务](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/loader/src/config/group.ts#L59-L105)
- 纯 Cordis 允许依赖缺失的 Plugin 长期 `PENDING`；教程甚至提醒这可能无输出且进程正常退出。Harness 产品 boot 额外审计 enabled entry，报告未解析 Plugin 和缺失 service，避免产品启动静默成功。[PENDING 语义](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/cordis-tutorial/03-services.md#L68-L86) [产品 fail-loud 审计](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/boot/app-boot/README.md#L5-L25)

**推断**

MVP 应默认把启动后的 unresolved hard dependency 当成配置错误，而不是长期 `PENDING`。只有明确支持运行时安装/卸载 provider 时，才需要 Cordis 这种动态等待语义。

### 2.9 隔离与安全

**源码事实**

Loader 的 `isolate` 使用 `LocalRealm`/`GlobalRealm` 为 service name 分配 symbol，并迁移/重载匹配的 service implementation。它没有创建进程、Worker、权限边界或文件系统隔离。[realm 实现](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/loader/src/config/isolate.ts#L25-L68) [isolate context patch](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/loader/src/config/isolate.ts#L91-L145)

普通 Host Plugin 通过 Node `import()` 在 Harness 进程内执行，所以具有该进程的权限。官方安装教程也明确：git dependency 的 `prepare` allowlist 等同于授权 package 在机器上、Agent sandbox 外执行代码，并建议只信任源码且固定 SHA。[安装安全警告](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/user/develop/basic/publish.md#L153-L178)

Harness 的 subprocess sandbox 是另一条 capability seam，只负责把将要 spawn 的 argv 包进文件效果约束；官方限制中明确其 policy 不覆盖网络、syscall、device 或 credential。它不是 Plugin loader 的沙箱。[Sandbox contract](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/sandbox/sandbox/README.md#L5-L13) [限制](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/sandbox/sandbox/README.md#L39-L46)

仓库另有模型动态定义 Plugin 的 extensions 子系统：Host half 在 `node:vm`，Client half 在浏览器执行，并有 run/stop/undefine 与人工审批流程。[extensions 组成](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/extensions/README.md#L1-L12) 但其官方 trust stance 明确写明 `node:vm` 只隔离 globals，不是安全边界，host-realm helper 可逃逸到 Node，应按 bash 权限对待。[动态 Plugin trust stance](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/extensions/tool-cordis/README.md#L21-L27) [已知限制](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/extensions/tool-cordis/README.md#L100-L104)

**结论**

“service isolation”“subprocess sandbox”“Plugin code trust”是三件不同的事：

| 机制 | 隔离什么 | 不隔离什么 |
|---|---|---|
| Cordis `isolate` | 同名 service 的解析范围 | 代码权限、内存、进程、文件、网络 |
| `ctx.sandbox` | 某次子进程调用的部分文件效果 | Host Plugin 本身、网络、凭据、完整 syscall |
| dynamic Plugin `node:vm` | globals 与一部分 API surface | 恶意代码逃逸到 Node 的安全边界 |

Notebook MVP 若要加载第三方不可信 Plugin，必须另做 process/container boundary、IPC capability protocol、资源限制和签名/授权；不能把 `isolate` 或 `node:vm` 当作安全答案。

## 三、内置 Plugin 分类与典型调用链

### 3.1 分类

锁定 SHA 的 `packages/` 下有大量细粒度 package；默认 base bundle 本身挂载从 timer/HMR 到 LLM、session、settings、credentials、persistence、sandbox、tools、prompt、agent-loop 等完整树。[base bundle 起始部分](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/bundle/base/cordis.patch.yml#L1-L30) [base bundle 的 tools/prompt/loop/provider](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/bundle/base/cordis.patch.yml#L420-L451)

| 类别 | 典型职责 | 典型例子 |
|---|---|---|
| Framework | lifecycle、loader、HMR、timer、logger | Cordis、Loader、Include、Group、HMR |
| Domain definition | 稳定 service/event/value contract | session、agent、llm、tools、system-prompt、storage |
| Provider/backend | 可替换机制 | DeepSeek/pi-ai adapter、JSONL/SQLite、local/sandbox FS、web provider |
| Consumer/tool | 把能力暴露给模型或人 | `tool-fs`、`tool-bash`、`tool-web`、commands、skills |
| Policy/middleware | 拦截流程或施加约束 | approval、permission、plan、timeout、compaction、retry、telemetry |
| Orchestration | 驱动多步工作 | agent-loop、jobs、goals、subagents、workflow、schedule |
| Surface/transport | 把 Agent 接给人或协议 | Web、headless、ACP、SDK、API gateway |
| Client UI | 浏览器 runtime 与 slot contributions | layout、conversation、settings、tool renderers、theme |
| Distribution | 组合一组 entry | base/web/headless bundle、profile、user patch |

这说明“Plugin type”主要由它向哪个 service/registry/event 贡献来区分，而不是由 Loader entry 的 `kind` 字段区分。Loader row 只有 module、config、dependency 与 grouping 元数据；业务角色存在于服务契约中。

### 3.2 启动调用链

```text
dsh CLI
  -> 解析 profile
  -> bundle patches + profile patch + home patch + --patch
  -> app-boot 创建 Context
  -> 挂载 Loader / Include / Group
  -> Loader import(entry.name)
  -> Registry 创建 Fiber
  -> 等待 inject services
  -> 校验 Config
  -> apply(ctx, config)
  -> 注册 service / event / provider / tool / UI slot
  -> app-boot 审计所有 enabled entries 已加载并激活
```

这条链的关键不是 YAML，而是**配置只描述组成；依赖可用性决定激活；Fiber 拥有所有贡献的清理责任**。

### 3.3 一次 Agent turn 的典型调用链

官方架构给出的主链为：

```text
turn/start
  -> inbox claim
  -> systemPrompt.assemble(sections + tool schemas)
  -> agent/pre-step waterfall
  -> step/start
  -> durable user/message
  -> deriveMessages(session log)
  -> agent/request waterfall
  -> llm.prepareCall / llm.stream
  -> durable assistant/chunk* + assistant/message
  -> durable tool/call
  -> tools/pre-execute
  -> tools/execute
  -> tools/post-execute
  -> durable tool/result
  -> step/end
  -> agent/turn-stopping
turn/end
```

[官方 turn flow](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/architecture.md#L63-L90) 源码中默认 Agent loop 确实依次 assembly prompt、append turn/step/message、调用 LLM、记录 chunk/message，并执行工具。[Agent loop prompt/turn](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/core/agent-loop/src/agent.ts#L230-L319) [LLM 与 assistant events](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/core/agent-loop/src/agent.ts#L340-L375)

典型 Plugin 组合为：

- `system-prompt` service 聚合 prompt section 与 tool schema；
- 每个工具 Plugin 向 `ctx.tools` 注册 definition；
- permission/timeout/metrics Plugin 监听工具 pipeline；
- LLM adapter 向 `ctx.llm` 注册 provider route；
- persistence/UI/telemetry 订阅同一 durable session event stream；
- Agent loop 只协调这些稳定 seam，不直接 import 每个实现。

## 四、如何新增一个常规 Plugin

### 4.1 最小入口

**源码事实**

最小 Plugin 只需导出 `apply`；常规 namespace export 还会导出 `name`、`inject`、`Config`。官方教程展示了函数、对象和 `Service` class 三种形态，并建议只有要提供 service 时才使用 class。[三种形态](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/cordis-tutorial/01-first-plugin.md#L53-L77)

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'notebook-importer'
export const inject = ['sourceImporters', 'blobStore']

export interface Config {
  maxBytes: number
}

export const Config: Schema<Config> = Schema.object({
  maxBytes: Schema.number().min(1).default(20 * 1024 * 1024),
})

export function apply(ctx: Context, config: Config) {
  return ctx.sourceImporters.register({
    kind: 'pdf',
    maxBytes: config.maxBytes,
    async import(input, signal) {
      return ctx.blobStore.put(await parsePdf(input, signal))
    },
  })
}
```

这个示例中的 `sourceImporters`/`blobStore` 是面向拟建 Notebook 的建议接口，不是 DeepSeek Harness 的现有 service。

### 4.2 本地加载

把 module 放进一个 patch 的 `insert` row，给它稳定 entry id：

```yaml
- insert:
    - id: notebook-importer-pdf
      name: '/absolute/path/to/plugin/index.js'
      config:
        maxBytes: 20971520
```

Loader row 以 module specifier 解析，稳定 id 用于 update/remove/HMR 对齐。[first Plugin composition](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/cordis-tutorial/01-first-plugin.md#L23-L51) [entry id 与 disabled](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/cordis-tutorial/06-composition-and-hmr.md#L5-L22)

### 4.3 发布与安装

常规外部 Plugin 的 package 声明：

```json
{
  "name": "dsh-notebook-importer-pdf",
  "type": "module",
  "main": "index.js",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

bundle 的 `cordis.patch.yml` 插入一个或多个 row；用户执行 `dsh plugin --profile <name> add <package>`，CLI 用 pnpm 安装并将声明 bundle 的 dependency 加入 profile bundle list。[官方发布教程](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/user/develop/basic/publish.md#L9-L64) [安装流程](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/user/develop/basic/publish.md#L75-L110)

### 4.4 一个合格 Plugin 还应做到

- 对 config 做 runtime schema validation；
- 只用 `inject` 声明真正的 hard dependency；
- 所有注册/连接/watcher 都返回 disposer；
- 对重复 provider/tool id 给稳定错误；
- 不直接 import 可替换 provider；
- 把可持久事实写为 domain record/event，把在途 policy 放在 hook；
- 测试 dispose 后 registry/service/listener 已清除；
- 至少有一个通过真实 Loader/composition 启动的测试。

最后两项是仓库明确的测试政策：每个 registry 都需要 HMR cleanup 测试，用户可见 Plugin 需要真实 composition test。[测试政策](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/testing.md#L7-L13) [真实入口测试](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/testing.md#L31-L35)

## 五、测试策略与成熟度

### 5.1 仓库声明的测试层级

**源码事实**

官方测试政策包含：

| 层级 | 目的 |
|---|---|
| Unit | package-local Vitest；强调 edge/error/order/concurrency；registry 必测卸载清理 |
| Coverage | `packages/*/*/src` per-file 100% gate，少数环境相关例外 |
| Real API e2e | 使用真实 DeepSeek/其他 provider key；无 key 时 self-skip |
| Keyless snapshot | ACP/headless 协议、session log、提示词/工具 schema 的确定性回放 |
| Web browser snapshot | Chromium 对 replay UI 做快照；Linux PR gate |
| Built artifact / real entry | 通过 Loader、真实 app/process、构建后 `lib` 验证发布路径 |

[各测试层级](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/testing.md#L7-L13) [真实发布入口要求](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/testing.md#L31-L40)

本次对锁定工作树的机械清点得到：234 个 `packages/**/package.json`、752 个 `*.spec.ts`、136 个 `*.e2e.ts`、582 个路径中含 `snapshots` 的文件。该数字包含 fixture 和测试支持包，只能说明规模，不能替代质量判断。

### 5.2 成熟度判断

**事实与判断分开**

- **事实**：README 仍明确标注 developer preview，并承诺会有 compatibility-breaking changes。[稳定性声明](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/README.md#L9-L11)
- **事实**：测试策略非常强，覆盖 unit、per-file coverage、真实 API、协议/日志快照、浏览器、构建产物和多平台 CI。
- **事实**：本次文件搜索没有在 `vendor/cordis` 和 `vendor/loader` 目录内找到直接随 vendored 源码放置的 test/spec 文件；但 `app-boot`、HMR、composition 与大量 package 测试会间接覆盖它们，不能据此断言 Cordis 没有测试。
- **判断**：实现成熟度和测试纪律高于通常的 developer preview；API/生态稳定度却仍低。适合借鉴结构与测试策略，不适合把当前 Cordis API 当成长期稳定第三方 Plugin ABI 直接绑定。
- **判断**：复杂度已经很高。高覆盖率降低回归概率，不降低理解成本、Plugin 间语义耦合和安全边界设计成本。

## 六、对 Open Notebook 类 MVP 可迁移的设计原则

### 6.1 先定义 MVP 中“所有皆插件”的严格含义

建议定义为：

> 除 Plugin kernel、领域实体/事件格式、持久化 migration owner、HTTP/UI composition root 和安全边界外，所有可替换业务能力都通过统一 Plugin lifecycle 提供或消费；MVP 的 Plugin 是仓库内可信模块，不是可在线安装的第三方代码。

这样保留 DeepSeek Harness 最有价值的模块化，同时避免过早承诺第三方 ABI 和不可信代码执行。

### 6.2 建议的最小 Plugin kernel

```ts
type ServiceKey<T> = symbol & { readonly __type?: T }
type Dispose = () => void | Promise<void>

interface Plugin<C = unknown> {
  id: string
  requires?: readonly ServiceKey<unknown>[]
  config: Schema<C>
  setup(ctx: PluginContext, config: C): void | Dispose | Promise<void | Dispose>
}

interface PluginContext {
  get<T>(key: ServiceKey<T>): T
  optional<T>(key: ServiceKey<T>): T | undefined
  provide<T>(key: ServiceKey<T>, value: T): Dispose
  on<T>(event: EventKey<T>, handler: (event: T) => void | Promise<void>): Dispose
  effect(acquire: () => void | Dispose | Promise<void | Dispose>): Dispose
}
```

MVP 只需要：

1. descriptor validation；
2. topological dependency validation；
3. deterministic start order；
4. reverse stop order；
5. setup 失败时 rollback 已启动 Plugin；
6. duplicate service/provider id 报错；
7. registry snapshot/diagnostic；
8. integration test helper。

不需要 Fiber 动态 epoch、运行中 service replacement、realm、HMR 或多层 patch transaction。

### 6.3 Notebook 的 capability seam 建议

| Capability definition | Provider 示例 | Consumer 示例 | MVP 优先级 |
|---|---|---|---:|
| `BlobStore` | local filesystem | importer、attachment API | P0 |
| `NotebookStore` | SQLite/Postgres | notebook CRUD、UI API | P0 |
| `SourceImporterRegistry` | file/url/text importers | source ingestion use case | P0 |
| `ContentExtractorRegistry` | PDF/HTML/Markdown extractor | ingestion pipeline | P0 |
| `ChunkingStrategy` | paragraph/token-aware | indexing pipeline | P0 |
| `EmbeddingProvider` | OpenAI-compatible/local | indexing pipeline | P0 |
| `VectorIndex` | SQLite vector/pgvector/Qdrant | retriever | P0 |
| `Retriever` | hybrid vector + keyword | grounded chat、artifact generator | P0 |
| `ChatModelProvider` | one OpenAI-compatible adapter | grounded chat | P0 |
| `PromptContributionRegistry` | citation/context policies | answer assembler | P0 |
| `ArtifactGeneratorRegistry` | summary/FAQ/study guide | notebook artifacts | P1 |
| `Reranker` | provider/local | retriever | P1 |
| `SyncProvider` | Drive/Notion/YouTube | refresh jobs | P2 |
| `UiSlotRegistry` | custom viewers/settings cards | Web client | P2 |

### 6.4 推荐的组合

```text
Notebook app composition root
  kernel
  storage.sqlite
  blob.local
  importer.file
  extractor.pdf
  extractor.markdown
  chunker.default
  embeddings.openai-compatible
  index.sqlite-vector
  retriever.hybrid
  chat.openai-compatible
  prompt.grounded-citations
  api.http
  ui.web
```

这里每一项可以是 Plugin，但 MVP 只有**一份 checked-in composition**。环境差异通过 typed config 解决；不要马上引入 profile、bundle 和多层覆盖。

### 6.5 必须保持稳定的领域核心

即便“所有皆插件”，以下内容也不应由 provider 私自定义：

- `Notebook`、`Source`、`SourceRevision`、`Document`、`Chunk`、`Citation`、`Conversation`、`Message`、`Artifact` 的 identity 和基本语义；
- source/version/index 状态机；
- citation 必须能回指 `sourceRevision + locator`；
- migration ownership 与数据库 compatibility version；
- durable job/outbox contract；
- error code 和 cancellation contract；
- secret reference，不把 secret 值散落进 Plugin config；
- provenance：哪一个 provider/version/config 生成了 embedding、answer 或 artifact。

DeepSeek Harness 自身也不是让 provider 任意定义会话历史：它把 model-visible 内容要求为可从 append-only session log 重建，并由 runtime invariant 约束。[Session log 原则](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/architecture.md#L92-L96)

### 6.6 对 Notebook 最有价值的 effect 用法

- importer Plugin unload 时停止目录 watcher；
- embedding provider unload 时关闭 HTTP pool/worker；
- vector backend unload 时 drain pending writes 并关闭连接；
- sync Plugin unload 时取消 schedule 并等待当前 job 到安全边界；
- UI/API Plugin unload 时撤销 route/slot；
- 测试结束时一键 dispose composition，保证无 timer、listener、open handle 泄漏。

### 6.7 错误策略

MVP 建议比纯 Cordis 更严格：

- 缺 hard dependency：启动失败；
- 重复 singleton service：启动失败；
- 重复 registry member：默认失败，除非 registry 明确定义 priority；
- config 不合法：Plugin 不启动；
- Plugin setup 失败：回滚当前 Plugin effect，再倒序停止本次启动的其他 Plugin；
- disposer 失败：聚合报告，但继续清理其他 Plugin；
- provider 调用失败：返回稳定 domain error code，不把任意 exception 泄漏成业务协议；
- ingestion/indexing：持久化 stage checkpoint，重试必须幂等；
- 查询/chat：request-scoped cancellation 必须向 model/retriever 下传。

### 6.8 测试金字塔

从 DeepSeek Harness 直接迁移以下测试纪律：

1. 每个 registry 测 register、duplicate、dispose cleanup；
2. 每个 provider 跑 contract test suite；
3. 每个可见功能跑一次真实 composition test；
4. model/network 只 mock 最昂贵或不确定的边界，storage/retrieval/formatting 尽量用真实实现；
5. 保存一组确定性的 end-to-end notebook fixtures，校验 citation、chunk provenance 和 generated artifact；
6. 至少一条 built artifact/production entry smoke；
7. 对启动失败、取消、重试、重复执行和部分写入做 fault injection。

## 七、MVP 不该照搬的部分

| DeepSeek Harness 机制 | 暂不照搬的原因 | MVP 替代 |
|---|---|---|
| 完整 Cordis Fiber 动态状态机 | 为运行时 provider 消失/reload 服务，复杂且难诊断 | 启动时建图，运行中 composition 固定 |
| HMR | 不是 Notebook 用户价值，要求所有 effect 都已高度正确 | 开发期重启进程 |
| Profile + bundle + home + CLI 多层 patch | 配置来源和 precedence 复杂，whole-config replacement 易误配 | 单一 typed config + 环境 override |
| `!!js` config | 配置中执行代码，影响安全与复现 | 有限变量替换 + secret refs |
| npm/GitHub 第三方 Plugin 安装 | supply-chain、build script、版本 ABI、迁移和支持成本高 | checked-in first-party plugins |
| Cordis service `isolate` realm | 不是安全隔离；MVP 通常也不需一进程多 composition | 每进程/每测试一个 container |
| 动态 Agent 自编写 Plugin | 官方 `node:vm` 也非安全边界；权限接近 bash | 不提供；以后用独立 worker/container + RPC |
| Host/Client 双 half Plugin 与 client boot graph | 解决动态 Web UI ecosystem，显著增加构建与协议复杂度 | 固定 Web app，后端 capability plugin |
| 五种 event dispatch mode | 语义负担高 | `notify` + `around` 两类 |
| 每个微小角色独立 npm package | 234-package 级管理成本不适合 MVP | 单仓模块，达到独立演进阈值再拆包 |
| 多 LLM、多 sandbox、多 subagent、workflow、code mode | 与 Notebook 的 ingestion/retrieval/citation 主链无关 | 每类一个默认 provider，先做纵向闭环 |
| 所有 UI 状态 event sourced | 成本高，需求不明确 | 只对需恢复/审计的 domain event 持久化 |
| per-file 100% coverage 作为起点 | 会把早期探索成本推高，覆盖率也不代表集成正确 | kernel/contract 高覆盖 + 关键纵向 E2E |

## 八、建议的分阶段路线

### P0：内部 Plugin 化的 Notebook 纵向闭环

- 实现 200-400 行级别的 Plugin kernel；
- 固定 composition，所有 Plugin 随应用启动/停止；
- SQLite + local blob；
- file/text/PDF 导入；
- chunk + embedding + index；
- retrieval-grounded chat，citation 可回源；
- 一种 artifact（例如 summary）；
- registry/provider contract tests + 一条真实 composition E2E。

### P1：可替换 provider，但仍是可信代码

- 增加第二个 model/embedding/index provider，验证 seam 是否真实；
- 增加 background job 与 retry checkpoint；
- 加 Plugin diagnostics 页面：状态、config source、依赖、注册项；
- 加 controlled hook middleware；
- 开始记录 Plugin API compatibility version。

### P2：生态与隔离

- 明确第三方 Plugin ABI、manifest、semver 和 migration policy；
- package signing/checksum/allowlist；
- out-of-process Plugin worker 与 capability-scoped RPC；
- CPU/memory/time/network/filesystem 限制；
- install/update/rollback；
- UI extension protocol；
- 到此时再评估 profile/bundle、HMR 和 marketplace。

## 九、需要在实施前确认的事项

以下不是对上游源码的疑问，而是本项目尚需做出的产品决策：

1. “所有皆插件”是只要求内部模块化，还是 MVP 就要求用户安装第三方 Plugin？两者的安全、版本、发布和测试成本不是一个量级。
2. MVP 的第一优先输入源是什么：本地文件、URL、YouTube、RSS、云盘还是粘贴文本？它决定首批 importer/extractor seam。
3. 部署是单用户桌面、本地 Web、单租户服务还是多租户 SaaS？Plugin 生命周期、secret、worker 和隔离边界随之不同。
4. 数据主存储选 SQLite 还是 Postgres？向量索引是否允许独立外部服务？
5. citation 的产品要求：只需 source-level，还是必须 page/section/timestamp 级可定位？这必须先于 extractor contract 定义。
6. Plugin 是否允许修改 UI？若不允许，Host capability Plugin 可以显著先行，Client Plugin 系统延后。
7. 是否需要运行中 reload？若答案只是“开发方便”，进程重启足够；若要求无停机升级，则需要版本化 state migration 和 quiescence protocol。

## 十、总评

DeepSeek Harness 最值得参考的是它把“扩展点”提升成了**有依赖、有所有者、有撤销、有组合测试的运行时模块**，而不是简单 callback 列表。它真正解决了大型 Agent 产品中 provider 替换、策略插入、工具注册、持久化观察和多 surface 共存的问题。

对 Open Notebook 类 MVP，应该复制其**设计纪律**，不复制其**生态规模**：用一个很小的 Plugin kernel 强制 capability、依赖、config、lifecycle 和 cleanup；把 ingestion、extraction、embedding、index、retrieval、model、artifact 做成可信的内置 Plugin；保留一个稳定领域模型和单一 composition root。等第二个实现、第三方作者或真实隔离需求出现，再逐步引入动态加载、分发、UI Plugin 和运行时热替换。
