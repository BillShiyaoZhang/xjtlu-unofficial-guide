# [Platform] 提供不可变实体修订与固定版本证据引用模块

## 背景与阻塞

`xjtlu-unofficial-guide` 要将通用机制迁入本平台。评估基线为 main `6a567f4819e430f4e52993d72ebf747e4ea27c20` / core 0.2.0。

[GraphEdge](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/6a567f4819e430f4e52993d72ebf747e4ea27c20/packages/core/index.d.ts#L30) 只连接稳定节点 ID；[applyChange](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/6a567f4819e430f4e52993d72ebf747e4ea27c20/packages/core/index.js#L105) 对同 ID 执行替换，维护的是整图 revision。[接入说明](https://github.com/BillShiyaoZhang/decentralized-information-community/blob/6a567f4819e430f4e52993d72ebf747e4ea27c20/docs/extending.md#L29) 已明确要求固定版本引用的使用方先扩展协议。

整图历史快照是有价值的，但不等同于来源修订与答案修订之间的固定引用。即使把 revision 编码成独立节点或附加 JSON 字段，当前平台也不保证其不可变性或引用语义。

指南现有数据链为 `ArtifactRevision -> EvidenceSpan/LinkCitation -> SentenceCitation -> AnswerCardRevision`，SQL 触发器禁止改写修订/引用。若只转换成可变节点或单一 source URL，会丢失原有证据关系；若继续在指南实现这些底层机制，则不能完成分离。

## 请求

增加可选的版本化内容/证据模块或等效平台契约，不要求把校园名词硬编码到通用图协议。

1. 区分稳定实体 ID 与不可变 revision ID，支持父修订关系和按修订读取；当前公开指针与历史内容分离。
2. 固定引用精确的内容/来源修订及引用位置；来源新建修订后，历史答案仍能解析原来的证据。
3. 支持领域结构验证与证据模式。指南可配置逐句引用、链接型来源和允许保存摘录的来源；平台执行引用完整性和模式约束。
4. 版本化导入/导出保留外部 ID、修订号、父链、引用次序和扩展字段。旧 D1 映射由使用方完成，平台提供验证和原子导入接口。

## 验收

- [ ] 新建答案及来源修订后，旧版本内容与引用保持不变，能按原修订 ID 读取。
- [ ] 通过受支持写入/导入接口改写或删除不可变修订被拒绝；错误引用使整个操作回滚。
- [ ] 引用指向不存在的修订、跨错实体或不合法位置时返回可识别错误。
- [ ] 指南 profile 可拒绝无有效引用的事实句；link-only 模式不保存正文、截图或内容哈希，摘录模式要求对应权利。
- [ ] 使用方导入 fixture 可往返保留历史 ID、父链与证据关系，重复导入行为明确。
- [ ] 纯图功能保持可独立使用；治理扩展的版本和兼容边界有文档。

审核权限、发布事务和撤回后的公开读取由配套 issue 跟踪。本项关注版本和证据数据契约，不能仅以支持任意 JSON 扩展字段作为完成标准。
