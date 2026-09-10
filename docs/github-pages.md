# GitHub Pages 同步与只读部署

更新：2026-09-10。审核工作台在本地运行，GitHub Pages 展示同步后的公开内容，并提供跳转 GitHub 的公开投稿入口。

公开地址：[西浦非官方指南](https://billshiyaozhang.github.io/xjtlu-unofficial-guide/)。

## 补充、纠错与不同经验

读者可以从 Pages 打开[GitHub 投稿表单](https://github.com/BillShiyaoZhang/xjtlu-unofficial-guide/issues/new/choose)，使用 GitHub 账号提交新增信息、纠错或不同经验。表单及讨论位于公开仓库 `BillShiyaoZhang/xjtlu-unofficial-guide`；由用户在 GitHub 最终提交，提交后公开可见。Pages 不接收或保存投稿正文，也不替用户创建 Issue。

本地工作台的「GitHub 投稿」入口打开同一仓库的 Issues，供维护者分类、去重和关联来源。整理、采纳或关闭 Issue 不等于完成事实核验；不同时间、校区或条件下的经验可以并列保留。Issue 不会自动进入手册，也不会转存为本地私件。决定更新手册时，仍先在本地编辑相应修订并发布，再按下方流程同步。

投稿地址由 `community/pages.config.json` 的 `contributionsRepository` 配置，当前为 `BillShiyaoZhang/xjtlu-unofficial-guide`。投稿入口随页面构建发布；修改入口配置、表单或页面代码需要正常提交并部署这些文件，`sync:pages` 仍只提交公开内容快照。完整操作与维护约定见 [GitHub 投稿与整理](github-contributions.md)。

## 本地审核后同步

1. 运行 `npm run dev`，在本地 `/editor` 登录，核对文章正文和来源。
2. 勾选文章，选择「通过并发布」并提交。本地读者页随即展示通过审核的新修订，原稿和审核记录保留。
3. 在仓库根目录执行：

   ```powershell
   npm run sync:pages
   ```

4. 命令从当前本地演示运行库导出公开快照，校验并构建静态站点，再将快照作为独立提交推送至 `origin/main`。GitHub Actions 随后运行检查并部署 Pages；对应提交的 `build`、`deploy` 均成功后，刷新公开网站核对正文与版本。

同步需要本机现有 Git 凭据拥有仓库推送权限；不会要求将 GitHub 密钥填入公开页面。命令成功推送表示已交给 Actions，不能据此认定部署已经完成。受分支保护或远端更新影响而推送失败时，按报错处理后重新运行，不要强制推送覆盖远端历史。

默认读取当前工作台所用的本地演示库。只有明确操作独立生产运行库时才使用 `npm run sync:pages -- --production`，并按 [运行手册](platform-runtime.md) 配置该环境及密钥。

若只想检查导出内容，不向 GitHub 提交：

```powershell
npm run export:pages
npm run build:pages
```

`export:pages` 默认读取本地演示库，也可显式传 `--demo`；`--production` 选择独立生产运行库。导出文件固定为 `community/pages-reviewed.json`，构建输出为 `community/pages-dist`。导出和同步均不代替人工审核，不会替未通过的草稿执行发布。

## 导出内容与构建方式

Pages 是静态页面；公开投稿跳转至 GitHub，手册登录、审核及持久化由本地 Node 服务负责。原有邀请制私有线索仍在本地服务中处理，与 GitHub 公开投稿分别保存。同步读取运行库当前获准公开的内容，并生成限定字段的公开快照；它不上传数据库、运行库备份、账户、密码、会话、多因素密钥、内部审核意见、私件或研究数据。

`community/pages-reviewed.json` 使用 `mode: public-reviewed`，包括公开正文、逐句引用、主题与适用范围、公开核验说明、生成时间及内容摘要校验值。已人工确认的 AI 辅助内容保留原始来源类型，读者详情明确显示「AI 辅助初稿，经人工审核确认」。原有演示答案仅按 `community/pages.config.json` 的显式清单进入快照，并继续标注「演示内容」。仅保存过旧版「通过」意见、仍未发布的文章不会因此进入快照。

`npm run build:pages` 优先读取并校验此快照。快照存在但损坏时构建失败；快照合法但为空时展示空目录。两种情况都不会悄悄恢复旧演示内容。首次导出、尚无此文件时，构建仍按 `pages.config.json` 的 `public-demo` 清单，在内存中导入演示种子、执行平台发布校验并生成原有四张演示卡。构建阶段不连接本机数据库；GitHub Actions 只消费已经提交的公开快照。

两种模式共用静态阅读页面，支持目录、主题筛选、搜索、全文、来源和 hash 深链。相对资源兼容 `/xjtlu-unofficial-guide/` 项目子路径；页面不请求本地后台 API、认证或研究上报。点击投稿入口后，用户在 GitHub 完成登录、填写和提交。复核期限在阅读时重新检查，已过期的内容显示待复核提示。

静态站点保留同步时的状态。本地隐藏、撤回、更新文章或处置来源后，必须再次同步并完成部署，Pages 才能反映变化；已下载或缓存的副本无法收回。带有效期限的来源不得进入静态产物。自有方法说明链接会指向 Pages，不能携带本机地址。不要将需要即时撤回、限时授权或含个人资料的内容纳入静态发布路径。

## Git 提交范围

`sync:pages` 基于最新 `origin/main`，使用独立索引创建只含 `community/pages-reviewed.json` 变化的提交，再作普通快进推送。它不会把工作区里其他已暂存或未暂存修改带入提交，也不会切换分支、移动当前 `HEAD` 或改写当前暂存区。

因此，同步后 `origin/main` 可能领先本地分支，这是该同步方式的预期结果。日常再次同步无需先手动合并本地代码；后续开发时仍按正常代码审查流程处理本地分支与远端的差异。首次接入所需的构建脚本、前端与工作流应先随代码变更提交，后续同步只提交公开快照。

## Actions 部署

仓库 Settings / Pages 的 Source 设为 GitHub Actions。工作流 `.github/workflows/pages.yml` 在 `main` 推送及手动触发时构建部署；PR 只验证，不部署。它执行消费端回归、平台契约、服务端构建、Pages 构建和项目子路径下的浏览器验收。

构建作业只有仓库只读权限，部署作业才拥有 `pages:write` 和 `id-token:write`。官方 Actions 固定到核对过的提交。浏览器测试依赖安装在 runner 临时目录，不加入消费端运行依赖。浏览器测试之后重新构建正式静态产物，避免将测试夹具带入上传目录。

上传路径严格限定为 `community/pages-dist`，不是仓库根目录、`community`、`.runtime` 或旧 `apps/web`。不要添加数据库、密钥、迁移产物或私有备份，即使文件内容已加密也不能发布。Pages 即使来自私有仓库，也可能公开可访问；不能以 Git 仓库可见性代替站点访问控制。

`npm run build` 仍只构建服务端 UI，不能直接用于 Pages；公开静态构建始终使用 `npm run build:pages`。

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

上线验收须核对对应提交的 Actions 结果及实际 Pages 页面；仅有本地构建结果不能说明已上线。

参考：[GitHub 官方自定义 Pages 工作流文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
