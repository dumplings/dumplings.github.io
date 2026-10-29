/** Deliberately conservative unencoded ASCII segment; excludes traversal,
 * separators, percent escapes, query strings and fragments. */
export function isSafePathSegment(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

export function languageHref(base: string, urlSegment: string): string {
  if (!isSafePathSegment(urlSegment)) {
    throw new Error("Invalid language URL segment.");
  }
  if (!base.startsWith("/") || base.startsWith("//")) {
    throw new Error("Invalid site base path.");
  }
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const segments = prefix.slice(1, -1);
  if (segments !== "" && !segments.split("/").every(isSafePathSegment)) {
    throw new Error("Invalid site base path.");
  }
  return `${prefix}${urlSegment}/`;
}
