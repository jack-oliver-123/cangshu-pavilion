# 议题跟踪器：GitHub

本仓库的议题和规格均存放在 GitHub Issues 中。所有操作使用 `gh` CLI。

## 操作约定

- **创建议题**：`gh issue create --title "..." --body "..."`。多行正文使用 heredoc。
- **读取议题**：`gh issue view <number> --comments`，使用 `jq` 筛选评论，并同时获取标签。
- **列出议题**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需使用 `--label` 和 `--state` 筛选。
- **评论议题**：`gh issue comment <number> --body "..."`
- **添加或移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭议题**：`gh issue close <number> --comment "..."`

仓库信息从 `git remote -v` 推断；在克隆仓库内运行时，`gh` 会自动完成推断。

## 是否将拉取请求纳入分流

**将 PR 作为请求入口：否。**

如本仓库把外部 PR 当作功能请求，可将此项改为“是”；`/triage` 会读取该配置。

启用后，PR 使用与议题相同的标签和状态，并采用对应的 `gh pr` 命令：

- **读取 PR**：使用 `gh pr view <number> --comments`，并通过 `gh pr diff <number>` 获取差异。
- **列出待分流的外部 PR**：运行 `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，仅保留 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE`，排除 `OWNER`、`MEMBER` 和 `COLLABORATOR`。
- **评论、标记或关闭**：使用 `gh pr comment`、`gh pr edit --add-label`、`--remove-label` 和 `gh pr close`。

GitHub 的议题与 PR 共用编号空间，因此 `#42` 可能指任意一种对象。先运行 `gh pr view 42`；若失败，再运行 `gh issue view 42`。

## 当技能要求“发布到议题跟踪器”时

创建一个 GitHub Issue。

## 当技能要求“获取相关工单”时

运行 `gh issue view <number> --comments`。

## Wayfinding 操作

供 `/wayfinder` 使用。**地图**是一个议题，**子项**是关联的子议题。

- **地图**：一个带有 `wayfinder:map` 标签的议题，其正文包含“笔记”“现有决策”和“迷雾”。使用 `gh issue create --label wayfinder:map` 创建。
- **子工单**：通过 GitHub 子议题 API 关联到地图。若未启用子议题，则把子项加入地图正文的任务列表，并在子议题正文顶部写入 `Part of #<map>`。标签为 `wayfinder:<type>`，其中类型为 `research`、`prototype`、`grilling` 或 `task`。认领后，将工单分配给负责推进的开发者。
- **阻塞关系**：优先使用 GitHub 原生议题依赖。通过 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 添加依赖；`<blocker-db-id>` 必须是阻塞议题的数字数据库 ID，可通过 `gh api repos/<owner>/<repo>/issues/<n> --jq .id` 获取，不能使用议题编号或 `node_id`。若依赖功能不可用，则在子议题正文顶部写入 `Blocked by: #<n>, #<n>`。
- **前沿查询**：列出地图下所有开放的子议题，排除仍有开放阻塞项或已有负责人者，按地图中的顺序选择第一项。
- **认领**：运行 `gh issue edit <n> --add-assignee @me`。这是会话中的首次写操作。
- **解决**：运行 `gh issue comment <n> --body "<answer>"`，再运行 `gh issue close <n>`，最后将上下文指针和链接追加到地图的“现有决策”部分。
