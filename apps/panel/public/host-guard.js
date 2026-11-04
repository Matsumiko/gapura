/*
 * Alias Pages (your-project.pages.dev) tidak bisa memakai cookie sesi
 * `__Host-gapura_admin` yang SameSite=Strict. Pindahkan ke domain kanonik
 * sebelum bundle panel berjalan, sambil mempertahankan path, query, dan hash.
 * Script ini hanya aktif di host alias, jadi tidak ada loop redirect.
 */
(function () {
  "use strict";

  var CANONICAL_ORIGIN = "https://admin.example.com";
  var ALIAS_HOST = "your-project.pages.dev";

  var location = window.location;
  if (String(location.hostname).toLowerCase() !== ALIAS_HOST) {
    return;
  }

  location.replace(
    CANONICAL_ORIGIN + location.pathname + location.search + location.hash,
  );
})();
