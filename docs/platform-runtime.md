# 底座运行与迁移手册

更新：2026-09-10。此手册适用于根目录的新入口，`docs/operations.md` 保留为旧 `apps/web` 的历史操作资料。

> #8 已通过验收，源码职责分离完成，业务工作台及离线运营工具已接入。以下命令说明不等于生产上线验收；真实数据、资格核验、研究审批、访问控制及流量切换仍须运营方明确执行。详细验证见 [0.3.0 记录](platform-reassessment-runtime-0.3.0.md)。

## 运行边界

使用 Node 24.12.x、npm，以及固定的 core 0.2.0 / runtime 0.3.0 分发包。运行 `npm ci --ignore-scripts`、`npm test`、`npm run test:platform`、`npm run build`。此构建只生成服务端界面文件，不把私有状态打包为静态网页；完整业务必须运行 Node 服务。另有 `npm run build:pages` 构建已导出的资料收录与人工审核公开快照；当前公开内容不含演示，缺少资料快照时构建失败。见 [Pages 同步](github-pages.md)，静态页面不能替代本手册的登录、审核及持久化流程。

- `npm run dev`：本地工作台使用独立 `.demo-runtime`，密钥在忽略的 `.dev-secrets.json`。首次初始化只导入资料草稿，不自动发布；目录与配置沿用历史名称，种子不含演示内容。不得承载真实研究数据。
- `npm start`：生产模式，不自动发布种子答案。需要 `RUNTIME_MFA_KEY`（32 字节十六进制）及 `RUNTIME_KEYRING`（平台 keyring JSON）。通过密钥管理系统注入，不能提交到 Git 或放进 UI 目录。
- `GUIDE_ROOT`：指定消费者配置目录，默认 `community`。`HOST` 默认 `127.0.0.1`，`PORT` 默认 `4317`。对外服务需运营方配置 HTTPS、反向代理和访问日志脱敏，不能直接暴露底座通用服务取代指南网关。
- `npm run build` 构建默认 `community`。`npm start` 会为指定 `GUIDE_ROOT` 构建并加载界面。自定义目录带 `.migration-incomplete` 标记时拒绝启动。

本机使用 `npm run dev` 启动，并通过回环地址（如 `http://127.0.0.1:4317/editor`）进入审核工作台时，只需账户 ID 和密码，不再填写双重验证码。原有账户和密码继续使用，无需重新开户。生产模式仍使用账户、密码和双重验证码；本机模式拒绝非回环及转发代理请求。

工作台启动时从 `GET /api/guide/login-config` 读取当前登录方式；仅服务端明确返回 `passwordOnly: true` 时隐藏验证码字段，登录仍提交到 `/api/auth/login`。配置读取失败时保留原有多因素登录方式。这项本机便利不删除账户已登记的 TOTP，也不改变生产账户维护流程。

Runtime 0.3.0 暂无密码单因素入口，本机适配层在服务端代为完成 TOTP 步骤，保留 SDK 的密码校验、失败锁定、会话与撤销机制；这不算用户完成了多因素验证。该类会话明确记录 `local-password`，普通服务入口拒绝接受。计数器和真实时间保持不变，短时间连续重新登录耗尽合法窗口时，等待 30 秒再试。

示例 keyring 结构：`{"activeVersion":"v1","keys":{"v1":"<64 hex characters>"}}`。不要使用示例占位值或演示密钥部署。

## 数据与界面

`content.json` 是不可变内容的导入种子，默认未发布。已有数据库不会在每次启动时重复导入；新增内容使用平台 `import`，再由审核角色显式发布。修改 `content-profile.json` 后必须通过平台 `configure-content` 校验，不能静默替换数据库规则。

`catalog.json` 保留话题、别名、范围及发布主体。`business.json`、`lifecycle.json`、`policy.json` 与 `consent.json` 定义校园权限、工作流和研究说明。`server/business-validation.mjs` 保存当前可执行的材料、报告及研究事件业务规则；`policy.json` 是业务目录，不是自动执行引擎，修改后需同步校验与测试。

读者页保留答案 slug 和数字版本链接，展示平台允许公开的修订及来源。参与者通过一次性邀请兑换会话，明确同意后才能提交问题、材料、非隐私报告及研究事件；本人活动只返回状态摘要。匿名入口仅接受有限字段的隐私报告，返回不透明回执。

当前页面研究记录为 `query -> open -> feedback`，只保存查询长度档与随机关联 ID，不保存搜索正文。长度沿用旧版 NFKC、标点及空白归一化，分为不超过 8 字、9–40 字、超过 40 字；分享事件契约可供业务客户端调用。新版事件结构不是旧版完整实验埋点，**新旧数据不可直接混作同一批实验结果**。只有搜索后在当前页面会话打开的答案才显示关联反馈。

`/editor` 是薄业务工作台：具名登录、队列筛选分页、授权私件详情、内部备注、处置和内容审核；`/runtime-editor` 保留平台原生维护及内容导入。所有操作仍经过指南网关及平台权限/事务。发布、隐藏及来源处置需要 8–400 字审核理由，同一事务以平台 SDK 加密保存为 `guide-reviews` 业务记录；审核记录不会公开。内部备注为 4–1000 字，进入终态至少 8 字并检查结果关联。试点运营没有全局私有正文读取权限。

内容审核提供全文、逐句来源、筛选与跨页勾选，可一次提交最多 100 篇文章的不同结论及意见。`GET /api/guide/review-articles` 需要 `content:read`；`POST /api/guide/reviews/batch` 需要 `content:publish` 和幂等键，请求为 `{ mode: "review-and-publish", items: [...] }`，每项绑定文章 ID、最新修订、当前实体版本及上次审核记录 ID。旧版工作台未明确发送此模式的请求会被拒绝，需重新加载页面，避免旧界面把「只保存」误当作发布。

`approved` 对应「通过并发布」：按所查看的最新修订追加人工确认版本，保留原文、引用及原始来源类型，记录审核人、原稿修订与审核时间，再通过平台 SDK 发布。原始修订保持不可变，其余决定只保存意见。审核结果以 `content.review` 追加到现有加密审核记录；记录与所有发布操作在同一事务内完成。任一项版本冲突、权限或发布校验失败时整批回滚；同一幂等键重试不会重复发布。新批量操作使用 `guide.reviews.batch.v2` 审计与幂等命名空间，保留旧记录。响应包含 `publishedCount` 和每项 `publishedRevisionId`，供界面明确显示实际发布结果。

当前服务的公开读者接口立即读取新的发布指针，仓库种子保持不变。随后可显式导出获准公开的内容并同步到 GitHub Pages；审核和账户管理继续在本地执行，Pages 只读取导出的公开快照。隐藏或撤回后需重新同步。操作步骤见 [逐篇勾选与批量审核](handbook-maintenance.md#逐篇勾选与批量审核)和 [Pages 同步](github-pages.md#本地审核后同步)。

目录与范围维护改为受审查的 `catalog.json`、`content-profile.json` 配置及内容导入，不保留旧 CRUD 页面。配置变更需版本控制评审；内容 profile 的实际数据库变更必须显式执行平台 `configure-content`。不能把示例宽权限账户直接用于招募人员。

## 离线管理

`npm run runtime -- <command>` 委托安装包 CLI，文件参数相对当前终端目录解析。`GUIDE_ROOT` 控制配置及数据库目录。

```powershell
npm run runtime -- bootstrap C:/private/named-account.private.json
npm run runtime -- invite C:/private/reviewed-eligibility.private.json
npm run runtime -- import C:/private/reviewed-content.json
npm run runtime -- backup C:/private/guide-backup.private.json
npm run runtime -- maintain
```

bootstrap 文件包含 `id`、`displayName`、至少 14 字符的独立 `password`、个人认证器 `totpSecret`（Base32）和明确 `roles`。运营方自行建立具名账户和 MFA；迁移不继承旧密码、TOTP 或 session。不要在聊天、Git 或命令参数中粘贴真实密钥。

runtime 0.3.0 的既有账户维护不是再次 bootstrap。先核验身份及主机操作授权，然后设置具名 `RUNTIME_OPERATOR_ID`：

```powershell
$env:RUNTIME_OPERATOR_ID = 'operations:reviewed-operator'
npm run runtime -- accounts
npm run runtime -- account C:/private/account-change.private.json
npm run runtime -- cancel-invitation C:/private/invitation.private.json
```

维护文件含 `accountId`、刚读取的 `expectedVersion`，以及 `action: credentials | roles | status | revoke-sessions` 的对应字段。凭据动作至少给 `password` 或 `totpSecret`；MFA 丢失通过受审计的离线重新登记恢复。角色、状态、凭据变更均撤销目标旧会话；普通停用可重新启用，永久撤销不可复活。维护文件按秘密保管，不得加入 Git。

invite 文件只包含可选的稳定 `subjectId`（必须 `participant:` 开头）及核验后的 `eligibility: {adult:true, eligible:true}`。资格核验必须真实完成，不能将此示例直接用于真实参与者。命令输出一次性邀请，按私密凭据交付；为同一主体另一台设备签发邀请时使用相同 subjectId。受信 MFA 运营账户也可调用 `/api/guide/invitations`。

演示管理用 `npm run runtime -- --demo <command> <file>`，自动选中演示配置和演示密钥，不会操作生产 `.runtime`。先运行一次 `npm run dev` 初始化；不要对真实数据使用 `--demo`。

运行模式每分钟调用平台 retention。离线 `maintain` 也可执行到期清理。撤回立即移除该主体的私有载荷并使全部设备失效；设备退出仅撤销本次会话。

## 旧库转换

本次只用合成数据库验证，**未打开、转换或替换真实数据库**。迁移前停止旧服务写入，按旧系统备份流程获得关闭的 SQLite 快照；对于 D1，先由运营方导出并离线形成一致的 SQLite 文件。不要直接指向运行中的库。工具只读源库，并拒绝未处理的 WAL/journal 和未知非空表。

先进行默认的内容模式转换：

```powershell
npm run migrate -- --source C:/private/closed.sqlite --output C:/private/guide-migration.private.json --profile community/content-profile.json --community-id xjtlu-unofficial-guide --public-origin https://your-guide.example
```

`public-origin` 必须是运营方实际准备使用的 HTTP(S) 根地址，用于旧相对来源链接，不能沿用示例域名。答案 ID、slug、版本父链、发布指针、引用、来源权限期限和审计会转换并校验。来源修订/片段按可见性边界拆分，旧身份与定位保留在迁移映射中。

默认遇到身份、私有线索或研究数据即拒绝，**不会静默丢弃**。需要迁移私有数据时，显式启用：

```powershell
npm run migrate -- --source C:/private/closed.sqlite --output C:/private/guide-migration.private.json --profile community/content-profile.json --community-id xjtlu-unofficial-guide --public-origin https://your-guide.example --include-private --lifecycle-file community/lifecycle.json --participants-file community/business.json --target-keyring-env GUIDE_TARGET_KEYRING --reencrypt-legacy --legacy-keyring-env GUIDE_LEGACY_KEYRING --withdrawn-register C:/private/withdrawn.private.json --revoked-register C:/private/revoked.private.json
```

两个环境变量保存 keyring JSON。若只有旧 v1 原始密钥，可用 `--legacy-secret-env OLD_SECRET_VARIABLE` 替代 `--legacy-keyring-env`，由平台 legacy helper 按原方案派生；不要同时传两者。未清理旧密文必须先验证旧 AAD，再显式重加密；不能更改 AAD 后直接复制密文。目标 keyring 必须与未来运行服务的 `RUNTIME_KEYRING` 一致。

两份 register 文件分别是运营方核对到当前时刻的撤回/撤销主体 ID 数组；空数组也必须明确提供。有歧义的历史主体需要 `--subject-mappings` 文件显式映射，不能凭散列猜测身份。例如 `{ "research_intakes:old-intake-id": "old-participant-id" }`；具体缺失引用由错误给出，目标必须是可确认的旧参与者或稳定新主体，不能随意造人。

私有迁移保留线索 ID、有限旧状态、旧同意、私有关联和加密内部记录。已到期或已撤回数据直接墓碑，不在迁移报告中另留副本。旧邀请、会话及回执全部失效；旧账户身份和角色只作加密归档，不保留可用凭据。需要重新核验参与资格和新版同意，不会补造原来没有的 consent。迁移后安全管理角色仍可按权限读取合法保留的私有载荷，不能把“需重新同意”误解为所有管理读取均已冻结。

转换产物本身是**私有备份**，包含编辑历史及迁移信息，即使是内容模式也不能上传静态托管或放进 `ui/`。工具拒绝覆盖已有输出。Windows 上 `mode:0600` 不等于完整 ACL，必须使用运营方已限制访问的目录，并按备份策略管理。

## 恢复与切换

由运营方审查转换报告、内容数量、私有记录处置和当前撤销清册后，将清册写为包含 `withdrawnSubjectIds`、`revokedSubjectIds` 两个数组的独立私有 JSON，再执行：

```powershell
npm run migrate:restore -- --artifact C:/private/guide-migration.private.json --target C:/private/guide-deployment --review C:/private/current-revocations.private.json
```

目标目录必须尚不存在，父目录必须存在。恢复先在内存中校验，再创建新的消费者目录，通过平台 `restore` 写入新数据库。不会覆盖当前 catalog、生产库或源快照；不会把原始迁移报告放进服务目录。失败目录保留 `.migration-incomplete`，不得手动删标记绕过校验，应调查后选择新的目标目录重试。

将 `GUIDE_ROOT` 指向新目录，并通过密钥管理系统设置目标 keyring、新的 MFA key。旧库迁移不导入凭据，缺失账户需要 bootstrap；恢复含具名账户的 runtime 备份后，返回 `accountsRequiringCredentials`，这些既有 ID 必须用 `account` 同时重新登记密码与 TOTP，不能 bootstrap 重复 ID。恢复保留普通停用状态，永久撤销账户仍禁止恢复。重新核验邀请后才启动 `npm start` 并验收数据，确认当前同意与撤销记录正确后才切换流量。

旧五模块迁移产物没有新的业务审核记录模块。恢复工具只显式初始化空 `guide-reviews` 并返回 `migrationWarnings`；保留原文件和已有平台数据，不丢弃未知模块。新产物原样验证审核记录。任意其他扩展或外部身份 provider 需要单独评审，不能冒充已验证迁移。

原生平台备份可用 `npm run runtime -- restore <backup> <current-review>` 恢复到**新的空数据库**。不能向已运行的目录覆盖恢复。新旧系统发生写入后，不允许通过简单切回旧快照回滚，否则会复活撤回数据或丢失新操作；必须重新核对最新撤销清册和增量数据。

旧 `apps/web` 已仅从 Git 索引移除，本地文件和预存改动未删除，目录被忽略。独立 SQL fixtures 取代旧树测试依赖。不要执行会清理忽略文件的 `git clean -fdx`；真实切换和回滚资料的保管仍由运营方负责。

## 运营证据

平台 `backup` 负责生成私有 runtime 备份；指南验证脚本只读取显式文件，在内存执行真实恢复并解密全部保留载荷，不打开配置中的现用数据库：

```powershell
npm run verify:backup -- --backup C:/private/runtime-backup.private.json --review C:/private/current-revocations.private.json --root community --evidence C:/private/backup-check.private.json
```

需要 `RUNTIME_OPERATOR_ID` 和与备份密文匹配的 `RUNTIME_KEYRING`。证据包含成功/失败、备份 SHA-256、时间、计数及需重新登记的账户数量；失败返回非零，不写异常正文或秘密。目标文件必须不存在。此检查验证恢复及解密，不替代在目标基础设施上的灾备演练、恢复时间测量或生产调度。Windows 仍须限制私有目录 ACL。

## 研究聚合

`business.research` 默认 `enabled:false`。启用前需批准独立 `batchId` 与带时区 ISO 的 `startAt/endAt`，窗口为 `[startAt,endAt)`；旧查询不能在结束后继续追加反馈。服务端绑定批次，客户端不能选择；默认演示不收集研究事件，但线索和有限匿名报告仍可使用。

```powershell
npm run research:report
npm run research:report -- --from 2026-10-01T00:00:00+08:00 --to 2026-10-08T00:00:00+08:00
```

以上日期仅为格式示例，不是已批准试点。需要具名 `RUNTIME_OPERATOR_ID`、`RUNTIME_KEYRING`，并用 `GUIDE_ROOT` 指定目标消费目录。省略区间统计配置批次；指定区间必须完整位于批次内。输出只有批次、窗口、去重查询计数及长度档，读取审计与聚合同一事务提交；旧实验、过期、撤回、失效同意及不成立的关联不会混入。`resolvedQueries` 与 `unclearQueries` 可以重叠，不应相加冒充互斥人数。报告会因后续合法撤回/到期而变化，不是不可变研究原始数据导出。
