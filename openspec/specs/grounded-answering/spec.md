# Grounded Answering Specification

## Purpose

定义 Notebook 范围内从候选 Passage 检索、证据选择、模型流式回答到 Citation 验证和材料不足终态的完整契约，确保任何回答均可追溯且不会越过 Notebook 边界。

## Requirements

### Requirement: Conversations are scoped to one Notebook

系统 SHALL 允许 Researcher 在一个 Notebook 内创建和查看 Conversation，并按顺序持久化 researcher 与 assistant Message。任何 Answer 请求 MUST 同时验证 Conversation 属于请求中的 Notebook。

#### Scenario: Continue a Conversation

- **WHEN** Researcher 在现有 Conversation 中提交问题
- **THEN** 系统 SHALL 持久化 researcher Message，并把有限的已完成历史提供给本轮回答

#### Scenario: Conversation belongs to another Notebook

- **WHEN** 请求使用 Notebook A 和 Notebook B 的 Conversation id
- **THEN** 系统 SHALL 返回 not-found 且 MUST NOT 创建 Message 或调用模型

### Requirement: Retrieval has a mandatory Notebook boundary

检索 Interface MUST 要求 `notebookId`，并且查询 SHALL 只比较该 Notebook、`ready` Source 与当前 Embedding model fingerprint 的 Passage。系统 MUST NOT 提供省略 Notebook 的全库检索重载。

#### Scenario: Similar Passage exists in another Notebook

- **WHEN** Notebook B 有比 Notebook A 更相似的 Passage，但问题在 Notebook A 中提出
- **THEN** 候选集 MUST 只包含 Notebook A 的 Passage

#### Scenario: Old embedding model remains stored

- **WHEN** Passage 的 Embedding fingerprint 与当前 Provider 不同
- **THEN** 该 Passage SHALL 不参与本轮向量距离比较

### Requirement: Answers stream with a durable lifecycle

系统 SHALL 通过 SSE 发送 `answer.started`、零个或多个 `answer.delta`、零个或多个 `citation`，以及唯一终止事件 `answer.completed` 或 `answer.failed`。Assistant Message MUST 在模型调用前以 `pending` 持久化，并在终止时成为 `completed` 或 `failed`。

#### Scenario: Successful streaming answer

- **WHEN** 模型流式返回内容且引用通过验证
- **THEN** 客户端 SHALL 收到 delta、Citation 和 completed Message，数据库 SHALL 保存相同最终内容与 Citation

#### Scenario: Provider fails after streaming begins

- **WHEN** Provider 在若干 delta 后抛出错误或连接中止
- **THEN** 系统 SHALL 标记 Assistant Message 为 failed，并发送或持久化失败终态而不是伪 completed

### Requirement: Citations are generated from retrieved Passages

系统 SHALL 为本轮候选 Passage 分配临时标签，模型只能返回这些标签。服务端 MUST 验证每个标签属于本轮候选集和当前 Notebook，并 MUST 从持久 Passage 生成 Source、locator 与 excerpt；模型提供的任意 Source id、locator 或 excerpt SHALL 不被信任。

#### Scenario: Valid labels from multiple Sources

- **WHEN** 模型引用两个本轮候选标签且它们来自不同 Source
- **THEN** 系统 SHALL 原子持久化两个可点击 Citation，其 excerpt 均能在对应 Passage 中验证

#### Scenario: Model cites an unretrieved label

- **WHEN** 模型文本或完成元数据包含未分配标签
- **THEN** 系统 SHALL 拒绝该回答的验证终态且 MUST NOT 持久化伪 Citation

#### Scenario: Adapter attempts cross-Notebook Citation

- **WHEN** 写入 Citation 的 Message 与 Passage 不属于同一 Notebook
- **THEN** 数据库组合外键 SHALL 拒绝写入

### Requirement: Insufficient evidence is explicit

当没有候选 Passage、没有有效 Citation 或引用验证失败时，系统 MUST 使用统一的材料不足结果，MUST NOT 用模型常识补全无引用事实，并 SHALL 持久化零 Citation。

#### Scenario: Empty Notebook

- **WHEN** Researcher 在没有 ready Passage 的 Notebook 中提问
- **THEN** 系统 SHALL 不调用 Chat Provider，返回“当前 Notebook 中的材料不足以可靠回答这个问题”并保存零 Citation

#### Scenario: Fluent answer without citations

- **WHEN** Chat Provider 返回看似完整但没有任何有效候选标签的回答
- **THEN** authoritative completed Message SHALL 被归一为材料不足结果，而不是把流式临时文本标为已验证

### Requirement: Evidence selection is bounded and diverse

系统 SHALL 对候选 Passage 设置总数量上限和每个 Source 的数量上限，并 SHALL 向模型提供 Source 标题、locator、标签和原文，而不是整个 Notebook 的无界内容。

#### Scenario: One Source dominates nearest neighbors

- **WHEN** 最近候选大部分来自同一个 Source，且其他 Source 也有候选
- **THEN** evidence selector SHALL 应用每 Source 上限，为跨 Source 证据保留空间
