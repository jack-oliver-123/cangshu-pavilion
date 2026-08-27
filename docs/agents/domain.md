# 领域文档

本文件规定工程技能在探索代码库时应如何使用本仓库的领域文档。

## 探索前读取

- 根目录下的 `CONTEXT.md`；或者
- 若根目录存在 `CONTEXT-MAP.md`，读取它指向的、与当前主题相关的各个 `CONTEXT.md`；
- 检查 `docs/adr/` 中与即将处理区域有关的 ADR。多上下文仓库还需检查 `src/<context>/docs/adr/` 中的上下文级决策。

如果这些文件不存在，直接继续，不要报告缺失，也不要预先建议创建。`/domain-modeling` 技能会在术语或决策真正明确时按需创建它们。

## 文件结构

单上下文仓库：

```text
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库以根目录中的 `CONTEXT-MAP.md` 为标志：

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 上下文级决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用术语表中的词汇

输出中出现领域概念时，应使用 `CONTEXT.md` 定义的术语，不要改用术语表明确排除的同义词。

如果所需概念尚未出现在术语表中，可能是输出引入了项目并未采用的语言，也可能是领域文档确有缺口；前者应重新考虑，后者应交由 `/domain-modeling` 处理。

## 标明与 ADR 的冲突

如果输出与现有 ADR 冲突，应明确指出，不要静默覆盖：

> 与 ADR-0007（事件溯源订单）冲突，但由于……值得重新讨论。
