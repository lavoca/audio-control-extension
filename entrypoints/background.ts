import { browser } from 'wxt/browser';
  
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

const tabStates = new Map<number, TabAudioState>();
let popupPorts: Browser.runtime.Port[] = [];// Keep track of connected popup ports 


 
export default defineBackground(() => {

  // Listen for tab audio changes using Chrome API (onUpdated)
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only process if audible state changed
    if(changeInfo.audible !== undefined) {
      // create a tab object that represents its state
      const currentState = tabStates.get(tabId) || {
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
      currentState.isAudible = changeInfo.audible || false;
      currentState.title = tab.title || currentState.title; //Preserve existing title/url if new ones are empty, Chrome sometimes sends empty strings when tab updates
      currentState.url = tab.url || currentState.url;
      currentState.lastUpdate = Date.now();

      // push the new tabstate data to the hashmap
      tabStates.set(tabId, currentState);
      sendAudioTabsToPopup();
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
  browser.tabs.onRemoved.addListener((tabId) => {
    if (tabStates.has(tabId)) {
      console.log(`Tab ${tabId} closed, removing from state`)
      tabStates.delete(tabId)
      sendAudioTabsToPopup()
    }
  })


  function sendAudioTabsToPopup(){ // we call this function in every place where audio state is updated/changes

    // Send current audio tabs to popup
    const audioTabs = Array.from(tabStates.values()).filter(
      // Include paused tabs so users can see them in the UI
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

function handleContentAudioDetected(tabId: number, message: any) {
  const existingState = tabStates.get(tabId) || {
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
  
  existingState.hasContentAudio = true,
  existingState.paused = false,
  existingState.url = message.url || existingState.url,
  existingState.title = message.title || existingState.title,

  existingState.is_muted = message.muted ?? existingState.is_muted;// Use nullish coalescing (??) to handle undefined vs false/0 properly 
  existingState.volume = message.volume ?? existingState.volume; // This ensures we don't overwrite valid false/0 values with default
  existingState.lastUpdate = Date.now(),
  
  tabStates.set(tabId, existingState),
  
  console.log(`[Content Script] Audio detected on tab ${tabId}`)
  logPlayingTabs()
  sendAudioTabsToPopup()
}

function handleContentAudioStopped(tabId: number, message: any) {
  const existingState = tabStates.get(tabId)
  if (existingState) {
    existingState.hasContentAudio = false,
    existingState.paused = false,
    existingState.lastUpdate = Date.now()
    tabStates.set(tabId, existingState)
    
    console.log(`[Content Script] Audio stopped on tab ${tabId}`)
    logPlayingTabs()
    sendAudioTabsToPopup()
  }
}

function handleContentAudioPaused(tabId: number, message: any) {
  const existingState = tabStates.get(tabId);
  if(existingState) {
    existingState.hasContentAudio = false;
    existingState.lastUpdate = Date.now();
    existingState.paused = true,
    tabStates.set(tabId, existingState)
    
    console.log(`[Content Script] Audio paused on tab ${tabId}`)
    logPlayingTabs()
    sendAudioTabsToPopup()
  }
}

function handleContentAudioChanged(tabId: number, message: any) {
  const existingState = tabStates.get(tabId);
  if(existingState) {
    
    existingState.is_muted = message.muted || existingState.is_muted,
    existingState.volume = message.volume || existingState.volume,
    existingState.lastUpdate = Date.now(),
    tabStates.set(tabId, existingState)
    
    console.log(`[Content Script] Audio paused on tab ${tabId} volume: ${message.volume}`)
    logPlayingTabs()
    sendAudioTabsToPopup()
  }
}
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


function logPlayingTabs() {
  const playingTabs = Array.from(tabStates.values()).filter(
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
