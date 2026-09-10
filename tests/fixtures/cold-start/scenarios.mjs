// Synthetic scenarios for the dedicated local preview only. Never import from production content.
export const fixtureRepository = 'cold-start-preview/synthetic-fixtures';
export const previewDisclosure = '【测试样例】本页新增话题、投稿、回复与人物均为合成，仅供界面测试，不是真实校园消息。所有外跳与发布均已停用。';

export function createColdStartFixtures({ now = Date.now() } = {}) {
  const epoch = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(epoch)) throw new TypeError('cold-start fixture now must be a valid timestamp');
  const at = hours => new Date(epoch + hours * 3600000).toISOString();
  const topic = (id, title, kind, metadata = {}) => ({
    id: `test-${id}`, catalogTopicId: kind === 'question' ? 'topic-study' : 'topic-campus',
    title: `【测试样例】${title}`, prompt: '合成场景，仅测试展示与交互；时间、地点和经过均不代表真实情况。',
    kind, editorial: true, createdAt: at(-48), ...metadata,
  });
  const registration = { registrationStatus: 'open', registrationStartsAt: at(-24), registrationEndsAt: at(48),
    registrationUrl: 'https://example.com/synthetic-registration', confirmedAt: at(-1) };
  const topics = [
    topic('question', '选课前，你会怎样准备？', 'question'),
    topic('event-open', '资料交流会 · 报名开放', 'event', { event: { status: 'scheduled', startsAt: at(72), endsAt: at(74), ...registration } }),
    topic('event-closed', '写作练习坊 · 报名截止', 'event', { event: { status: 'scheduled', startsAt: at(72), endsAt: at(74), ...registration, registrationEndsAt: at(-1) } }),
    topic('event-postponed', '校园摄影散步 · 延期', 'event', { event: { status: 'postponed', startsAt: at(24), confirmedAt: at(-1) } }),
    topic('event-rescheduled', '学习工具分享 · 改期', 'event', { event: { status: 'rescheduled', previousStartsAt: at(24), startsAt: at(96), endsAt: at(98), ...registration } }),
    topic('event-cancelled', '户外交流活动 · 取消', 'event', { event: { status: 'cancelled', startsAt: at(24), endsAt: at(26), confirmedAt: at(-1) } }),
    topic('event-past', '读书小聚 · 计划时间已过', 'event', { event: { status: 'scheduled', startsAt: at(-26), endsAt: at(-24), confirmedAt: at(-48) } }),
    topic('incident-ongoing', '模拟设施维护 · 仍有影响', 'incident', { incident: { status: 'ongoing', occurredAt: at(-5), updatedAt: at(-2), confirmedAt: at(-2), summary: '【测试样例】虚构维护场景，用于检查持续影响状态。' } }),
    topic('incident-resolved', '模拟服务恢复 · 已解决', 'incident', { incident: { status: 'resolved', occurredAt: at(-24), updatedAt: at(-2), confirmedAt: at(-2), summary: '【测试样例】虚构恢复记录，用于检查解决状态与历史收纳。' } }),
    topic('incident-unknown', '模拟地点变化 · 待确认', 'incident', { incident: { status: 'unknown', occurredAt: at(-3), updatedAt: at(-1), summary: '【测试样例】未确认的虚构消息，时间经过不意味着问题已解决。' } }),
  ];
  const discussions = {
    'test-question': [
      '【测试样例】准备示例课程 TEST101 时，我先把示例提纲里的陌生词列出来，再找一道入门练习试做。原以为最缺的是背景阅读，动手后才发现自己连练习工具都不熟。',
      '后来我把准备清单缩成三项：跑通一个小例子、记下两个具体问题、给第一次练习留一段完整时间。没有从头看完一整本书，反而比较容易开始。',
      '这是虚构学生的一种准备经历。你会先看提纲、试做练习，还是先问修过类似内容的人？也想听听基础不一样时怎么安排。',
    ],
    'test-event-open': [
      '【测试样例】我准备参加这场示例资料交流会，打算带一页自己整理的 TEST101 术语表，看看别人怎样把长笔记压缩成能复习的内容。',
      '页面目前显示报名开放。我想先确认：示例环节是每个人轮流讲，还是分成小组互相看资料？如果只是旁听，是否也需要准备一份样稿？这里讨论的安排都属于虚构活动，报名入口仅供演示。',
    ],
    'test-event-closed': [
      '【测试样例】刚整理好想带去写作练习坊的示例段落，就发现已经过了报名截止时间，页面也不再显示可用的报名按钮。',
      '我主要想练习把一个很长的段落拆成论点和例子。如果这个示例活动后续有公开练习题，能否在这里补一个入口？目前没有候补或追加名额的确认信息，先不把它们当成可行安排。',
    ],
    'test-event-postponed': [
      '【测试样例】原先约好的示例摄影散步延期了。我把旧的集合提醒取消了，但还没加新的，因为目前只知道“延期”，不知道新日期。',
      '本来想练习同一位置在不同光线下的构图，器材已经收好，可以等新时间确定后再安排。若后续有人补充，请把新时间和确认出处一起放上来，旧海报上的时间容易让人误会。',
    ],
    'test-event-rescheduled': [
      '【测试样例】这场示例学习工具分享改到了页面上方的新计划时间，原定时间也保留着，方便对照。我已经按新时间调整了自己的演练日历。',
      '我想听的部分是：怎样把一份 TEST101 练习笔记变成可检索的小清单。还不清楚示例议程和原报名是否沿用；时间改了，不等于这些安排也都确认了。',
    ],
    'test-event-cancelled': [
      '【测试样例】示例户外交流活动已经取消，我把原来的出行计划撤掉了。之前讨论过的路线仍留在这里，之后查记录时可以看出大家为什么做过这些准备。',
      '暂时没有补办日期。如果以后另办一场，希望单独写清新安排；这条取消记录本身不能当成新的活动通知。',
    ],
    'test-event-past': [
      '【测试样例】页面上的读书小聚计划结束时间已经过去了，但我没有到场，也没看到能确认举办情况的后续记录。',
      '我手头有一页为这次示例活动准备的阅读问题：作者的主要判断是什么、用了什么例子、哪一点还需要证据。这是个人准备材料，不能用来证明活动实际举行。若有后续记录，可以补充是否举办、实际讨论了什么。',
    ],
    'test-incident-ongoing': [
      '【测试样例】在虚构的“示例楼 A 区”，我试过靠窗的两台练习终端：同一份测试文件都停在加载画面。换到门边的一台后能打开，所以目前观察到的影响范围只是前面两台。',
      '最新记录仍有影响。我没有逐台检查，也不知道其他区域是否一样；如果补充观察，写明“哪台、做了什么操作、是否重试”会比一句“都坏了”更容易核对。',
    ],
    'test-incident-resolved': [
      '【测试样例】示例文件服务恢复后，我用昨天失败的同一份测试文件重试，预览和下载这两步都完成了。记录中的“已解决”指这次模拟故障已有确认恢复的更新。',
      '我的复测只覆盖这一份文件和这两个操作，没有检查所有设备或其他功能。如果另一个操作仍然失败，可以把新现象接着记下来，不必把一次复测理解成所有问题都消失了。',
    ],
    'test-incident-unknown': [
      '【测试样例】有人在示例讨论里转述“活动从示例房间 A 换到了 B”，但我目前只看到了这句转述，没找到原始变更说明。旧海报仍写着 A，也没有注明更新时间。',
      '现在能确认的是两个说法不一致，不能确认最终地点。有没有人能补上带时间的原说明？在找到依据前，这里先保留待确认状态。',
    ],
  };
  const replyBodies = [
    '【测试样例】你试做 TEST101 入门练习时，怎样判断是工具问题还是概念没理解？我也会先动手，但卡住后容易同时开太多教程。能否举一个你最后保留在问题清单里的具体问题？',
    '【测试样例】我也准备了一页样稿，是把三个容易混淆的示例概念放在一起比较。如果采用小组交流，我可以先讲最不确定的一处；旁听是否需要材料，仍等示例安排确认。',
    '【测试样例】我也想看练习题，尤其是修改前后的对照。可以先把“希望有公开材料”留作需求；目前这条回复没有新增名额或候补开放的消息。',
    '【测试样例】我保存的也是旧海报，里面只有原时间。先把它标成旧安排，等新日期有依据后再更新，避免有人照着旧截图出发。',
    '【测试样例】新时间和我的示例练习安排不冲突了。你提到原报名是否沿用，这个问题很实际；如果收到答复，建议同时写明答复针对哪一场，免得和另一个示例分享会混在一起。',
    '【测试样例】收到取消信息，我也撤掉了同行提醒。路线笔记可以保留作讨论背景，但如果有人以后发起新活动，请另外给出日期和确认记录。',
    '【测试样例】这三个阅读问题即使活动未举办也能单独讨论。我同样没有现场记录，先不补写参加人数或活动总结；希望后续能有人说明实际情况。',
    '【测试样例】在这个虚构场景里，我补测了门边第二台终端，同一份测试文件可以打开。这只增加了一个可用位置的观察，不能说明靠窗两台已经恢复，也不能推到整个示例楼。',
    '【测试样例】我在另一台示例设备上也完成了同一文件的预览，但没有测试下载。因此我的补充只支持“预览可用”，下载结果仍以你记录的那次复测为范围。',
    '【测试样例】我手里的截图也没有日期，不能用它判断 A 和 B 哪个更新。如果能找到原消息，请同时保留发布时间和所指活动名称，单独一个房间名容易串场。',
    '【测试样例】你把了解学习形式放在前面，这和第一条先试做练习的路径很不一样。如果拿到的 TEST101 示例提纲没有具体任务，你会先问一个什么问题来判断自己的准备重点？',
  ];
  const issues = topics.map((row, index) => ({
    number: index + 1, title: `【测试样例】关于「${row.title.replace('【测试样例】', '')}」的合成讨论`,
    body: `<!-- xjtlu-topic:${row.id} -->\n共建话题：${row.title}\n知识分类 ID：${row.catalogTopicId}\n\n### 我的分享\n\n${discussions[row.id].join('\n\n')}\n\n### 公开提交确认\n\n我知道在 GitHub 确认提交后，我的 GitHub 用户名和这段正文会公开。`,
    state: 'open', comments: 1, html_url: `https://github.com/${fixtureRepository}/issues/${index + 1}`,
    user: { login: 'test-fixture-author' }, created_at: at(-12 - index), updated_at: at(-0.5),
  }));
  issues.push({ ...issues[0], number: 11, title: '【测试样例】另一种准备方式（已关闭讨论）',
    body: '<!-- xjtlu-topic:test-question -->\n\n【测试样例】我的准备顺序相反。面对 TEST101 这样的示例课程，我会先看学习形式：需要独立完成什么、哪里会涉及讨论、最后要交出怎样的作品。比起提前做很多练习，我更想先弄清一周怎样分配时间。\n\n在这个虚构经历里，我只提前读了两页示例材料，把读不懂的地方圈出来；第一轮接触后再决定补什么。这个办法适合我当时基础较弱、容易因为预习范围太大而拖延的情况，不一定适合所有人。\n\n这条示例讨论已关闭，但关闭不代表这种准备方式被编辑采纳。',
    state: 'closed', comments: 1, html_url: `https://github.com/${fixtureRepository}/issues/11`, user: { login: 'test-fixture-alternative' } });
  const replies = Object.fromEntries(issues.map(issue => [issue.number, [{
    id: 1000 + issue.number, body: replyBodies[issue.number - 1],
    user: { login: 'test-fixture-reply' }, created_at: at(-1), updated_at: at(-1),
    html_url: `${issue.html_url}#issuecomment-${1000 + issue.number}`,
  }]]));
  return { now: new Date(epoch).toISOString(), topics: { schemaVersion: 1, topics }, issues, replies };
}
