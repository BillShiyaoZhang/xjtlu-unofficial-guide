'use client';

import { Check, Copy, KeyRound, Loader2, RotateCcw, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { PilotInvitationSummary } from '@/lib/pilot';
import { formatDateTime } from '@/lib/presentation';

type IssuedCredential = {
  inviteCode: string;
  participantRef: string;
  expiresAt: number;
};

export function PilotInvitationManager({
  invitations,
}: {
  invitations: PilotInvitationSummary[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [issued, setIssued] = useState<IssuedCredential | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [reissueExisting, setReissueExisting] = useState(false);

  async function issue(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('issue');
    setMessage('');
    setIssued(null);
    const form = new FormData(event.currentTarget);
    const inviteCode = randomInviteCode();
    const participantRef = reissueExisting
      ? String(form.get('participantRef') ?? '')
          .trim()
          .toLocaleUpperCase('en-US')
      : randomParticipantRef();
    try {
      const response = await fetch('/v1/editor/pilot-invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inviteCode,
          participantRef,
          mode: reissueExisting ? 'reissue' : 'new',
          recruitmentChannel: form.get('recruitmentChannel'),
          isTest: form.get('isTest') === 'on',
          adultVerified: form.get('adultVerified') === 'on',
        }),
      });
      const payload = (await response.json()) as {
        data?: PilotInvitationSummary;
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message ?? '无法签发邀请。');
      }
      setIssued({
        inviteCode,
        participantRef,
        expiresAt: payload.data.expiresAt,
      });
      setBusy(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法签发邀请。');
      setBusy(null);
    }
  }

  async function revoke(invitation: PilotInvitationSummary) {
    setBusy(invitation.id);
    setMessage('');
    try {
      const response = await fetch(
        `/v1/editor/pilot-invitations/${invitation.id}/revoke`,
        {
          method: 'POST',
          headers: { 'if-match': `"${invitation.lockVersion}"` },
        },
      );
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? '无法撤销邀请。');
      }
      setBusy(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法撤销邀请。');
      setBusy(null);
    }
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1_500);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]">
      <form
        onSubmit={issue}
        className="rounded-xl border border-border bg-card p-5 shadow-sm"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <KeyRound aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h3 className="font-heading text-lg font-semibold">
              签发一次性邀请
            </h3>
            <p className="text-xs text-muted-foreground">72 小时内可兑换</p>
          </div>
        </div>
        <label className="mt-5 block text-sm font-semibold">
          招募渠道
          <select
            name="recruitmentChannel"
            required
            defaultValue="campus"
            className="mt-2 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="campus">校园现场</option>
            <option value="student_group">学生社群</option>
            <option value="referral">参与者转介</option>
            <option value="other">其他合规渠道</option>
          </select>
        </label>
        <label className="mt-3 flex items-start gap-3 rounded-lg border border-border p-3 text-sm leading-6">
          <input
            type="checkbox"
            name="reissueExisting"
            checked={reissueExisting}
            onChange={(event) => setReissueExisting(event.target.checked)}
            className="mt-1 size-4 accent-primary"
          />
          <span>
            <span className="block font-semibold">补发给既有研究编号</span>
            <span className="text-xs text-muted-foreground">
              参与者退出设备后，用其线下保存的原编号补发；渠道和测试标记须与首次一致。
            </span>
          </span>
        </label>
        {reissueExisting ? (
          <label className="mt-3 block text-sm font-semibold">
            原研究编号
            <input
              name="participantRef"
              required
              pattern="PR-[A-Za-z0-9]{12,32}"
              minLength={15}
              maxLength={35}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="PR-…"
              className="mt-2 min-h-11 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm uppercase"
            />
          </label>
        ) : null}
        <label className="mt-4 flex items-start gap-3 rounded-lg bg-muted/55 p-3 text-sm leading-6">
          <input
            type="checkbox"
            name="adultVerified"
            required
            className="mt-1 size-4 accent-primary"
          />
          我已在线下核验该参与者成年，且没有录入证件或生日。
        </label>
        <label className="mt-3 flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="isTest"
            className="size-4 accent-primary"
          />
          测试邀请（永不进入正式指标）
        </label>
        <Button
          type="submit"
          size="lg"
          className="mt-5 min-h-11"
          disabled={busy !== null}
        >
          {busy === 'issue' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <KeyRound />
          )}
          {reissueExisting ? '补发邀请' : '生成邀请'}
        </Button>
      </form>

      <div className="space-y-4">
        {issued ? (
          <output className="block rounded-xl border border-emerald-800/20 bg-emerald-900/7 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-heading text-lg font-semibold">
                  仅此处显示完整凭证
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  有效至 {formatDateTime(issued.expiresAt)}；数据库只保存摘要。
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="关闭凭证"
                onClick={() => setIssued(null)}
              >
                <X />
              </Button>
            </div>
            <Credential
              label="研究编号"
              value={issued.participantRef}
              copied={copied === 'ref'}
              onCopy={() => void copy('ref', issued.participantRef)}
            />
            <Credential
              label="邀请代码"
              value={issued.inviteCode}
              copied={copied === 'invite'}
              onCopy={() => void copy('invite', issued.inviteCode)}
            />
          </output>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="font-heading font-semibold">最近邀请</h3>
            <span className="text-xs text-muted-foreground">
              {invitations.length} 条
            </span>
          </div>
          <div className="max-h-96 divide-y divide-border overflow-y-auto">
            {invitations.length ? (
              invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">
                        …{invitation.participantHint}
                      </span>
                      <Badge
                        variant={invitation.isTest ? 'outline' : 'secondary'}
                      >
                        {invitation.isTest ? '测试' : '正式'}
                      </Badge>
                      <Badge variant="outline">
                        {statusLabel(invitation.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {channelLabel(invitation.recruitmentChannel)} · 到期{' '}
                      {formatDateTime(invitation.expiresAt)}
                    </p>
                  </div>
                  {invitation.status === 'available' ||
                  invitation.status === 'redeemed' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void revoke(invitation)}
                    >
                      {busy === invitation.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <RotateCcw />
                      )}
                      撤销
                    </Button>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">
                尚未签发邀请
              </p>
            )}
          </div>
        </div>
      </div>
      {message ? (
        <p role="alert" className="text-sm text-destructive xl:col-span-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function Credential({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-4 rounded-lg bg-card p-3 ring-1 ring-foreground/10">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all text-sm">{value}</code>
        <Button type="button" size="icon-sm" variant="outline" onClick={onCopy}>
          {copied ? <Check /> : <Copy />}
          <span className="sr-only">复制{label}</span>
        </Button>
      </div>
    </div>
  );
}

function randomInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `pi1_${btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')}`;
}

function randomParticipantRef() {
  return `PR-${crypto.randomUUID().replaceAll('-', '').slice(0, 16).toLocaleUpperCase()}`;
}

function statusLabel(status: PilotInvitationSummary['status']) {
  return {
    available: '待兑换',
    redeemed: '已兑换',
    expired: '已过期',
    revoked: '已撤销',
  }[status];
}

function channelLabel(channel: PilotInvitationSummary['recruitmentChannel']) {
  return {
    campus: '校园现场',
    student_group: '学生社群',
    referral: '参与者转介',
    other: '其他渠道',
  }[channel];
}
