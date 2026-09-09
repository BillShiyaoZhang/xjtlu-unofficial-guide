# Runtime 0.1.0 底座迁移复核

> 后续状态见 [Runtime 0.1.1 修复验收](platform-reassessment-runtime-0.1.1.md)：本文两项阻塞已修复，以下仅保留历史基线与复现记录。

复核日期：2026-09-09。

## 结论

**架构方向可行，新版已实现大部分所需平台机制；但仍有两项已复现的契约缺口，尚不满足无损迁移验收，暂缓整体迁移。**

这不是旧版“仅有图核心、缺少完整运行时”的结论。新增 runtime 已实质性解决原来四项适配请求中的主要问题。本次停止点收敛为：

1. link-only 来源无法保留并执行已有的权利到期时间。
2. 私有工作流快照导入未校验配置允许的决定码及公开结果映射，可把不符合配置的结果带入公开投影。

已分别在原 [issue #4 的复核评论](https://github.com/BillShiyaoZhang/decentralized-information-community/issues/4#issuecomment-5600652340)和 [issue #6 的复核评论](https://github.com/BillShiyaoZhang/decentralized-information-community/issues/6#issuecomment-5600635340)补充复现与验收要求，不重复创建 issue。

## 基线与验证范围

- 底座本地 HEAD 与本次读取的远端 main 均为 [`a436f19e60cb8c395a2c3e986e20d4c4d001b931`](https://github.com/BillShiyaoZhang/decentralized-information-community/commit/a436f19e60cb8c395a2c3e986e20d4c4d001b931)，提交为 `Add governed runtime package and distribution workflow`。
- 包版本：`@information-community/runtime@0.1.0`、`@information-community/core@0.2.0`。
- 验证环境：Windows、Node `v24.12.0`，符合 runtime 的 `>=24.12.0 <25` 约束。
- 在底座根目录执行 `npm.cmd test`：**77/77 通过**。包含独立打包消费者、版本升级/恢复、内容、鉴权、生命周期、HTTP 及构建测试。
- 额外使用合成数据检查指南迁移所需的到期语义、发布历史恢复和私有快照导入。没有读取、导出或发布真实私有记录。
- 这些检查不是完整旧库迁移验收，也不代表所有指南页面、业务映射和运维场景已经通过。

## 已补齐的主要能力

| 领域 | 新版能力与本次结论 |
| --- | --- |
| 独立消费 | runtime 包、CLI、通用 UI、配置及分发工作流；外部消费者测试覆盖脱离平台源码树使用打包产物。原 #3 的主要架构缺口已补齐。 |
| 存储与命令 | RuntimeStore 模块、事务、版本检查、幂等及审计契约；导入、备份、恢复和升级测试通过。 |
| 内容与证据 | 不可变实体修订、固定版本引用、逐句事实约束及来源校验。仍有下述 link-only 到期缺口。 |
| 身份与发布 | 经验证的主体、MFA/TOTP、角色权限、会话撤销及受控发布；公开读取通过统一内容投影。 |
| 私有生命周期 | 私有模块、加密载荷、配置状态机、同意/撤回、保留清理、维护与公开/私有导出分离。仍有下述快照导入一致性缺口。 |

接口和运行说明见上游 [docs/runtime.md](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/a436f19e60cb8c395a2c3e986e20d4c4d001b931/docs/runtime.md)及 [runtime README](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/a436f19e60cb8c395a2c3e986e20d4c4d001b931/packages/runtime/README.md)。

### 不再作为平台阻塞的迁移问题

普通 content interchange 只创建未发布内容，但文档支持的可信离线 `RuntimeStore.restore` 可以承载经过验证映射的完整状态。内存验证保留了旧 ID、slug、版本号 17、两条发布历史、当前发布指针及旧审计主体/时间；恢复会推进运行时 revision 并失效旧会话。因此，不能仅凭普通内容导入不接收发布指针，就认定旧发布状态无法迁移。

该路径仍需要业务仓库实现一次性的受控转换、备份与迁移验收，不应暴露给普通公开内容导入。旧密文也不能只改 ID 后原样复制，必须按旧、新加密上下文受控转换。

指南现有来源修订/片段的不可变可见性可尝试通过独立 source 实体和稳定外部 ID/关系映射承接。本次未发现必须新增平台原语的证据，但完整数据映射尚未实施或验证。

## 阻塞一：Link-only 到期语义

指南 schema 允许 `rights_mode = 'link_only'`、`visibility = 'public'`、非空 `rights_expires_at`，同时 `archived_text` 与 `content_hash` 为空。现有公开查询对该模式同样执行到期过滤，见 [repository.ts](../apps/web/lib/repository.ts) 的来源可见性查询。

上游 [content.mjs](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/a436f19e60cb8c395a2c3e986e20d4c4d001b931/packages/runtime/content.mjs#L97) 的 `validateSource` 不允许 link-only data 携带到期字段；同文件 `sourceAvailable`（第 224 行）仅对 excerpt 检查 `rights.expiresAt`。

最小诊断：[runtime-0.1.0-link-expiry.mjs](platform-probes/runtime-0.1.0-link-expiry.mjs)。在 `2099-01-01T00:00:00Z` 到期的合成来源上，结果如下：

| 尝试 | 观察结果 |
| --- | --- |
| source data 增加 `rightsExpiresAt` | `EVIDENCE_MODE`，导入事务回滚。 |
| source data 增加 `rights: { expiresAt }` | `EVIDENCE_MODE`，导入事务回滚。 |
| 忽略到期元数据后导入并发布 | 到期前和到期时，公开列表均有 1 条；修订详情均可见；公开导出均有 1 条修订。 |

期望为到期前可见，到期时及之后不可见。删除到期信息会改变现有权限语义；改为 excerpt 会改变来源模式并要求不存在的正文。由业务仓库重新维护定时隐藏或额外查询过滤，不符合通用机制由底座承担的目标。

上游需要允许并执行 link-only 到期元数据，统一覆盖列表、修订/历史读取、导出和派生图结果，保留 link-only 不可归档正文的约束。已反馈至 [#4](https://github.com/BillShiyaoZhang/decentralized-information-community/issues/4#issuecomment-5600652340)，并关联 #5。

## 阻塞二：私有快照导入一致性

上游 [lifecycle.mjs](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/a436f19e60cb8c395a2c3e986e20d4c4d001b931/packages/runtime/lifecycle.mjs#L379) 的 import 命令校验结构、密文和引用，却不按当前 workflow 配置校验记录的 type/status/decisionCode/publicResult 一致性。`lifecyclePublicResults`（第 214 行）直接返回满足内容关联与生命周期条件的存储结果。

此导入还可从 [HTTP 私有命令入口](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/a436f19e60cb8c395a2c3e986e20d4c4d001b931/packages/runtime/http.mjs#L77)以 `lifecycle:manage` 权限调用，不只是可信离线完整数据库恢复。

最小诊断：[runtime-0.1.0-private-import.mjs](platform-probes/runtime-0.1.0-private-import.mjs)。使用仓库示例内容和两个内存数据库：

- 配置仅允许 `corrected` 决定码和固定的 `Reviewed correction` 公开结果。
- 正常 transition 使用 `unconfigured` 决定码被拒绝为 `INVALID_DECISION`。
- 将合成快照中仍为 submitted、decisionCode 为 null 的记录设为 `publicResult: { code: 'unconfigured', label: 'UNCONFIGURED_RESULT' }`，密文保持正常创建时的值。
- 通过同样的配置和已授权主体向空 lifecycle 模块调用 import，快照被接受，公开结果包含 `UNCONFIGURED_RESULT`。

该观察证明导入与正常命令的配置约束不一致，不代表匿名写入、覆盖非空库或读取真实私有载荷。受信迁移器可以主动避免这类输入，但平台尚未承担文档约定的配置一致性保证。上游应原子拒绝或显式迁移不兼容快照，确保公开结果来自允许的决定码及配置映射，并为公开投影提供对应有效性保证。可信离线恢复可另行定义信任边界。已反馈至 [#6](https://github.com/BillShiyaoZhang/decentralized-information-community/issues/6#issuecomment-5600635340)。

## 复现命令

从指南仓库根目录运行，`PLATFORM_ROOT` 指向上述基线的底座 checkout：

```powershell
$env:PLATFORM_ROOT = 'C:/Users/zhang/Developer/decentralized-information-community'
node docs/platform-probes/runtime-0.1.0-link-expiry.mjs
node docs/platform-probes/runtime-0.1.0-private-import.mjs
```

两项诊断均只使用内存 SQLite 和合成数据，不写入底座文件或业务数据库。

link-expiry 脚本为观察性诊断，退出码为 0 不代表契约已通过，应比较输出的 expected 与实际结果。private-import 脚本在观察到不应公开的结果时显式退出 1；当前基线退出 1 是已复现缺口，不是测试环境故障。

完整上游测试必须从底座根目录通过 `npm.cmd test` 执行；部分分发测试依赖 npm 提供的执行上下文，不应以直接 `node --test` 的环境差异判定产品失败。

## 恢复迁移的条件

等待上游修复两项缺口后，固定新版本，先复跑相关回归和完整测试。通过后再进行真实 schema/配置映射、加密载荷受控转换、旧/新公开结果对照、业务操作与恢复演练，验证成功后才替换指南现有运行入口。

本次仅新增诊断和复核文档、补充上游 issue 评论；未修改应用代码、依赖、数据库或底座源码，未创建 Git 提交或部署。工作区原有 core 导航接入改动保持不变。
