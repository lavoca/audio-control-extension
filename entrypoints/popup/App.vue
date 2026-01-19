
<script lang="ts" setup>

/**
 * POPUP UI (opens when user clicks extension icon)
 * - Connects to background script to receive audio tab states
 * - Displays list of tabs with active audio
 * - Provides volume sliders and mute buttons for user control
 * - Sends volume/mute commands to content scripts via background
 */



import { ref, onMounted, onBeforeUnmount, onUnmounted } from 'vue'

type AudioTab = {
  id: number 
  tabId: number
  title: string
  url: string
  isAudible: boolean
  hasContentAudio: boolean
  isMuted: boolean
  paused: boolean
  volume: number
}

let serverStatus :String = 'DISCONNECTED'; 
const audioTabs = ref<AudioTab[]>([])
let port: Browser.runtime.Port | null = null
const startVolumes = new Map<number, number>() // map to hold all the starting slider volumes for every tab

// handle messages we get from background
function handleMessage(msg: any) {
  if (msg.type === 'AUDIO_TABS_UPDATE') {
    audioTabs.value = msg.tabs.map((tab: any) => ({
      ...tab,
      id: tab.tabId, // Map tabId to id for Vue key
      paused: tab.paused ?? false,
      volume: tab.volume ?? 0,
      isMuted: tab.isMuted ?? false,
    }))

  }else if(msg.type === 'TAURI_VOLUME_CHANGED') {
    console.log("muting from changing volume from tauri");
    changeVolume(msg.data.tauriTabId, msg.data.tauriVolume); // gets the volume and tabid from tauri via websocket and calls the change volume function with them jsut like if the slider in template called it
  
  }else if(msg.type === 'TAURI_MUTE_CHANGED') {
    console.log("muting from tauri");
    setMute(msg.data.tauriTabId, msg.data.taurisMuted);

  }else if(msg.type === 'SERVER_STATUS') {
    serverStatus = msg.status;
    console.log("server status:", serverStatus);
  }
}
 // captures the value when the slider first gets pressed this value will serve as a returning point when we unmute from volume = 0
function captureStartVolume(tabID:number, initialVolume: number) {
  startVolumes.set(tabID, initialVolume); // push the volume and the tabID associated with it as the key

}

async function changeVolume(tabID: number, newVolume: number) {;
  await browser.tabs.sendMessage(tabID, {
    type: 'UI_VOLUME_CHANGE',
    volume: newVolume,
  })
}

async function setMute(tabID: number, muted: boolean) {
  const startVolume = startVolumes.get(tabID); // get the initial slider volume for this tabID
  console.log("lastvolume:", startVolume)
  await browser.tabs.sendMessage(tabID, {
    type: 'UI_MUTE_SET',
    isMuted: muted,
    initialVolume: startVolume, // send the initial volume to content.ts along with the mute state
  })
}



onMounted(() => {
  // Connect to background when popup opens
  port = browser.runtime.connect({ name: 'popup' })
  port.postMessage({ type: 'GET_AUDIO_TABS' })
  port.onMessage.addListener(handleMessage)
})

onBeforeUnmount(() => { // before the extension is about to close
  if (port) {
    port.disconnect(); // if we have a port then close it
  }
})
</script>

<template>
  <div class="popup">
    <h1>Active Audio Tabs version 2</h1>
    <h2>connection to tauri server: {{ serverStatus }}</h2>
    <ul v-if="audioTabs.length > 0">
      <li v-for="tab in audioTabs" :key="tab.id" class="tab">
        <span class="title">{{ tab.title || tab.url }}</span>
        
        <!-- Volume Controls -->
        
          <!-- Volume Slider -->
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="tab.volume"
          @mousedown="captureStartVolume(tab.id, tab.volume)" 
          @input="changeVolume(tab.id, ($event.target as HTMLInputElement).valueAsNumber)"
          class="w-40 h-2 bg-gray-500 rounded-lg appearance-none cursor-pointer"
        />
        <button
          @click="setMute(tab.id, !tab.isMuted)"
          class="px-4 py-1 text-sm font-semibold text-white rounded-md transition-colors duration-200"
          :class="tab.isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'"
        >
          {{ tab.isMuted ? 'Unmute' : 'Mute' }}
        </button>
        <!-- Check muted first, then paused, then playing -->
        <!-- Priority: Muted > Paused > Playing -->
        <span v-if="tab.isMuted && !tab.paused" class="badge muted">
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