'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, Share, X } from 'lucide-react';
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
 * - In standalone / installed mode, nothing renders.
 *
 * iOS (Section 14, P-1): Safari never fires beforeinstallprompt,
 * so iOS visitors used to get no guidance at all. On iPhone / iPad
 * (including iPadOS, which reports itself as Macintosh — detected
 * via maxTouchPoints) the card instead shows the manual steps:
 * Share → Add to Home Screen. It never claims an App Store
 * download exists — there is no native app yet (see
 * app/mobile-app/page.tsx) — and links to /mobile-app for the
 * full guide. Same dismiss flag as the Chromium card.
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
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    // Already installed (standalone) or previously dismissed → never show.
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) return;
    if (window.localStorage.getItem(DISMISS_KEY) === '1') return;

    // iOS Safari never fires beforeinstallprompt: show the manual
    // Share → Add to Home Screen steps instead of nothing. iPadOS
    // 13+ reports a Macintosh user agent, so touch points are the
    // tell there.
    const isIos =
      /iPad|iPhone|iPod/.test(window.navigator.userAgent) ||
      (window.navigator.platform === 'Macintosh' && window.navigator.maxTouchPoints > 1);
    if (isIos) {
      setShowIos(true);
      return;
    }

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
    setShowIos(false);
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

  if (showIos) {
    return (
      <Card
        role="dialog"
        aria-label="Install SmartBuy AI on iPhone or iPad"
        className="fixed bottom-4 left-4 z-40 w-[calc(100vw-2rem)] max-w-sm p-4 text-card-foreground shadow-lg animate-fade-in motion-reduce:animate-none"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Share className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Install SmartBuy AI on your iPhone or iPad</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Safari has no install button, so add it by hand — no App Store download: the
              website itself installs as an app.
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                Tap <strong>Share</strong> (the square with an arrow
                pointing up).
              </li>
              <li>
                Scroll down and tap <strong>Add to Home Screen</strong>,
                then <strong>Add</strong>.
              </li>
            </ol>
            <div className="mt-3 flex gap-2">
              <Button size="sm" asChild>
                <Link href="/mobile-app">Full install guide</Link>
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
