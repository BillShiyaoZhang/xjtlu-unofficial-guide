import { headers } from 'next/headers';

import { getPilotSessionFromCookieHeader } from './pilot';

export async function getPilotSessionForPage() {
  const requestHeaders = await headers();
  return getPilotSessionFromCookieHeader(requestHeaders.get('cookie'));
}
