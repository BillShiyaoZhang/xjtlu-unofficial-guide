'use client';

import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

export function PwaRuntime() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const updateOnlineState = () => setOnline(navigator.onLine);
    updateOnlineState();
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);

    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });
    }

    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-amber-700/20 bg-amber-500/12 px-4 py-2 text-center text-xs font-semibold leading-5 text-amber-950"
    >
      <WifiOff aria-hidden="true" className="size-4 shrink-0" />
      当前离线。重新联网后才能获取最新核验答案或提交反馈。
    </div>
  );
}
