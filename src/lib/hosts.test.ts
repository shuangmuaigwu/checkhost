import { describe, expect, it } from "vitest";

import { buildEntries, listDomains, sanitizeGroups, type HostGroup } from "./hosts";

describe("sanitizeGroups", () => {
  it("repairs missing ids and ensures each group has at least one target", () => {
    const groups = [
      {
        id: "",
        name: "Example",
        domain: "demo.internal",
        activeTargetId: "missing-target",
        targets: [],
      },
    ] as HostGroup[];

    const sanitized = sanitizeGroups(groups);

    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].id).toBeTruthy();
    expect(sanitized[0].targets).toHaveLength(1);
    expect(sanitized[0].targets[0].id).toBeTruthy();
    expect(sanitized[0].activeTargetId).toBeNull();
  });
});

describe("listDomains", () => {
  it("normalizes domains and removes duplicates", () => {
    const groups: HostGroup[] = [
      {
        id: "group-1",
        name: "Group A",
        domain: " Demo.INTERNAL ",
        activeTargetId: null,
        targets: [{ id: "target-1", label: "A", ip: "192.0.2.1" }],
      },
      {
        id: "group-2",
        name: "Group B",
        domain: "demo.internal",
        activeTargetId: null,
        targets: [{ id: "target-2", label: "B", ip: "192.0.2.2" }],
      },
      {
        id: "group-3",
        name: "Group C",
        domain: "   ",
        activeTargetId: null,
        targets: [{ id: "target-3", label: "C", ip: "192.0.2.3" }],
      },
    ];

    expect(listDomains(groups)).toEqual(["demo.internal"]);
  });
});

describe("buildEntries", () => {
  it("returns only active targets and trims persisted values", () => {
    const groups: HostGroup[] = [
      {
        id: "group-1",
        name: "  QA Group  ",
        domain: " Demo.INTERNAL ",
        activeTargetId: "target-2",
        targets: [
          { id: "target-1", label: "One", ip: "192.0.2.1" },
          { id: "target-2", label: "  Demo Box  ", ip: " 192.0.2.22 " },
        ],
      },
      {
        id: "group-2",
        name: "Inactive",
        domain: "inactive.internal",
        activeTargetId: null,
        targets: [{ id: "target-3", label: "Three", ip: "192.0.2.3" }],
      },
    ];

    expect(buildEntries(groups)).toEqual([
      {
        domain: "demo.internal",
        groupName: "QA Group",
        ip: "192.0.2.22",
        label: "Demo Box",
      },
    ]);
  });
});
