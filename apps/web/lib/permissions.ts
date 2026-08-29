export function parseEditorAllowlist(
  configured: string | undefined,
): Set<string> {
  return new Set(
    (configured ?? '')
      .split(',')
      .map((email) => email.trim().toLocaleLowerCase())
      .filter(Boolean),
  );
}

export function emailIsAllowlisted(
  email: string,
  configured: string | undefined,
): boolean {
  return parseEditorAllowlist(configured).has(email.trim().toLocaleLowerCase());
}
