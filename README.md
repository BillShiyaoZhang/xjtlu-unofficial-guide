# 西浦非官方指南

这是一个“先核对来源，再做决定”的校园信息指南。仓库当前交付的是完整的低风险、编辑驱动阶段 1 产品；远期的公开 UGC、高影响内容、AI 自动发布和知识图谱仍默认关闭。产品判断与完整设计见：

- [产品意图](./docs/intention.md)
- [详细设计](./docs/design.md)
- [阶段 1 产品边界](./docs/product-boundary.md)
- [阶段 1 本地实现说明](./docs/implementation.md)
- [本地运行与运维手册](./docs/operations.md)

当前软件位于 [`apps/web`](./apps/web)，已完成本地构建与产品闭环，**没有、也不计划部署到 OpenAI Sites**。真实试点只能使用运营方自选并负责的基础设施；在上线检查、真实内容和运营责任未完成前，不应公开开放。

快速开始：

```bash
cd apps/web
npm install
cp .env.example .env.local
npm run dev
```

首次具名管理员、密钥、演示数据和私有线索入口的配置方式见 [`apps/web/README.md`](./apps/web/README.md)。备份、恢复、故障与回滚按 [`docs/operations.md`](./docs/operations.md) 执行。
