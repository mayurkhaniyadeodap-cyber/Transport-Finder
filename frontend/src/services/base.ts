/** Prefixes an app-relative "/api/..." URL with the path the app is served from (Vite's `base`,
 * e.g. "/transport-finder/" in production), so the app also works under a sub-path such as
 * https://care.deodap.info/transport-finder/. With the default base "/" URLs are unchanged. */
export function withBase(url: string): string {
  if (!url.startsWith("/api/")) return url;
  return import.meta.env.BASE_URL.replace(/\/$/, "") + url;
}
