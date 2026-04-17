/**
 * Background Service Worker
 * Handles message passing between content script and page context
 */

// ============================================
// Logger Utility
// ============================================
const PREFIX = '[RH Learning Assistant BG]';

const Logger = {
  info: (...args) => console.log(`${PREFIX} ℹ️`, ...args),
  success: (...args) => console.log(`${PREFIX} ✅`, ...args),
  warn: (...args) => console.warn(`${PREFIX} ⚠️`, ...args),
  error: (...args) => console.error(`${PREFIX} ❌`, ...args),
  debug: (...args) => console.log(`${PREFIX} 🔍`, ...args),
};

// ============================================
// Initialization
// ============================================
Logger.success('='.repeat(50));
Logger.success('RH Learning Assistant - Background Service Worker');
Logger.success('='.repeat(50));
Logger.info('Service worker started');

// ============================================
// Transcript Cache
// ============================================
let transcriptCache = {};

// Statistics
const stats = {
  messagesReceived: 0,
  transcriptsStored: 0,
  transcriptsRetrieved: 0,
  errors: 0
};

// ============================================
// Message Handler
// ============================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  stats.messagesReceived++;
  const tabId = sender.tab?.id;
  const tabUrl = sender.tab?.url || 'unknown';
  
  Logger.info(`Message received: ${message.type} from tab ${tabId}`);
  Logger.debug(`Tab URL: ${tabUrl.substring(0, 50)}...`);

  switch (message.type) {
    case 'STORE_TRANSCRIPT':
      handleStoreTranscript(tabId, message.transcript, sendResponse);
      break;

    case 'GET_TRANSCRIPT':
      handleGetTranscript(tabId, sendResponse);
      break;

    case 'CLEAR_TRANSCRIPT':
      handleClearTranscript(tabId, sendResponse);
      break;

    case 'GET_STATS':
      Logger.debug('Stats requested');
      sendResponse({ success: true, stats: stats, cache: Object.keys(transcriptCache) });
      break;

    default:
      Logger.warn(`Unknown message type: ${message.type}`);
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  return true; // Keep message channel open for async response
});

// ============================================
// Message Handlers
// ============================================

function handleStoreTranscript(tabId, transcript, sendResponse) {
  if (!tabId) {
    Logger.error('Cannot store transcript: no tab ID');
    stats.errors++;
    sendResponse({ success: false, error: 'No tab ID' });
    return;
  }

  if (!transcript) {
    Logger.error('Cannot store transcript: empty transcript');
    stats.errors++;
    sendResponse({ success: false, error: 'Empty transcript' });
    return;
  }

  Logger.info(`Storing transcript for tab ${tabId}`);
  Logger.debug(`Transcript length: ${transcript.length} characters`);
  
  transcriptCache[tabId] = {
    transcript: transcript,
    timestamp: Date.now(),
    length: transcript.length
  };
  
  stats.transcriptsStored++;
  Logger.success(`Transcript stored successfully (total stored: ${stats.transcriptsStored})`);
  Logger.debug(`Cache now contains ${Object.keys(transcriptCache).length} transcripts`);
  
  sendResponse({ success: true });
}

function handleGetTranscript(tabId, sendResponse) {
  Logger.info(`Retrieving transcript for tab ${tabId}`);
  
  if (!tabId) {
    Logger.error('Cannot retrieve transcript: no tab ID');
    stats.errors++;
    sendResponse({ success: false, error: 'No tab ID' });
    return;
  }

  if (transcriptCache[tabId]) {
    const cached = transcriptCache[tabId];
    const age = Math.round((Date.now() - cached.timestamp) / 1000);
    
    Logger.success(`Transcript found (${cached.length} chars, ${age}s old)`);
    stats.transcriptsRetrieved++;
    
    sendResponse({ 
      success: true, 
      transcript: cached.transcript,
      age: age
    });
  } else {
    Logger.info('No transcript found for this tab');
    sendResponse({ success: false, error: 'No transcript found' });
  }
}

function handleClearTranscript(tabId, sendResponse) {
  Logger.info(`Clearing transcript for tab ${tabId}`);
  
  if (tabId && transcriptCache[tabId]) {
    delete transcriptCache[tabId];
    Logger.success('Transcript cleared');
  } else {
    Logger.info('No transcript to clear');
  }
  
  sendResponse({ success: true });
}

// ============================================
// Tab Management
// ============================================

// Clean up cache when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (transcriptCache[tabId]) {
    Logger.info(`Tab ${tabId} closed, cleaning up cached transcript`);
    delete transcriptCache[tabId];
  }
});

// ============================================
// Cache Cleanup
// ============================================

// Clean up old transcripts periodically (older than 1 hour)
const CLEANUP_INTERVAL = 15 * 60 * 1000; // 15 minutes
const MAX_AGE = 60 * 60 * 1000; // 1 hour

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  Logger.debug('Running cache cleanup...');
  
  for (const tabId in transcriptCache) {
    if (transcriptCache[tabId].timestamp < now - MAX_AGE) {
      Logger.info(`Removing stale transcript for tab ${tabId}`);
      delete transcriptCache[tabId];
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    Logger.info(`Cleanup complete: removed ${cleaned} stale transcript(s)`);
  } else {
    Logger.debug('Cleanup complete: no stale transcripts found');
  }
  
  Logger.debug(`Cache size: ${Object.keys(transcriptCache).length} transcript(s)`);
}, CLEANUP_INTERVAL);

// ============================================
// Startup Complete
// ============================================
Logger.success('Background service worker ready');
Logger.info('Listening for messages from content scripts...');
