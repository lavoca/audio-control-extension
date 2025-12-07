import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
  
interface TabAudioState {
  tabId: number;
  url: string;
  title: string;
  isAudible: boolean;
  hasContentAudio: boolean;
  is_muted: boolean;
  paused: boolean;
  volume: number;
  lastUpdate: number;
}

const tabStatesStorage = storage.defineItem<Record<number, TabAudioState>>(
  'local:tabStates',
  { defaultValue: {} }
);

let popupPorts: Browser.runtime.Port[] = [];

export default defineBackground(() => {
  
  
  async function cleanupStaleTabs() {
    const tabStates = await getTabstates();
    const allTabs = await browser.tabs.query({});
    const validTabIds = new Set(allTabs.map(t => t.id));
    
    for (const tabId in tabStates) {
      if (!validTabIds.has(Number(tabId))) {
        await deleteTabState(Number(tabId));
      }
    }
  }
  
  cleanupStaleTabs();


  async function updateTabstate(tabId: number, updates: Partial<TabAudioState>) {
    const tabStates = await getTabstates();
    tabStates[tabId] = {
      ...tabStates[tabId],
      ...updates,
      lastUpdate: Date.now(),
    };
    await tabStatesStorage.setValue(tabStates);
  }


  
  async function getTabstates() {
    return await tabStatesStorage.getValue();
  }
  
  
  async function deleteTabState(tabId: number) {
    const tabStates = await getTabstates();
    delete tabStates[tabId];
    await tabStatesStorage.setValue(tabStates);
  }

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.audible !== undefined) {
      const tabstates = await getTabstates();
      const currentState = tabstates[tabId];
      
      // Only update isAudible, preserve content script state
      if (currentState) {
        await updateTabstate(tabId, {
          isAudible: changeInfo.audible || false,
          title: tab.title || currentState.title,
          url: tab.url || currentState.url,
        });
      } else {
        // New tab, create initial state
        await updateTabstate(tabId, {
          tabId,
          url: tab.url || '',
          title: tab.title || '',
          isAudible: changeInfo.audible || false,
          hasContentAudio: false,
          is_muted: false,
          paused: false,
          volume: 0,
          lastUpdate: Date.now()
        });
      }
      
      await sendAudioTabsToPopup();
    }
  });

  browser.runtime.onMessage.addListener((message, sender) => {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    
    switch (message.type) {
      case 'AUDIO_DETECTED':
        handleContentAudioDetected(tabId, message);
        break;
        
      case 'AUDIO_STOPPED':
        handleContentAudioStopped(tabId, message);
        break;
      
      case 'AUDIO_PAUSED':
        handleContentAudioPaused(tabId, message);
        break;

      case 'VOLUME_CHANGED':
        handleContentAudioChanged(tabId, message);
        break;
    }
  });

  browser.tabs.onRemoved.addListener(async (tabId) => {
    await deleteTabState(tabId);
    await sendAudioTabsToPopup();
  });

  async function sendAudioTabsToPopup() {
    const tabstates = await getTabstates();
    const audioTabs = Object.values(tabstates).filter(
      tab => tab.isAudible || tab.hasContentAudio || tab.paused
    );
    
    popupPorts.forEach(port => {
      port.postMessage({
        type: 'AUDIO_TABS_UPDATE',
        tabs: audioTabs
      });
    });
  }

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'popup') {
      popupPorts.push(port);
      
      port.onDisconnect.addListener(() => {
        popupPorts = popupPorts.filter(p => p !== port);
      });
      
      port.onMessage.addListener((message) => {
        if (message.type === 'GET_AUDIO_TABS') {
          sendAudioTabsToPopup();
        }
      });
    }
  });

  async function handleContentAudioDetected(tabId: number, message: any) {
    const tabstates = await getTabstates();
    const existingState = tabstates[tabId];
    
    const baseState = existingState || {
      tabId,
      url: '',
      title: '',
      isAudible: false,
      hasContentAudio: false,
      is_muted: false,
      paused: false,
      volume: 0,
      lastUpdate: Date.now(),
    };
    
    await updateTabstate(tabId, {
      ...baseState,
      hasContentAudio: true,
      paused: false,
      url: message.url || baseState.url,
      title: message.title || baseState.title,
      is_muted: message.muted ?? baseState.is_muted,
      volume: message.volume ?? baseState.volume,
    });
    
    await sendAudioTabsToPopup();
  }

  async function handleContentAudioStopped(tabId: number, message: any) {
    const tabstates = await getTabstates();
    const existingState = tabstates[tabId];
    
    if (existingState) {
      await updateTabstate(tabId, {
        hasContentAudio: false,
        paused: false,
        // Keep muted/volume state from message
        is_muted: message.muted ?? existingState.is_muted,
        volume: message.volume ?? existingState.volume,
      });
      
      await sendAudioTabsToPopup();
    }
  }

  async function handleContentAudioPaused(tabId: number, message: any) {
    const tabstates = await getTabstates();
    const existingState = tabstates[tabId];
    
    if (existingState) {
      await updateTabstate(tabId, {
        hasContentAudio: true,
        paused: true,
        // Update muted/volume from the pause event
        is_muted: message.muted ?? existingState.is_muted,
        volume: message.volume ?? existingState.volume,
      });
      
      await sendAudioTabsToPopup();
    }
  }

  async function handleContentAudioChanged(tabId: number, message: any) {
    const tabstates = await getTabstates();
    const existingState = tabstates[tabId];
    
    if (existingState) {
      await updateTabstate(tabId, {
        is_muted: message.muted ?? existingState.is_muted,
        volume: message.volume ?? existingState.volume,
      });
      
      await sendAudioTabsToPopup();
    }
  }
});