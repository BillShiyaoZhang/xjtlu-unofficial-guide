# [Platform] 提供已验证身份、审核发布事务与统一公开读取策略

## 背景与阻塞

`xjtlu-unofficial-guide` 正评估将平台机制迁入本项目。基线为 main `6a567f4819e430f4e52993d72ebf747e4ea27c20` / core 0.2.0。

[server/http.mjs](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/6a567f4819e430f4e52993d72ebf747e4ea27c20/server/http.mjs#L28) 的 graph/search/neighborhood/analysis 和兼容 data URL 直接读取 store 中的完整图，写入口校验共享 Bearer token 后直接 commit。[架构说明](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/6a567f4819e430f4e52993d72ebf747e4ea27c20/docs/architecture.md) 明确 author 是署名，不是已验证身份；[接入说明](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/6a567f4819e430f4e52993d72ebf747e4ea27c20/docs/extending.md) 把授权、证据与发布检查留给业务服务器。

这符合当前公开图参考应用定位，但无法承接指南既有的具名 MFA、六类最小角色、受控发布、来源撤回和隐藏历史页。仅附加 draft/private 字段不会改变当前接口的行为。此 issue 是平台能力请求，不是要求轻量图应用默认具备所有业务限制。

## 请求

1. runtime 接受已验证 principal/session，并提供统一授权执行点、策略接口及可信审计主体。至少交付一条具名身份、MFA、撤销会话的可运行集成；身份提供方可以外置，但使用方不应仍需自行维护整套通用账号系统。
2. 角色名称、权限分配和发布规则由业务配置；发布事务同时校验权限、expected revision、证据/领域规则，切换公开指针并追加审计与幂等结果，任一步失败完整回滚。
3. 公共列表、详情、历史版本、搜索、邻域、统计和导出/静态产物共用可公开性策略。私有、未发布、隐藏或失去有效来源的内容不能从备用入口泄露。
4. 来源处置应传播到当前公开投影，并定义缓存/静态产物失效行为。可先只支持能维持该保证的服务端模式，不能宣称已撤回却仍保留可访问副本。
5. 给出筛选/搜索策略扩展：使用方配置校园别名、适用范围和警示文案，平台运行受控检索与过滤。

## 验收

- [ ] 未授权请求、被撤销会话及伪造 author 无法获得发布权限；审计主体来自服务端验证的身份。
- [ ] 并发冲突、缺失证据和策略拒绝均不改变公开指针，不留下半完成审核/审计操作；幂等重试行为明确。
- [ ] 隐藏答案或撤回来源后，列表、详情、历史页、搜索、邻域、统计和导出均遵守相同公开策略。
- [ ] 指南 profile 继续拒绝高影响发布及 ai_draft 直接发布（人工点击也不能绕过，须先人工创建正式修订）；来源权利失效会阻断公开，复核逾期保留现有警示语义。
- [ ] 范围规则可配置并测试：维度内 OR、维度间 AND，universal 总是适用，主动筛选时 unknown 不匹配。
- [ ] 提供端到端 provider + runtime 示例，使用方仅维护业务规则和少量 UI 扩展。

不可变证据结构和私有生命周期分别由配套 issue 跟踪。普通图核心可以保持原有轻量 API；受治理的 runtime 不得保留绕开策略的原始读写入口。
