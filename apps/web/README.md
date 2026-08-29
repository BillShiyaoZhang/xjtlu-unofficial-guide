# 阶段 1 Web 应用

这是 `docs/design.md` 的本地阶段 1 工程实现：一个公开只读、编辑维护的校园信息核验指南。当前交付用于产品与工程验证，不代表已经满足公开运营或真实研究试点的全部前置条件。

## 已实现

- 中文关键词、别名和范围筛选；搜索结果按答案卡归组。
- 话题页、答案卡、适用范围、核验日期、复核期限、负责人和逾期警示。
- 不可变答案修订、历史版本、逐句来源、`EvidenceSpan` 与 `LinkCitation` 分离。
- 来源发布时间、平台收录/访问时间，以及来源链接/可定位证据两类覆盖率。
- ChatGPT 登录身份与服务端编辑白名单分离；编辑 API 默认拒绝未授权账号。
- 新建草稿、创建修订、人工发布、紧急隐藏与恢复；均使用幂等键、乐观并发和追加式审计。
- 匿名二选一反馈；匿名隐私报告；受邀成年试点参与者的其他结构化报告。
- 私有问题/材料线索、PII 启发式拦截、安全 URL 校验、30 天到期去标识化。
- D1 触发器维护发布原子性、引用覆盖、权利模式、修订不可变和受控状态转换。

高影响答案当前故意保持关闭，直到领域审核角色和来源权威范围校验完成。公开 UGC、评论、知识图谱、向量检索、LLM 自动发布和开放投稿均不在本阶段。

## 本地运行

要求 Node.js 22.13 或更高版本。

```bash
npm install
cp .env.example .env.local
npm run dev
```

用于完整本地演示的 `.env.local` 示例：

```dotenv
EDITOR_EMAILS=seedy@sites.test
RESEARCH_INTAKE_SECRET=replace-with-a-local-demo-secret
MAINTENANCE_SECRET=replace-with-a-different-local-secret
SEED_DEMO_CONTENT=true
```

本地 Sites 登录使用开发身份 `seedy@sites.test`；该地址仍必须出现在 `EDITOR_EMAILS` 中，授权才会通过。`SEED_DEMO_CONTENT` 只能用于本地演示，真实试点或任何正式数据库必须设为 `false`。

常用入口：

- `/`：公开首页
- `/search`：搜索
- `/topics`：话题
- `/report`：结构化问题报告
- `/research-intake`：受邀成年参与者私有线索
- `/editor`：编辑工作台

## 保留期限任务

每次数据库访问都会按分钟节流检查到期私有线索，但真实试点还必须由独立调度器定期调用：

```bash
curl -X POST http://localhost:3000/v1/internal/maintenance \
  -H "Authorization: Bearer $MAINTENANCE_SECRET"
```

调度器使用的值必须与 `MAINTENANCE_SECRET` 相同。到期处理会清空参与者哈希、背景、正文、URL 和材料关系，仅保留不可关联的状态墓碑与审计记录。

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

`.openai/hosting.json` 仅来自本地脚手架和绑定声明。本项目没有执行 OpenAI Sites 部署，当前也不应直接公开上线。

## 真实试点前仍需完成

- 冻结单一校区/入学届切口，并用真实访谈制作 30–50 张经双人抽检的答案卡。
- 改用逐参与者、短期、可撤销且绑定线下成年确认的一次性邀请凭证。
- 接入真实调度、边缘限流、备份恢复、日志告警和运营值班。
- 明确运营主体、审核责任、高风险联系人、隐私/版权处理和适用合规要求。
- 建立不含跨会话画像的试点计量口径与离线搜索评测。
- 将占位 canonical origin `https://xjtlu-guide.example` 替换为经确认的正式域名。
