# 阶段 1 Web 应用

这是 `docs/design.md` 的阶段 1 完整产品实现：一个公开只读、编辑维护的校园信息核验指南。软件侧已经覆盖本地使用、内容治理、安全队列和可验证运维闭环；真实内容、运营责任、研究材料与适用审查仍需由项目方在线下完成。产品边界见 [`docs/product-boundary.md`](../../docs/product-boundary.md)，运维步骤见 [`docs/operations.md`](../../docs/operations.md)。

## 已实现

- 中文关键词、别名和范围筛选；搜索结果按答案卡归组，失效筛选会被显式忽略。
- 手机优先公开端：紧凑顶栏、四项底部导航、Safe Area、触控目标和移动筛选抽屉。
- 可安装 PWA：Manifest、独立应用图标、Apple 图标、联网状态提示与保守离线页。
- 话题页、答案卡、适用范围、核验日期、复核期限、负责人和逾期警示。
- 答案系统分享/复制；分享链接只指向当前公开答案，不携带底部导航上下文。
- 不可变答案修订、历史版本、逐句来源、`EvidenceSpan` 与 `LinkCitation` 分离。
- 来源发布时间、平台收录/访问时间，以及来源链接/可定位证据两类覆盖率。
- 具名编辑登录：PBKDF2 密码、TOTP/恢复码、可撤销短期会话、六类最小角色、持久限流、同源写保护和默认拒绝；不依赖 Sites 身份模拟。
- 编辑目录控制面：维护话题/别名、适用范围、发布主体和来源状态；来源复核中、撤回、不可用或权利到期会让受影响答案 fail-closed。
- 新建草稿、创建修订、人工发布、紧急隐藏与恢复；均使用幂等键、乐观并发和追加式审计。
- 匿名二选一反馈；匿名隐私报告；受邀成年试点参与者的其他结构化报告。
- 逐参与者一次性邀请、线下成年核验绑定、版本化独立同意、28 天短期会话、编辑撤销、设备退出、按原研究编号补发邀请，以及失去会话后凭原邀请码撤回。
- 一次明确点击搜索对应一个去标识化查询旅程；筛选细化复用同一分母并更新结果状态，记录真实答案打开、分享与关联反馈。自动检索不保存正文或正文哈希；IP 只在内存中短时转为限流指纹。
- 搜索正文经 POST 提交，结果页使用一小时有效的不透明加密参数；正式参与者的参数绑定当前会话，canonical 分享只包含答案地址。
- 编辑工作台可签发/撤销邀请，并分别查看正式成年队列与公开匿名事件级指标；检索错误可观测，未反馈查询按未解决计，分享闸门按去重参与者计算。
- 报告提交后直接进入持久状态页；报告和私有线索拥有独立分页队列、详情、SLA、指派、内部备注、决定码和结果内容链接，全部状态迁移受版本与数据库审计约束。
- 私有问题/材料线索、PII 启发式拦截、安全 URL 校验、AES-GCM 静态加密和 30 天到期清理；研究交互事件最长保留 120 天，随后删除并清除研究编号/邀请码映射。
- 零结果页先显示话题候选，并把原问题和范围预填到私有线索；全局加载、错误和 404 均有移动端恢复入口。
- D1 触发器维护发布原子性、引用覆盖、权利模式、修订不可变和受控状态转换。
- 健康、运维与恢复控制面：公开最小健康检查、每日 maintenance 运行记录、备份证明、月度恢复演练证明和编辑上线检查。

高影响答案当前故意保持关闭，直到领域审核角色和来源权威范围校验完成。公开 UGC、评论、知识图谱、向量检索、LLM 自动发布和开放投稿均不在本阶段。

PWA 不会离线缓存答案、举报、研究线索或编辑内容。生产构建中的 Service Worker 只缓存静态断网页；网络失败时明确提示重新联网，避免把过期校园信息伪装成当前答案。开发模式不会注册 Service Worker。仓库提供的 `npm run dev` 和 `npm start` 还会关闭 Cloudflare 本地 Explorer/Observability，避免调试追踪持久化完整请求 URL；不要绕开这些脚本启动含敏感测试数据的服务。

## 本地运行

要求 Node.js 22.13 或更高版本。

```bash
npm install
cp .env.example .env.local
umask 077
npm run dev
```

用于完整本地演示的 `.env.local` 示例：

```dotenv
EDITOR_PASSWORD_PEPPER=replace-with-a-random-password-pepper-32-chars-min
EDITOR_MFA_KEY_V1=replace-with-a-different-mfa-encryption-key-32-chars-min
EDITOR_RATE_LIMIT_SECRET=replace-with-a-third-rate-limit-key-32-chars-min
PRIVATE_INTAKE_KEY_V1=replace-with-a-fourth-private-payload-key-32-chars-min
EDITOR_BOOTSTRAP_EMAIL=admin@example.invalid
EDITOR_BOOTSTRAP_NAME=本地产品管理员
EDITOR_BOOTSTRAP_PASSWORD=replace-with-a-unique-password-14-chars-min
EDITOR_BOOTSTRAP_TOTP_SECRET=REPLACEWITHBASE32SECRET
EDITOR_ENABLE_LEGACY_LOGIN=false
PILOT_SECRET=replace-with-at-least-32-random-characters
PILOT_WINDOW_START=2026-08-29T00:00:00+08:00
PILOT_WINDOW_END=2026-09-26T00:00:00+08:00
MAINTENANCE_SECRET=replace-with-a-different-local-secret
PUBLIC_ORIGIN=http://localhost:3000
SEED_DEMO_CONTENT=true
```

四个安全密钥必须都不少于 32 个字符且彼此不同，也不能复用 `PILOT_SECRET` 或维护密钥；其中 `PRIVATE_INTAKE_KEY_V1` 用于加密私有线索正文、背景和来源。首次登录会使用 `EDITOR_BOOTSTRAP_*` 创建具名管理员；确认它能重新登录后，应从运行环境移除全部 bootstrap 值并重启。`EDITOR_BOOTSTRAP_TOTP_SECRET` 是 16–128 位 Base32 字符串，应同时录入管理员的认证器。真实试点不得使用示例邮箱、密码或 TOTP 值。

`PILOT_WINDOW_START` 与 `PILOT_WINDOW_END` 必须成对使用带时区的 ISO 时间，结束时间不包含在窗口内；未配置时工作台只显示“全部历史预览”，不会把达标数字标绿。`SEED_DEMO_CONTENT` 只能用于本地演示，真实试点或任何正式数据库必须设为 `false`，`PUBLIC_ORIGIN` 必须改成实际 HTTPS origin。完整的首次管理员与密钥要求见 [运维手册](../../docs/operations.md#3-环境与密钥)。

常用入口：

- `/`：公开首页
- `/search`：搜索
- `/topics`：话题
- `/report`：结构化问题报告
- `/pilot`：兑换邀请、查看会话、退出或撤回同意
- `/pilot/activity`：参与者自己的报告与线索状态
- `/research-intake`：受邀成年参与者私有线索
- `/editor`：编辑工作台
- `/editor/login`：本地编辑登录
- `/editor/content`：可分页、可筛选的内容队列
- `/editor/catalog`：话题、范围、发布主体与来源控制面
- `/editor/accounts`：具名账号与角色
- `/editor/security`：个人密码与会话
- `/editor/reports`、`/editor/intakes`：安全处置队列
- `/editor/operations`：健康、备份、恢复与上线检查

在支持的浏览器中可以把公开端添加到手机主屏幕。桌面可直接用 `localhost` 验证；实体手机必须通过同一局域网中的可信 HTTPS 反向代理访问，并在手机上信任该本地证书，否则安全 Cookie 和 PWA 安装都不会可靠工作。可使用 Caddy、mkcert 等本地工具完成这一层，但不要把开发服务直接暴露到互联网。本项目没有因此部署到 OpenAI Sites。

`.wrangler` 中的本地数据库可能包含经 AES-GCM 加密的私有线索载荷及可关联元数据，仍应使用专用 OS 账号、加密磁盘和 `umask 077`；不要共享该目录、密钥或未加密备份。构建配置不会把环境中的真实密钥写进 `dist`，但 `dist` 仍是生成物，不应作为含运行凭据的分发包。

早期本地版本曾把搜索正文放进 URL；新版不会这样做，但无法代替用户清除既有浏览器历史、恢复标签或本地调试追踪。如果此前输入过敏感内容，应手动清除这个本地站点的浏览历史与站点数据；应用不会擅自删除用户的浏览器数据。

## 保留期限与运维任务

每次数据库访问都会按分钟节流检查到期私有线索，但真实试点还必须由独立调度器定期调用：

```bash
curl -X POST http://localhost:3000/v1/internal/maintenance \
  -H "Authorization: Bearer $MAINTENANCE_SECRET"
```

调度器使用的值必须与 `MAINTENANCE_SECRET` 相同。到期处理会在 30 天清空私有线索正文与关联，使 28 天到期会话失效，并在 120 天删除查询、结果、打开、分享和关联反馈事件，随后清除直接研究编号与邀请码映射。最小同意/审计记录仍保留精确时间、渠道与内部关联，在小样本中可能被招募人员间接回溯，并不等于匿名；真实试点前必须为它们确定单独的合法保留期限、受限权限和最终删除/归档流程，并写入完整版说明。

真实试点还必须每天生成并校验备份、调用 `/v1/internal/backup-runs` 记录证明，并每月至少一次在隔离环境恢复后调用 `/v1/internal/recovery-drills`。目标为 RPO 不超过 24 小时、RTO 不超过 4 小时。请求格式、告警、密钥轮换、故障和回滚流程见 [`docs/operations.md`](../../docs/operations.md)。

## 验证命令

```bash
npm run format
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

完整依赖审计仍可能报告 Drizzle 迁移生成器中的开发期告警；运行时依赖应以 `npm audit --omit=dev` 为准。不要使用 `npm audit fix --force` 自动降级或跨主版本替换工具链。

## 架构说明

详细设计的目标形态是 Next.js/FastAPI/PostgreSQL。这个本地实现采用 Vinext + Cloudflare D1 的单应用适配，以更快验证页面、API 和数据不变量。领域边界、不可变修订、来源权利、幂等和发布事务均按设计保留；迁移到目标架构时应先保持这些契约，再替换存储与检索实现。

`.openai/hosting.json` 与 Sites 构建插件仅来自本地脚手架和绑定适配。本地编辑授权不依赖它们；本项目**不部署到 OpenAI Sites**。真实试点只能使用运营方选择、控制并承担安全与数据处理责任的基础设施。

## 真实试点的线下与运营前置

- 冻结单一校区/入学届切口，并用真实访谈制作 30–50 张经双人抽检的答案卡。
- 用真实责任人完成具名编辑账号、MFA、最小权限、恢复码保管、服务端会话撤销和职责分离演练。
- 接入真实调度、反向代理/边缘保护、备份恢复、日志告警和运营值班，并在 `/editor/operations` 完成全部上线检查。
- 在反向代理和可观测层关闭请求 query string 记录，尤其不得保存加密搜索视图参数；当前本地配置已禁用 Worker observability。
- 明确运营主体、审核责任、高风险联系人、隐私/版权处理和适用合规要求；仓库不提供虚构联系人或法务结论。
- 用独立、去标识化的任务集完成搜索离线评测与交叉对照基线。
- 将 `PUBLIC_ORIGIN` 配置为运营方确认的正式 HTTPS origin。
