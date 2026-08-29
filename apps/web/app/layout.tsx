import type { Metadata } from 'next';
import { Geist } from 'next/font/google';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';

import './globals.css';

const geist = Geist({
  variable: '--font-geist',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://xjtlu-guide.example'),
  title: {
    default: '西浦非官方指南｜先核对来源，再做决定',
    template: '%s｜西浦非官方指南',
  },
  description:
    '编辑维护、公开只读的校园信息核验指南；每张答案标出适用范围、核验时间和来源。',
  robots: { index: false, follow: false },
  openGraph: {
    title: '西浦非官方指南',
    description: '先核对来源，再做决定。',
    locale: 'zh_CN',
    type: 'website',
    images: [{ url: '/opengraph.png', width: 1200, height: 630 }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${geist.variable} min-h-screen antialiased`}>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
