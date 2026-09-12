# 纸条公开内容采集记录（2026-09-10）

2026-09-12 更新：现已增加公开关键词搜索，定向发现 129 条去重线索，选中 22 条并逐个读取详情后收录。连同 3 篇其他公开经验构成第三批，当前共 64 条社区话题。新增清单见 [常见讨论记录](2026-09-12-common-discussions.md)；下文“第二批”数量保留为历史记录。

第二批已经导入 20 条来源整理：14 条提问／资源、4 条活动邀约、2 条校园情况反馈。默认 Pages 构建现在包含 39 条话题和原有 76 篇资料。尚未推送或部署。

## 实际尝试与结果

| 方法 | 结果 |
| --- | --- |
| 内置浏览器打开用户的纸条分享页 | 只渲染“纸条详情”，没有取得正文 |
| web 工具读取纸条链接 | 未取得正文 |
| PowerShell HTTP 读取公开 HTML | HTTP 200，发现公开脚本地址 |
| 静态分析公开 H5 脚本 | 确认 API 域名、详情、热门、最新和分区列表的 GET 路径；仅读取脚本文本，没有执行下载的代码 |
| 普通 HTTP GET 用户提供的帖子详情 | HTTP 200，成功读取；没有发送 Cookie、Bearer token 或签名 |
| 普通列表及分区列表 | 仅返回 2022 年的客户端升级通知，不能作为当前分区内容 |
| 最新列表及热门列表 | 带 `school: XJTLU`，HTTP 200；三页最新和一页热门共 60 条记录 |
| 内置浏览器小红书“西浦”搜索 | 显示“登录后查看搜索结果”；用户选择先处理其他来源 |
| 搜索引擎检索小红书 | 未取得可核验的笔记正文 |

路径来自 `https://h5.zhitiaox.com/static/js/index.4d33002d.js` 及它引用的公开分块。可读接口：

- `GET https://api.zhitiaox.com/message/<已知帖子 ID>`
- `GET https://api.zhitiaox.com/message/latest`
- `GET https://api.zhitiaox.com/message/latest?updatedAt=<上一页末条的更新时间>`
- `GET https://api.zhitiaox.com/message/hot`
- `GET https://api.zhitiaox.com/search/message/?q=<关键词>&startId=<上一页末条 ID>`（2026-09-12 从公开 `pages-search-searched.620de078.js` 确认）

脚本里的浏览器签名不是本次读取的必要条件。采集器不生成签名、不读取登录存储、不使用管理接口。公开分享页为什么没显示正文尚未确定；API 成功不代表 H5 页面已修复。访问 `robots.txt` 返回 404，此结果没有被解释为转载授权。

## 复用

```powershell
# 默认一页最新 + 一页热门；最多三页最新 + 一页热门
npm run collect:zhitiao -- --pages 3

# 按已知 ID 重读详情；每次最多 20 个，可重复 --post
npm run collect:zhitiao -- --post 6aa11d60bbfc85382f7b014e

# 按关键词发现线索；最多 8 个词、每词最多 3 页；不可与 --post 混用
npm run collect:zhitiao -- --query '申研' --query '中介' --query '给分' --pages 1

# 校验与导入本次整理好的批次；重复执行不会重复添加
npm run seed:cold-start -- --batch 2026-09-10-zhitiao.json --check
npm run seed:cold-start -- --batch 2026-09-10-zhitiao.json
npm run build:pages
npm run preview:pages
```

结果写入已忽略的 `community/.cold-start-cache/<读取时间>.json`，包含必要的候选正文与元数据，供本地筛选。请求串行间隔 1.2 秒、单次超时 20 秒、响应上限 2 MiB；遇到鉴权、限流、网络失败或响应结构变化即停止，无自动重试或代理切换。输出 `stopped: true` 时退出码为 1，并保留先前已读候选与失败状态。

候选投影只允许帖子 ID、原链接、学校、正文、原始时间、读取时间及内容哈希；不保存用户对象、昵称、头像、性别、年级、专业、IP 属地、图片、评论或互动数。初筛排除其他学校、删除标记、无正文和部分明显个人敏感内容；关键词过滤并不完备，所以候选文件不能直接导入或发布。随后逐条筛选与原创概括，保持来源的不确定性。

搜索模式返回 `discoveries`，逐条标记 `requiresDetailReread: true`，不会进入详情候选 `candidates`。公开搜索响应使用 `result` 数组，通常不包含 `deleted` 和 `updatedAt`；采集器不会补造删除状态，分页只使用响应末条的真实 ID。先编辑筛选，再用 `--post` 重读选中详情，确认正文和删除状态。搜索关键词限制为 1–40 字，跨关键词去重；鉴权、限流和响应异常沿用停止规则。新搜索结果中包含广告和个人敏感经历，初筛通过不等于适合收录。

本次列表 60 条记录中初筛省略 4 条、重复 1 条，得到 55 条候选；从中选出 20 条，再逐个 GET 详情，20 条均返回可读且未标记删除的正文。数据文件：

- `community/cold-start/2026-09-10-zhitiao.json`：可导入的原创摘要与话题。
- `community/cold-start/2026-09-10-zhitiao-evidence.json`：发现请求计数、20 条精确链接、原发布时间、读取时间、正文 SHA-256，无原帖全文。
- `community/cold-start/source-queue.json`：纸条与小红书的访问结论。

`accessedAt` 只代表本次读取时间；`publishedOn` 从原帖时间转换为北京时间日期。标题是编辑概括。原帖提问不是已核实答案，邀约不代表已经成行，个人抱怨不代表学校已确认事故。没有迁移账号、伪造评论、同步点赞或自动联系原作者。

固定批次适合冷启动和测试。未来原帖可能更新、删除或失效：重新读取时需复核现有摘要；导入脚本遇到相同 ID 的内容冲突会停止，不会覆盖维护者修订。此次没有建立自动监控。
