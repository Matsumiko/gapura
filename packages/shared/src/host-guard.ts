export function aliasRedirect(
  hostname: string,
  pathname: string,
  search: string,
  hash: string,
  canonicalOrigin: string | undefined,
  aliasHost: string | undefined,
): string | null {
  const canonical = canonicalOrigin?.trim().replace(/\/+$/, "");
  const alias = aliasHost?.trim().toLowerCase();
  if (!canonical || !alias || hostname.toLowerCase() !== alias) {
    return null;
  }
  return `${canonical}${pathname || "/"}${search}${hash}`;
}
