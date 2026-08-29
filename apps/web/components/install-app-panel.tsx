'use client';

import { CheckCircle2, Download, Share2, Smartphone } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type InstallSnapshot = {
  canPrompt: boolean;
  installed: boolean;
  isIos: boolean;
  standalone: boolean;
};

const initialSnapshot: InstallSnapshot = {
  canPrompt: false,
  installed: false,
  isIos: false,
  standalone: false,
};

let installPrompt: InstallPrompt | null = null;
let snapshot = initialSnapshot;
const listeners = new Set<() => void>();

function publish(patch: Partial<InstallSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return initialSnapshot;
}

async function install() {
  if (!installPrompt) return;
  await installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  installPrompt = null;
  publish({
    canPrompt: false,
    installed: choice.outcome === 'accepted' || snapshot.installed,
  });
}

export function InstallAppRuntime() {
  useEffect(() => {
    const navigatorWithStandalone = navigator as Navigator & {
      standalone?: boolean;
    };
    publish({
      standalone:
        window.matchMedia('(display-mode: standalone)').matches ||
        navigatorWithStandalone.standalone === true,
      isIos:
        /iphone|ipad|ipod/iu.test(navigator.userAgent) ||
        (/macintosh/iu.test(navigator.userAgent) &&
          navigator.maxTouchPoints > 1),
    });

    const handlePrompt = (event: Event) => {
      event.preventDefault();
      installPrompt = event as InstallPrompt;
      publish({ canPrompt: true });
    };
    const handleInstalled = () => {
      installPrompt = null;
      publish({ canPrompt: false, installed: true });
    };

    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  return null;
}

export function InstallAppPanel() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (state.standalone || state.installed) {
    return (
      <div className="rounded-2xl bg-[#dcebe5] p-4">
        <CheckCircle2 aria-hidden="true" className="size-6 text-[#0f594d]" />
        <p className="mt-4 font-heading font-semibold">
          {state.standalone ? '已作为应用打开' : '已添加到主屏幕'}
        </p>
        <p className="mt-1 text-xs leading-5 text-foreground/65">
          {state.standalone ? '当前使用独立窗口' : '可从主屏幕再次打开'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-[#dcebe5] p-4">
      <Smartphone aria-hidden="true" className="size-6 text-[#0f594d]" />
      <p className="mt-4 font-heading font-semibold">添加到主屏幕</p>
      {state.canPrompt ? (
        <Button
          type="button"
          size="sm"
          onClick={install}
          className="mt-3 min-h-10 rounded-xl"
        >
          <Download aria-hidden="true" />
          安装
        </Button>
      ) : (
        <p className="mt-1 flex gap-1.5 text-xs leading-5 text-foreground/65">
          {state.isIos ? (
            <Share2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          ) : null}
          {state.isIos ? '在 Safari 分享菜单中添加' : '使用浏览器菜单添加'}
        </p>
      )}
    </div>
  );
}
