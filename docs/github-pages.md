# GitHub Pages 只读演示部署

更新：2026-09-10。仓库所有者已明确选择发布公开只读演示版。

## 数据边界

Pages 地址：https://billshiyaozhang.github.io/xjtlu-unofficial-guide/ 。

GitHub Pages 是静态托管，不运行 Node 或 SQLite。**本次不需要数据库迁移，也没有读取、上传或迁移真实数据库。** 登录、邀请、投稿、审核、私有线索、研究数据和实时撤回仍属于独立 Node 服务；恢复真实数据需要另行按 [运行手册](platform-runtime.md) 完成运营审查。

`npm run build` 仍构建 runtime 的服务端 UI 空壳，不能直接用于 Pages。`npm run build:pages` 使用固定底座包，在内存导入 Git 内的演示种子，通过显式清单发布并取得平台公开投影，输出到 `community/pages-dist`。不调用持久数据库入口，也不导出 runtime 备份。

`community/pages.config.json` 是单独的静态发布审批清单；新增种子或草稿不会自动出现在 Pages。发布对象必须明确标为演示内容，来源必须满足平台公开规则；带有效期限的来源不得进入静态产物。内部字段、私有模块及未批准版本不能由界面资产旁路输出。自有方法说明链接映射到 Pages，不能带本机 localhost 地址。

静态站点是构建时的公开快照。后续隐藏、撤回和复核变化需要重新构建部署，已经下载或缓存的副本无法收回。不要将需要即时撤回、限时授权或含个人资料的内容纳入此演示发布路径。演示内容不代表当前事实已重新核验。

## 发布流程

仓库 Settings / Pages 的 Source 设为 GitHub Actions。工作流 `.github/workflows/pages.yml` 在 `main` 推送及手动触发时构建部署；PR 只验证，不部署。它执行消费端回归、平台契约、服务端构建、Pages 构建和项目子路径下的浏览器验收。

构建作业只有仓库只读权限，部署作业才拥有 `pages:write` 和 `id-token:write`。官方 Actions 固定到核对过的提交。浏览器测试依赖安装在 runner 临时目录，不加入消费端运行依赖。

上传路径严格限定为 `community/pages-dist`，不是仓库根目录、`community`、`.runtime` 或旧 `apps/web`。不要添加数据库、密钥、迁移产物或私有备份，即使文件内容已加密也不能发布。Pages 即使来自私有仓库，也可能公开可访问；不能以 Git 仓库可见性代替站点访问控制。

静态页面使用相对资源及 hash 深链，兼容 `/xjtlu-unofficial-guide/` 项目子路径和刷新。只有浏览器交互，无服务端 API、认证或研究上报请求。

## 验证

```powershell
npm ci --ignore-scripts
npm test
npm run test:platform
npm run build
npm run build:pages
npm run test:pages-browser
```

浏览器测试需要 Playwright；本机可用 `PLAYWRIGHT_PACKAGE` 指定安装位置，默认使用 Edge。Linux CI 设置 `PLAYWRIGHT_CHANNEL=chromium` 并安装相应浏览器。测试临时启动只读文件服务，核验桌面/手机的搜索、详情、来源、深链刷新及公开资产请求。

生产部署以对应提交的 Actions `build`、`deploy` 均成功且实际 Pages 地址可访问为准，不能仅凭本地构建成功认定上线。

2026-09-10 本地验收：消费端测试 95/95、独立平台探针 13/13、桌面/手机 Pages 浏览器测试 2/2，以及两种构建均通过。浏览器中的异常输入仅由请求拦截注入；工作流在浏览器测试之后重新生成正式静态快照再上传，不发布测试时间或异常输入。

参考：[GitHub 官方自定义 Pages 工作流文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
