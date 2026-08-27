# Plugin Application Runtime Specification

## Purpose

定义静态可信 Plugin 计划从完整预验证、Capability 依赖解析、确定性启动到失败回滚和逆序资源回收的生命周期，并约束 Plugin 访问范围与公开诊断内容。

## Requirements

### Requirement: Application starts from a closed Plugin plan

系统 SHALL 只从 composition root 提交的一份静态、可信、闭合 Plugin 清单启动，并且 SHALL 不提供运行时安装、替换或卸载 Plugin 的 Interface。

#### Scenario: Start a valid plan

- **WHEN** composition root 提交的 Plugin id、Capability Provider、依赖和配置全部有效
- **THEN** Kernel SHALL 启动完整清单并返回仅含 `snapshot` 与幂等 `stop` 的运行句柄

#### Scenario: Reject runtime mutation

- **WHEN** 应用已经开始启动或运行
- **THEN** Kernel SHALL 没有可注册、替换或卸载 Plugin 的公开操作

### Requirement: Kernel prevalidates the complete plan

Kernel MUST 在任何 Plugin `setup` 产生副作用前校验全部配置、Plugin id 唯一性、Capability id 唯一性、单 Provider、必需依赖和依赖环。

#### Scenario: Multiple preflight failures

- **WHEN** 清单同时包含无效配置、重复 Provider 和缺失依赖
- **THEN** Kernel SHALL 返回结构化 composition issues 且 SHALL 不执行任何 Plugin `setup`

#### Scenario: Dependency cycle

- **WHEN** Capability 依赖图包含直接或间接环
- **THEN** Kernel SHALL 拒绝启动并标识 dependency-cycle 问题

### Requirement: Startup order is deterministic

Kernel SHALL 使用稳定拓扑顺序串行启动 Plugin；没有依赖关系的 Plugin MUST 保持清单中的声明顺序。Capability 只有在 Provider `setup` 完整成功后才能对依赖者可见。

#### Scenario: Independent and dependent Plugins

- **WHEN** 两个独立 Plugin 出现在一个依赖链之前和之间
- **THEN** Kernel SHALL 按依赖约束与声明顺序产生可重复的 planned order

#### Scenario: Provider fails before publication

- **WHEN** Provider 在 `setup` 返回 Capability 前抛出错误
- **THEN** 任何依赖该 Capability 的 Plugin SHALL 不会启动

### Requirement: Resource lifecycle is fully unwound

Plugin SHALL 能用 `defer` 或 `own` 立即登记 cleanup。启动失败时 Kernel MUST 先 LIFO 清理失败 Plugin 已登记资源，再按成功启动顺序的严格逆序清理其他 Plugin；正常停止 MUST 使用相同逆序规则。

#### Scenario: Partial startup rollback

- **WHEN** Plugin 在登记两个 cleanup 后启动失败，且已有两个 Plugin 成功启动
- **THEN** Kernel SHALL 先逆序执行失败 Plugin 的两个 cleanup，再逆序停止先前两个 Plugin

#### Scenario: Cleanup also fails

- **WHEN** 一个或多个 cleanup 抛出错误
- **THEN** Kernel SHALL 继续尝试所有剩余 cleanup，并在完成后返回聚合错误

#### Scenario: Concurrent stop calls

- **WHEN** 多个 caller 同时或重复调用 `stop`
- **THEN** 所有 caller SHALL 共享同一停止过程，且每个 cleanup SHALL 至多执行一次

### Requirement: Plugin access and diagnostics are constrained

Plugin MUST 只能取得其 `requires` 中具名声明的 Capability，且 SHALL 无法访问全局 registry。Kernel snapshot MUST 可 JSON 序列化并且 MUST NOT 包含原始配置、密钥、Capability 值、业务正文或堆栈。

#### Scenario: Inspect a running application

- **WHEN** caller 读取运行中应用 snapshot
- **THEN** snapshot SHALL 只包含应用状态、Plugin/Capability 标识、planned order、生命周期状态、cleanup 数量和脱敏错误摘要
