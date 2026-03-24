<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import {
  STORAGE_KEY,
  buildEntries,
  createEmptyGroup,
  createEmptyTarget,
  detectPlatformClass,
  extractErrorMessage,
  listDomains,
  loadGroups,
  statusLabel,
  type HostGroup,
  type HostsStatus,
} from "./lib/hosts";

type BusyState = "refresh" | "apply" | null;

const groups = ref<HostGroup[]>(loadGroups());
const hostsStatus = ref<HostsStatus | null>(null);
const busy = ref<BusyState>(null);
const notice = ref("默认示例 IP 使用 `192.0.2.x`，请先改成你的真实测试机地址。");
const error = ref<string | null>(null);
const platformClass = detectPlatformClass();

watch(
  groups,
  (nextGroups) => {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(nextGroups));
  },
  { deep: true },
);

const domainStateMap = computed(
  () => new Map((hostsStatus.value?.domainStates ?? []).map((state) => [state.domain.toLowerCase(), state])),
);
const configuredCount = computed(() => buildEntries(groups.value).length);
const groupViews = computed(() =>
  groups.value.map((group, index) => {
    const domainState = domainStateMap.value.get(group.domain.trim().toLowerCase()) ?? null;
    const activeTarget = group.targets.find((target) => target.id === group.activeTargetId) ?? null;

    return {
      group,
      index,
      domainState,
      activeTarget,
      hasDuplicates: (domainState?.duplicates.length ?? 0) > 1,
    };
  }),
);

onMounted(() => {
  document.documentElement.classList.add(platformClass);
  void refreshHosts(groups.value);
});

onBeforeUnmount(() => {
  document.documentElement.classList.remove(platformClass);
});

async function refreshHosts(sourceGroups = groups.value) {
  busy.value = "refresh";
  error.value = null;

  try {
    const status = await invoke<HostsStatus>("get_hosts_status", {
      domains: listDomains(sourceGroups),
    });

    hostsStatus.value = status;
  } catch (invokeError) {
    error.value = extractErrorMessage(invokeError);
  } finally {
    busy.value = null;
  }
}

async function applyConfiguration(nextGroups: HostGroup[], successMessage: string) {
  groups.value = nextGroups;
  busy.value = "apply";
  error.value = null;

  try {
    const status = await invoke<HostsStatus>("apply_hosts", {
      entries: buildEntries(nextGroups),
      domains: listDomains(nextGroups),
    });

    hostsStatus.value = status;
    notice.value = successMessage;
  } catch (invokeError) {
    error.value = extractErrorMessage(invokeError);
    await refreshHosts(nextGroups);
  } finally {
    busy.value = null;
  }
}

function groupLabel(group: HostGroup) {
  return group.name || group.domain || "该域名组";
}

function addGroup() {
  groups.value.push(createEmptyGroup());
  notice.value = "已新增域名组，填好域名和 IP 后即可切换。";
}

function deleteGroup(groupId: string) {
  const group = groups.value.find((item) => item.id === groupId);

  if (!group) {
    return;
  }

  const nextGroups = groups.value.filter((item) => item.id !== groupId);

  if (group.activeTargetId) {
    void applyConfiguration(nextGroups, `已移除 ${groupLabel(group)} 的 hosts 映射。`);
    return;
  }

  groups.value = nextGroups;
}

function addTarget(groupId: string) {
  const group = groups.value.find((item) => item.id === groupId);

  if (!group) {
    return;
  }

  group.targets.push(createEmptyTarget());
}

function removeTarget(groupId: string, targetId: string) {
  const group = groups.value.find((item) => item.id === groupId);

  if (!group) {
    return;
  }

  const targets = group.targets.filter((target) => target.id !== targetId);
  const nextGroup = {
    ...group,
    targets: targets.length > 0 ? targets : [createEmptyTarget()],
    activeTargetId: group.activeTargetId === targetId ? null : group.activeTargetId,
  };
  const nextGroups = groups.value.map((item) => (item.id === groupId ? nextGroup : item));

  if (group.activeTargetId === targetId) {
    void applyConfiguration(nextGroups, `已停用 ${groupLabel(group)} 的当前目标。`);
    return;
  }

  groups.value = nextGroups;
}

function switchTarget(groupId: string, targetId: string) {
  const group = groups.value.find((item) => item.id === groupId);
  const target = group?.targets.find((item) => item.id === targetId);

  if (!group || !target) {
    return;
  }

  const nextGroups = groups.value.map((item) =>
    item.id === groupId
      ? {
          ...item,
          activeTargetId: targetId,
        }
      : item,
  );

  void applyConfiguration(nextGroups, `${group.domain || "该域名"} 已切换到 ${target.label || target.ip || "目标环境"}。`);
}

function disableGroup(groupId: string) {
  const group = groups.value.find((item) => item.id === groupId);

  if (!group) {
    return;
  }

  const nextGroups = groups.value.map((item) =>
    item.id === groupId
      ? {
          ...item,
          activeTargetId: null,
        }
      : item,
  );

  void applyConfiguration(nextGroups, `${group.domain || "该域名"} 已从 CheckHosts 管理区移除。`);
}
</script>

<template>
  <main class="shell">
    <section class="hero">
      <div>
        <span class="eyebrow">Tauri / Hosts Switcher</span>
        <h1>CheckHosts</h1>
        <p class="hero-copy">
          把常用域名整理成分组，一键切换到不同测试机。每次写入系统 hosts 时会由系统弹出管理员授权窗口。
        </p>
      </div>
      <div class="hero-panel">
        <div class="hero-metric">
          <span>已配置生效目标</span>
          <strong>{{ configuredCount }}</strong>
        </div>
        <div class="hero-metric">
          <span>系统 hosts 文件</span>
          <strong>{{ hostsStatus?.hostPath ?? "/etc/hosts" }}</strong>
        </div>
        <div class="hero-actions">
          <button
            class="primary"
            :disabled="busy !== null"
            type="button"
            @click="applyConfiguration(groups, '已按当前选择重新写入系统 hosts。')"
          >
            {{ busy === "apply" ? "正在写入..." : "应用当前选择" }}
          </button>
          <button class="ghost" :disabled="busy !== null" type="button" @click="refreshHosts()">
            {{ busy === "refresh" ? "正在刷新..." : "刷新系统状态" }}
          </button>
        </div>
      </div>
    </section>

    <section class="status-strip">
      <div class="status-card">
        <span>管理区块</span>
        <strong>{{ hostsStatus?.blockPresent ? "已写入" : "尚未写入" }}</strong>
      </div>
      <div class="status-card wide">
        <span>提示</span>
        <strong>{{ notice }}</strong>
      </div>
      <div v-if="error" class="status-card error">
        <span>错误</span>
        <strong>{{ error }}</strong>
      </div>
    </section>

    <section class="toolbar">
      <div>
        <h2>域名分组</h2>
        <p>每个域名组只会激活一个目标 IP。CheckHosts 会把当前启用的映射写到 hosts 顶部。</p>
      </div>
      <button class="accent" :disabled="busy !== null" type="button" @click="addGroup">新增域名组</button>
    </section>

    <section class="groups">
      <div v-if="groups.length === 0" class="empty-state">
        <h3>还没有域名组</h3>
        <p>先添加一个域名组，再把不同测试机的 IP 填进去。之后就可以从桌面上一键切换 hosts。</p>
        <button class="accent" :disabled="busy !== null" type="button" @click="addGroup">新增第一个域名组</button>
      </div>

      <article v-for="view in groupViews" :key="view.group.id" class="group-card">
        <header class="group-header">
          <div class="group-index">0{{ view.index + 1 }}</div>
          <div class="group-meta">
            <div class="group-title-row">
              <input v-model="view.group.name" class="title-input" placeholder="例如：KWS 测试环境" />
              <button class="danger" :disabled="busy !== null" type="button" @click="deleteGroup(view.group.id)">
                删除分组
              </button>
            </div>
            <div class="group-fields">
              <label>
                <span>域名</span>
                <input v-model="view.group.domain" placeholder="kws.knd.io" />
              </label>
              <div class="state-cluster">
                <span class="pill active">
                  选择中:
                  {{
                    view.activeTarget
                      ? `${view.activeTarget.label || "未命名"} / ${view.activeTarget.ip || "待填写"}`
                      : "未启用"
                  }}
                </span>
                <span :class="['pill', view.domainState?.source ?? 'missing']">
                  系统状态:
                  {{
                    view.domainState
                      ? `${statusLabel(view.domainState.source)}${view.domainState.ip ? ` / ${view.domainState.ip}` : ""}`
                      : "未检测"
                  }}
                </span>
              </div>
            </div>
            <p v-if="view.hasDuplicates" class="warning">
              检测到重复映射: {{ view.domainState?.duplicates.join(" / ") }}。CheckHosts 会优先使用它写在顶部的那条记录。
            </p>
          </div>
        </header>

        <div class="targets">
          <div
            v-for="target in view.group.targets"
            :key="target.id"
            :class="[
              'target-card',
              { selected: view.group.activeTargetId === target.id, live: view.domainState?.ip === target.ip.trim() },
            ]"
          >
            <div class="target-header">
              <span>{{ view.group.activeTargetId === target.id ? "当前选择" : "可切换目标" }}</span>
              <div class="target-actions">
                <button class="ghost" :disabled="busy !== null" type="button" @click="switchTarget(view.group.id, target.id)">
                  一键切换
                </button>
                <button
                  class="danger ghost"
                  :disabled="busy !== null"
                  type="button"
                  @click="removeTarget(view.group.id, target.id)"
                >
                  删除
                </button>
              </div>
            </div>

            <label>
              <span>目标名称</span>
              <input v-model="target.label" placeholder="测试 1" />
            </label>
            <label>
              <span>IP 地址</span>
              <input v-model="target.ip" placeholder="192.168.10.11" />
            </label>
            <div class="target-foot">
              <span>{{ view.domainState?.ip === target.ip.trim() ? "系统当前命中该 IP" : "尚未写入系统 hosts" }}</span>
            </div>
          </div>
        </div>

        <footer class="group-footer">
          <button class="ghost" :disabled="busy !== null" type="button" @click="addTarget(view.group.id)">新增目标</button>
          <button class="ghost" :disabled="busy !== null" type="button" @click="disableGroup(view.group.id)">
            停用此域名
          </button>
        </footer>
      </article>
    </section>
  </main>
</template>
