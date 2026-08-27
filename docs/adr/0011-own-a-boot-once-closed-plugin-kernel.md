# Own a boot-once closed Plugin Kernel

MVP 使用仓库自有的最小 Plugin Kernel：composition root 一次性提交完整的可信 Plugin 清单，Kernel 在任何副作用发生前完成配置、唯一 Provider、缺失依赖与依赖环校验，再按稳定拓扑顺序串行启动。Plugin 只能取得显式声明的 Capability，并用 `defer` 登记资源释放；启动失败时先回滚当前 Plugin，再逆序回滚已启动 Plugin，正常停止也按逆序执行且聚合清理错误。公开运行期 Interface 仅包含 `startApplication`、脱敏 `snapshot` 与幂等 `stop`，不提供通用 service locator、hooks、multi-binding、动态注册、热重载或第三方代码执行。
