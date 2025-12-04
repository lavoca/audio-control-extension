/**
// content.ts - Universal Audio Detection Engine
export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    // --- TYPES & STATE ---
    type AudioStateEvent = 'AUDIO_DETECTED' | 'AUDIO_PAUSED' | 'AUDIO_STOPPED' | 'VOLUME_CHANGED' | 'MUTED' | 'UNMUTED' | 'WEB_AUDIO_ACTIVE';
    const tracked = new WeakMap<HTMLMediaElement, { lastPlaying: boolean; lastVolume?: number; lastMuted?: boolean; attrObserver?: MutationObserver }>();
    const mediaElements = new Set<HTMLMediaElement>();
    let pollingHandle: number | null = null;
    let observer: MutationObserver | null = null;

    // send messages to background (top-level props)
    function updateAudioStatus(event: AudioStateEvent, data: { volume?: number; muted?: boolean } = {}) {
      try {
        browser.runtime.sendMessage({
          type: event,
          ...data,
          url: location.href,
          title: document.title,
          timestamp: Date.now()
        });
      } catch (e) {
        // ignore (page might be unloading)
      }
    }

    // --- HELPERS ---
    function isElementPlaying(el: HTMLMediaElement) {
      try {
        return !el.paused && !el.ended && el.readyState > 0;
      } catch {
        return false;
      }
    }

    function safeNumber(n: any) {
      return typeof n === 'number' && isFinite(n) ? n : 0;
    }

    // Attach attribute observer for elements that change attributes rather than firing events
    function attachAttributeObserver(el: HTMLMediaElement) {
      if (tracked.get(el)?.attrObserver) return;
      const attrObs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && (m.attributeName === 'muted' || m.attributeName === 'volume')) {
            const volume = safeNumber(el.volume);
            const muted = !!el.muted;
            handleVolumeChange(el, volume, muted);
          }
        }
      });
      attrObs.observe(el, { attributes: true, attributeFilter: ['muted', 'volume'] });
      tracked.set(el, { ...(tracked.get(el) || { lastPlaying: false }), attrObserver: attrObs });
    }

    // Clean up per-element observers when element is removed
    function detachAttributeObserver(el: HTMLMediaElement) {
      const info = tracked.get(el);
      if (info?.attrObserver) {
        try { info.attrObserver.disconnect(); } catch {}
        delete (info as any).attrObserver;
        tracked.set(el, info);
      }
    }

    // Per-element event handlers
    function addMediaListeners(el: HTMLMediaElement) {
      if (mediaElements.has(el)) return;
      mediaElements.add(el);

      // store initial tracked state
      tracked.set(el, { lastPlaying: isElementPlaying(el), lastVolume: safeNumber(el.volume), lastMuted: !!el.muted });

      // play
      el.addEventListener('play', () => {
        updateAudioStatus('AUDIO_DETECTED', { volume: el.volume, muted: el.muted });
        const info = tracked.get(el); if (info) info.lastPlaying = true;
      }, { passive: true });

      // pause
      el.addEventListener('pause', () => {
        // if any media element still playing, we'll let periodic scan decide overall tab state,
        // but we still notify of pause on this element
        updateAudioStatus('AUDIO_PAUSED', { volume: el.volume, muted: el.muted });
        const info = tracked.get(el); if (info) info.lastPlaying = false;
      }, { passive: true });

      // ended
      el.addEventListener('ended', () => {
        updateAudioStatus('AUDIO_STOPPED', { volume: el.volume, muted: el.muted });
        const info = tracked.get(el); if (info) info.lastPlaying = false;
      }, { passive: true });

      // volume/mute changes (many sites use this)
      el.addEventListener('volumechange', () => {
        const volume = safeNumber(el.volume);
        const muted = !!el.muted;
        handleVolumeChange(el, volume, muted);
      }, { passive: true });

      // attribute observer (for sites that change attributes instead of firing events)
      attachAttributeObserver(el);
    }

    function handleVolumeChange(el: HTMLMediaElement, volume: number, muted: boolean) {
      const info = tracked.get(el);
      const lastVol = info?.lastVolume ?? null;
      const lastMuted = info?.lastMuted ?? null;

      // If volume changed or muted toggled, emit update
      if (lastVol !== volume || lastMuted !== muted) {
        updateAudioStatus('VOLUME_CHANGED', { volume, muted });
        // also emit explicit MUTED/UNMUTED for UI clarity
        if (muted && !lastMuted) updateAudioStatus('MUTED', { volume, muted });
        if (!muted && lastMuted) updateAudioStatus('UNMUTED', { volume, muted });
      }

      tracked.set(el, { ...(info || { lastPlaying: false }), lastVolume: volume, lastMuted: muted, attrObserver: info?.attrObserver });
    }

    // Remove references when element is removed from DOM
    function handleElementRemoved(el: HTMLMediaElement) {
      if (mediaElements.has(el)) {
        mediaElements.delete(el);
        detachAttributeObserver(el);
        tracked.delete(el);
      }
    }

    // Scan DOM for media elements and attach listeners
    function scanForMediaElements() {
      try {
        document.querySelectorAll('audio, video').forEach((node) => {
          const el = node as HTMLMediaElement;
          if (!mediaElements.has(el)) addMediaListeners(el);
        });
      } catch (e) {
        // ignore
      }
    }

    // Periodic polling fallback (300ms)
    function startPolling() {
      if (pollingHandle != null) return;
      pollingHandle = window.setInterval(() => {
        // Re-scan for new elements (covers dynamic replacement)
        scanForMediaElements();

        // For each tracked element, check playing/volume changes
        mediaElements.forEach((el) => {
          try {
            const playing = isElementPlaying(el);
            const info = tracked.get(el) || { lastPlaying: false };
            if (playing !== info.lastPlaying) {
              // Transition between playing/paused
              if (playing) updateAudioStatus('AUDIO_DETECTED', { volume: el.volume, muted: el.muted });
              else updateAudioStatus('AUDIO_PAUSED', { volume: el.volume, muted: el.muted });
              info.lastPlaying = playing;
            }
            // Volume/mute changes (some sites don't emit events)
            const vol = safeNumber(el.volume);
            const muted = !!el.muted;
            if (vol !== (info.lastVolume ?? vol) || muted !== (info.lastMuted ?? muted)) {
              handleVolumeChange(el, vol, muted);
            }
            tracked.set(el, info);
          } catch {}
        });
      }, 300);
    }

    function stopPolling() {
      if (pollingHandle != null) {
        clearInterval(pollingHandle);
        pollingHandle = null;
      }
    }

    // MutationObserver to detect added/removed nodes
    function startDomObserver() {
      if (observer) return;
      observer = new MutationObserver((mutations) => {
        let added = false;
        for (const m of mutations) {
          // added nodes - scan them
          if (m.addedNodes.length > 0) {
            m.addedNodes.forEach((n) => {
              if (n.nodeType !== Node.ELEMENT_NODE) return;
              const el = n as Element;
              if (el.tagName === 'AUDIO' || el.tagName === 'VIDEO' || el.querySelector?.('audio, video')) {
                added = true;
              }
            });
          }
          // removed nodes - if tracked element removed, clean up
          if (m.removedNodes.length > 0) {
            m.removedNodes.forEach((n) => {
              if (n.nodeType !== Node.ELEMENT_NODE) return;
              const el = n as Element;
              el.querySelectorAll?.('audio, video').forEach((inner) => handleElementRemoved(inner as HTMLMediaElement));
              if (el.tagName === 'AUDIO' || el.tagName === 'VIDEO') handleElementRemoved(el as HTMLMediaElement);
            });
          }
        }
        if (added) {
          // small delay to allow frameworks to finish creating element attributes
          setTimeout(scanForMediaElements, 50);
        }
      });
      // observe document body (guard in case body missing)
      try {
        if (document.body) observer.observe(document.body, { childList: true, subtree: true });
      } catch {}
    }

    // WebAudio hooking: try to intercept createMediaElementSource & createGain
    function hookWebAudioAPI() {
      try {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;

        // Hook createMediaElementSource - will let us detect media elements connected to WebAudio
        const origCreateMediaElementSource = AudioCtx.prototype.createMediaElementSource;
        if (origCreateMediaElementSource) {
          AudioCtx.prototype.createMediaElementSource = function (this: any, mediaEl: HTMLMediaElement) {
            try {
              if (mediaEl && !mediaElements.has(mediaEl)) addMediaListeners(mediaEl);
              updateAudioStatus('WEB_AUDIO_ACTIVE'); // signal web audio usage in tab
            } catch {}
            return origCreateMediaElementSource.call(this, mediaEl);
          };
        }

        // Hook createGain as heuristic: many libs createGain and connect nodes to play audio
        const origCreateGain = AudioCtx.prototype.createGain;
        if (origCreateGain) {
          AudioCtx.prototype.createGain = function (this: any, ...args: any[]) {
            const node = origCreateGain.apply(this, args);
            try {
              // attach simple analyser to monitor audio presence (non-blocking)
              if ((node as any).context && !(node as any).__patched__) {
                (node as any).__patched__ = true;
                // we do not build heavy analysis here — just announce web-audio usage
                setTimeout(() => updateAudioStatus('WEB_AUDIO_ACTIVE'), 0);
              }
            } catch {}
            return node;
          };
        }
      } catch {}
    }

    // --- INIT ---
    scanForMediaElements();
    startDomObserver();
    startPolling();
    hookWebAudioAPI();

    // Clean up on unload
    window.addEventListener('pagehide', () => {
      stopPolling();
      if (observer) { try { observer.disconnect(); } catch {} }
      mediaElements.forEach((el) => detachAttributeObserver(el));
      mediaElements.clear();
    }, { passive: true });
  }
});



*/

























export default defineContentScript({
  matches: ['<all_urls>'],

  main() {

    const audioElements = new Set<HTMLMediaElement>;
    let isTabPlayingAudio = false;

      // Function to notify if a tab is playing audio or not
    function updateAudioStatus(state: string, data: {muted?: Boolean, volume?: number} = {}) {
        
      browser.runtime.sendMessage({
        type: state, 
        ...data, // "...data" means we extract the values inside data without needing to do things like data.volume: / data.muted:
        url: window.location.href,
        title: document.title,
        timestamp: Date.now()
      })
      
    }

    // function to determine if a tab has any element that is playing audio
    // a tab can have many media elements that can play audio if one of them is playing then the whole tab is playing 
    function checkAnyAudioPlaying() {
      let anyPlaying = false;
      let currentVolume = 0;
      let currentMuted = false;
      audioElements.forEach(element => {       
        if(!element.paused && !element.ended && element.readyState > 0 ) { // if not paused and not ended and audio element is in a state that is loaded so any state bigger than 0
          anyPlaying = true;
          currentVolume = element.volume; 
          currentMuted = element.muted || element.volume === 0; // if slider goes to 0 we treat it as muted
        }
      });
      if (anyPlaying) {
        if (isTabPlayingAudio === false) {
          // Audio just started (transition from silent to playing)
          isTabPlayingAudio = true;
          updateAudioStatus("AUDIO_DETECTED", {muted: currentMuted, volume: currentVolume});
        }else {
          // Already playing but state might have changed (new video in shorts)
          updateAudioStatus("AUDIO_DETECTED", {muted: currentMuted, volume: currentVolume}); ////////////
        }
      } else {
        if (isTabPlayingAudio === true) {
          // All audio stopped (transition from playing to silent)
          isTabPlayingAudio = false;
          updateAudioStatus("AUDIO_STOPPED");
        }
      }
    }


    function addMediaEventListener(element: HTMLMediaElement) {
      element.addEventListener('play', () => {
        const volume = element.volume;
        const muted = element.muted || element.volume === 0;
        isTabPlayingAudio = true;
        updateAudioStatus("AUDIO_DETECTED", {muted, volume});
      })

      // Send pause event immediately with current state
      element.addEventListener('pause', () => {
        // Check if other elements are still playing
        checkAnyAudioPlaying(); // If still playing, it will be AUDIO_DETECTED. If nothing is playing, it will be AUDIO_STOPPED
              
        // So we send AUDIO_PAUSED to indicate this specific element paused
        if (isTabPlayingAudio === false) {
                                        
          updateAudioStatus("AUDIO_PAUSED", {muted: element.muted || element.volume === 0, volume: element.volume});
        }
      }) 

      element.addEventListener('ended', () => {
        checkAnyAudioPlaying();
        if (isTabPlayingAudio === false) {
          updateAudioStatus("AUDIO_STOPPED");
        }
      })
      
      element.addEventListener('volumechange', () => {
        const volume = element.volume;
        const muted = element.muted || element.volume === 0;
        updateAudioStatus("VOLUME_CHANGED", {muted, volume});
        
      })

      // loadedmetadata listener for shorts/tiktok videos
      element.addEventListener('loadedmetadata', () => {
        // When new video loads in shorts, update state immediately
        if (!element.paused && element.readyState > 0) {
          const volume = element.volume;
          const muted = element.muted || element.volume === 0;
          updateAudioStatus("AUDIO_DETECTED", {muted, volume});
        }
      })

      // playing event - fires when video actually starts playing after buffering
      element.addEventListener('playing', () => {
        const volume = element.volume;
        const muted = element.muted || element.volume === 0;
        isTabPlayingAudio = true;
        updateAudioStatus("AUDIO_DETECTED", {muted, volume});
      });

      // canplay event - fires when video is ready to play
      element.addEventListener('canplay', () => {
        if (!element.paused) {
          const volume = element.volume;
          const muted = element.muted || element.volume === 0;
          updateAudioStatus("AUDIO_DETECTED", {muted, volume});
        }
      });
      
    }



    // Function to scan for audio/video elements and add them to an array set 
    function scanForMediaElements() {
      const mediaElements = document.querySelectorAll('audio, video') as NodeListOf<HTMLMediaElement>;
      mediaElements.forEach(element => {
        if(!audioElements.has(element)) {
          audioElements.add(element);
          addMediaEventListener(element);
          // Check if this newly found element is already playing
          if (!element.paused && element.readyState > 0) {
            const volume = element.volume;
            const muted = element.muted || element.volume === 0;
            isTabPlayingAudio = true;
            updateAudioStatus("AUDIO_DETECTED", {muted, volume});
          }
        }
      });
    }


    // Setup mutation observer for dynamic content
    // Detect dynamically added media elements

    function setupMutationObserver() {
      const observer = new MutationObserver((mutations) => {
        let shouldScan = false
        
        mutations.forEach((mutation) => {
          if (mutation.addedNodes.length > 0) {
            // Check if any added nodes contain media elements
            mutation.addedNodes.forEach(node => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node as Element
                if (element.tagName === 'AUDIO' || element.tagName === 'VIDEO' || element.querySelector('audio, video')) {
                  shouldScan = true
                }
              }
            })
          }
        })
        
        if (shouldScan) {
          // Wait a bit for elements to be fully loaded
          setTimeout(scanForMediaElements, 300)
        }
      })
      
      observer.observe(document.body, {
        childList: true,
        subtree: true
      })
    }

    
    // Periodic check to catch missed elements (helpful for Reddit/dynamic sites)
    function setupPeriodicCheck() {
      setInterval(() => {
        scanForMediaElements();
        // Always check current playing state for shorts/tiktok
        if (isTabPlayingAudio === true) {
          checkAnyAudioPlaying();
        }
      }, 2000) // Check every 2 seconds
    }
  
    

    // This function "intercepts" Web Audio API calls to detect audio usage
    function hookWebAudioAPI() {

      // Web Audio API has two possible names depending on browser
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;

      // if we dont find it, exit early 
      if (!AudioContextClass) {
        console.log('Web Audio API not supported in this browser')
        return
      }
      // Get the original method we want to intercept
      // createMediaElementSource() connects HTML <audio>/<video> to Web Audio processing
      const originalCreateMediaElementSource = AudioContextClass.prototype.createMediaElementSource;

      // If this method doesn't exist, exit 
      if (!originalCreateMediaElementSource) {
        console.log('createMediaElementSource method not found')
        return
      }

      // STEP 3: Replace the original method with our custom version
      // This is called "monkey patching" - modifying existing browser APIs
      AudioContextClass.prototype.createMediaElementSource = function(mediaElement: HTMLMediaElement) {

        // Add this element to our tracking
        // This element might not have been found by our regular DOM scanning
        // because it was created dynamically or is hidden
        if(!audioElements.has(mediaElement)) {
          audioElements.add(mediaElement);
          addMediaEventListener(mediaElement); // Add the same event listeners we add to regular elements
        }else {
          console.log('   - Element already being tracked');
        }

        // STEP 5: Call the original method and return its result
        // IMPORTANT: We must call the original method so the Web Audio API still works!
        // We're just "spying" on the call, not breaking it
        const result = originalCreateMediaElementSource.call(this, mediaElement);
        return result
      }       
    
    }
    
    // Initialize
    hookWebAudioAPI();
    
    // Initial scan after a short delay to ensure DOM is ready
    setTimeout(() => {
      scanForMediaElements();
    }, 500);
    
    setupMutationObserver();
    
    setupPeriodicCheck();


  },
});




















/** 


export default defineContentScript({
  matches: ['<all_urls>'],

  main() {
    const audioElements = new Set<HTMLMediaElement>();
    let isTabPlayingAudio = false;

    // Track current state to include in all messages
    let currentAudioState = {
      volume: 0,
      muted: false,
    };

    function updateAudioStatus(state: string, data: {muted?: boolean, volume?: number} = {}) {
      // Update our tracking
      if (data.volume !== undefined) currentAudioState.volume = data.volume;
      if (data.muted !== undefined) currentAudioState.muted = data.muted;
      
      browser.runtime.sendMessage({
        type: state,
        // Always include current state
        muted: currentAudioState.muted,
        volume: currentAudioState.volume,
        url: window.location.href,
        title: document.title,
        timestamp: Date.now()
      });
    }

    function checkAnyAudioPlaying() {
      let anyPlaying = false;
      let maxVolume = 0;
      let anyMuted = false;
      
      audioElements.forEach(element => {
        if (!element.paused && !element.ended && element.readyState > 0) {
          anyPlaying = true;
          // Track the loudest non-muted element, or any element if all are muted
          if (!element.muted && element.volume > maxVolume) {
            maxVolume = element.volume;
          }
          if (element.muted) {
            anyMuted = true;
          }
        }
      });

      // Update current state
      currentAudioState.volume = maxVolume;
      currentAudioState.muted = anyMuted && maxVolume === 0; // Only fully muted if no audible elements

      if (anyPlaying) {
        if (!isTabPlayingAudio) {
          isTabPlayingAudio = true;
          updateAudioStatus("AUDIO_DETECTED");
        }
      } else {
        if (isTabPlayingAudio) {
          isTabPlayingAudio = false;
          updateAudioStatus("AUDIO_STOPPED");
        }
      }
    }

    function addMediaEventListener(element: HTMLMediaElement) {
      element.addEventListener('play', () => {
        currentAudioState.volume = element.volume;
        currentAudioState.muted = element.muted;
        isTabPlayingAudio = true;
        updateAudioStatus("AUDIO_DETECTED");
      });

      element.addEventListener('pause', () => {
        // Include current element's state when pausing
        updateAudioStatus("AUDIO_PAUSED", {
          muted: element.muted,
          volume: element.volume
        });
        
      });

      element.addEventListener('ended', () => {
        checkAnyAudioPlaying();
        if (!isTabPlayingAudio) {
          updateAudioStatus("AUDIO_STOPPED");
        }
      });
      
      element.addEventListener('volumechange', () => {
        updateAudioStatus("VOLUME_CHANGED", {
          muted: element.muted,
          volume: element.volume
        });
      });
    }

    function scanForMediaElements() {
      const mediaElements = document.querySelectorAll('audio, video') as NodeListOf<HTMLMediaElement>;
      mediaElements.forEach(element => {
        if (!audioElements.has(element)) {
          audioElements.add(element);
          addMediaEventListener(element);
          
          // Check if this element is already playing
          if (!element.paused && !element.ended && element.readyState > 0) {
            currentAudioState.volume = element.volume;
            currentAudioState.muted = element.muted;
            isTabPlayingAudio = true;
            updateAudioStatus("AUDIO_DETECTED");
          }
        }
      });
    }

    function setupMutationObserver() {
      const observer = new MutationObserver((mutations) => {
        let shouldScan = false;
        
        mutations.forEach((mutation) => {
          if (mutation.addedNodes.length > 0) {
            mutation.addedNodes.forEach(node => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node as Element;
                if (element.tagName === 'AUDIO' || element.tagName === 'VIDEO' || 
                    element.querySelector('audio, video')) {
                  shouldScan = true;
                }
              }
            });
          }
        });
        
        if (shouldScan) {
          // Increased timeout for slow-loading sites like Reddit
          setTimeout(scanForMediaElements, 300);
        }
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    // Periodic check to catch missed elements (helpful for Reddit/dynamic sites)
    function setupPeriodicCheck() {
      setInterval(() => {
        scanForMediaElements();
        checkAnyAudioPlaying();
      }, 3000); // Check every 3 seconds
    }

    function hookWebAudioAPI() {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      
      if (!AudioContextClass) return;
      
      const originalCreateMediaElementSource = AudioContextClass.prototype.createMediaElementSource;
      
      if (!originalCreateMediaElementSource) return;

      AudioContextClass.prototype.createMediaElementSource = function(mediaElement: HTMLMediaElement) {
        if (!audioElements.has(mediaElement)) {
          audioElements.add(mediaElement);
          addMediaEventListener(mediaElement);
        }
        
        return originalCreateMediaElementSource.call(this, mediaElement);
      };
    }

    // Initialize
    hookWebAudioAPI();
    
    // Initial scan after a short delay to ensure DOM is ready
    setTimeout(() => {
      scanForMediaElements();
    }, 500);
    
    setupMutationObserver();
    setupPeriodicCheck();
  },
});
*/