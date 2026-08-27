# Local Web Experience Specification

## Purpose

定义藏书阁从 PostgreSQL、Server、Worker 到生产 SPA 的完整本地部署方式，以及远程访问保护、稳定 HTTP 契约和响应式简体中文研究工作台的用户体验边界。

## Requirements

### Requirement: Docker Compose starts a complete local deployment

仓库 SHALL 提供从空数据卷执行的 Docker Compose 路径，依次准备 PostgreSQL/pgvector、应用迁移与 Graphile schema，并启动 Server、Worker 和生产 SPA。Server readiness MUST 等待数据库与必要运行依赖可用。

#### Scenario: Cold start

- **WHEN** Researcher 在没有现有数据卷的机器运行 `docker compose up --build`
- **THEN** 迁移 SHALL 成功完成，Server 与 Worker SHALL 启动，浏览器 SHALL 能打开可用的藏书阁界面

#### Scenario: Restart existing deployment

- **WHEN** 所有容器在已有数据卷上重启
- **THEN** Notebook、Source 状态、Conversation、Citation、Note、Provider 密文与未完成任务 SHALL 保留

### Requirement: Localhost is the secure default

Server SHALL 默认只绑定 `127.0.0.1` 且 localhost 模式无需登录。任何非回环绑定 MUST 配置共享密码，否则进程 MUST 在监听端口前拒绝启动。

#### Scenario: Default local start

- **WHEN** 未设置绑定地址和共享密码
- **THEN** Server SHALL 只监听 localhost，并允许本机 Researcher 使用应用

#### Scenario: Unsafe remote bind

- **WHEN** 绑定地址为非回环且没有共享密码
- **THEN** Server SHALL 返回 `REMOTE_ACCESS_REQUIRES_PASSWORD` 启动错误且 MUST NOT 监听端口

### Requirement: Remote mode uses a protected shared session

远程模式 SHALL 使用限速登录、恒定时间密码比较、签名 HttpOnly SameSite Cookie 和有限会话寿命保护所有非健康检查 Interface。登出 MUST 使浏览器会话失效。

#### Scenario: Authenticated remote request

- **WHEN** Researcher 使用正确共享密码登录并请求受保护 Interface
- **THEN** Server SHALL 设置安全会话 Cookie 并允许请求，响应 MUST NOT 返回共享密码

#### Scenario: Repeated invalid login

- **WHEN** 一个来源在限速窗口内重复提交错误密码
- **THEN** Server SHALL 返回限速错误并避免继续执行高成本密码验证

### Requirement: HTTP Interface has stable contracts

Server SHALL 为 Notebook、Source、Conversation/Answer、Note、Provider Settings 和 health 提供版本内稳定的 JSON/multipart/SSE Interface。JSON 成功与错误 MUST 使用一致 envelope；校验错误 MUST 包含稳定 code 与字段 path。

#### Scenario: Invalid JSON request

- **WHEN** caller 提交缺失必需字段或超过限制的值
- **THEN** Server SHALL 返回 4xx envelope，其中包含稳定 `VALIDATION_ERROR` 和字段 path，且 MUST NOT 返回堆栈

#### Scenario: Upload Source

- **WHEN** caller 通过 multipart 提交受支持文件和标题
- **THEN** Server SHALL 返回 queued Source envelope，文件字节 MUST NOT 被复制到 JSON 日志

#### Scenario: Health probes

- **WHEN** orchestrator 调用 liveness 或 readiness
- **THEN** liveness SHALL 反映进程存活，readiness SHALL 反映数据库和应用启动完成，两个 Interface SHALL 不要求登录

### Requirement: The SPA supports the primary research workflow

SPA SHALL 以简体中文为默认 message catalog，并提供稳定 Notebook 导航、Source/对话/Note tabs、处理状态、失败重试、流式回答、Citation 查看器、Note 编辑器与 Chat/Embedding 设置。第一屏 MUST 是可使用的工作台而不是营销页面。

#### Scenario: Complete the MVP loop

- **WHEN** Researcher 创建 Notebook、导入两份 Source、等待 ready、提问并保存答案
- **THEN** UI SHALL 在同一工作台内完成全部步骤，并在 Note tab 显示可编辑的新 Note

#### Scenario: Open a Citation

- **WHEN** Researcher 选择答案中的 Citation
- **THEN** Source 查看器 SHALL 显示 Source 标题、格式化 locator 和匹配 excerpt，并把目标原文高亮

#### Scenario: Source processing fails

- **WHEN** Source 进入 failed 状态
- **THEN** Source 列表 SHALL 显示失败阶段、可读摘要和仅在允许时可用的 retry 操作

### Requirement: The SPA is responsive and accessible

桌面与移动视口 MUST 不出现主要控制重叠、不可读截断或动态内容导致的布局跳动。图标命令 SHALL 使用熟悉的 Lucide 图标、可访问名称和 tooltip；键盘焦点、表单标签、对比度和 reduced-motion 偏好 MUST 可用。

#### Scenario: Mobile research view

- **WHEN** 视口宽度为常见手机尺寸且打开长标题、长 Citation 或流式回答
- **THEN** 文本 SHALL 换行或截断到明确的可展开区域，主要导航和提交操作 SHALL 保持可访问且不互相遮挡

#### Scenario: Keyboard-only interaction

- **WHEN** Researcher 只使用键盘操作 Notebook、tabs、Source import、问题提交和 Citation
- **THEN** 所有交互 SHALL 有可见焦点、语义名称和合理顺序
