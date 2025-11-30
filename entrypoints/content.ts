export default defineContentScript({
  matches: ['<all_urls>'],
  main() {

    const audioElements = new Set<HTMLMediaElement>;
    let isTabPlayingAudio = false;

      // Function to notify if a tab is playing audio or not
    function updateAudioStatus(state: string, data: {muted?: Boolean, volume?: number} = {}) {
        
      browser.runtime.sendMessage({
        type: state, ...data, // ...data means we extract the values inside data without needing to things like data.volume/data.muted
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
          currentMuted = element.muted;
        }
      });
      if (anyPlaying) {
        if (!isTabPlayingAudio) {
          // Audio just started (transition from silent to playing)
          isTabPlayingAudio = true;
          updateAudioStatus("AUDIO_DETECTED", {muted: currentMuted, volume: currentVolume});
        }
      } else {
        if (isTabPlayingAudio) {
          // All audio stopped (transition from playing to silent)
          isTabPlayingAudio = false;
          updateAudioStatus("AUDIO_STOPPED");
        }
      }
    }


    function addMediaEventListener(element: HTMLMediaElement) {
      element.addEventListener('play', () => {
        const volume = element.volume;
        const muted = element.muted;
        isTabPlayingAudio = true;
        updateAudioStatus("AUDIO_DETECTED", {muted, volume});
      })

      element.addEventListener('pause', () => {
        // Check if other elements are still playing
        checkAnyAudioPlaying();
        // If still playing, it will be AUDIO_DETECTED
        // If nothing playing, it will be AUDIO_STOPPED
        // So we send AUDIO_PAUSED to indicate this specific element paused
        if (!isTabPlayingAudio) {
          updateAudioStatus("AUDIO_PAUSED");
        }
      })

      element.addEventListener('ended', () => {
        checkAnyAudioPlaying();
        if (!isTabPlayingAudio) {
          updateAudioStatus("AUDIO_STOPPED");
        }
      })
      
      element.addEventListener('volumechange', () => {
        const volume = element.volume;
        const muted = element.muted;
        updateAudioStatus("VOLUME_CHANGED", {muted, volume});
        
      })
    }



    // Function to scan for audio/video elements and add them to an array set 
    function scanForMediaElements() {
      const mediaElements = document.querySelectorAll('audio, video') as NodeListOf<HTMLMediaElement>;
      mediaElements.forEach(element => {
        if(!audioElements.has(element)) {
          audioElements.add(element);
          addMediaEventListener(element);
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
          setTimeout(scanForMediaElements, 100)
        }
      })
      
      observer.observe(document.body, {
        childList: true,
        subtree: true
      })
    }

    /** 
    // Periodic check for audio state
    function setupPeriodicCheck() {
      setInterval(() => {
        checkAnyAudioPlaying()
      }, 2000) // Check every 2 seconds
    }
*/
    hookWebAudioAPI();
    scanForMediaElements();
    setupMutationObserver();
    //setupPeriodicCheck();

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

  },
});
