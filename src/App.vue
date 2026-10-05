<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useSchemeStore } from './store/scheme'

const route = useRoute()
const router = useRouter()
const store = useSchemeStore()
const nav = [
  { name: 'overview', label: '方案总览' },
  { name: 'map', label: '地图与阶段' },
  { name: 'review', label: '会签与通告' },
]
</script>

<template>
  <a-layout class="shell">
    <a-layout-sider :width="224" class="sider">
      <div class="brand"><b>路</b><div><strong>封路协调台</strong><small>ROAD CONTROL</small></div></div>
      <a-menu :selected-keys="[route.name]" class="menu" @menu-item-click="(key: string) => router.push({ name: key })">
        <a-menu-item v-for="item in nav" :key="item.name">{{ item.label }}</a-menu-item>
      </a-menu>
      <div class="project-card"><span :class="{ off: store.offline }"></span><div><b>{{ store.current.project }}</b><small>{{ store.offline ? '离线编辑 · 恢复时按修订号合并' : `当前修订 R${store.revisionNo} · 4 家单位会签` }}</small></div></div>
    </a-layout-sider>
    <a-layout>
      <a-layout-header class="topbar">
        <div><b>{{ store.current.id }}</b><span>{{ store.current.area }} · 2026 年第四季度施工计划 · 修订链 R1–R{{ store.revisionNo }}</span></div>
        <div class="top-actions">
          <a-tag :color="store.offline ? 'orange' : 'green'">{{ store.offline ? `离线中 · 本地 R${store.revisionNo}` : '协同在线 11' }}</a-tag>
          <a-button @click="store.viewRevision(null); router.push('/review')">修订链 / 历史版本</a-button>
          <a-button type="primary" @click="router.push('/review')">会签与通告</a-button>
        </div>
      </a-layout-header>
      <a-layout-content class="main"><router-view /></a-layout-content>
    </a-layout>
  </a-layout>
</template>
