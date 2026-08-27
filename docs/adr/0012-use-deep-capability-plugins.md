# Use deep capability Plugins

MVP 按深业务能力组织 Plugin，而不把每个处理步骤都变成浅 Plugin。`NotebookManagement`、`SourceIngestion`、`ResearchAnswering`、`NoteManagement`、HTTP Host 与 Worker Host 是 composition root 可见的主要 Capability；提取器选择、Passage 切分、检索策略、Citation 校验和 Provider Adapter 保持在拥有其规则的深 Module 内部。需要多个实现时由该 Module 暴露专用 registry 或策略 Interface，只有出现第二个真实用例后才新增 Seam，避免 Kernel 演变成全局 registry。
