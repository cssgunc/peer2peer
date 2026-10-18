import { describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "./api";

describe("apiFetch", () => {
  // JSON Sucess
  it("JSON success", async () => {
    const fakeData = { name: "Joe" };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fakeData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await apiFetch("/api/users");

    expect(result).toEqual(fakeData);

    vi.unstubAllGlobals();
  });

  // 204 Error
  it("204 no content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 204,
        }),
      ),
    );
    const result = await apiFetch("/api/users");

    expect(result).toBeUndefined();

    vi.unstubAllGlobals();
  });

  // Test an API Error
  it("API Error", async () => {
    const fakeData = {
      code: "INVALID_INPUT",
      detail: "Invalid user information",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fakeData), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const promise = apiFetch("/api/users");
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      status: 400,
      code: "INVALID_INPUT",
    });

    vi.unstubAllGlobals();
  });

  // 502 Error
  it("502 error, non-JSON error", async () => {
    const fakeHTML = "<html><body>502 Bad Gateway </body><html>";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(fakeHTML, {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );
    const promise = apiFetch("/api/users");
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      status: 502,
    });

    vi.unstubAllGlobals();
  });
});
