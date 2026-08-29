import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: '西浦非官方指南｜先核对来源，再做决定',
    short_name: '西浦非官方指南',
    description:
      '非官方、编辑维护的校园信息核验指南；每张答案标出适用范围、核验时间和来源。',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f3ea',
    theme_color: '#1f5c50',
    lang: 'zh-CN',
    categories: ['education', 'utilities'],
    prefer_related_applications: false,
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
