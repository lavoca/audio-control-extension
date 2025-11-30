import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
  
interface TabAudioState {
  tabId: number,
  url: string,
  title: string,
  isAudible: boolean,
  hasContentAudio: boolean,
  is_muted: boolean,
  paused: boolean,
  volume: number,
  lastUpdate: number,
}
 // storage to keep tabstates in it so that the extension doesnt loose data after time has passed
 // problem is extension looses access to data after some time so we need to store that data in wxt storage
 // we also need helper functions to get data and push updates to and from storage
const tabStatesStorage = storage.defineItem<Record<number, TabAudioState>>(
  'local:tabStates',
  { defaultValue: {} }
);

let popupPorts: Browser.runtime.Port[] = [];// Keep track of connected popup ports 


 

export default defineBackground(() => {

  // helper function to get data from storage
  async function getTabstates() {
    return await tabStatesStorage.getValue();
  }
  // helper function to update data in storage partially or fully 
  async function updateTabstate(tabId: number, updates: Partial<TabAudioState>) {
    const tabStates = await getTabstates();
    tabStates[tabId] = {
      ...tabStates[tabId], // keep existing values
      ...updates, // apply changes
      lastUpdate: Date.now(), // always update lastUpdate
    }
    await tabStatesStorage.setValue(tabStates);
  }
  // helper function to delete data from storage
  async function deleteTabState(tabId: number) {
    const tabStates = await getTabstates();
    delete tabStates[tabId];
    await tabStatesStorage.setValue(tabStates); // update new info
  }


  // Listen for tab audio changes using Chrome API (onUpdated)
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Only process if audible state changed
    if(changeInfo.audible !== undefined) {
      const tabstates = await getTabstates();
      // create a tab object that represents its state
      const currentState = tabstates[tabId] || {
        tabId,
        url: tab.url || '',
        title: tab.title || '',
        isAudible: false, // can be undefined if the audio doesnt exist yet so we default to false and update it later
        hasContentAudio: false,
        is_muted: false,
        paused: false,
        volume: 0,
        lastUpdate: Date.now() 
      }
      // update the object when a tab's state changes 
      await updateTabstate(tabId, {
        ...currentState, // keep existing values 
        isAudible: changeInfo.audible || false,
        title: tab.title || currentState.title, //Preserve existing title/url if new ones are empty, Chrome sometimes sends empty strings when tab updates
        url: tab.url || currentState.url,
      })
      await sendAudioTabsToPopup();
    }
  })


  // Listen for messages from content scripts
  browser.runtime.onMessage.addListener((message, sender) => {
    const tabId = sender.tab?.id
    if (!tabId) return
    
    console.log(`[Content Script] Message from tab ${tabId}:`, message)
    
    switch (message.type) {
      case 'AUDIO_DETECTED':
        handleContentAudioDetected(tabId, message)
        break
        
      case 'AUDIO_STOPPED':
        handleContentAudioStopped(tabId, message)
        break
      
      case 'AUDIO_PAUSED':
        handleContentAudioPaused(tabId, message)
        break

      case 'VOLUME_CHANGED':
        handleContentAudioChanged(tabId, message)
        break
/* 
      case 'TAB_LOADED':
        handleTabLoaded(tabId, message)
        break
*/
    }

  })

  // STEP 3: Clean up closed tabs
  browser.tabs.onRemoved.addListener(async (tabId) => {
    await deleteTabState(tabId);
    console.log(`Tab ${tabId} closed, removing from state`)
    
    await sendAudioTabsToPopup()
    
  })


  async function sendAudioTabsToPopup(){ // we call this function in every place where audio state is updated/changes
    const tabstates = await getTabstates();
    // Send current audio tabs to popup
    // Object.values converts the tabstates object to an array so we can filter
    const audioTabs = Object.values(tabstates).filter(
      // send tabs that have audio from isAudible and hasContentAudio and paused tabs so users can see them in the UI
      tab => tab.isAudible || tab.hasContentAudio || tab.paused
    )
    popupPorts.forEach(port => {
      port.postMessage({
        type: 'AUDIO_TABS_UPDATE',
        tabs: audioTabs
      })
    })
    

  }



  // Handle popup requests for current state
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'popup') {
      popupPorts.push(port);
      port.onDisconnect.addListener(() => {
        popupPorts = popupPorts.filter(p => p != port);
      });
      port.onMessage.addListener((message) => {
        if (message.type === 'GET_AUDIO_TABS') {
          sendAudioTabsToPopup()
        }
      })
    }
  })

  

  
// STEP 5: Helper functions

async function handleContentAudioDetected(tabId: number, message: any) {
  const tabstates = await getTabstates();
  const existingState = tabstates[tabId] || {
    tabId,
    url: message.url || '',
    title: message.title || '',
    isAudible: false,
    hasContentAudio: false,
    is_muted: message.muted,
    paused: false,
    volume: message.volume,
    lastUpdate: Date.now()
  }
  
  await updateTabstate(tabId, {
    ...existingState,
    hasContentAudio: true,
    paused: false,
    url: message.url || existingState.url, // we dont want a title or url to be empty string 
    title: message.title ||  existingState.title,

    is_muted: message.muted ?? existingState.is_muted, // Use nullish coalescing (??) to handle undefined vs false/0 properly 
    volume: message.volume ?? existingState.volume, // This ensures we don't overwrite valid false/0 values with default
    lastUpdate: Date.now(),
  })
 
  
  
  console.log(`[Content Script] Audio detected on tab ${tabId}`)
  logPlayingTabs()
  await sendAudioTabsToPopup()
}

async function handleContentAudioStopped(tabId: number, message: any) {
  const tabstates = await getTabstates();
  const existingState = tabstates[tabId]
  if (existingState) {
    await updateTabstate(tabId, {
    ...existingState,
    hasContentAudio: false,
    paused: false,
    lastUpdate: Date.now()
    })

    console.log(`[Content Script] Audio stopped on tab ${tabId}`)
    logPlayingTabs()
    await sendAudioTabsToPopup()
  }
}

async function handleContentAudioPaused(tabId: number, message: any) {
  const tabstates = await getTabstates();
  const existingState = tabstates[tabId];
  if(existingState) {
    await updateTabstate(tabId, {
      ...existingState,
      hasContentAudio: false,
      lastUpdate: Date.now(),
      paused: true,
    })
    
    console.log(`[Content Script] Audio paused on tab ${tabId}`)
    logPlayingTabs()
    await sendAudioTabsToPopup()
  }
}

async function handleContentAudioChanged(tabId: number, message: any) {
  const tabstates = await getTabstates();
  const existingState = tabstates[tabId];
  if(existingState) {
    await updateTabstate(tabId, {
      ...existingState,
      is_muted: message.muted ?? existingState.is_muted,
      volume: message.volume ?? existingState.volume,
      lastUpdate: Date.now(),
    })
    
    console.log(`[Content Script] Audio changed on tab ${tabId} volume: ${message.volume}`)
    logPlayingTabs()
    await sendAudioTabsToPopup()
  }
}

async function logPlayingTabs() {
  const tabstates = await getTabstates();
  const playingTabs = Object.values(tabstates).filter(
    tab => tab.isAudible || tab.hasContentAudio
  )
  
  if (playingTabs.length > 0) {
    console.log('🔊 Currently playing tabs:')
    playingTabs.forEach(tab => {
      const sources = []
      if (tab.isAudible) sources.push('Chrome API')
      if (tab.hasContentAudio) sources.push('Content Script')
      
      console.log(`  - ${tab.title} (${sources.join(' + ')})`)
    })
  } else {
    console.log('🔇 No audio detected')
  }
}

});


/*
function handleTabLoaded(tabId: number, message: any) {
  const existingState = tabStates.get(tabId) || {
    tabId,
    url: message.url || '',
    title: message.title || '',
    isAudible: false,
    hasContentAudio: false,
    is_muted: message.muted,
    volume: message.volume,
    lastUpdate: Date.now()
  }
  
  existingState.url = message.url || existingState.url
  existingState.title = message.title || existingState.title
  existingState.lastUpdate = Date.now()
  
  tabStates.set(tabId, existingState)
  sendAudioTabsToPopup()
  
  console.log(`[Content Script] Tab loaded: ${tabId}`)
}
*/
