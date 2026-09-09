# 底座迁移可行性评估

> 最新结论见 [0.3.0 验收](platform-reassessment-runtime-0.3.0.md)：#7、#8 已通过验证，源码职责分离完成。以下保留为 `6a567f4` 基线的历史评估，不代表新版能力。

评估日期：2026-09-09。

## 结论

**架构上可分离，但当前版本不能完成所要求的整体迁移。暂停应用重构，先等待底座适配。**

目标是让本仓库主要维护校园数据、业务配置及少量定制页面，由 `decentralized-information-community` 执行通用机制。仅把图函数作为依赖，或复制一份底座模板继续维护通用服务，都不满足这个目标。

底座目前是可复用图核心及参考应用，尚不是能承接本项目现有能力的平台。直接把数据库导出成 `nodes/edges` 会丢失机制保障；继续在本仓库维护这些机制则没有完成职责分离。本评估不以删除现有功能为迁移前提。

## 评估基线

- 指南本地 HEAD：`b110fa955931a7679413662b462e0da28fd96586`，以及工作区已有的 core 0.2.0 导航接入改动。
- [底座 main](https://github.com/BillShiyaoZhang/decentralized-information-community/commit/6a567f4819e430f4e52993d72ebf747e4ea27c20)：`6a567f4819e430f4e52993d72ebf747e4ea27c20`。
- 相邻底座本地 HEAD 为 `45936c3499552e7fea782e230fbd18e2f0c06c3d`；与远端 main 的 tree 相同，均为 `f1fae6ed1d389c7694ea7f834e146fadbaa4dc1e`。
- 本次只新增评估文档和 issue 正文存档，并在上游提交四项适配请求；没有修改应用代码、依赖、数据库或相邻底座仓库，未创建 Git 提交或部署。

## 已有接入与能力差距

当前 `apps/web/lib/public-knowledge.ts` 使用 `@information-community/core@0.2.0` 做公开答案的同主题导航。它只投影标题、稳定 ID 和主题关系；数据库、证据、审核和权限仍由指南维护。已有未提交接入改动原样保留。

| 领域 | 底座当前能力 | 整体迁移缺口 |
| --- | --- | --- |
| 外部消费 | 独立 ESM/TypeScript core 包；模板、仓库内 Node 服务 | 可版本化消费的完整 runtime、通用界面和业务/存储扩展契约 |
| 数据与证据 | 可扩展 JSON 节点/关系、整图 revision、原子提案 | 不可变实体修订、固定版本证据引用、逐句引用及权利校验 |
| 发布与访问 | 全图公开读取；共享 Bearer token 可直接写入 | 已验证身份、细分权限、审核发布事务、统一公开投影和撤回传播 |
| 私有工作流 | 没有公开图之外的私有记录服务 | 报告/线索状态机、访问隔离、加密、同意/撤回、保留清理与维护证据 |
| 迁移 | 本图格式初次导入、当前快照导出 | 接管既有状态的事务、扩展 schema、版本化导入/导出和回滚契约 |

底座允许 JSON 扩展字段，但不执行这些字段的业务语义。只读内存探针确认，添加 `publicationStatus: draft`、`visibility: private`、空 citations 等字段的节点仍可通过 `applyChange`。这符合图核心目前的定位，但不能替代治理机制。

证据可见底座的 [core 协议](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/6a567f4819e430f4e52993d72ebf747e4ea27c20/packages/core/index.d.ts)、[HTTP 入口](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/6a567f4819e430f4e52993d72ebf747e4ea27c20/server/http.mjs)、[快照存储](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/6a567f4819e430f4e52993d72ebf747e4ea27c20/server/store.mjs)及[接入说明](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/6a567f4819e430f4e52993d72ebf747e4ea27c20/docs/extending.md)。

## 目标职责边界

| 所有者 | 负责内容 |
| --- | --- |
| 指南业务仓库 | 校园话题/别名、范围值、发布主体、已审核公开答案与来源、品牌与文案、阶段 1 政策、研究说明、业务参数、少量 UI 扩展 |
| 底座项目 | 通用数据/修订/证据引擎、权限执行、发布与公开读取、工作流、持久化迁移、生命周期任务、通用后台与接口 |
| 私有运行环境 | 账号、会话、密钥、私有报告/材料、参与者数据及受限审计；不进入公开 Git 数据文件 |

本地校园种子目前内嵌于 `apps/web/db/bootstrap.ts:464`，搜索别名内嵌于 `apps/web/lib/domain.ts:46`，后续适合转为业务数据与配置。通用发布服务、身份系统和数据库触发器不能仅因移动到 `business/` 目录就被认定为业务配置。

校园特定角色名称、范围维度、禁用能力、TTL、试点窗口和统计口径可由业务配置或小型策略模块表达。底座可以用可选模块承载编辑和私有工作流，无需让所有社区启用校园研究功能。一次性的旧 D1 数据映射归指南，通用事务与迁移扩展能力归底座。

## 迁移验收契约

以下结合现有实现与产品要求定义验收目标；部分端到端路径仍有基线缺口，见末尾验证说明，不能把它们都视为已获完整证明的现有行为。

1. 稳定 ID、slug、实体版本、父修订、逐句证据、来源修订和当前公开指针；发布/隐藏、幂等记录、并发版本检查及审计在事务中一致。
2. `link_only` 不存正文、截图或内容哈希；来源撤回、不可见或权利到期时，相关答案不能经列表、详情、历史页或其他公开入口继续出现。复核逾期则保留现有警示语义，不与权利失效混为一谈。
3. 高影响发布及 `ai_draft` 直接发布继续拒绝，即使由人工点击也不能直接发布 AI 草稿，须先人工创建正式修订；范围维度内 OR、维度间 AND，`universal` 总是适用，主动筛选时 `unknown` 不匹配。
4. 具名身份、MFA、撤销会话、细分权限，以及报告/线索的指派、状态迁移、处理结果和审计闭环。
5. 同意撤回阻断在途研究事件，清除私有载荷和可关联幂等记录；测试、匿名、编辑与已撤回流量不进入正式指标。
6. 私有线索密文 AAD 绑定 `research-intake:v1:<record ID>`，迁移应保留 ID 或执行受控重加密；不能把密文复制后任意重命名记录。会话和邀请的 HMAC/令牌迁移也须有明确策略。
7. 保留清理、健康检查、备份与恢复验收，以及现有 PWA 不缓存答案/API/私有写入的行为。

对应实现集中于 `apps/web/db/schema.ts`、`apps/web/drizzle/0000_*.sql` 至 `0014_*.sql`、`lib/mutations.ts`、`lib/repository.ts`、`lib/editor-session.ts`、`lib/private-intake-crypto.ts`、`lib/pilot.ts` 和 `db/bootstrap.ts`。现有测试可作为未来平台契约验收的输入。

## 上游适配清单

| Issue 正文存档 | 内容 | 上游 Issue |
| --- | --- | --- |
| [运行时与扩展契约](platform-issues/01-runtime-contract.md) | 外部消费、UI 扩展、存储、导入/迁移/回滚契约 | [#3](https://github.com/BillShiyaoZhang/decentralized-information-community/issues/3) |
| [不可变修订与证据](platform-issues/02-revisions-evidence.md) | 实体修订、固定证据引用、领域校验 | [#4](https://github.com/BillShiyaoZhang/decentralized-information-community/issues/4) |
| [身份与发布控制](platform-issues/03-publication-access.md) | principal、权限、审核事务、统一公开投影 | [#5](https://github.com/BillShiyaoZhang/decentralized-information-community/issues/5) |
| [私有工作流与生命周期](platform-issues/04-private-lifecycle.md) | 私有状态、加密、同意/撤回、清理与维护 | [#6](https://github.com/BillShiyaoZhang/decentralized-information-community/issues/6) |

四项适配请求均于 2026-09-09 通过 GitHub 网页创建，并核对为 Open 状态。每项包含现状、源码依据、请求范围和验收条件。后续等待底座交付适配版本，再依本报告重新验收；本仓库在此期间不继续整体迁移。

## 验证与恢复条件

本次指南数据库不变量、领域、范围匹配及已有公开导航测试共 46 项通过，底座 core 测试 15 项通过。内存探针不写数据库。没有执行全站构建或浏览器产品验收，因为本次未改应用，也未进行迁移；这些结果只证明当前能力边界，不证明新架构已实现。

源码复核发现两项现有基线缺口，本次按停止重构要求只记录，未修改应用：

- `apps/web/lib/pilot.ts:741` 的同意撤回 SQL 把私有线索改为 expired，却未清空 `payload_ciphertext` 和 `payload_key_version`。对尚未清理的加密线索，`0014_private_intake_encryption.sql:17` 的触发器会拒绝更新，导致撤回事务回滚。现有测试证明触发器拒绝这种清理，但没有覆盖实际撤回服务的组合路径。
- `apps/web/lib/repository.ts:325` 的 history 查询只校验曾发布记录，不按其来源的当前有效性过滤，随后仍输出历史 title/summary。当当前版本来源有效而旧版本来源撤回时，旧详情虽可拒绝读取，当前答案 API 的 history 仍可能包含旧摘要。来源撤回只关联当前公开修订的级联操作也不能覆盖这个分支。

未来验收需补齐“有加密线索的实际撤回”和“当前版本有效、旧版本来源失效的历史摘要”两条路径。它们属于指南基线与迁移验收问题，不冒充底座现有图 API 的缺陷。

恢复重构前，须检查上述能力已进入可固定版本的实际产物，并运行独立消费方与迁移契约测试。Issue 关闭、附加几个 JSON 字段或新增导航演示本身不构成验收。

后续顺序：建立业务配置与数据入口；在隔离环境映射旧数据并验证历史、权限和生命周期；切换公开页面/API 与后台到平台；通过失败回滚演练后再移除本仓库重复的通用实现。在底座适配完成前，不执行这部分工作。
