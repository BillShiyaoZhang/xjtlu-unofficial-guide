const PILOT_NOTICE_CONTENT = {
  sections: [
    {
      term: '研究目的',
      detail:
        '验证带来源的答案卡能否帮助成年参与者完成校园信息查找；本项目非校方研究。',
    },
    {
      term: '记录什么',
      detail:
        '记录随机研究 ID、查询长度档、筛选、结果数与排序、答案打开、分享和反馈；自动检索不保存问题正文，除非你在私有线索页看见并再次明确提交。IP 只在内存中短时转为限流指纹，不写入研究数据。',
    },
    {
      term: '期限与撤回',
      detail:
        '会话最长 28 天，私有线索最长 30 天，研究交互事件最长 120 天；届时删除事件并清除直接研究编号与邀请码映射。最小同意/审计时间和渠道仍在受限库中，可能间接回溯；若完整版说明未写明其准确期限，请勿加入。可随时撤回并立即清理产品研究关联与私有载荷。',
    },
    {
      term: '风险与联系',
      detail:
        '没有保证的直接收益。请勿提交个人信息；若招募人员未提供完整版说明、负责人联系方式和投诉渠道，请勿加入。',
    },
  ],
  consent:
    '我已阅读本页摘要及招募人员提供的完整版研究说明，有机会提问，自愿同意参与阶段 1 产品试用，并知道可以随时撤回。',
} as const;

export const PILOT_NOTICE_VERSION = `stage1-v3-${noticeFingerprint(
  PILOT_NOTICE_CONTENT,
)}`;

export const PILOT_NOTICE = {
  version: PILOT_NOTICE_VERSION,
  ...PILOT_NOTICE_CONTENT,
} as const;

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function noticeFingerprint(value: unknown) {
  const text = JSON.stringify(value);
  let left = 0x81_1c_9d_c5;
  let right = 0x9e_37_79_b9;
  for (const character of new TextEncoder().encode(text)) {
    left = Math.imul(left ^ character, 0x01_00_01_93);
    right = Math.imul(right ^ character, 0x85_eb_ca_6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}
