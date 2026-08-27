## ADDED Requirements

### Requirement: Researcher manages independent Notebooks

系统 SHALL 允许 Researcher 创建、列出、重命名和删除 Notebook。每个 Source、Passage、Conversation、Message、Citation 与 Note MUST 直接或间接属于且只能属于一个 Notebook。

#### Scenario: Create and rename a Notebook

- **WHEN** Researcher 提交非空且不超过限制的名称并随后重命名
- **THEN** 系统 SHALL 持久化 Notebook 和新名称，并在重启后保留

#### Scenario: Cross-Notebook child relation

- **WHEN** Adapter 尝试把 Message、Passage 或 Citation 关联到不同 Notebook 的父记录
- **THEN** 数据库约束 SHALL 拒绝该写入

### Requirement: Supported Sources can be imported

系统 SHALL 支持具有文本层的 PDF、普通 HTTP/HTTPS 网页、粘贴文本、TXT 与 Markdown；上传文件 MUST 不超过 50 MiB，粘贴文本 MUST 不超过 5 MiB。扫描 PDF、OCR、登录页面和依赖复杂 JavaScript 的页面不在支持范围。

#### Scenario: Import a text PDF

- **WHEN** Researcher 向 Notebook 上传不超过 50 MiB 且具有文本层的 PDF
- **THEN** 系统 SHALL 保存原始字节、创建 queued Source 并提交持久处理任务

#### Scenario: Import pasted Markdown

- **WHEN** Researcher 提交标题和不超过 5 MiB 的 Markdown 文本
- **THEN** 系统 SHALL 以 Markdown Source 保存并进入相同处理流程

#### Scenario: Reject unsupported or oversized input

- **WHEN** 上传超过限制、类型不受支持或 PDF 没有可读文本
- **THEN** 系统 SHALL 返回稳定错误码且 MUST NOT 把 Source 标为 ready

### Requirement: Web import prevents server-side request forgery

网页 importer MUST 只允许 HTTP/HTTPS，拒绝 URL 凭据、loopback、link-local、私网、保留网段和云 metadata 地址，并对每次重定向重复校验。系统 MUST 限制重定向次数、响应体大小和请求时间，并将已验证 DNS 地址用于实际连接。

#### Scenario: Public webpage import

- **WHEN** URL 及其所有重定向解析为允许的公网地址且响应在限制内
- **THEN** 系统 SHALL 提取主要正文并创建带原始 URL locator 的 Passage

#### Scenario: Redirect to a private address

- **WHEN** 公网 URL 重定向到 loopback、私网或 metadata 地址
- **THEN** importer SHALL 在请求该目标前终止并把 Source 标为可见失败

#### Scenario: DNS rebinding attempt

- **WHEN** 主机名在校验后可能返回不同地址
- **THEN** 本次 HTTP 连接 MUST 使用已通过公网检查的地址，而不是重新进行未校验解析

### Requirement: Source processing is durable and observable

系统 SHALL 使用 PostgreSQL-backed 至少一次队列和独立 Worker 处理 Source，并 SHALL 持久化 `queued`、`extracting`、`indexing`、`ready`、`failed` 状态及每次 Attempt。重复投递 MUST 产生相同最终 Passage 集，而不能累加重复记录。

#### Scenario: Worker restart during processing

- **WHEN** Worker 在 Source 完成前停止并重新启动
- **THEN** 未完成任务 SHALL 保留并可重试，Source SHALL 不会被伪标记为 ready

#### Scenario: Duplicate delivery after success

- **WHEN** 已完成任务被再次投递
- **THEN** 处理器 SHALL 安全返回或事务性替换相同 Passage，并保持唯一 ordinal

#### Scenario: Processing failure and retry

- **WHEN** extractor 或 Embedding Provider 失败
- **THEN** Source SHALL 显示 stage、稳定 code、脱敏 message 与 retryable 标记，Researcher SHALL 能提交新 Attempt

### Requirement: Passages preserve exact Source locations

系统 SHALL 把提取文本保存为有序 Passage，并为 PDF 保存页码、为网页保存段落与 URL、为 Text/Markdown 保存行范围；每个 locator MUST 同时包含该 block 内的字符范围和可展示原文。

#### Scenario: Split a long PDF page

- **WHEN** 单页文本超过 Passage 字符上限
- **THEN** splitter SHALL 在同一页内生成多个有序、可重叠 Passage，且每个 Passage 保留相同页码和各自字符范围

#### Scenario: Ready status is atomic with Passage persistence

- **WHEN** Worker 完成全部 Embedding
- **THEN** Passage 替换、数量更新和 Source `ready` 状态 MUST 在同一数据库事务中提交

### Requirement: Original bytes are content addressed and reference safe

上传原件 SHALL 以 SHA-256 key 原子保存。相同 Notebook 中相同内容的重复导入 SHALL 返回已有 Source；一个 blob 仍被任一 Source 引用时 MUST NOT 被删除。

#### Scenario: Duplicate upload in one Notebook

- **WHEN** Researcher 再次上传内容哈希相同的文件
- **THEN** 系统 SHALL 返回已有 Source 且 SHALL 不创建第二组处理任务

#### Scenario: Delete one of multiple references

- **WHEN** 一个 storage key 仍被另一个 Source 引用而 Researcher 删除当前 Source 或 Notebook
- **THEN** 数据库记录 SHALL 被删除，但原始 blob MUST 保留

#### Scenario: Delete final reference

- **WHEN** 删除操作移除某 storage key 的最后一个数据库引用
- **THEN** 系统 SHALL 清理对应 blob，且重复清理 SHALL 安全成功
