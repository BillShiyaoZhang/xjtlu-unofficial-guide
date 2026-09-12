# 西浦非官方指南

**[阅读初版手册](docs/handbook.md)**：按入学、学习、生活与发展机会整理的完整中文内容，包含逐句来源、两校区适用范围和复核提示。2026-09-10 的原有 69 篇与本轮补充的 7 篇均获明确授权，作为「资料整理初版」收录到 Pages 公开清单；共 76 篇，保留 AI 来源、资料读取时间及尚未人工核验的说明。文章与引用分别标注「学校官方」「用户提供」「网络资料」，来源类别不代表已经人工核验。覆盖情况、导入方式及后续缺口见 [内容维护说明](docs/handbook-maintenance.md)。

这是一个让同学共同留下校园消息与经验的平台：从具体问题开始分享，在原始讨论的基础上逐渐整理学校知识。本仓库是 [decentralized-information-community](https://github.com/BillShiyaoZhang/decentralized-information-community) 的数据与业务消费端：通用存储、证据修订、发布、身份、会话、加密、撤回和恢复由底座负责。

默认入口已经从 `apps/web` 切换到根目录。`community/` 保存校园数据、内容规则、角色权限、生命周期配置、研究说明和少量定制页面；`server/` 只补业务校验和展示字段。编辑工作台复用底座的身份、详情、处置及内容 SDK。

**源码职责分离已完成，真实数据尚未切换。** 上游 #8 已在 runtime 0.3.0 通过独立验收；旧应用已移出 Git 跟踪，本地目录和原有修改原样保留。接入边界、验证及运营限制见 [0.3.0 验收记录](docs/platform-reassessment-runtime-0.3.0.md)。

## 本地运行

需要 Node **24.12.x** 和 npm。

```powershell
npm ci --ignore-scripts
npm test
npm run build
npm run dev
```

默认访问 <http://127.0.0.1:4317>；端口被占用时命令会输出实际地址。本地工作台使用独立的 `community/.demo-runtime` 和本地随机密钥，首次将完整资料导入为草稿，不自动发布。76 篇资料的 Pages 收录通过独立导出清单完成，原始 AI 稿及运行库发布状态保留；重启不会自动导入或发布未来草稿。原有四篇演示已从生产内容与公开清单中移除，演示数据仅保留为测试夹具；已有运行库中的不可变历史通过隐藏保留。

## 维护边界

- `community/`：数据、业务配置和少量定制 UI。
- `server/`：校园规则及 SDK 网关；不实现数据库、认证、加密或发布引擎。
- `scripts/`：构建、离线平台 CLI、只读旧库转换和全新目录恢复。
- `vendor/`、根 `package-lock.json`：固定 core 0.3.0 / runtime 0.3.0 分支兼容产物，不依赖相邻源码目录；来源与校验值见 `vendor/README.md`。
- `tests/fixtures/legacy-schema/`：15 个旧 SQL schema，仅供合成迁移测试。
- 本地 `apps/web/`：已忽略、不再跟踪的旧实现及已有修改；它不是新代码的构建、运行或测试依赖。请勿对这个保留目录执行 `git clean -fdx`。

完整操作、密钥管理、私有迁移、研究聚合和备份检查见 [底座运行手册](docs/platform-runtime.md)。编辑工作台是 `/editor`，平台通用入口保留为 `/runtime-editor`。没有迁移真实数据库或替上游提交代码；研究采集默认关闭。

在 `/editor` 的「内容审核」中，审核人可以同时展开多篇正文、查看逐句来源、跨页勾选文章，并批量提交结论与逐篇意见。选择「通过并发布」会在同次提交中生成经过人工确认的新修订并公开；原稿、逐句引用和审核记录保留。其余结论只保存意见。操作步骤见 [逐篇勾选与批量审核](docs/handbook-maintenance.md#逐篇勾选与批量审核)。

## GitHub Pages

读者首页以「开始探索」为入口，提供搜索示例、第一篇推荐和「刚到西浦／处理日常／探索机会」三条阅读路线。推荐只引用当前公开快照中的文章，主题目录默认列表，分支图仍可切换。文章提供来源导航、同主题继续阅读和返回原入口；话题先展示资料与讨论，分享表单按需展开。设计分析与验证见 [引导与探索体验重构](docs/audits/2026-09-12-uiux-guided-exploration.md)。

课程经验、校园资源、硕士入学三条编辑提问与校园消息入口继续保留。站内读取真实 GitHub 投稿与回复；轻量输入只要求分享正文和公开确认，支持主动保存本机草稿。引用精确原帖／回复的整理会与原文互相连接。活动报名、延期／取消、计划结束与校园情况的解决记录分别展示，往期内容保留。当前没有虚构活动、参与人数或评论，发布仍由用户在 GitHub 确认。配置与整理步骤见 [校园共建运营流程](docs/community-operations.md)。

预览本轮公开页面（与本地编辑工作台分开）：

```powershell
npm run build:pages
npm run preview:pages
```

访问 <http://127.0.0.1:4318/>。此命令只展示构建后的公开产物；代码和话题配置需要经仓库部署流程更新线上版本。

本地已有 61 条带来源的冷启动话题：16 条官方来源、42 条纸条整理、3 篇其他公开经验，加上 3 条编辑提问共 64 条。2026-09-12 新增 25 条，补充研究生申请、留学中介、老师评价和课程评价；首页“从公开来源整理”提供四类搜索入口，每条可追溯原文。纸条支持 `npm run collect:zhitiao -- --query '申研' --query '中介' --pages 1` 定向发现线索，筛选后须逐条读取详情；方法见 [抓取记录](docs/research/zhitiao-collection.md)，完整新增清单见 [常见讨论采集记录](docs/research/2026-09-12-common-discussions.md)。本次小红书浏览器仍显示“登录后查看搜索结果”，未将未读笔记收录。独立测试预览 `npm run preview:cold-start` 位于 <http://127.0.0.1:4319/>，提供 10 个合成话题、11 条讨论及 11 条回复，覆盖报名、改期、取消与后续状态；它不会进入正式构建。批次和使用方法见 [冷启动数据说明](docs/cold-start-data.md)。

读者页现提供「分支图 / 列表」切换：按话题展开不同陈述，并在每条陈述下面展开补充信息和后续补充，分别保留来源、适用范围和核验状态。正文旁可定位当前陈述、跳转父陈述，或发起「补充这条信息」投稿。详见 [话题分支图与不同说法的收录](docs/topic-branches.md)。

[公开指南](https://billshiyaozhang.github.io/xjtlu-unofficial-guide/) 由 `npm run build:pages` 和 GitHub Actions 发布，支持「资料整理初版」和「已人工审核」两类内容。76 个精确修订由 `community/pages.config.json` 的 `collectedRevisionIds` 显式列出；无需为此次收录伪造人工审核。后续确实完成人工核对的文章，可从本地工作台「通过并发布」后同步，优先展示其已审核公开版。站点提供目录、搜索、正文和来源；读者可直接在页面填写补充、更正及个人经验，再跳转到已填好标题和正文的 GitHub Issue 页面确认提交，界面明确提示需要 GitHub 账号。

运行 `npm run sync:pages` 后，Pages 在 GitHub Actions 部署完成后更新。导出只读本机运行库，生成 `mode: public-guide` 的 `community/pages-reviewed.json`，将 `collectedCount` 与 `reviewedCount` 分别计数；不会把收录初版改为人工来源、填写核验时间或新增审核记录。当前发布快照包含 76 篇资料初版、0 篇人工审核内容、0 篇演示。账户、密码、内部意见和运行库不会进入静态站点。人工审核、隐藏、来源撤回和修订更新会在后续同步时反映，清单不会自动公开未来草稿或恢复被取代的初稿。操作步骤见 [Pages 同步](docs/github-pages.md)。

公众可使用 GitHub 账号[提交补充、纠错或不同经验](https://github.com/BillShiyaoZhang/xjtlu-unofficial-guide/issues/new/choose)，也可[查看已有投稿](https://github.com/BillShiyaoZhang/xjtlu-unofficial-guide/issues)。内容由投稿人在 GitHub 最终提交并公开；维护者在 Issues 中整理、去重、关联来源。采纳或关闭 Issue 不代表事实已核验，也不会自动改写手册。使用方式见 [投稿说明](CONTRIBUTING.md) 和 [GitHub 投稿与整理](docs/github-contributions.md)。

GitHub Issues 投稿与讨论的站内展示、76 篇资料整理初版的显式收录，都是对旧阶段 1 边界的明确扩展；公开投稿无需研究邀请或研究同意。站内直接发布评论、自动导入投稿及未获授权草稿的自动发布仍未开放。**没有、也不计划部署到 OpenAI Sites**。产品判断与历史设计见：

- [产品意图](./docs/intention.md)
- [详细设计](./docs/design.md)
- [阶段 1 产品边界](./docs/product-boundary.md)
- [旧阶段 1 实现说明](./docs/implementation.md)
- [旧应用运维与回滚资料](./docs/operations.md)
