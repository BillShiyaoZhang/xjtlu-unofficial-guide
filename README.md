# 西浦非官方指南

这是一个“先核对来源，再做决定”的校园信息指南原型。产品判断与完整设计见：

- [产品意图](./docs/intention.md)
- [详细设计](./docs/design.md)
- [阶段 1 本地实现说明](./docs/implementation.md)

当前软件位于 [`apps/web`](./apps/web)，只完成了本地构建与验证，**没有部署到 OpenAI Sites 或其他公开环境**。

快速开始：

```bash
cd apps/web
npm install
npm run dev
```

本地演示数据、编辑白名单和私有线索入口的配置方式见 [`apps/web/README.md`](./apps/web/README.md)。
