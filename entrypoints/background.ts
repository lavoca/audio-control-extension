
/**
 * BACKGROUND SCRIPT (runs once globally)
 * - Receives audio state updates from all content scripts
 * - Stores tab audio states in persistent storage
 * - Coordinates between content scripts and popup
 * - Sends aggregated audio tab data to popup via port connection
 */


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

// storage to hold tabs and their audio states so they can persist and not lose the data after a while 
const tabStatesStorage = storage.defineItem<Record<number, TabAudioState>>(
  'local:tabStates',
  { defaultValue: {} }
);

let popupPorts: Browser.runtime.Port[] = [];

let socket : WebSocket | null = null;
let heartbeatInterval: any;
let status: String = 'DISCONNECTED';
let tauriVolume: number;
let tauriMuted: boolean;

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

    // this only gets us info about the audible state and the title and the url, the other info we get from content script
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => { // this listens to updates from tabs
    if (changeInfo.audible !== undefined) { // check if tab has audio
      const tabstates = await getTabstates(); 
      const currentState = tabstates[tabId]; // get the tab by id from storage, the tabId is from the listener
      
      // Only update isAudible, preserve content script state
      if (currentState) { // if we already have info about this tab then update it in storage
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
      
      await sendTabsToPopupAndTauri();
    }
  });

  // get info about audio state of a tab from content script and handle them
  browser.runtime.onMessage.addListener((message, sender) => {
    const tabId = sender.tab?.id; // content script sends the exact tab id and its audio state 
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
    await sendTabsToPopupAndTauri();
  });

  // responsible for sending both to tauri app and to popup 
  async function sendTabsToPopupAndTauri() { 
    const tabstates = await getTabstates();
    const audioTabs = Object.values(tabstates).filter(
      tab => tab.isAudible || tab.hasContentAudio || tab.paused
    );
    
    // sends to popup
    popupPorts.forEach(port => { // send to popup
      port.postMessage({
        type: 'AUDIO_TABS_UPDATE',
        tabs: audioTabs
      });
    });

    // sends to tauri app via websocket server
    if(socket?.readyState === WebSocket.OPEN) { // if we have a connection to the websocket
        socket.send(JSON.stringify({
          type: 'AUDIO_TABS',
          payload: audioTabs
        }));  
    }
  }
  

  // this sends existing audio tabs to popup when first connected. it gets called in 'onMounted' in app.vue
  // it also sends those same audio tabs to tauri via websocket server. when the extension is mounted we do two things: send to popup and send to tauri the same tabs data
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'popup') {
      popupPorts.push(port);
      
      port.onDisconnect.addListener(() => {
        popupPorts = popupPorts.filter(p => p !== port);
      });
      
      port.onMessage.addListener((message) => { 
        if (message.type === 'GET_AUDIO_TABS') { // this is sent from app.vue when the popup is first mounted
          connect(); // connect to the server. inside this function we handle the sending of tabs to both tauri and popup.
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
    
    await sendTabsToPopupAndTauri();
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
      
      await sendTabsToPopupAndTauri();
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
      
      await sendTabsToPopupAndTauri();
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
      
      await sendTabsToPopupAndTauri();
    }
  }

  // connecting to a websocket server:
  // A one time send to notify the popup of the status of the connection to the server. this is different from 'port.sendMessage' that establishes a Long-lived Connection to the popup
  const updateStatus = (newStatus: String) => {
    status = newStatus;
    // Notify the Vue UI whenever the status changes
    browser.runtime.sendMessage({type: 'SERVER_STATUS', status})
  };

  let reconnectAttempts = 0; // keeps track of how many times we invoke connect() 

  // connecting to the sound-control-panel tauri app wesocket server in 'ws://127.0.0.1:8080'
  const connect = () => {
    if (socket) { // check if we have some previous connection and close it before starting a new one
      // This "cuts the wires" so the old socket can't trigger 
      // a new connect() when it finally finishes closing.
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.close();
      updateStatus('DISCONNECTED');
    }
    socket = new WebSocket('ws://127.0.0.1:8080');

    // the browser will kill this connection after 30 seconds
    // we need to send a ping message to the server every 20 seconds to reset the 30 seconds timer everytime so the connection can persist 
    socket.onopen = async () => {
      updateStatus('CONNECTED');
      reconnectAttempts = 0; // reset on new connection
      clearInterval(heartbeatInterval); // clears the previous interval
      heartbeatInterval = setInterval(() => {
        if(socket?.readyState === WebSocket.OPEN) { // if we have a connection to the websocket
          socket.send(JSON.stringify({type: 'ping'})); // send a ping message 
        }
      }, 20000); // after 20 seconds rerun this interval to send ping again 

      await sendTabsToPopupAndTauri(); // send tabs to tauri and popup when first connected
    }
    
    socket.onclose = (event) => {
      clearInterval(heartbeatInterval);
      if(event.code === 1000 || event.code === 1001) {
        updateStatus('DISCONNECTED');
        reconnectAttempts = 0; // reset on clean exit
        console.log('Clean closure from Tauri.');
      }else {
        updateStatus('RECONNECTING');
        reconnectAttempts++; // increments every time onclose is fired for not clean disconnect
        const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000); // 1s -> 2s -> 4s -> ... capped at 30s 
        setTimeout(() => connect(), delay); // Delay reconnection to avoid CPU spikes
      }
    }

    socket.onerror = (err) => {
      console.error('WebSocket error detected');
    }


    // the idea is to controll the volume slider directly in app.vue from tauri slider by sending to app.vue the tauri slider state every time it moves
    // we get volume values from tauri slider or a mute value and send it to popup and there we control the slider in app.vue with the slider from tauri app
    socket.onmessage = (event) => {
      // parse the data to json
      const data = JSON.parse(event.data);
      // handle data coming from rust
      tauriVolume = data.volume;
      tauriMuted = data.muted;
      browser.runtime.sendMessage({type: 'TAURI_VOLUME_CHANGED', data: {tauriVolume, tauriMuted}}).catch(() => {}); // Quietly ignore if popup is closed
    }
  
  }
  

});




