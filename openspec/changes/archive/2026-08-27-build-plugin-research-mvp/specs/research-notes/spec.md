## ADDED Requirements

### Requirement: Researcher manages Markdown Notes

系统 SHALL 允许 Researcher 在当前 Notebook 创建、列出、读取、编辑和删除 Markdown Note；标题 MUST 非空且正文 MUST 受大小限制。Note MUST 在应用重启后保留。

#### Scenario: Create and edit a Note

- **WHEN** Researcher 创建 Note 并修改标题或 Markdown 正文
- **THEN** 系统 SHALL 持久化变更、更新时间并在 Notebook Note 列表中显示最新版本

#### Scenario: Access Note from another Notebook

- **WHEN** 请求使用 Notebook A 和 Notebook B 的 Note id
- **THEN** 系统 SHALL 返回 not-found 且 MUST NOT 返回或修改 Note 内容

#### Scenario: Delete a Note

- **WHEN** Researcher 删除当前 Notebook 中存在的 Note
- **THEN** Note SHALL 被持久删除，重复删除 SHALL 返回 not-found

### Requirement: Completed Grounded Answer can become a Note

系统 SHALL 允许 Researcher 把当前 Notebook 中已完成的 assistant Message 保存为 Note。生成的 Markdown MUST 包含权威答案正文，以及每条 Citation 的标签、Source 标题、格式化 locator 和 excerpt，并保存来源 Message id。

#### Scenario: Save cited answer

- **WHEN** 已完成 Grounded Answer 包含两个持久 Citation
- **THEN** 新 Note SHALL 包含答案和两条可读引用记录，且 SHALL 关联原 Message

#### Scenario: Save insufficient-evidence answer

- **WHEN** 已完成 Message 是统一材料不足结果且没有 Citation
- **THEN** 系统 SHALL 允许保存其正文，且 SHALL 不生成虚假的引用章节

#### Scenario: Reject pending or failed answer

- **WHEN** Researcher 尝试保存 pending、failed 或 researcher Message
- **THEN** 系统 SHALL 返回 conflict 且 MUST NOT 创建 Note

### Requirement: Saved Note remains independently editable

从答案保存的 Note SHALL 是耐久研究产物；后续编辑 MUST 只更新 Note，而 MUST NOT 改写原 Conversation Message 或 Citation。

#### Scenario: Edit a saved answer Note

- **WHEN** Researcher 修改由答案生成的 Note 正文
- **THEN** 系统 SHALL 保留原 Message 与 Citation 不变，并持久化 Note 的独立内容
