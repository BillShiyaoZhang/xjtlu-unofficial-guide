# Runtime 0.1.1 修复验收与迁移边界

> 历史评估：本页的 #7 阻塞已在 [Runtime 0.2.0 复核](platform-reassessment-runtime-0.2.0.md) 中解除。当前运行与迁移请按 [新版手册](platform-runtime.md)，不要继续使用本页旧诊断的预期拒绝结果。

日期：2026-09-09。

## 结论

**上一轮两项阻塞均已修复并通过独立复验。** 继续检查实际业务流程后，仍有参与者凭据/会话生命周期这一独立平台适配需求。公开内容和编辑发布已有迁移路径，但完整指南尚不能只留下业务规则、小型 SDK 适配和少量页面；按原要求暂不修改应用运行入口。

新需求已提交为 [issue #7](https://github.com/BillShiyaoZhang/decentralized-information-community/issues/7)，完整请求存档见 [参与者会话适配](platform-issues/05-participant-sessions.md)。这不是重新否定 #4/#6 的修复，也不是要求削弱编辑 MFA。

## 精确基线

- 相邻平台仓库 HEAD：`a436f19e60cb8c395a2c3e986e20d4c4d001b931`。
- 本次读取的 GitHub main 仍为同一提交；**实际验证的是其上的本地未提交修复工作区**，包版本标记为 `@information-community/runtime@0.1.1`。不能将 HEAD 单独当成已包含修复的版本。
- core 为 0.2.0；验证环境为 Windows、Node v24.12.0。
- 没有替上游提交、推送或发布包。后续迁移必须固定包含修复的提交/产物及 lockfile，不能继续安装旧 runtime 0.1.0。

已验证源码的 SHA-256（本地文件字节）：

| 文件 | SHA-256 |
| --- | --- |
| `packages/runtime/content.mjs` | `DB92DA8316300662F61D8F4045C00652DFB7FDE16F575A1BD97FC3573027EB7A` |
| `packages/runtime/lifecycle.mjs` | `9D933BC3D8441DC671EB91704B1006984169113881779B5E8804E560EE55B512` |
| `packages/runtime/http.mjs` | `9EC7CD11FEB545124B5616E80091CEAFE09DA9B13005EF455913D44FD407B797` |
| `packages/runtime/auth.mjs` | `5ADF0DC624BAFF2868A393A9224BE9B8CA47782E02CF0BADD9711B160F3C1D9B` |

## 两项修复验收

| 检查 | 结果 |
| --- | --- |
| 上游根目录 `npm.cmd test` | **87/87 通过**，包含独立打包消费者、HTTP、恢复及新增回归。 |
| 指南独立回归 `runtime-0.1.1-regression.test.mjs` | **2/2 通过**，对原始诊断输出执行明确断言。 |
| link-only 到期 | `data.rights.expiresAt` 可导入；截止前列表/详情/导出可见，精确截止时均不可见。 |
| 私有导入 | 未配置结果被 `INVALID_PUBLIC_RESULT` 拒绝；合法配置的结果仍能公开。 |

到期字段采用嵌套的 `rights.expiresAt`；扁平 `rightsExpiresAt` 被拒绝是正常契约选择。无期限来源继续可见也是正确行为，因此迁移器必须保留旧非空期限，不能删字段来让导入通过。

`lifecyclePublicResults` 新版需要显式传入 `config`。本仓库原诊断脚本已补传配置，并增加合法结果正向对照，避免把“缺配置导致空列表”误判为修复。非法快照原子拒绝、合法未处理记录、清理墓碑及离线恢复后的配置过滤也有上游测试覆盖。

已分别补充 [#4 验收评论](https://github.com/BillShiyaoZhang/decentralized-information-community/issues/4#issuecomment-5601134048)和 [#6 验收评论](https://github.com/BillShiyaoZhang/decentralized-information-community/issues/6#issuecomment-5601154551)，没有擅自关闭 issue。

## 剩余平台边界

[阶段 1 产品边界](product-boundary.md)明确区分邀请式成年参与者与具名 MFA 编辑。现有参与者入口见 [pilot/session](../apps/web/app/v1/pilot/session/route.ts)及 [pilot.ts](../apps/web/lib/pilot.ts)，受限匿名隐私报告见 [mutations.ts](../apps/web/lib/mutations.ts)。

平台的 `requirePermission` 对所有受保护操作要求 `principal.mfa === true`。可信 provider 只有 authenticate 接口；普通 logout/revoke 与生命周期撤回仍操作内置 `auth.sessions`。配置扩展只是状态模块，没有可消费的凭据/会话签发、撤销和撤回联动契约。

已有 lifecycle create 会按主体 `withdrawnAt`/consent epoch 拒绝撤回后的写入；本次没有发现绕过该检查。缺口是外部参与者凭据/会话本身的签发、失效、单设备退出及恢复衔接，而不是否定现有生命周期的主体检查。

本轮 [参与者访问诊断](platform-probes/runtime-0.1.1-participant-access.mjs)使用内存数据库、合成凭据和本机临时 HTTP 端口，得到：

- 已模拟验证的非 MFA 邀请主体执行 HTTP 私有 create：401。
- 无登录的配置隐私报告走同一入口：401。
- 即使测试主体有 MFA，仅持 `lifecycle:self` 读取管理列表：403。

这些拒绝符合现有接口定位，不是权限绕过漏洞。诊断中的 SDK 私有正文读取也被 MFA 拒绝，但**指南参与者活动页只需要本人状态摘要，不要求正文解密**，因此该正文限制本身不作为迁移阻塞。

SDK 的 consent/create/withdraw 可以在可信事务中操作稳定非 MFA 主体；业务包装器也能从生命周期摘要构造本人活动视图。问题不在于完全无法编码，而在于指南仍需独立维护邀请 token、会话签发/验证、安全传输、重放限制、退出/撤销和在途请求一致性。这会继续承担本次分离目标要移交的平台机制。不能通过伪称 `mfa:true` 或全局放松 MFA 解决。

#7 请求平台提供可选凭据/会话或完整 provider 生命周期契约、按操作分级的认证保证、撤回联动及受限 self/隐私报告接入。成年核验标准、邀请资格、研究编号、同意文本、试点窗口和统计口径仍归指南业务。

## 已有可行映射

- 话题、别名、范围、发布主体及校园规则转为业务 JSON/profile；答案、来源、句子、修订、父链和引用保留稳定 ID。
- 来源修订/片段按可见性边界映射 source entity/revision；link-only 期限转为 UTC ISO `rights.expiresAt`，旧定位信息由业务字段保留。
- 旧发布指针、历史和审计使用受信离线 restore；旧加密上下文使用已有 legacy helper 保留或受控重加密。
- 公开 DTO 缺少的 slug、摘要、核验日期等可由小型 SDK 网关在同一快照调用平台可见性判断后按白名单输出，无需重写公开规则。
- 六类角色可以做业务权限映射。不能照抄示例把试点运营和安全审核都授予全局私有管理权限；细分包装器必须是唯一暴露入口，不能留下绕过它的宽权限通用路由。
- Node 24 + SQLite 是支持的部署路线；不将 D1 在线驱动视为必需新增能力。

上述是源码/API 可行性分析，不是已经完成全库转换、页面重构或真实迁移验收。

## 重跑

在指南根目录设置平台 checkout，再分别执行：

```powershell
$env:PLATFORM_ROOT = 'C:/Users/zhang/Developer/decentralized-information-community'
node --test docs/platform-probes/runtime-0.1.1-regression.test.mjs
node docs/platform-probes/runtime-0.1.1-participant-access.mjs
```

第二条为观察性诊断，退出 0 只表示运行完成，不表示参与者迁移契约通过。测试不写业务数据库，不使用真实材料或会话；HTTP 仅监听随机本机端口并在结束时关闭。

本次仅更新诊断/文档并提交上游反馈，应用代码、依赖和现有未提交改动保持不变。等待 #7 的受支持身份路线后，先验证独立消费者，再开始数据/业务映射和应用替换。
