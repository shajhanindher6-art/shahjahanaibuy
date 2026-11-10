'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * PWA install prompt (S2#29 / Section 3 item 9).
 *
 * Listens for the browser's `beforeinstallprompt` event (Chromium
 * desktop + Android). The prompt is HONEST and dismissible:
 * - It only appears when the browser itself offers installation
 *   (no fake "Install our app" button when install is impossible).
 * - It never claims the app works fully offline: only pages the
 *   visitor has already opened are cached (see public/sw.js and
 *   docs/pwa.md). Live prices always need a connection.
 * - Dismissing it hides it for this browser (localStorage flag);
 *   the browser may still offer its own install UI.
 * - In standalone / installed mode, or on browsers without
 *   beforeinstallprompt (e.g. iOS Safari), nothing renders.
 *
 * No permission changes: installation is a user gesture, and the
 * service worker only caches same-origin pages/assets.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'sb-pwa-install-dismissed';

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Already installed (standalone) or previously dismissed → never show.
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) return;
    if (window.localStorage.getItem(DISMISS_KEY) === '1') return;

    const onBeforeInstall = (event: Event) => {
      // Prevent the browser's automatic mini-infobar so we show our
      // own dismissible card instead (one prompt, not two).
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setDeferred(null);
      setVisible(false);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    // Accepted → the browser installs and fires `appinstalled`
    // (hides the card). Dismissed → hide for this browser too.
    if (choice.outcome === 'dismissed') {
      window.localStorage.setItem(DISMISS_KEY, '1');
    }
    setDeferred(null);
    setVisible(false);
  };

  if (!visible || !deferred) return null;

  return (
    <Card
      role="dialog"
      aria-label="Install SmartBuy AI"
      className="fixed bottom-4 left-4 z-40 w-[calc(100vw-2rem)] max-w-sm p-4 text-card-foreground shadow-lg animate-fade-in motion-reduce:animate-none"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Download className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Install SmartBuy AI</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add SmartBuy AI to your home screen for faster access. Pages
            you have already visited keep working offline; live prices
            need a connection.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={install}>
              Install
            </Button>
            <Button size="sm" variant="outline" onClick={dismiss}>
              Not now
            </Button>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
