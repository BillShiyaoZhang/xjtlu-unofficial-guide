import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';

import { InstallAppRuntime } from '@/components/install-app-panel';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { PwaRuntime } from '@/components/pwa-runtime';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { getBuildPublicOrigin } from '@/lib/public-origin';

import './globals.css';

const geist = Geist({
  variable: '--font-geist',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(getBuildPublicOrigin()),
  applicationName: '西浦非官方指南',
  manifest: '/manifest.webmanifest',
  title: {
    default: '西浦非官方指南｜先核对来源，再做决定',
    template: '%s｜西浦非官方指南',
  },
  description:
    '编辑维护、公开只读的校园信息核验指南；每张答案标出适用范围、核验时间和来源。',
  referrer: 'same-origin',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      {
        url: '/icons/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  },
  appleWebApp: {
    capable: true,
    title: '西浦非官方指南',
    statusBarStyle: 'default',
  },
  other: { 'mobile-web-app-capable': 'yes' },
  robots: {
    index:
      process.env.NODE_ENV === 'production' &&
      getBuildPublicOrigin() !== 'https://xjtlu-guide.invalid',
    follow:
      process.env.NODE_ENV === 'production' &&
      getBuildPublicOrigin() !== 'https://xjtlu-guide.invalid',
  },
  openGraph: {
    title: '西浦非官方指南',
    description: '先核对来源，再做决定。',
    locale: 'zh_CN',
    type: 'website',
    images: [{ url: '/opengraph.png', width: 1200, height: 630 }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f7f3ea',
  colorScheme: 'light',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${geist.variable} min-h-screen min-h-dvh antialiased`}>
        <SiteHeader />
        <InstallAppRuntime />
        <PwaRuntime />
        {children}
        <SiteFooter />
        <MobileBottomNav />
      </body>
    </html>
  );
}
