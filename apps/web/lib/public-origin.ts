import { getRuntimeValue } from '@/db';

export function getPublicOrigin() {
  const configured = getRuntimeValue('PUBLIC_ORIGIN')?.trim() ?? '';
  try {
    const url = new URL(configured);
    if (
      url.protocol === 'https:' &&
      url.origin === configured.replace(/\/$/u, '')
    ) {
      return url.origin;
    }
  } catch {
    // Local development deliberately falls through to a non-public origin.
  }
  return 'http://localhost:3000';
}

export function getBuildPublicOrigin() {
  const configured = process.env.PUBLIC_ORIGIN?.trim() ?? '';
  try {
    const url = new URL(configured);
    if (
      url.protocol === 'https:' &&
      url.origin === configured.replace(/\/$/u, '')
    ) {
      return url.origin;
    }
  } catch {
    // Static metadata must stay non-indexable until a valid origin is supplied.
  }
  return 'https://xjtlu-guide.invalid';
}
