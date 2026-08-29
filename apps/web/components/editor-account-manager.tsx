'use client';

import { Check, Copy, Loader2, UserPlus } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EDITOR_ROLES, type EditorRole } from '@/lib/editor-access-model';
import { formatDateTime } from '@/lib/presentation';

type Account = {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  lastLoginAt: number | null;
  createdAt: number;
  roles: EditorRole[];
  activeSessions: number;
};

type Activation = {
  initialPassword: string;
  totpSecret: string;
  totpUri: string;
  recoveryCodes: string[];
};

const roleLabels: Record<EditorRole, string> = {
  content_editor: '内容编辑',
  content_reviewer: '内容审核',
  pilot_operator: '试点运营',
  safety_reviewer: '安全处置',
  account_admin: '账号管理',
  operations_admin: '运行维护',
};

export function EditorAccountManager({ initial }: { initial: Account[] }) {
  const [accounts, setAccounts] = useState(initial);
  const [activation, setActivation] = useState<Activation | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function createAccount(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setActivation(null);
    const form = new FormData(event.currentTarget);
    const roles = EDITOR_ROLES.filter((role) => form.get(role) === 'on');
    try {
      const response = await fetch('/v1/editor/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          displayName: form.get('displayName'),
          roles,
        }),
      });
      const payload = (await response.json()) as {
        data?: { account: Account; activation: Activation };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message ?? '无法创建账号。');
      }
      setActivation(payload.data.activation);
      setAccounts((current) => [
        {
          ...payload.data!.account,
          status: 'active',
          mustChangePassword: true,
          lastLoginAt: null,
          createdAt: Math.floor(Date.now() / 1_000),
          activeSessions: 0,
        },
        ...current,
      ]);
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法创建账号。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <form
        onSubmit={createAccount}
        className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <UserPlus className="size-5" />
          </span>
          <div>
            <h2 className="font-heading text-xl font-semibold">创建编辑账号</h2>
            <p className="text-xs text-muted-foreground">
              初始密码、验证器密钥和恢复码只显示这一次。
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            姓名
            <Input
              name="displayName"
              required
              minLength={2}
              maxLength={80}
              className="mt-2 min-h-11"
            />
          </label>
          <label className="text-sm font-semibold">
            工作邮箱
            <Input
              name="email"
              type="email"
              required
              className="mt-2 min-h-11"
            />
          </label>
        </div>
        <fieldset className="mt-5">
          <legend className="text-sm font-semibold">职责权限</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {EDITOR_ROLES.map((role) => (
              <label
                key={role}
                className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"
              >
                <input
                  type="checkbox"
                  name={role}
                  defaultChecked={role === 'content_editor'}
                  className="size-4 accent-primary"
                />
                {roleLabels[role]}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" size="lg" className="mt-5" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
          创建并生成交接资料
        </Button>
        {message ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {message}
          </p>
        ) : null}
      </form>

      {activation ? <ActivationCard activation={activation} /> : null}

      <section aria-labelledby="accounts-heading">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h2
            id="accounts-heading"
            className="font-heading text-2xl font-semibold"
          >
            已有账号
          </h2>
          <span className="text-xs text-muted-foreground">
            {accounts.length} 个
          </span>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {accounts.map((account) => (
            <AccountEditor
              key={account.id}
              account={account}
              onChange={(next) =>
                setAccounts((current) =>
                  current.map((item) => (item.id === next.id ? next : item)),
                )
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ActivationCard({ activation }: { activation: Activation }) {
  const [copied, setCopied] = useState(false);
  const bundle = [
    `初始密码：${activation.initialPassword}`,
    `验证器密钥：${activation.totpSecret}`,
    '恢复码：',
    ...activation.recoveryCodes,
  ].join('\n');
  return (
    <section className="rounded-2xl border border-emerald-700/25 bg-emerald-500/8 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-semibold">一次性交接资料</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            请通过可信渠道交给本人；离开本页后无法恢复。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(bundle);
            setCopied(true);
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? '已复制' : '复制全部'}
        </Button>
      </div>
      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold">初始密码</dt>
          <dd className="mt-1 break-all rounded-lg bg-background p-3 font-mono">
            {activation.initialPassword}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">验证器密钥</dt>
          <dd className="mt-1 break-all rounded-lg bg-background p-3 font-mono">
            {activation.totpSecret}
          </dd>
        </div>
      </dl>
      <div className="mt-4">
        <p className="text-sm font-semibold">一次性恢复码</p>
        <div className="mt-2 grid gap-2 rounded-lg bg-background p-3 font-mono text-xs sm:grid-cols-2">
          {activation.recoveryCodes.map((code) => (
            <span key={code}>{code}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function AccountEditor({
  account,
  onChange,
}: {
  account: Account;
  onChange: (account: Account) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const roles = EDITOR_ROLES.filter((role) => form.get(role) === 'on');
    const status = form.get('status') === 'disabled' ? 'disabled' : 'active';
    try {
      const response = await fetch(`/v1/editor/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roles, status, reason: form.get('reason') }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message ?? '保存失败。');
      onChange({ ...account, roles, status, activeSessions: 0 });
      setMessage('已保存；该账号原有会话已撤销。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={save}
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{account.displayName}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{account.email}</p>
        </div>
        <Badge variant={account.status === 'active' ? 'secondary' : 'outline'}>
          {account.status === 'active' ? '启用' : '停用'}
        </Badge>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        最近登录：
        {account.lastLoginAt
          ? formatDateTime(account.lastLoginAt)
          : '从未'} ·
        活跃会话 {account.activeSessions}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {EDITOR_ROLES.map((role) => (
          <label key={role} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name={role}
              defaultChecked={account.roles.includes(role)}
              className="size-4 accent-primary"
            />
            {roleLabels[role]}
          </label>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[9rem_1fr]">
        <select
          name="status"
          defaultValue={account.status}
          className="min-h-11 rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="active">启用</option>
          <option value="disabled">停用</option>
        </select>
        <Input
          name="reason"
          required
          minLength={6}
          maxLength={300}
          placeholder="变更理由（至少 6 个字符）"
          className="min-h-11"
        />
      </div>
      <Button type="submit" variant="outline" className="mt-4" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : null}
        保存账号设置
      </Button>
      {message ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
    </form>
  );
}
