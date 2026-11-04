import { describe, expect, it } from "vitest";
import { aliasRedirect } from "@gapura/shared/host-guard";

const CANONICAL = "https://admin.example.com";
const ALIAS = "your-project.pages.dev";

describe("host guard panel", () => {
  it("mengalihkan alias Pages ke domain kanonik sambil mempertahankan path, query, dan hash", () => {
    expect(aliasRedirect(ALIAS, "/transactions/123", "?status=PAID", "#detail", CANONICAL, ALIAS)).toBe(
      "https://admin.example.com/transactions/123?status=PAID#detail",
    );
  });

  it("tidak mengalihkan domain kanonik sehingga tidak ada loop", () => {
    expect(aliasRedirect("admin.example.com", "/audit", "", "", CANONICAL, ALIAS)).toBeNull();
  });

  it("tidak mengalihkan host lain atau konfigurasi kosong", () => {
    expect(aliasRedirect("localhost", "/", "", "", CANONICAL, ALIAS)).toBeNull();
    expect(aliasRedirect("your-project-preview.pages.dev", "/", "", "", CANONICAL, ALIAS)).toBeNull();
    expect(aliasRedirect(ALIAS, "/", "", "", "", ALIAS)).toBeNull();
    expect(aliasRedirect(ALIAS, "/", "", "", CANONICAL, "")).toBeNull();
  });

  it("mencocokkan host tanpa memedulikan kapitalisasi dan slash akhir", () => {
    expect(aliasRedirect("YOUR-PROJECT.PAGES.DEV", "/", "", "", `${CANONICAL}/`, ALIAS)).toBe(
      "https://admin.example.com/",
    );
  });
});
