import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../panel/public/host-guard.js", import.meta.url).pathname,
  "utf8",
);

function redirects(hostname: string, pathname = "/", search = "", hash = ""): string[] {
  const calls: string[] = [];
  runInNewContext(source, {
    window: {
      location: {
        hostname,
        pathname,
        search,
        hash,
        replace: (url: string) => {
          calls.push(url);
        },
      },
    },
  });
  return calls;
}

describe("host guard panel", () => {
  it("mengalihkan alias pages.dev ke domain kanonik sambil mempertahankan path, query, dan hash", () => {
    expect(redirects("your-project.pages.dev", "/transactions/123", "?status=PAID", "#detail")).toEqual([
      "https://admin.example.com/transactions/123?status=PAID#detail",
    ]);
  });

  it("tidak mengalihkan domain kanonik sehingga tidak ada loop", () => {
    expect(redirects("admin-pay.example.com", "/audit")).toEqual([]);
  });

  it("tidak mengalihkan host lain (dev/preview)", () => {
    expect(redirects("localhost")).toEqual([]);
    expect(redirects("gapura-admin-preview.pages.dev")).toEqual([]);
  });

  it("mencocokkan host tanpa memedulikan kapitalisasi", () => {
    expect(redirects("GAPURA-ADMIN.PAGES.DEV", "/")).toEqual([
      "https://admin.example.com/",
    ]);
  });
});
