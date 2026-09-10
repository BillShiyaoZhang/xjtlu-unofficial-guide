# 西浦非官方指南

**[阅读初版手册](docs/handbook.md)**：按入学、学习、生活与发展机会整理的完整中文内容，包含逐句来源、两校区适用范围和复核提示。资料整理于 2026-09-10，新增内容已进入仓库的候选内容库，尚待人工审核。覆盖情况、导入方式及后续缺口见 [内容维护说明](docs/handbook-maintenance.md)。

这是一个“先核对来源，再做决定”的校园信息指南。本仓库现在是 [decentralized-information-community](https://github.com/BillShiyaoZhang/decentralized-information-community) 的数据与业务消费端：通用存储、证据修订、发布、身份、会话、加密、撤回和恢复由底座负责。

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

默认访问 <http://127.0.0.1:4317>；端口被占用时命令会输出实际地址。演示使用独立的 `community/.demo-runtime` 和本地随机密钥，首次导入完整内容，只发布明确标注的四条演示答案。新增手册内容保留为编辑草稿；重启不会自动导入或发布。演示内容不是新的事实核验结果。

## 维护边界

- `community/`：数据、业务配置和少量定制 UI。
- `server/`：校园规则及 SDK 网关；不实现数据库、认证、加密或发布引擎。
- `scripts/`：构建、离线平台 CLI、只读旧库转换和全新目录恢复。
- `vendor/`、根 `package-lock.json`：固定 core 0.2.0 / runtime 0.3.0 产物，不依赖相邻源码目录。
- `tests/fixtures/legacy-schema/`：15 个旧 SQL schema，仅供合成迁移测试。
- 本地 `apps/web/`：已忽略、不再跟踪的旧实现及已有修改；它不是新代码的构建、运行或测试依赖。请勿对这个保留目录执行 `git clean -fdx`。

完整操作、密钥管理、私有迁移、研究聚合和备份检查见 [底座运行手册](docs/platform-runtime.md)。编辑工作台是 `/editor`，平台通用入口保留为 `/runtime-editor`。没有迁移真实数据库或替上游提交代码；研究采集默认关闭。

在 `/editor` 的「内容审核」中，审核人可以同时展开多篇正文、查看逐句来源、跨页勾选文章，并批量提交结论与逐篇意见。选择「通过并发布」会在同次提交中生成经过人工确认的新修订并公开；原稿、逐句引用和审核记录保留。其余结论只保存意见。操作步骤见 [逐篇勾选与批量审核](docs/handbook-maintenance.md#逐篇勾选与批量审核)。

## GitHub Pages

[公开只读指南](https://billshiyaozhang.github.io/xjtlu-unofficial-guide/) 由 `npm run build:pages` 和 GitHub Actions 发布。在本地工作台完成「通过并发布」后，可以同步已审核的公开内容到 Pages。站点提供目录、搜索、正文和来源，不包含登录、投稿、编辑、研究采集或数据库。

审核工作台继续在本地 Node 服务中运行；本地读者页立即更新，Pages 则在同步并完成 GitHub Actions 部署后更新。导出的 `community/pages-reviewed.json` 只包含获准公开的正文、引用与展示信息；账户、密码、内部意见和运行库不会进入静态站点。首次导出前保留四张演示卡，首次导出后改用审核快照，即使快照为空也不回退到演示内容。操作步骤与命令见 [Pages 同步](docs/github-pages.md)。

公开 UGC、高影响内容和 AI 自动发布仍默认关闭。**没有、也不计划部署到 OpenAI Sites**；真实试点只能使用运营方负责的基础设施，并先完成内容、责任和研究说明审核。产品判断与历史设计见：

- [产品意图](./docs/intention.md)
- [详细设计](./docs/design.md)
- [阶段 1 产品边界](./docs/product-boundary.md)
- [旧阶段 1 实现说明](./docs/implementation.md)
- [旧应用运维与回滚资料](./docs/operations.md)
