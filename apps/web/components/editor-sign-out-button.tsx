'use client';

import { Loader2, LogOut } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

export function EditorSignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch('/v1/editor/session/exit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
    } finally {
      window.location.replace('/editor/login');
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="min-h-9"
      disabled={busy}
      onClick={() => void signOut()}
    >
      {busy ? <Loader2 className="animate-spin" /> : <LogOut />}
      退出
    </Button>
  );
}
