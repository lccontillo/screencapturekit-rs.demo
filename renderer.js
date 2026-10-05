// Elements - Backend & Screen Recording
const backendStatusPill = document.getElementById('backend-status-pill');
const platformValue = document.getElementById('platform-value');
const binaryPathValue = document.getElementById('binary-path-value');
const durationInput = document.getElementById('duration-input');
const recordBtn = document.getElementById('record-btn');
const logOutput = document.getElementById('log-output');
const clearLogsBtn = document.getElementById('clear-logs-btn');

// Elements - Keyboard Shortcut Telemetry
const kbStatusPill = document.getElementById('kb-status-pill');
const kbRecordBtn = document.getElementById('kb-record-btn');
const kbBtnText = document.getElementById('kb-btn-text');
const kbClearBtn = document.getElementById('kb-clear-btn');
const kbPromptSave = document.getElementById('kb-prompt-save');
const kbActiveKeys = document.getElementById('kb-active-keys');
const kbCountVal = document.getElementById('kb-count-val');
const kbTimerVal = document.getElementById('kb-timer-val');
const kbLastVal = document.getElementById('kb-last-val');
const kbStreamCount = document.getElementById('kb-stream-count');
const kbEventList = document.getElementById('kb-event-list');
const kbSaveBanner = document.getElementById('kb-save-banner');
const kbSavedPath = document.getElementById('kb-saved-path');
const kbRevealBtn = document.getElementById('kb-reveal-btn');

// Elements - Mouse Telemetry
const mouseStatusPill = document.getElementById('mouse-status-pill');
const mouseRecordBtn = document.getElementById('mouse-record-btn');
const mouseBtnText = document.getElementById('mouse-btn-text');
const mouseClearBtn = document.getElementById('mouse-clear-btn');
const mousePromptSave = document.getElementById('mouse-prompt-save');
const mouseCoordVal = document.getElementById('mouse-coord-val');
const mouseLastAction = document.getElementById('mouse-last-action');
const mouseCountVal = document.getElementById('mouse-count-val');
const mouseMovesVal = document.getElementById('mouse-moves-val');
const mouseClicksVal = document.getElementById('mouse-clicks-val');
const mouseWheelVal = document.getElementById('mouse-wheel-val');
const mouseTimerVal = document.getElementById('mouse-timer-val');
const mouseStreamCount = document.getElementById('mouse-stream-count');
const mouseEventList = document.getElementById('mouse-event-list');
const mouseSaveBanner = document.getElementById('mouse-save-banner');
const mouseSavedPath = document.getElementById('mouse-saved-path');
const mouseRevealBtn = document.getElementById('mouse-reveal-btn');

// Telemetry State - Keyboard
let isRecordingKB = false;
let kbStartTime = null;
let kbTimerInterval = null;
let kbTelemetryData = [];
let lastSavedFilePath = null;

// Telemetry State - Mouse
let isRecordingMouse = false;
let mouseStartTime = null;
let mouseTimerInterval = null;
let mouseMovesCount = 0;
let mouseClicksCount = 0;
let mouseWheelCount = 0;
let mouseTotalCount = 0;
let lastSavedMouseFilePath = null;

function appendLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  logOutput.textContent += `\n[${timestamp}] ${message}`;
  logOutput.scrollTop = logOutput.scrollHeight;
}

// -------------------------------------------------------------
// Global Keyboard Shortcut Format & Detection Helpers
// -------------------------------------------------------------
function renderKeyBadges(comboStr) {
  if (!comboStr) {
    kbActiveKeys.innerHTML = '<span class="placeholder-text">Press any shortcut system-wide while recording...</span>';
    return;
  }
  const keys = comboStr.split('+');
  kbActiveKeys.innerHTML = keys.map(k => `<span class="key-badge">${k}</span>`).join(' <span style="color:#64748b">+</span> ');
}

function updateTelemetryStats() {
  kbCountVal.textContent = kbTelemetryData.length.toString();
  kbStreamCount.textContent = `${kbTelemetryData.length} events`;
}

function addEventToStream(item) {
  const emptyState = kbEventList.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  const row = document.createElement('div');
  row.className = 'event-row';
  row.innerHTML = `
    <div class="event-left">
      <span class="event-offset">+${item.offsetSec}s</span>
      <span class="event-combo">${item.shortcut}</span>
    </div>
    <div class="event-right">
      <span>${item.key || item.code || ''}</span>
      <span>${new Date(item.timestamp).toLocaleTimeString()}.${String(new Date(item.timestamp).getMilliseconds()).padStart(3, '0')}</span>
    </div>
  `;

  kbEventList.prepend(row);
}

// Listen for global shortcut events streamed from main process
window.api.onGlobalShortcutEvent((eventItem) => {
  if (!isRecordingKB) return;

  kbTelemetryData.push(eventItem);
  kbLastVal.textContent = eventItem.shortcut;
  updateTelemetryStats();
  addEventToStream(eventItem);
  appendLog(`[Global Shortcut Captured] ${eventItem.shortcut} (t=+${eventItem.offsetSec}s)`);
});

// Listen for raw key state to animate key visualizer live
window.api.onGlobalRawKeyState((data) => {
  if (!isRecordingKB) return;
  renderKeyBadges(data.shortcut);
});

window.api.onGlobalKeyUp(() => {
  if (!isRecordingKB) return;
  setTimeout(() => {
    if (isRecordingKB) {
      kbActiveKeys.innerHTML = '<span class="placeholder-text">Listening for system-wide keystrokes...</span>';
    }
  }, 400);
});

// -------------------------------------------------------------
// Start / Stop Global Recording & Save Telemetry
// -------------------------------------------------------------
async function startKBRecording() {
  isRecordingKB = true;
  kbStartTime = Date.now();
  kbTelemetryData = [];
  
  kbEventList.innerHTML = '<div class="empty-state">System-wide global hook active! Switch to any app (VS Code, Chrome, etc.) and type shortcuts.</div>';
  updateTelemetryStats();
  kbLastVal.textContent = '-';
  kbSaveBanner.classList.add('hidden');

  kbStatusPill.className = 'badge badge-recording';
  kbStatusPill.textContent = 'Global Hook Active';
  kbRecordBtn.classList.add('recording');
  kbBtnText.textContent = 'Stop Recording & Save Telemetry';

  appendLog('=== Started System-Wide (Global) Shortcut Recording Session ===');

  try {
    const res = await window.api.startGlobalKbRecording();
    if (!res.success) {
      appendLog(`Failed to start global hook: ${res.error}`);
    }
  } catch (err) {
    appendLog(`Error starting global hook: ${err.message}`);
  }

  kbTimerInterval = setInterval(() => {
    const elapsed = Date.now() - kbStartTime;
    const minutes = Math.floor(elapsed / 60000).toString().padStart(2, '0');
    const seconds = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
    const tenths = Math.floor((elapsed % 1000) / 100);
    kbTimerVal.textContent = `${minutes}:${seconds}.${tenths}`;
  }, 100);
}

async function stopKBRecording() {
  if (!isRecordingKB) return;
  
  const endTime = Date.now();
  clearInterval(kbTimerInterval);
  isRecordingKB = false;

  kbStatusPill.className = 'badge badge-idle';
  kbStatusPill.textContent = 'Idle';
  kbRecordBtn.classList.remove('recording');
  kbBtnText.textContent = 'Start Global Shortcut Recording';
  kbActiveKeys.innerHTML = '<span class="placeholder-text">Recording stopped.</span>';

  const totalDurationMs = endTime - kbStartTime;
  appendLog(`=== Stopped Global Shortcut Recording (Duration: ${(totalDurationMs / 1000).toFixed(2)}s, Shortcuts: ${kbTelemetryData.length}) ===`);

  const timestampStr = new Date(kbStartTime).toISOString().replace(/[:.]/g, '-');
  const filename = `global-kb-telemetry-${timestampStr}.json`;
  const promptSaveAs = kbPromptSave.checked;

  appendLog(`Finalizing & saving telemetry JSON (${promptSaveAs ? 'Prompting save location...' : 'auto-saving to ./telemetry'})...`);

  try {
    const result = await window.api.stopGlobalKbRecording({
      defaultFilename: filename,
      promptSaveAs: promptSaveAs
    });

    if (result.canceled) {
      appendLog('Save dialog canceled by user.');
    } else if (result.success && result.filePath) {
      lastSavedFilePath = result.filePath;
      kbSavedPath.textContent = result.filePath;
      kbSaveBanner.classList.remove('hidden');
      appendLog(`Telemetry successfully saved to: ${result.filePath} (${result.itemCount} items)`);
    } else if (result.success) {
      appendLog(`Recording completed (${result.itemCount} items).`);
    } else {
      appendLog(`Error stopping global recording: ${result.error}`);
    }
  } catch (err) {
    appendLog(`Unexpected error stopping recording: ${err.message}`);
  }
}

kbRecordBtn.addEventListener('click', () => {
  if (!isRecordingKB) {
    startKBRecording();
  } else {
    stopKBRecording();
  }
});

kbClearBtn.addEventListener('click', () => {
  kbTelemetryData = [];
  updateTelemetryStats();
  kbLastVal.textContent = '-';
  kbEventList.innerHTML = '<div class="empty-state">Buffer cleared. Click "Start Global Shortcut Recording" to capture new events.</div>';
  kbSaveBanner.classList.add('hidden');
  appendLog('Cleared keyboard telemetry buffer.');
});

kbRevealBtn.addEventListener('click', async () => {
  if (lastSavedFilePath) {
    await window.api.showInFolder(lastSavedFilePath);
  }
});

// -------------------------------------------------------------
// Global Mouse Telemetry Helpers & Stream Listeners
// -------------------------------------------------------------
function updateMouseStats() {
  mouseCountVal.textContent = mouseTotalCount.toString();
  mouseMovesVal.textContent = mouseMovesCount.toString();
  mouseClicksVal.textContent = mouseClicksCount.toString();
  mouseWheelVal.textContent = mouseWheelCount.toString();
  mouseStreamCount.textContent = `${mouseTotalCount} events`;
}

function addMouseEventToStream(item) {
  const emptyState = mouseEventList.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  const row = document.createElement('div');
  row.className = 'event-row';

  let typeBadgeColor = '#38bdf8';
  let detailText = `(${item.x}, ${item.y}) [nx:${item.nx}, ny:${item.ny}]`;

  if (item.type === 'mousedown' || item.type === 'mouseup') {
    typeBadgeColor = item.type === 'mousedown' ? '#f43f5e' : '#10b981';
    detailText = `${item.button.toUpperCase()} ${item.type === 'mousedown' ? 'DOWN' : 'UP'} (${item.x}, ${item.y})`;
  } else if (item.type === 'wheel') {
    typeBadgeColor = '#a855f7';
    const dir = item.rotation > 0 ? 'DOWN' : 'UP';
    detailText = `SCROLL ${dir} (${item.x}, ${item.y})`;
  }

  row.innerHTML = `
    <div class="event-left">
      <span class="event-offset">+${item.offsetSec}s</span>
      <span class="event-combo" style="color: ${typeBadgeColor}; font-weight: 600;">${item.type.toUpperCase()}</span>
    </div>
    <div class="event-right">
      <span>${detailText}</span>
      <span>${new Date(item.timestamp).toLocaleTimeString()}.${String(new Date(item.timestamp).getMilliseconds()).padStart(3, '0')}</span>
    </div>
  `;

  mouseEventList.prepend(row);

  // Keep DOM lightweight (max 100 entries)
  if (mouseEventList.children.length > 100) {
    mouseEventList.removeChild(mouseEventList.lastChild);
  }
}

// Listen for global mouse position updates (throttled live feed)
window.api.onGlobalMousePosition((data) => {
  if (!isRecordingMouse) return;

  mouseMovesCount++;
  mouseTotalCount = data.totalEvents || (mouseMovesCount + mouseClicksCount + mouseWheelCount);
  mouseCoordVal.textContent = `X: ${data.x} | Y: ${data.y} (nx: ${data.nx}, ny: ${data.ny})`;
  updateMouseStats();
});

// Listen for global mouse clicks (mousedown / mouseup)
window.api.onGlobalMouseClick((item) => {
  if (!isRecordingMouse) return;

  mouseClicksCount++;
  mouseTotalCount++;
  mouseCoordVal.textContent = `X: ${item.x} | Y: ${item.y} (nx: ${item.nx}, ny: ${item.ny})`;
  mouseLastAction.textContent = `${item.button.toUpperCase()} ${item.type === 'mousedown' ? 'DOWN' : 'UP'}`;
  mouseLastAction.style.borderColor = item.type === 'mousedown' ? '#f43f5e' : '#10b981';
  mouseLastAction.style.color = item.type === 'mousedown' ? '#fda4af' : '#6ee7b7';

  updateMouseStats();
  addMouseEventToStream(item);
  appendLog(`[Global Mouse Click] ${item.button} ${item.type} at (${item.x}, ${item.y}) (t=+${item.offsetSec}s)`);
});

// Listen for global mouse wheel events
window.api.onGlobalMouseWheel((item) => {
  if (!isRecordingMouse) return;

  mouseWheelCount++;
  mouseTotalCount++;
  const dir = item.rotation > 0 ? 'SCROLL DOWN' : 'SCROLL UP';
  mouseCoordVal.textContent = `X: ${item.x} | Y: ${item.y} (nx: ${item.nx}, ny: ${item.ny})`;
  mouseLastAction.textContent = dir;
  mouseLastAction.style.borderColor = '#a855f7';
  mouseLastAction.style.color = '#c084fc';

  updateMouseStats();
  addMouseEventToStream(item);
  appendLog(`[Global Mouse Wheel] ${item.direction} ${dir} at (${item.x}, ${item.y}) (t=+${item.offsetSec}s)`);
});

// -------------------------------------------------------------
// Start / Stop Global Mouse Recording & Save Telemetry
// -------------------------------------------------------------
async function startMouseRecording() {
  isRecordingMouse = true;
  mouseStartTime = Date.now();
  mouseMovesCount = 0;
  mouseClicksCount = 0;
  mouseWheelCount = 0;
  mouseTotalCount = 0;

  mouseEventList.innerHTML = '<div class="empty-state">System-wide global mouse hook active! Move, click, or scroll in any application outside this app.</div>';
  updateMouseStats();
  mouseCoordVal.textContent = 'Tracking cursor...';
  mouseLastAction.textContent = 'Listening...';
  mouseLastAction.style.borderColor = '#a855f7';
  mouseLastAction.style.color = '#c084fc';
  mouseSaveBanner.classList.add('hidden');

  mouseStatusPill.className = 'badge badge-recording';
  mouseStatusPill.textContent = 'Global Hook Active';
  mouseRecordBtn.classList.add('recording');
  mouseBtnText.textContent = 'Stop Recording & Save Telemetry';

  appendLog('=== Started System-Wide (Global) Mouse Telemetry Recording ===');

  try {
    const res = await window.api.startGlobalMouseRecording();
    if (res && res.screenBounds) {
      appendLog(`Display resolution: ${res.screenBounds.width}x${res.screenBounds.height}`);
    }
  } catch (err) {
    appendLog(`Error starting global mouse recording: ${err.message}`);
  }

  mouseTimerInterval = setInterval(() => {
    const elapsed = Date.now() - mouseStartTime;
    const minutes = Math.floor(elapsed / 60000).toString().padStart(2, '0');
    const seconds = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
    const tenths = Math.floor((elapsed % 1000) / 100);
    mouseTimerVal.textContent = `${minutes}:${seconds}.${tenths}`;
  }, 100);
}

async function stopMouseRecording() {
  if (!isRecordingMouse) return;

  const endTime = Date.now();
  clearInterval(mouseTimerInterval);
  isRecordingMouse = false;

  mouseStatusPill.className = 'badge badge-idle';
  mouseStatusPill.textContent = 'Idle';
  mouseRecordBtn.classList.remove('recording');
  mouseBtnText.textContent = 'Start Global Mouse Recording';

  const totalDurationMs = endTime - mouseStartTime;
  appendLog(`=== Stopped Global Mouse Recording (Duration: ${(totalDurationMs / 1000).toFixed(2)}s, Events: ${mouseTotalCount}) ===`);

  const timestampStr = new Date(mouseStartTime).toISOString().replace(/[:.]/g, '-');
  const filename = `global-mouse-telemetry-${timestampStr}.json`;
  const promptSaveAs = mousePromptSave.checked;

  appendLog(`Finalizing & saving mouse telemetry JSON (${promptSaveAs ? 'Prompting save location...' : 'auto-saving to ./telemetry'})...`);

  try {
    const result = await window.api.stopGlobalMouseRecording({
      defaultFilename: filename,
      promptSaveAs: promptSaveAs
    });

    if (result.canceled) {
      appendLog('Mouse telemetry save dialog canceled by user.');
    } else if (result.success && result.filePath) {
      lastSavedMouseFilePath = result.filePath;
      mouseSavedPath.textContent = result.filePath;
      mouseSaveBanner.classList.remove('hidden');
      appendLog(`Mouse telemetry successfully saved to: ${result.filePath} (${result.itemCount} items)`);
    } else if (result.success) {
      appendLog(`Mouse recording completed (${result.itemCount} items).`);
    } else {
      appendLog(`Error stopping mouse recording: ${result.error}`);
    }
  } catch (err) {
    appendLog(`Unexpected error stopping mouse recording: ${err.message}`);
  }
}

mouseRecordBtn.addEventListener('click', () => {
  if (!isRecordingMouse) {
    startMouseRecording();
  } else {
    stopMouseRecording();
  }
});

mouseClearBtn.addEventListener('click', () => {
  mouseMovesCount = 0;
  mouseClicksCount = 0;
  mouseWheelCount = 0;
  mouseTotalCount = 0;
  updateMouseStats();
  mouseCoordVal.textContent = 'X: - | Y: - (nx: -, ny: -)';
  mouseLastAction.textContent = 'No click/wheel yet';
  mouseEventList.innerHTML = '<div class="empty-state">Buffer cleared. Click "Start Global Mouse Recording" to capture new events.</div>';
  mouseSaveBanner.classList.add('hidden');
  appendLog('Cleared mouse telemetry buffer.');
});

mouseRevealBtn.addEventListener('click', async () => {
  if (lastSavedMouseFilePath) {
    await window.api.showInFolder(lastSavedMouseFilePath);
  }
});


// -------------------------------------------------------------
// Backend Status & Screen Recorder
// -------------------------------------------------------------
async function checkBackend() {
  try {
    const status = await window.api.checkRustBinary();
    platformValue.textContent = status.platform;
    binaryPathValue.textContent = status.path;

    if (status.exists) {
      backendStatusPill.className = 'badge badge-success';
      backendStatusPill.textContent = 'Rust Binary Ready';
      appendLog(`Rust binary found at: ${status.path}`);
    } else {
      backendStatusPill.className = 'badge badge-warning';
      backendStatusPill.textContent = 'Binary Missing';
      appendLog(`Warning: Rust binary not found at ${status.path}. Build with 'cargo build --release'`);
    }
  } catch (err) {
    backendStatusPill.className = 'badge badge-danger';
    backendStatusPill.textContent = 'Error';
    appendLog(`Backend check error: ${err.message}`);
  }
}

recordBtn.addEventListener('click', async () => {
  const duration = parseInt(durationInput.value, 10) || 5;
  recordBtn.disabled = true;
  recordBtn.classList.add('recording');
  recordBtn.innerHTML = '<span class="record-dot"></span> Recording in progress...';
  appendLog(`Starting screen capture for ${duration}s via screencapturekit-rs...`);

  try {
    const result = await window.api.recordScreen({ duration });
    if (result.success) {
      appendLog(`Recording completed successfully! Output: ${result.outputFile}`);
      if (result.stdout) {
        appendLog(`stdout: ${result.stdout.trim()}`);
      }
    } else {
      appendLog(`Recording failed: ${result.error}`);
    }
  } catch (err) {
    appendLog(`Unexpected error: ${err.message}`);
  } finally {
    recordBtn.disabled = false;
    recordBtn.classList.remove('recording');
    recordBtn.innerHTML = '<span class="record-dot"></span> Start Recording';
  }
});

clearLogsBtn.addEventListener('click', () => {
  logOutput.textContent = 'Ready.';
});

// Initialize on page load
checkBackend();

let uptime = 0;
const liveTicker = document.getElementById('live-ticker');
setInterval(() => {
  uptime += 0.5;
  if (liveTicker) {
    liveTicker.textContent = `Live Activity: ${uptime.toFixed(1)}s elapsed | Active WindowServer`;
  }
}, 500);

