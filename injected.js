/**
 * Injected Script - Runs in page context
 * Intercepts fetch and XMLHttpRequest to capture Kaltura transcript responses
 */

(function() {
  'use strict';

  // ============================================
  // Logger Utility
  // ============================================
  const PREFIX = '[RH Learning Assistant]';
  
  const Logger = {
    info: (...args) => console.log(`${PREFIX} ℹ️`, ...args),
    success: (...args) => console.log(`${PREFIX} ✅`, ...args),
    warn: (...args) => console.warn(`${PREFIX} ⚠️`, ...args),
    error: (...args) => console.error(`${PREFIX} ❌`, ...args),
    debug: (...args) => console.log(`${PREFIX} 🔍`, ...args),
    network: (...args) => console.log(`${PREFIX} 🌐`, ...args),
  };

  // ============================================
  // Configuration
  // ============================================
  const KALTURA_API_URL = 'cdnapisec.kaltura.com/api_v3/service/multirequest';

  // Keywords indicating transcript/caption services in request body
  const CAPTION_SERVICE_INDICATORS = [
    'caption_captionasset',
    'captionAsset',
    'caption.list',
    'getCaptions',
    'transcript',
    'captionassetitem',
    'caption_captionassetitem'
  ];

  // Track statistics
  const stats = {
    totalIntercepted: 0,
    captionRequestsDetected: 0,
    transcriptsExtracted: 0,
    errors: 0
  };

  // ============================================
  // Detection Functions
  // ============================================

  /**
   * Check if request body indicates a transcript/caption request
   */
  function isTranscriptRequest(requestBody) {
    if (!requestBody) {
      Logger.debug('Request body is empty, skipping caption check');
      return false;
    }
    
    try {
      const bodyStr = typeof requestBody === 'string' 
        ? requestBody 
        : JSON.stringify(requestBody);
      
      const lowerBody = bodyStr.toLowerCase();
      
      for (const indicator of CAPTION_SERVICE_INDICATORS) {
        if (lowerBody.includes(indicator.toLowerCase())) {
          Logger.debug(`Caption indicator found: "${indicator}"`);
          return true;
        }
      }
      
      Logger.debug('No caption indicators found in request body');
      return false;
    } catch (e) {
      Logger.error('Error checking request body:', e.message);
      return false;
    }
  }

  /**
   * Check if response headers indicate transcript data (long cache)
   */
  function hasTranscriptCacheHeaders(headers) {
    if (!headers || typeof headers.get !== 'function') {
      return false;
    }
    
    try {
      const cacheControl = headers.get('cache-control') || '';
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
      
      if (maxAgeMatch) {
        const maxAge = parseInt(maxAgeMatch[1]);
        const isLongCache = maxAge > 86400; // > 1 day
        
        if (isLongCache) {
          Logger.debug(`Long cache detected: max-age=${maxAge} (${Math.round(maxAge/86400)} days)`);
        }
        
        return isLongCache;
      }
      
      return false;
    } catch (e) {
      Logger.error('Error checking cache headers:', e.message);
      return false;
    }
  }

  // ============================================
  // Transcript Extraction Functions
  // ============================================

  /**
   * Extract text segments from an objects array
   */
  function extractFromObjectsArray(objects) {
    const segments = [];
    let contentArraysFound = 0;

    for (const obj of objects) {
      // Check for content array with text segments
      if (obj && obj.content && Array.isArray(obj.content)) {
        contentArraysFound++;
        
        for (const segment of obj.content) {
          if (segment && segment.text) {
            segments.push(segment.text);
          }
        }
      }
    }

    return { segments, contentArraysFound };
  }

  /**
   * Extract transcript from Kaltura API response
   * Handles multiple response formats:
   * 1. Direct object: { objects: [...] }
   * 2. Array of objects: [{ objects: [...] }, ...]
   */
  function extractTranscriptFromResponse(data) {
    const segments = [];
    let objectsFound = 0;
    let contentArraysFound = 0;

    // Format 1: Direct object with 'objects' array
    // Example: { "objects": [{ "content": [{ "text": "..." }] }] }
    if (data && !Array.isArray(data) && data.objects && Array.isArray(data.objects)) {
      Logger.debug(`Response is direct object with ${data.objects.length} items in objects array`);
      objectsFound = 1;
      
      const result = extractFromObjectsArray(data.objects);
      segments.push(...result.segments);
      contentArraysFound = result.contentArraysFound;
      
      Logger.debug(`Direct object extraction: ${contentArraysFound} content arrays, ${segments.length} text segments`);
    }
    // Format 2: Array response (multirequest format)
    // Example: [{ "objects": [...] }, { "objects": [...] }]
    else if (Array.isArray(data)) {
      Logger.debug(`Response is array with ${data.length} items`);
      
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        
        if (item && item.objects && Array.isArray(item.objects)) {
          objectsFound++;
          Logger.debug(`Item ${i}: Found objects array with ${item.objects.length} entries`);
          
          const result = extractFromObjectsArray(item.objects);
          segments.push(...result.segments);
          contentArraysFound += result.contentArraysFound;
        }
      }
      
      Logger.debug(`Array extraction: ${objectsFound} objects arrays, ${contentArraysFound} content arrays, ${segments.length} text segments`);
    }
    else {
      Logger.debug('Response format not recognized');
      Logger.debug(`Response type: ${typeof data}, isArray: ${Array.isArray(data)}`);
      if (data && typeof data === 'object') {
        Logger.debug(`Response keys: ${Object.keys(data).slice(0, 10).join(', ')}`);
      }
      return null;
    }

    Logger.debug(`Extraction summary: ${objectsFound} objects arrays, ${contentArraysFound} content arrays, ${segments.length} text segments`);

    if (segments.length === 0) {
      return null;
    }
    
    return segments.join(' ');
  }

  /**
   * Clean transcript text
   */
  function cleanTranscript(text) {
    if (!text) return '';
    
    const original = text;
    let cleaned = text
      .replace(/\[\d+:\d+(?::\d+)?\]/g, '')  // Remove [HH:MM:SS] timestamps
      .replace(/\(\d+:\d+(?::\d+)?\)/g, '')  // Remove (HH:MM:SS) timestamps
      .replace(/\d+:\d+(?::\d+)?/g, '')      // Remove bare HH:MM:SS timestamps
      .replace(/\s+/g, ' ')                   // Normalize whitespace
      .replace(/\s+([.,!?;:])/g, '$1')       // Fix punctuation spacing
      .trim();
    
    const removed = original.length - cleaned.length;
    if (removed > 0) {
      Logger.debug(`Cleaned transcript: removed ${removed} characters (timestamps, whitespace)`);
    }
    
    return cleaned;
  }

  /**
   * Send transcript to content script
   */
  function sendTranscriptToExtension(transcript) {
    Logger.info('Sending transcript to extension...');
    
    window.postMessage({
      type: 'RH_SUMMARIZER_TRANSCRIPT',
      transcript: transcript
    }, '*');
    
    Logger.success('Transcript sent to extension successfully');
  }

  // ============================================
  // Main Processing Function
  // ============================================

  /**
   * Process potential Kaltura response
   */
  function processResponse(url, responseText, requestBody, headers) {
    if (!url.includes(KALTURA_API_URL)) return;

    stats.totalIntercepted++;
    Logger.network(`Processing Kaltura request #${stats.totalIntercepted}`);

    // Detection signals
    const isLikelyCaptionRequest = isTranscriptRequest(requestBody);
    const hasTranscriptHeaders = hasTranscriptCacheHeaders(headers);

    if (isLikelyCaptionRequest) {
      stats.captionRequestsDetected++;
      Logger.info(`Caption request detected (#${stats.captionRequestsDetected})`);
    }

    // Log detection summary
    Logger.debug('Detection signals:', {
      captionRequestBody: isLikelyCaptionRequest,
      longCacheHeaders: hasTranscriptHeaders,
      responseSize: responseText ? responseText.length : 0
    });

    // Try to parse and extract transcript
    try {
      Logger.debug('Parsing JSON response...');
      const data = JSON.parse(responseText);
      Logger.debug('JSON parsed successfully');
      
      Logger.debug('Attempting to extract transcript...');
      const rawTranscript = extractTranscriptFromResponse(data);
      
      if (rawTranscript) {
        Logger.info(`Raw transcript found: ${rawTranscript.length} characters`);
        
        const cleanedTranscript = cleanTranscript(rawTranscript);
        Logger.info(`Cleaned transcript: ${cleanedTranscript.length} characters`);
        
        if (cleanedTranscript.length > 50) {
          stats.transcriptsExtracted++;
          Logger.success(`Transcript extracted successfully (#${stats.transcriptsExtracted})`);
          Logger.info(`Preview: "${cleanedTranscript.substring(0, 150)}..."`);
          
          sendTranscriptToExtension(cleanedTranscript);
        } else {
          Logger.warn(`Transcript too short (${cleanedTranscript.length} chars), ignoring`);
        }
      } else {
        Logger.debug('No transcript structure found in response');
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        Logger.debug('Response is not valid JSON, skipping');
      } else {
        stats.errors++;
        Logger.error(`Error processing response: ${e.message}`);
      }
    }
  }

  // ============================================
  // Intercept fetch API
  // ============================================
  Logger.info('Setting up fetch interceptor...');
  
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input?.url || '';
    const requestBody = init?.body;
    
    // Check if this is a Kaltura request
    const isKalturaRequest = url.includes(KALTURA_API_URL);
    
    if (isKalturaRequest) {
      Logger.network('Intercepted fetch request to Kaltura API');
      Logger.debug(`URL: ${url.substring(0, 100)}...`);
    }
    
    let response;
    try {
      response = await originalFetch.apply(this, args);
    } catch (fetchError) {
      Logger.error(`Fetch failed: ${fetchError.message}`);
      throw fetchError;
    }
    
    if (isKalturaRequest) {
      Logger.network(`Response received: ${response.status} ${response.statusText}`);
      
      try {
        const clone = response.clone();
        const text = await clone.text();
        Logger.debug(`Response body size: ${text.length} bytes`);
        processResponse(url, text, requestBody, response.headers);
      } catch (e) {
        stats.errors++;
        Logger.error(`Failed to process response: ${e.message}`);
      }
    }
    
    return response;
  };
  
  Logger.success('Fetch interceptor ready');

  // ============================================
  // Intercept XMLHttpRequest
  // ============================================
  Logger.info('Setting up XMLHttpRequest interceptor...');
  
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._rhSummarizerUrl = url;
    this._rhSummarizerMethod = method;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(body) {
    this._rhSummarizerBody = body;
    const isKalturaRequest = this._rhSummarizerUrl && this._rhSummarizerUrl.includes(KALTURA_API_URL);
    
    if (isKalturaRequest) {
      Logger.network('Intercepted XHR request to Kaltura API');
      Logger.debug(`Method: ${this._rhSummarizerMethod}, URL: ${this._rhSummarizerUrl.substring(0, 100)}...`);
      
      const xhr = this;
      
      this.addEventListener('load', function() {
        Logger.network(`XHR Response received: ${xhr.status} ${xhr.statusText}`);
        Logger.debug(`Response body size: ${xhr.responseText ? xhr.responseText.length : 0} bytes`);
        
        try {
          const headersObj = {
            get: function(name) {
              return xhr.getResponseHeader(name);
            }
          };
          processResponse(xhr._rhSummarizerUrl, xhr.responseText, xhr._rhSummarizerBody, headersObj);
        } catch (e) {
          stats.errors++;
          Logger.error(`Failed to process XHR response: ${e.message}`);
        }
      });
      
      this.addEventListener('error', function() {
        stats.errors++;
        Logger.error('XHR request failed');
      });
      
      this.addEventListener('timeout', function() {
        stats.errors++;
        Logger.warn('XHR request timed out');
      });
    }
    
    return originalXHRSend.call(this, body);
  };
  
  Logger.success('XMLHttpRequest interceptor ready');

  // ============================================
  // Initialization Complete
  // ============================================
  Logger.success('='.repeat(50));
  Logger.success('RH Learning Assistant - Transcript Interceptor');
  Logger.success('='.repeat(50));
  Logger.info('Monitoring for Kaltura transcript requests...');
  Logger.info('Play a video to capture its transcript.');
  Logger.debug(`Watching for URL pattern: ${KALTURA_API_URL}`);
  Logger.debug(`Caption indicators: ${CAPTION_SERVICE_INDICATORS.join(', ')}`);

  // Expose stats for debugging in console
  window._rhSummarizerStats = () => {
    console.table(stats);
    return stats;
  };
  Logger.info('Tip: Run _rhSummarizerStats() in console to see statistics');

})();
