# [Platform] 提供可外部消费的运行时、业务配置与存储迁移扩展契约

## 背景与阻塞

使用方 `xjtlu-unofficial-guide` 希望主要保留数据、校园业务配置和少量定制页面，由本项目维护通用平台机制。评估基线为 main `6a567f4819e430f4e52993d72ebf747e4ea27c20` / core 0.2.0。

- [core 包清单](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/6a567f4819e430f4e52993d72ebf747e4ea27c20/packages/core/package.json) 只分发纯函数、类型和说明。
- [根 package.json](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/6a567f4819e430f4e52993d72ebf747e4ea27c20/package.json) 为 private；[buildSite](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/6a567f4819e430f4e52993d72ebf747e4ea27c20/scripts/build.mjs) 从平台源码目录拷贝 web/core/adapters，服务也通过仓库内入口运行。
- [loadCommunity](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/6a567f4819e430f4e52993d72ebf747e4ea27c20/scripts/community-config.mjs) 已支持外部配置路径，但业务契约目前只有图文件和品牌文案。
- [SqliteStore](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/6a567f4819e430f4e52993d72ebf747e4ea27c20/server/store.mjs) 只有整图 snapshots；初次 JSON 导入与当前快照导出不等于业务状态迁移契约。

指南目前通过 tgz 使用同主题导航，仍自己维护 D1 schema、15 个 SQL migration、API 和通用编辑后台。复制整个模板继续维护这些源码不能完成职责分离。

## 请求

提供至少一种正式支持的外部消费方式，例如版本化 runtime/CLI 包，或固定版本服务镜像配套 SDK。平台自行选择技术，不要求同时提供所有方案，也不要求先发布 npm registry。

1. 独立消费目录仅维护依赖/部署声明、content、community/business 配置和可选 UI，无需复制 server、scripts、adapters 和通用后台源码。
2. 定义运行时配置、路由/DTO/错误契约、业务策略和可选模块注册，以及可复用界面或页面扩展入口。
3. 提供持久化与事务接口、扩展 schema 版本、升级迁移、受控导入/导出及失败回滚。至少一条存储路线可以真实运行；可支持现有 D1，也可提供目标数据库的导入入口，不强制 Cloudflare。
4. 旧 D1 的校园字段映射由指南完成；平台须能保留外部稳定 ID、内容版本、固定引用、公开指针及审计，区分公开内容导出与私有运行时备份。
5. 业务扩展结构和迁移须有版本契约，使升级无需手工复制上游源码。

## 验收

- [ ] 仓库外 fixture 仅消费固定版本产物，加载自己的数据/配置，即可构建、启动、查询、写入和重启恢复。
- [ ] 从干净环境可重现，不依赖相邻源码路径、工作区链接或上游工作目录。
- [ ] 平台升级保留使用方数据、配置与 UI 扩展，并有兼容范围说明。
- [ ] 测试覆盖事务失败回滚、重复导入策略、旧 ID/引用保留、扩展 schema 升级和公开导出隔离。
- [ ] 有从现有应用接入的示例，明确平台执行机制与使用方配置的边界。

配套的不可变修订、发布权限和私有生命周期另行跟踪；这些能力可以是可选包，不要求全部进入无依赖 core。本次使用方停止整体重构，等待可验收版本。
