# Provider Configuration Specification

## Purpose

定义 Chat 与 Embedding Provider 的独立配置、密钥保护、环境优先级和连接测试。

## Requirements

### Requirement: Chat and Embedding Providers are configured independently

系统 SHALL 为 `chat` 与 `embedding` 分别管理 OpenAI-compatible `baseUrl`、`model` 和可选 `apiKey`。保存一个种类 MUST NOT 覆盖另一个种类。

#### Scenario: Save both Provider kinds

- **WHEN** Researcher 为 Chat 与 Embedding 提交不同 endpoint、model 和 key
- **THEN** 系统 SHALL 独立持久化并在后续回答中分别解析对应配置

#### Scenario: Update metadata without replacing key

- **WHEN** Researcher 修改 endpoint 或 model 但省略 apiKey
- **THEN** 系统 SHALL 保留已有加密 key

### Requirement: Provider keys are encrypted at rest

数据库中的 Provider key MUST 使用 AES-256-GCM 和随机 nonce 加密。主密钥 MUST 来自环境变量或服务器数据卷中权限受限的 key file，并且 MUST NOT 存入 PostgreSQL、仓库或浏览器持久存储。

#### Scenario: Inspect database row

- **WHEN** Provider key 已保存并直接读取 `provider_configurations` 记录
- **THEN** 记录 SHALL 只包含带版本、nonce、ciphertext 和 authentication tag 的密文，不包含明文 key

#### Scenario: First local startup without explicit master key

- **WHEN** 数据卷没有 key file 且未配置主密钥环境变量
- **THEN** Server SHALL 生成 32-byte 随机主密钥文件并限制其文件权限，后续启动 SHALL 复用同一文件

### Requirement: Environment configuration has explicit precedence

完整的 Chat 或 Embedding 环境变量组 SHALL 覆盖同种类数据库设置。公共设置投影 MUST 显示 `environment`、`database` 或 `missing` 来源和 `hasApiKey`，但 MUST NOT 返回 key。

#### Scenario: Environment overrides database

- **WHEN** 数据库和环境变量都提供完整 Chat 配置
- **THEN** 运行时 SHALL 使用环境配置，UI SHALL 标记来源为 environment 且不显示明文 key

#### Scenario: Provider is missing

- **WHEN** 某种类既没有完整环境配置也没有数据库配置
- **THEN** 依赖该 Provider 的操作 SHALL 返回 `PROVIDER_NOT_CONFIGURED`，设置页 SHALL 显示 missing

### Requirement: Provider configuration can be tested before use

系统 SHALL 允许 Researcher 测试 Chat 或 Embedding 输入；测试 MUST 执行该种类的最小真实模型调用，而不是依赖可选的 models listing Interface，并 MUST 有有限超时和重试上限。

#### Scenario: Test compatible Chat endpoint

- **WHEN** Chat endpoint、model 和凭据有效
- **THEN** 系统 SHALL 执行最小 completion 并返回成功，不保存完整 Provider 响应

#### Scenario: Test invalid credentials

- **WHEN** Provider 拒绝凭据
- **THEN** 系统 SHALL 返回脱敏 Provider 错误，响应和日志 MUST NOT 包含提交的 key

### Requirement: Sensitive model data is not exposed

HTTP 响应、日志、Kernel snapshot 和公共配置 MUST NOT 包含明文 key、完整 prompt、完整 Source 内容或完整 Provider 响应。

#### Scenario: Provider call fails with a verbose error

- **WHEN** SDK error对象包含请求头、key 或完整响应正文
- **THEN** 对外错误和结构化日志 SHALL 只保留稳定错误码、Provider kind 和脱敏摘要
