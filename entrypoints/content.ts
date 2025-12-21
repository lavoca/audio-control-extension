/**
 * CONTENT SCRIPT (runs once per tab)
 * - Detects audio/video elements in the page DOM
 * - Listens for play/pause/volume events on media elements
 * - Sends audio state updates to background script
 * - Receives volume/mute control commands from popup and applies them to elements
 */


export default defineContentScript({
  matches: ['<all_urls>'],

  main() {

    const audioElements = new Set<HTMLMediaElement>;
    let isTabPlayingAudio = false;

      // Function to notify if a tab is playing audio or not
    function updateAudioStatus(state: string, data: {muted?: Boolean, volume?: number} = {}) {

      // CONTENT SCRIPT: Send audio state TO background
      // Browser automatically attaches this tab's ID for background to know who sent it  
      browser.runtime.sendMessage({
        type: state, 
        ...data, // "...data" means we extract the values inside data without needing to do things like data.volume: / data.muted:
        url: window.location.href,
        title: document.title,
        timestamp: Date.now()
      })
      
    }

    // CONTENT SCRIPT: Receive volume control commands FROM popup/background
    // Browser already routed this message to THIS specific tab only
    browser.runtime.onMessage.addListener((message) =>{
      // we are already in the correct tab so we just loop through the elemets inside it
      if(message.type === 'UI_VOLUME_CHANGE') {
        audioElements.forEach(element => {

          element.volume = message.volume;

        }) 
      } else if(message.type === 'UI_MUTE_SET') {
        audioElements.forEach(element => {
          if(message.is_muted === false && element.volume === 0) { // if the mute value we get from popup is false which means we want to unmute and the volume is 0 from popup
            element.volume = message.initialVolume; // initial volume we want to go back to after we unmute from volume being 0
          }else {
            element.muted = message.is_muted;
          } 
        })
      } // this volume and mute change will then be detected by addEventListener('volumechange') and fires updateAudioStatus and everything proceeds as normal from there
    })

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


