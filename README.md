# 西浦非官方指南

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

默认访问 <http://127.0.0.1:4317>；端口被占用时命令会输出实际地址。演示使用独立的 `community/.demo-runtime` 和本地随机密钥，仅首次初始化发布明确标注的四条演示答案。重启不会发布编辑草稿。演示内容不是新的事实核验结果。

## 维护边界

- `community/`：数据、业务配置和少量定制 UI。
- `server/`：校园规则及 SDK 网关；不实现数据库、认证、加密或发布引擎。
- `scripts/`：构建、离线平台 CLI、只读旧库转换和全新目录恢复。
- `vendor/`、根 `package-lock.json`：固定 core 0.2.0 / runtime 0.3.0 产物，不依赖相邻源码目录。
- `tests/fixtures/legacy-schema/`：15 个旧 SQL schema，仅供合成迁移测试。
- 本地 `apps/web/`：已忽略、不再跟踪的旧实现及已有修改；它不是新代码的构建、运行或测试依赖。请勿对这个保留目录执行 `git clean -fdx`。

完整操作、密钥管理、私有迁移、研究聚合和备份检查见 [底座运行手册](docs/platform-runtime.md)。编辑工作台是 `/editor`，平台通用入口保留为 `/runtime-editor`。没有迁移真实数据库或替上游提交代码；研究采集默认关闭。

## GitHub Pages

[公开只读演示指南](https://billshiyaozhang.github.io/xjtlu-unofficial-guide/) 由 `npm run build:pages` 和 GitHub Actions 发布。仅包含仓库内显式允许的演示答案、搜索及来源，不包含登录、投稿、编辑、研究采集或数据库。完整业务入口仍需独立 Node 服务。

Pages 不需要迁移数据库，也不能托管 SQLite 后端。静态发布清单、内容边界、自动检查和重新部署说明见 [Pages 部署](docs/github-pages.md)。

公开 UGC、高影响内容和 AI 自动发布仍默认关闭。**没有、也不计划部署到 OpenAI Sites**；真实试点只能使用运营方负责的基础设施，并先完成内容、责任和研究说明审核。产品判断与历史设计见：

- [产品意图](./docs/intention.md)
- [详细设计](./docs/design.md)
- [阶段 1 产品边界](./docs/product-boundary.md)
- [旧阶段 1 实现说明](./docs/implementation.md)
- [旧应用运维与回滚资料](./docs/operations.md)
