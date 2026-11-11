<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, post, type CleanupView } from '../api.ts';
import Icon from '../components/Icon.vue';
import { notify, notifyError, refresh } from '../store.ts';

const { t } = useI18n();
const host = (u: string) => new URL(u).hostname;
const view = ref<CleanupView | null>(null);
const offGroups = ref(new Set<string>());
const unsub = ref(new Set<string>());
const alsoTrashNews = ref(true);
const busy = ref(false);
const toOpen = ref<string[]>([]);

async function load() {
  try {
    const v = await api<CleanupView>('/api/cleanup');
    view.value = v;
    offGroups.value = new Set();
    unsub.value = new Set(v.newsletters.filter((n) => n.canUnsub).map((n) => n.fromEmail));
  } catch (e) {
    notifyError(e);
  }
}
onMounted(load);

const toggle = (set: Set<string>, v: string) => (set.has(v) ? set.delete(v) : set.add(v));
const groups = computed(() => view.value?.groups ?? []);
const news = computed(() => view.value?.newsletters ?? []);
const trashIds = computed(() => [
  ...groups.value.filter((g) => !offGroups.value.has(g.group)).flatMap((g) => g.ids),
  ...(alsoTrashNews.value ? news.value.filter((n) => unsub.value.has(n.fromEmail)).flatMap((n) => n.ids) : []),
]);

async function apply() {
  busy.value = true;
  try {
    const r = await post<{ trashed: number; unsubscribed: number; toOpen: string[] }>('/api/cleanup', { trashIds: trashIds.value, unsubscribe: [...unsub.value] });
    notify(t('cleanup.done', { trashed: r.trashed, unsub: r.unsubscribed }));
    toOpen.value = r.toOpen;
    await Promise.all([load(), refresh()]);
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <header class="topbar">
    <a href="#/" class="btn btn-icon" :aria-label="t('common.backToTriage')"><Icon name="back" :size="18" /></a>
    <span class="eyebrow">{{ t('cleanup.eyebrow') }}</span>
  </header>

  <div style="display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-end">
    <h1 class="headline" style="flex: 1 1 480px">
      <template v-if="trashIds.length">
        <span style="color: var(--accent-text)">{{ t('cleanup.headline', { n: trashIds.length }) }}</span> {{ t('cleanup.headlineRest') }} <em>{{ t('cleanup.headlineEm') }}</em>
      </template>
      <template v-else>{{ t('cleanup.clean') }} <em>{{ t('cleanup.cleanEm') }}</em></template>
    </h1>
    <p style="flex: 1 1 280px; margin: 0; max-width: 42ch; font-size: 14px; line-height: 1.6; color: var(--body)">{{ t('cleanup.intro') }}</p>
  </div>

  <div v-if="toOpen.length" class="banner">
    <p>{{ t('cleanup.confirmSites') }}</p>
    <div style="display: flex; flex-wrap: wrap; gap: 8px">
      <a v-for="u in toOpen" :key="u" class="btn" :href="u" target="_blank" rel="noopener noreferrer">{{ host(u) }}</a>
    </div>
  </div>

  <section v-if="groups.length" style="display: flex; flex-direction: column; gap: 14px" aria-labelledby="del-title">
    <h2 id="del-title" class="eyebrow" style="margin: 0; font-weight: 500">{{ t('cleanup.toTrash') }}</h2>
    <div class="tiles">
      <label v-for="(g, i) in groups" :key="g.group" :class="['tile', 'rise', { off: offGroups.has(g.group) }]" :style="{ animationDelay: `${i * 60}ms` }">
        <span style="display: flex; align-items: flex-start; gap: 10px">
          <span class="n">{{ g.count }}</span>
          <input type="checkbox" :checked="!offGroups.has(g.group)" @change="toggle(offGroups, g.group)" />
        </span>
        <span style="font-size: 15px; font-weight: 600">{{ g.group }}</span>
        <span class="eyebrow" :style="{ color: offGroups.has(g.group) ? 'var(--muted)' : 'var(--hot-text)' }">
          {{ offGroups.has(g.group) ? t('cleanup.kept') : t('cleanup.toTrash') }}
        </span>
      </label>
    </div>
  </section>

  <section v-if="news.length" style="display: flex; flex-direction: column; gap: 14px" aria-labelledby="nl-title">
    <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">
      <h2 id="nl-title" class="eyebrow" style="margin: 0; font-weight: 500; flex: 1">{{ t('cleanup.newsTitle') }}</h2>
      <label style="display: flex; align-items: center; gap: 8px; font-size: 13px">
        <input v-model="alsoTrashNews" type="checkbox" style="width: 18px; height: 18px; accent-color: var(--accent)" /> {{ t('cleanup.alsoTrash') }}
      </label>
    </div>
    <div class="table">
      <label v-for="n in news" :key="n.fromEmail" class="nl">
        <input type="checkbox" :checked="unsub.has(n.fromEmail)" :disabled="!n.canUnsub" @change="toggle(unsub, n.fromEmail)" />
        <span style="display: flex; flex-direction: column; gap: 2px; min-width: 0">
          <span class="name">{{ n.fromName }}</span>
          <span class="mono muted ellipsis" style="font-size: 11px">{{ n.fromEmail }}</span>
        </span>
        <span class="mono" style="font-size: 13px">{{ t('common.mails', n.count) }}</span>
        <span class="pill">{{ n.canUnsub ? (unsub.has(n.fromEmail) ? t('reader.unsubscribe') : t('cleanup.keep')) : t('cleanup.noLink') }}</span>
      </label>
    </div>
  </section>

  <p v-if="view && !groups.length && !news.length" class="empty">{{ t('cleanup.nothing') }}</p>

  <footer class="sticky-foot">
    <span class="mono muted" style="flex: 1 1 260px; font-size: 13px">{{ t('cleanup.summary', { trash: trashIds.length, unsub: unsub.size }) }}</span>
    <button type="button" class="btn btn-prim" style="min-height: 48px; padding: 0 24px; font-size: 15px" :disabled="busy || (!trashIds.length && !unsub.size)" @click="apply">
      {{ busy ? t('cleanup.applying') : t('cleanup.apply') }} <Icon name="arrow" :size="16" />
    </button>
  </footer>
</template>
