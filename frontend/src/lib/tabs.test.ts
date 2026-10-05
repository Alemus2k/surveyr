import { describe, expect, test } from "vitest";
import { closeTab, openTab, reconcileTabs } from "./tabs";

describe("openTab", () => {
  test("appends a project that isn't open and makes it active", () => {
    expect(openTab({ open: ["a"], active: "a" }, "b")).toEqual({ open: ["a", "b"], active: "b" });
  });

  test("just activates a project that is already open", () => {
    expect(openTab({ open: ["a", "b"], active: "a" }, "b")).toEqual({ open: ["a", "b"], active: "b" });
  });
});

describe("closeTab", () => {
  test("activates the tab to the right of the closed active tab", () => {
    expect(closeTab({ open: ["a", "b", "c"], active: "b" }, "b")).toEqual({ open: ["a", "c"], active: "c" });
  });

  test("falls back to the left when closing the last tab", () => {
    expect(closeTab({ open: ["a", "b", "c"], active: "c" }, "c")).toEqual({ open: ["a", "b"], active: "b" });
  });

  test("keeps the active tab when closing a different one", () => {
    expect(closeTab({ open: ["a", "b", "c"], active: "a" }, "c")).toEqual({ open: ["a", "b"], active: "a" });
  });

  test("leaves nothing active when the only tab closes", () => {
    expect(closeTab({ open: ["a"], active: "a" }, "a")).toEqual({ open: [], active: null });
  });
});

describe("reconcileTabs", () => {
  test("opens every project on first run", () => {
    expect(reconcileTabs(null, ["a", "b"])).toEqual({ open: ["a", "b"], active: "a" });
  });

  test("restores saved tabs in order, dropping projects that no longer exist", () => {
    const saved = { open: ["c", "gone", "a"], active: "c" };
    expect(reconcileTabs(saved, ["a", "b", "c"])).toEqual({ open: ["c", "a"], active: "c" });
  });

  test("moves to the neighbouring tab when the active project disappears", () => {
    const saved = { open: ["c", "gone", "a"], active: "gone" };
    expect(reconcileTabs(saved, ["a", "b", "c"])).toEqual({ open: ["c", "a"], active: "a" });
  });

  test("keeps a saved empty tab bar empty", () => {
    expect(reconcileTabs({ open: [], active: null }, ["a"])).toEqual({ open: [], active: null });
  });
});
