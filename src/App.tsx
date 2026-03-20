import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type HostTarget = {
  id: string;
  label: string;
  ip: string;
};

type HostGroup = {
  id: string;
  name: string;
  domain: string;
  activeTargetId: string | null;
  targets: HostTarget[];
};

type ManagedHostEntry = {
  domain: string;
  ip: string;
  label: string;
  groupName: string;
};

type DomainSource = "managed" | "external" | "missing";

type DomainState = {
  domain: string;
  ip: string | null;
  source: DomainSource;
  duplicates: string[];
};

type HostsStatus = {
  hostPath: string;
  blockPresent: boolean;
  domainStates: DomainState[];
};

const STORAGE_KEY = "checkhosts.groups.v1";

const DEFAULT_GROUPS: HostGroup[] = [
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

function createId() {
  return crypto.randomUUID();
}

function createEmptyTarget(): HostTarget {
  return {
    id: createId(),
    label: "",
    ip: "",
  };
}

function createEmptyGroup(): HostGroup {
  return {
    id: createId(),
    name: "新的域名组",
    domain: "",
    activeTargetId: null,
    targets: [createEmptyTarget()],
  };
}

function sanitizeGroups(rawGroups: HostGroup[]): HostGroup[] {
  return rawGroups
    .map((group) => {
      const targets = group.targets.map((target) => ({
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

function loadGroups(): HostGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return DEFAULT_GROUPS;
    }

    const parsed = JSON.parse(raw) as HostGroup[];

    return sanitizeGroups(parsed);
  } catch {
    return DEFAULT_GROUPS;
  }
}

function listDomains(groups: HostGroup[]) {
  return groups
    .map((group) => group.domain.trim().toLowerCase())
    .filter((domain, index, domains) => domain && domains.indexOf(domain) === index);
}

function buildEntries(groups: HostGroup[]): ManagedHostEntry[] {
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

function statusLabel(source: DomainSource) {
  switch (source) {
    case "managed":
      return "CheckHosts 生效中";
    case "external":
      return "系统已有其他映射";
    case "missing":
      return "未命中 hosts";
  }
}

function extractErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "操作失败，请重试。";
}

function detectPlatformClass() {
  const navigatorWithUAData = navigator as Navigator & {
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

function App() {
  const [groups, setGroups] = useState<HostGroup[]>(() => loadGroups());
  const [hostsStatus, setHostsStatus] = useState<HostsStatus | null>(null);
  const [busy, setBusy] = useState<"refresh" | "apply" | null>(null);
  const [notice, setNotice] = useState("默认示例 IP 使用 `192.0.2.x`，请先改成你的真实测试机地址。");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  }, [groups]);

  useEffect(() => {
    const platformClass = detectPlatformClass();
    document.documentElement.classList.add(platformClass);

    return () => {
      document.documentElement.classList.remove(platformClass);
    };
  }, []);

  useEffect(() => {
    void refreshHosts(loadGroups());
  }, []);

  const domainStateMap = new Map(
    (hostsStatus?.domainStates ?? []).map((state) => [state.domain.toLowerCase(), state]),
  );
  const configuredCount = buildEntries(groups).length;

  async function refreshHosts(sourceGroups = groups) {
    setBusy("refresh");
    setError(null);

    try {
      const status = await invoke<HostsStatus>("get_hosts_status", {
        domains: listDomains(sourceGroups),
      });

      setHostsStatus(status);
    } catch (invokeError) {
      setError(extractErrorMessage(invokeError));
    } finally {
      setBusy(null);
    }
  }

  async function applyConfiguration(nextGroups: HostGroup[], successMessage: string) {
    setGroups(nextGroups);
    setBusy("apply");
    setError(null);

    try {
      const status = await invoke<HostsStatus>("apply_hosts", {
        entries: buildEntries(nextGroups),
        domains: listDomains(nextGroups),
      });

      setHostsStatus(status);
      setNotice(successMessage);
    } catch (invokeError) {
      setError(extractErrorMessage(invokeError));
      await refreshHosts(nextGroups);
    } finally {
      setBusy(null);
    }
  }

  function updateGroup(groupId: string, updater: (group: HostGroup) => HostGroup) {
    setGroups((current) => current.map((group) => (group.id === groupId ? updater(group) : group)));
  }

  function addGroup() {
    setGroups((current) => [...current, createEmptyGroup()]);
    setNotice("已新增域名组，填好域名和 IP 后即可切换。");
  }

  function deleteGroup(groupId: string) {
    const group = groups.find((item) => item.id === groupId);
    const nextGroups = groups.filter((item) => item.id !== groupId);

    if (!group) {
      return;
    }

    if (group.activeTargetId) {
      void applyConfiguration(nextGroups, `已移除 ${group.name || group.domain || "该域名组"} 的 hosts 映射。`);
      return;
    }

    setGroups(nextGroups);
  }

  function addTarget(groupId: string) {
    updateGroup(groupId, (group) => ({
      ...group,
      targets: [...group.targets, createEmptyTarget()],
    }));
  }

  function removeTarget(groupId: string, targetId: string) {
    const group = groups.find((item) => item.id === groupId);

    if (!group) {
      return;
    }

    const targets = group.targets.filter((target) => target.id !== targetId);
    const nextGroup = {
      ...group,
      targets: targets.length > 0 ? targets : [createEmptyTarget()],
      activeTargetId: group.activeTargetId === targetId ? null : group.activeTargetId,
    };
    const nextGroups = groups.map((item) => (item.id === groupId ? nextGroup : item));

    if (group.activeTargetId === targetId) {
      void applyConfiguration(nextGroups, `已停用 ${group.name || group.domain || "该域名组"} 的当前目标。`);
      return;
    }

    setGroups(nextGroups);
  }

  function switchTarget(groupId: string, targetId: string) {
    const group = groups.find((item) => item.id === groupId);
    const target = group?.targets.find((item) => item.id === targetId);

    if (!group || !target) {
      return;
    }

    const nextGroups = groups.map((item) =>
      item.id === groupId
        ? {
            ...item,
            activeTargetId: targetId,
          }
        : item,
    );

    void applyConfiguration(
      nextGroups,
      `${group.domain || "该域名"} 已切换到 ${target.label || target.ip || "目标环境"}。`,
    );
  }

  function disableGroup(groupId: string) {
    const group = groups.find((item) => item.id === groupId);

    if (!group) {
      return;
    }

    const nextGroups = groups.map((item) =>
      item.id === groupId
        ? {
            ...item,
            activeTargetId: null,
          }
        : item,
    );

    void applyConfiguration(nextGroups, `${group.domain || "该域名"} 已从 CheckHosts 管理区移除。`);
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <span className="eyebrow">Tauri / Hosts Switcher</span>
          <h1>CheckHosts</h1>
          <p className="hero-copy">
            把常用域名整理成分组，一键切换到不同测试机。每次写入系统 hosts 时会由系统弹出管理员授权窗口。
          </p>
        </div>
        <div className="hero-panel">
          <div className="hero-metric">
            <span>已配置生效目标</span>
            <strong>{configuredCount}</strong>
          </div>
          <div className="hero-metric">
            <span>系统 hosts 文件</span>
            <strong>{hostsStatus?.hostPath ?? "/etc/hosts"}</strong>
          </div>
          <div className="hero-actions">
            <button
              className="primary"
              disabled={busy !== null}
              onClick={() => void applyConfiguration(groups, "已按当前选择重新写入系统 hosts。")}
              type="button"
            >
              {busy === "apply" ? "正在写入..." : "应用当前选择"}
            </button>
            <button
              className="ghost"
              disabled={busy !== null}
              onClick={() => void refreshHosts()}
              type="button"
            >
              {busy === "refresh" ? "正在刷新..." : "刷新系统状态"}
            </button>
          </div>
        </div>
      </section>

      <section className="status-strip">
        <div className="status-card">
          <span>管理区块</span>
          <strong>{hostsStatus?.blockPresent ? "已写入" : "尚未写入"}</strong>
        </div>
        <div className="status-card wide">
          <span>提示</span>
          <strong>{notice}</strong>
        </div>
        {error ? (
          <div className="status-card error">
            <span>错误</span>
            <strong>{error}</strong>
          </div>
        ) : null}
      </section>

      <section className="toolbar">
        <div>
          <h2>域名分组</h2>
          <p>每个域名组只会激活一个目标 IP。CheckHosts 会把当前启用的映射写到 hosts 顶部。</p>
        </div>
        <button className="accent" disabled={busy !== null} onClick={addGroup} type="button">
          新增域名组
        </button>
      </section>

      <section className="groups">
        {groups.length === 0 ? (
          <div className="empty-state">
            <h3>还没有域名组</h3>
            <p>先添加一个域名组，再把不同测试机的 IP 填进去。之后就可以从桌面上一键切换 hosts。</p>
            <button className="accent" disabled={busy !== null} onClick={addGroup} type="button">
              新增第一个域名组
            </button>
          </div>
        ) : null}

        {groups.map((group, index) => {
          const groupDomain = group.domain.trim().toLowerCase();
          const domainState = domainStateMap.get(groupDomain);
          const activeTarget = group.targets.find((target) => target.id === group.activeTargetId) ?? null;
          const hasDuplicates = (domainState?.duplicates.length ?? 0) > 1;

          return (
            <article className="group-card" key={group.id}>
              <header className="group-header">
                <div className="group-index">0{index + 1}</div>
                <div className="group-meta">
                  <div className="group-title-row">
                    <input
                      className="title-input"
                      onChange={(event) =>
                        updateGroup(group.id, (current) => ({
                          ...current,
                          name: event.currentTarget.value,
                        }))
                      }
                      placeholder="例如：KWS 测试环境"
                      value={group.name}
                    />
                    <button className="danger" disabled={busy !== null} onClick={() => deleteGroup(group.id)} type="button">
                      删除分组
                    </button>
                  </div>
                  <div className="group-fields">
                    <label>
                      <span>域名</span>
                      <input
                        onChange={(event) =>
                          updateGroup(group.id, (current) => ({
                            ...current,
                            domain: event.currentTarget.value,
                          }))
                        }
                        placeholder="kws.knd.io"
                        value={group.domain}
                      />
                    </label>
                    <div className="state-cluster">
                      <span className="pill active">
                        选择中: {activeTarget ? `${activeTarget.label || "未命名"} / ${activeTarget.ip || "待填写"}` : "未启用"}
                      </span>
                      <span className={`pill ${domainState?.source ?? "missing"}`}>
                        系统状态: {domainState ? `${statusLabel(domainState.source)}${domainState.ip ? ` / ${domainState.ip}` : ""}` : "未检测"}
                      </span>
                    </div>
                  </div>
                  {hasDuplicates ? (
                    <p className="warning">
                      检测到重复映射: {domainState?.duplicates.join(" / ")}。CheckHosts 会优先使用它写在顶部的那条记录。
                    </p>
                  ) : null}
                </div>
              </header>

              <div className="targets">
                {group.targets.map((target) => {
                  const selected = group.activeTargetId === target.id;
                  const systemActive = domainState?.ip === target.ip.trim();

                  return (
                    <div
                      className={`target-card${selected ? " selected" : ""}${systemActive ? " live" : ""}`}
                      key={target.id}
                    >
                      <div className="target-header">
                        <span>{selected ? "当前选择" : "可切换目标"}</span>
                        <div className="target-actions">
                          <button
                            className="ghost"
                            disabled={busy !== null}
                            onClick={() => switchTarget(group.id, target.id)}
                            type="button"
                          >
                            一键切换
                          </button>
                          <button
                            className="danger ghost"
                            disabled={busy !== null}
                            onClick={() => removeTarget(group.id, target.id)}
                            type="button"
                          >
                            删除
                          </button>
                        </div>
                      </div>

                      <label>
                        <span>目标名称</span>
                        <input
                          onChange={(event) =>
                            updateGroup(group.id, (current) => ({
                              ...current,
                              targets: current.targets.map((item) =>
                                item.id === target.id
                                  ? {
                                      ...item,
                                      label: event.currentTarget.value,
                                    }
                                  : item,
                              ),
                            }))
                          }
                          placeholder="测试 1"
                          value={target.label}
                        />
                      </label>
                      <label>
                        <span>IP 地址</span>
                        <input
                          onChange={(event) =>
                            updateGroup(group.id, (current) => ({
                              ...current,
                              targets: current.targets.map((item) =>
                                item.id === target.id
                                  ? {
                                      ...item,
                                      ip: event.currentTarget.value,
                                    }
                                  : item,
                              ),
                            }))
                          }
                          placeholder="192.168.10.11"
                          value={target.ip}
                        />
                      </label>
                      <div className="target-foot">
                        <span>{systemActive ? "系统当前命中该 IP" : "尚未写入系统 hosts"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <footer className="group-footer">
                <button className="ghost" disabled={busy !== null} onClick={() => addTarget(group.id)} type="button">
                  新增目标
                </button>
                <button className="ghost" disabled={busy !== null} onClick={() => disableGroup(group.id)} type="button">
                  停用此域名
                </button>
              </footer>
            </article>
          );
        })}
      </section>
    </main>
  );
}

export default App;
