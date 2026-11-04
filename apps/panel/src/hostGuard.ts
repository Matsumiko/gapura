import { aliasRedirect } from "@gapura/shared/host-guard";

/**
 * Panel di host alias (mis. *.pages.dev) tidak bisa memakai cookie __Host
 * milik domain kanonik. Alihkan sebelum React dimuat.
 */
export function installHostGuard(): void {
  const target = aliasRedirect(
    window.location.hostname,
    window.location.pathname,
    window.location.search,
    window.location.hash,
    import.meta.env.VITE_CANONICAL_ORIGIN,
    import.meta.env.VITE_ALIAS_HOST,
  );
  if (target) {
    window.location.replace(target);
  }
}
