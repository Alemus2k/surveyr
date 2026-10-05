import { afterEach, describe, expect, test, vi } from "vitest";
import { apiBase, deleteProject, uploadScan, waitForBackend } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("apiBase", () => {
  test("uses the dev-server proxy in a browser", () => {
    vi.stubGlobal("window", {});
    expect(apiBase()).toBe("/api");
  });

  test("uses the address the desktop shell injects", () => {
    vi.stubGlobal("window", { __SURVEYR_API__: "http://127.0.0.1:51234/api" });
    expect(apiBase()).toBe("http://127.0.0.1:51234/api");
  });
});

describe("waitForBackend", () => {
  test("retries until the health check answers", async () => {
    vi.stubGlobal("window", {});
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("connection refused"))
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await waitForBackend({ intervalMs: 1, timeoutMs: 1000 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("gives up with a clear error after the timeout", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("connection refused")));

    await expect(waitForBackend({ intervalMs: 1, timeoutMs: 20 })).rejects.toThrow(/analysis engine/);
  });
});

describe("uploadScan", () => {
  test("surfaces the server's reason when a file is rejected", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ detail: "could not read this file as a point cloud" }),
      })
    );

    const file = new File(["nope"], "x.ply");
    await expect(uploadScan(file)).rejects.toThrow("could not read this file as a point cloud");
  });
});

describe("deleteProject", () => {
  test("sends DELETE for the project", async () => {
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "garden", removed: ["garden.xyz"] }) });
    vi.stubGlobal("fetch", fetchMock);

    await deleteProject("garden");

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/garden", { method: "DELETE" });
  });

  test("throws when the server refuses", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ detail: "unknown project 'x'" }) }));

    await expect(deleteProject("x")).rejects.toThrow("unknown project 'x'");
  });
});
