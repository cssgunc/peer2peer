import { revalidateTag } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { POST } from "./route";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const SECRET = "test-revalidate-secret";

function call(body: unknown, secret?: string | null) {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret != null) {
    headers.set("x-revalidate-secret", secret);
  }
  return POST(
    new Request("http://localhost/api/revalidate", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("REVALIDATE_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(revalidateTag).mockClear();
});

describe("POST /api/revalidate", () => {
  it("returns 401 when the secret header is missing", async () => {
    const response = await call({ tags: ["faqs"] }, null);
    expect(response.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong secret of the same length", async () => {
    const wrong = "x".repeat(SECRET.length);
    const response = await call({ tags: ["faqs"] }, wrong);
    expect(response.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong secret of a different length without throwing", async () => {
    const response = await call({ tags: ["faqs"] }, "short");
    expect(response.status).toBe(401);
  });

  it.each([undefined, ""])(
    "returns 401 when REVALIDATE_SECRET is %j",
    async (value) => {
      vi.stubEnv("REVALIDATE_SECRET", value);
      const response = await call({ tags: ["faqs"] }, "");
      expect(response.status).toBe(401);
      expect(revalidateTag).not.toHaveBeenCalled();
    },
  );

  it("checks the secret before the body", async () => {
    const response = await call({ tags: ["unknown"] }, "wrong");
    expect(response.status).toBe(401);
  });

  it.each([
    ["an unknown tag", { tags: ["faqs", "accounts"] }],
    ["an empty list", { tags: [] }],
    ["a missing tags field", {}],
    ["tags that aren't a list", { tags: "faqs" }],
    ["a non-string tag", { tags: [1] }],
    ["a JSON array body", ["faqs"]],
    ["malformed JSON", "{not json"],
  ])("returns 400 for %s", async (_label, body) => {
    const response = await call(body, SECRET);
    expect(response.status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("revalidates each allowed tag and returns 204", async () => {
    const response = await call({ tags: [...CACHE_TAGS] }, SECRET);
    expect(response.status).toBe(204);
    expect(revalidateTag).toHaveBeenCalledTimes(CACHE_TAGS.length);
    for (const tag of CACHE_TAGS) {
      expect(revalidateTag).toHaveBeenCalledWith(tag, { expire: 0 });
    }
  });

  it("revalidates a repeated tag once", async () => {
    const response = await call({ tags: ["faqs", "faqs"] }, SECRET);
    expect(response.status).toBe(204);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });
});
