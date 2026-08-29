export async function isTrustedIdentityBoundary(input: {
  nodeEnv: string | undefined;
  host: string;
  configuredSecret: string;
  presentedSecret: string;
}) {
  if (input.configuredSecret.length >= 32) {
    return secretsMatch(input.configuredSecret, input.presentedSecret);
  }
  if (input.nodeEnv === 'production') return false;

  const host = input.host.toLocaleLowerCase('en-US');
  return (
    host === 'localhost' ||
    host.startsWith('localhost:') ||
    host === '127.0.0.1' ||
    host.startsWith('127.0.0.1:') ||
    host === '[::1]' ||
    host.startsWith('[::1]:')
  );
}

async function secretsMatch(expected: string, actual: string) {
  const [expectedDigest, actualDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(actual)),
  ]);
  const expectedBytes = new Uint8Array(expectedDigest);
  const actualBytes = new Uint8Array(actualDigest);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= expectedBytes[index] ^ actualBytes[index];
  }
  return difference === 0;
}
