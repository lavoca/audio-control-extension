
<script lang="ts" setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

type AudioTab = {
  id: number 
  tabId: number
  title: string
  url: string
  isAudible: boolean
  hasContentAudio: boolean
  is_muted: boolean
  paused: boolean
  volume: number
}

const audioTabs = ref<AudioTab[]>([])
let port: Browser.runtime.Port | null = null

function handleMessage(msg: any) {
  if (msg.type === 'AUDIO_TABS_UPDATE') {
    audioTabs.value = msg.tabs.map((tab: any) => ({
      ...tab,
      id: tab.tabId, // Map tabId to id for Vue key
      paused: tab.paused ?? false,
      volume: tab.volume ?? 0,
      is_muted: tab.is_muted ?? false,
    }))
  }
}

onMounted(() => {
  // Connect to background when popup opens
  port = browser.runtime.connect({ name: 'popup' })
  port.onMessage.addListener(handleMessage)
  port.postMessage({ type: 'GET_AUDIO_TABS' })
})

onBeforeUnmount(() => {
  if (port) {
    port.disconnect()
  }
})
</script>

<template>
  <div class="popup">
    <h1>Active Audio Tabs version 2</h1>
    <ul v-if="audioTabs.length > 0">
      <li v-for="tab in audioTabs" :key="tab.id" class="tab">
        <span class="title">{{ tab.title || tab.url }}</span>
        
        <!-- Check muted first, then paused, then playing -->
        <!-- Priority: Muted > Paused > Playing -->
        <span v-if="tab.is_muted && !tab.paused" class="badge muted">
          Muted
        </span>
        <span v-else-if="tab.paused" class="badge paused">
          Paused - {{ (tab.volume * 100).toFixed(0) }}%
        </span>
        <span v-else-if="tab.isAudible || tab.hasContentAudio" class="badge playing">
          Playing - {{ (tab.volume * 100).toFixed(0) }}%
        </span>
        <span v-else class="badge inactive">
          Silent
        </span>
      </li>
    </ul>
    <p v-else>No audio detected</p>
  </div>
</template>

<style scoped>
.popup {
  min-width: 320px; 
  padding: 12px;
  font-family: sans-serif;
}

h1 {
  font-size: 16px;
  margin-bottom: 10px;
}

ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.tab {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px; 
  padding: 8px;
  background: #000000;
  border-radius: 6px;
}

.title {
  flex: 1;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 8px;
}

.badge {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  color: rgb(255, 255, 255);
  white-space: nowrap; 
}

/* Different colors for different states */
.badge.playing {
  background: #4caf50;
}

.badge.muted {
  background: #ff9800;
}

.badge.paused {
  background: #2196f3;
}

.badge.inactive {
  background: #888;
}
</style>