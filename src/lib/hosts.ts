export type HostTarget = {
  id: string;
  label: string;
  ip: string;
};

export type HostGroup = {
  id: string;
  name: string;
  domain: string;
  activeTargetId: string | null;
  targets: HostTarget[];
};

export type ManagedHostEntry = {
  domain: string;
  ip: string;
  label: string;
  groupName: string;
};

export type DomainSource = "managed" | "external" | "missing";

export type DomainState = {
  domain: string;
  ip: string | null;
  source: DomainSource;
  duplicates: string[];
};

export type HostsStatus = {
  hostPath: string;
  blockPresent: boolean;
  domainStates: DomainState[];
};

export const STORAGE_KEY = "checkhosts.groups.v1";

function fallbackId() {
  return `checkhosts-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createId() {
  return globalThis.crypto?.randomUUID?.() ?? fallbackId();
}

export function createEmptyTarget(): HostTarget {
  return {
    id: createId(),
    label: "",
    ip: "",
  };
}

export function createEmptyGroup(): HostGroup {
  return {
    id: createId(),
    name: "新的域名组",
    domain: "",
    activeTargetId: null,
    targets: [createEmptyTarget()],
  };
}

export function createDefaultGroups(): HostGroup[] {
  return [
    {
      id: createId(),
      name: "KWS 测试环境",
      domain: "kws.knd.io",
      activeTargetId: null,
      targets: [
        { id: createId(), label: "测试 1", ip: "192.0.2.1" },
        { id: createId(), label: "测试 2", ip: "192.0.2.2" },
        { id: createId(), label: "测试 3", ip: "192.0.2.3" },
      ],
    },
  ];
}

export function sanitizeGroups(rawGroups: HostGroup[]): HostGroup[] {
  return rawGroups
    .map((group) => {
      const rawTargets = Array.isArray(group.targets) ? group.targets : [];
      const targets = rawTargets.map((target) => ({
        id: target.id || createId(),
        label: target.label ?? "",
        ip: target.ip ?? "",
      }));
      const activeTargetId = targets.some((target) => target.id === group.activeTargetId)
        ? group.activeTargetId
        : null;

      return {
        id: group.id || createId(),
        name: group.name ?? "",
        domain: group.domain ?? "",
        activeTargetId,
        targets: targets.length > 0 ? targets : [createEmptyTarget()],
      };
    })
    .filter((group) => group.name || group.domain || group.targets.some((target) => target.label || target.ip));
}

export function loadGroups() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);

    if (!raw) {
      return createDefaultGroups();
    }

    const parsed = JSON.parse(raw) as HostGroup[];

    return sanitizeGroups(parsed);
  } catch {
    return createDefaultGroups();
  }
}

export function listDomains(groups: HostGroup[]) {
  return groups
    .map((group) => group.domain.trim().toLowerCase())
    .filter((domain, index, domains) => domain && domains.indexOf(domain) === index);
}

export function buildEntries(groups: HostGroup[]): ManagedHostEntry[] {
  return groups
    .map((group) => {
      const domain = group.domain.trim().toLowerCase();
      const target = group.targets.find((item) => item.id === group.activeTargetId);

      if (!domain || !target) {
        return null;
      }

      return {
        domain,
        ip: target.ip.trim(),
        label: target.label.trim() || "未命名目标",
        groupName: group.name.trim() || "未命名域名组",
      };
    })
    .filter((entry): entry is ManagedHostEntry => entry !== null);
}

export function statusLabel(source: DomainSource) {
  switch (source) {
    case "managed":
      return "CheckHosts 生效中";
    case "external":
      return "系统已有其他映射";
    case "missing":
      return "未命中 hosts";
  }
}

export function extractErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "操作失败，请重试。";
}

export function detectPlatformClass() {
  const navigatorWithUAData = globalThis.navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };
  const platform =
    navigatorWithUAData.userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent;

  if (/windows/i.test(platform)) {
    return "platform-windows";
  }

  if (/mac/i.test(platform)) {
    return "platform-macos";
  }

  if (/linux/i.test(platform)) {
    return "platform-linux";
  }

  return "platform-other";
}
