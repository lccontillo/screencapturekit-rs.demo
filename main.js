const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;

function getRustBinaryPath() {
  const isDev = !app.isPackaged;
  const binaryName = process.platform === 'win32' ? 'macos-screen-recorder.exe' : 'macos-screen-recorder';
  
  if (isDev) {
    const releasePath = path.join(__dirname, 'target', 'release', binaryName);
    const debugPath = path.join(__dirname, 'target', 'debug', binaryName);
    if (fs.existsSync(releasePath)) return releasePath;
    if (fs.existsSync(debugPath)) return debugPath;
    return releasePath;
  } else {
    return path.join(process.resourcesPath, 'bin', binaryName);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 860,
    height: 920,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  const args = process.argv;
  const isScreenshotMode = args.includes('--screenshot');

  if (isScreenshotMode) {
    mainWindow.webContents.once('did-finish-load', async () => {
      // Allow CSS animations and rendering to settle
      setTimeout(async () => {
        try {
          await mainWindow.webContents.executeJavaScript(`
            const card = document.querySelector('.mouse-card');
            if (card) card.scrollIntoView({ behavior: 'instant', block: 'start' });
          `);
          setTimeout(async () => {
            const image = await mainWindow.webContents.capturePage();
            const outputPath = path.join(process.cwd(), 'screenshot.png');
            fs.writeFileSync(outputPath, image.toPNG());
            console.log(`[CI] Screenshot successfully saved to ${outputPath}`);
            app.exit(0);
          }, 300);
        } catch (err) {
          console.error('[CI] Failed to capture screenshot:', err);
          app.exit(1);
        }
      }, 1500);
    });
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handler: Check Rust Binary status
ipcMain.handle('check-rust-binary', async () => {
  const binaryPath = getRustBinaryPath();
  const exists = fs.existsSync(binaryPath);
  return {
    path: binaryPath,
    exists: exists,
    platform: process.platform
  };
});

// IPC Handler: Run screen recording via Rust screencapturekit-rs binary
ipcMain.handle('record-screen', async (event, { duration, outputPath }) => {
  const binaryPath = getRustBinaryPath();
  
  if (!fs.existsSync(binaryPath)) {
    return {
      success: false,
      error: `Rust binary not found at ${binaryPath}. Please run 'cargo build --release' first.`
    };
  }

  const finalOutput = outputPath || path.join(app.getPath('videos'), `recording-${Date.now()}.mp4`);

  return new Promise((resolve) => {
    const child = spawn(binaryPath, ['--duration', duration.toString(), '--output', finalOutput]);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          outputFile: finalOutput,
          stdout
        });
      } else {
        resolve({
          success: false,
          error: stderr || stdout || `Process exited with code ${code}`
        });
      }
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        error: err.message
      });
    });
  });
});

const { uIOhook, UiohookKey } = require('uiohook-napi');

// Build reverse keycode lookup map
const keycodeToName = {};
for (const [name, code] of Object.entries(UiohookKey)) {
  if (typeof code === 'number' && !keycodeToName[code]) {
    keycodeToName[code] = name;
  }
}

const MODIFIER_KEYCODES = new Set([
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight
]);

// Screen bounds helper for normalizing mouse coordinates
function getScreenDimensions() {
  try {
    const primary = screen.getPrimaryDisplay();
    return {
      width: primary.bounds.width,
      height: primary.bounds.height
    };
  } catch (err) {
    return { width: 1920, height: 1080 };
  }
}

const MOUSE_BUTTON_NAMES = {
  1: 'left',
  2: 'right',
  3: 'middle',
  4: 'back',
  5: 'forward'
};

// Global Keyboard Shortcut Telemetry State
let isGlobalKbRecording = false;
let globalKbStartTime = null;
let globalKbTelemetry = [];

// Global Mouse Telemetry State
let isGlobalMouseRecording = false;
let globalMouseStartTime = null;
let globalMouseTelemetry = [];
let lastRecordedMoveTime = 0;
let lastRecordedX = -1;
let lastRecordedY = -1;
let lastIpcSendTime = 0;

let uiohookRunning = false;

function buildGlobalShortcutString(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push(process.platform === 'darwin' ? 'Cmd' : 'Meta');
  if (e.altKey) parts.push(process.platform === 'darwin' ? 'Option' : 'Alt');
  if (e.shiftKey) parts.push('Shift');

  if (!MODIFIER_KEYCODES.has(e.keycode)) {
    let keyName = keycodeToName[e.keycode] || `Key_${e.keycode}`;
    if (keyName === 'CtrlRight' || keyName === 'Ctrl') keyName = 'Ctrl';
    else if (keyName === 'AltRight' || keyName === 'Alt') keyName = 'Alt';
    else if (keyName === 'ShiftRight' || keyName === 'Shift') keyName = 'Shift';
    else if (keyName === 'MetaRight' || keyName === 'Meta') keyName = 'Meta';
    parts.push(keyName);
  }

  return parts.join('+');
}

function handleGlobalKeydown(e) {
  if (!isGlobalKbRecording) return;

  const isModifierOnly = MODIFIER_KEYCODES.has(e.keycode);
  const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
  const isFunctionKey = e.keycode >= UiohookKey.F1 && e.keycode <= UiohookKey.F24;
  const isSpecialKey = [
    UiohookKey.Escape,
    UiohookKey.Tab,
    UiohookKey.Delete,
    UiohookKey.Backspace,
    UiohookKey.Enter,
    UiohookKey.PageUp,
    UiohookKey.PageDown,
    UiohookKey.Home,
    UiohookKey.End,
    UiohookKey.ArrowUp,
    UiohookKey.ArrowDown,
    UiohookKey.ArrowLeft,
    UiohookKey.ArrowRight
  ].includes(e.keycode);

  const shortcut = buildGlobalShortcutString(e);
  const now = Date.now();
  const offsetMs = now - (globalKbStartTime || now);
  const offsetSec = parseFloat((offsetMs / 1000).toFixed(3));

  // Live key state for visualizer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('global-raw-key-state', {
      shortcut,
      isModifierOnly,
      keycode: e.keycode,
      keyName: keycodeToName[e.keycode] || `Key_${e.keycode}`
    });
  }

  // Record if it's a combination (modifiers + key) OR shift+key OR special/functional key
  if (!isModifierOnly && (hasModifier || e.shiftKey || isFunctionKey || isSpecialKey)) {
    const keyName = keycodeToName[e.keycode] || `Key_${e.keycode}`;
    const eventItem = {
      id: globalKbTelemetry.length + 1,
      shortcut,
      key: keyName,
      keycode: e.keycode,
      modifiers: {
        ctrl: !!e.ctrlKey,
        meta: !!e.metaKey,
        alt: !!e.altKey,
        shift: !!e.shiftKey
      },
      timestamp: new Date(now).toISOString(),
      timestampMs: now,
      offsetMs: offsetMs,
      offsetSec: offsetSec
    };

    globalKbTelemetry.push(eventItem);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('global-shortcut-event', eventItem);
    }
  }
}

function handleGlobalKeyup() {
  if (!isGlobalKbRecording) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('global-key-up');
  }
}

// -------------------------------------------------------------
// Global Mouse Handlers
// -------------------------------------------------------------
function handleGlobalMousemove(e) {
  if (!isGlobalMouseRecording) return;
  const now = Date.now();
  if (e.x === lastRecordedX && e.y === lastRecordedY) return;

  // Sample move events at ~100Hz (10ms minimum interval) to prevent flooding while keeping smooth tracking
  if (now - lastRecordedMoveTime < 10) return;

  lastRecordedMoveTime = now;
  lastRecordedX = e.x;
  lastRecordedY = e.y;

  const screenBounds = getScreenDimensions();
  const offsetMs = now - (globalMouseStartTime || now);
  const offsetSec = parseFloat((offsetMs / 1000).toFixed(3));
  const nx = screenBounds.width > 0 ? +(e.x / screenBounds.width).toFixed(4) : 0;
  const ny = screenBounds.height > 0 ? +(e.y / screenBounds.height).toFixed(4) : 0;

  const moveItem = {
    id: globalMouseTelemetry.length + 1,
    t: offsetMs,
    type: 'move',
    x: e.x,
    y: e.y,
    nx,
    ny,
    timestamp: new Date(now).toISOString(),
    timestampMs: now,
    offsetMs,
    offsetSec
  };

  globalMouseTelemetry.push(moveItem);

  // Throttle live UI visualizer IPC updates to ~30fps (33ms)
  if (now - lastIpcSendTime >= 33) {
    lastIpcSendTime = now;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('global-mouse-position', {
        x: e.x,
        y: e.y,
        nx,
        ny,
        offsetSec,
        totalEvents: globalMouseTelemetry.length
      });
    }
  }
}

function handleGlobalMousedown(e) {
  if (!isGlobalMouseRecording) return;
  const now = Date.now();
  const screenBounds = getScreenDimensions();
  const offsetMs = now - (globalMouseStartTime || now);
  const offsetSec = parseFloat((offsetMs / 1000).toFixed(3));
  const nx = screenBounds.width > 0 ? +(e.x / screenBounds.width).toFixed(4) : 0;
  const ny = screenBounds.height > 0 ? +(e.y / screenBounds.height).toFixed(4) : 0;
  const buttonName = MOUSE_BUTTON_NAMES[e.button] || `button_${e.button}`;

  const clickItem = {
    id: globalMouseTelemetry.length + 1,
    t: offsetMs,
    type: 'mousedown',
    button: buttonName,
    buttonCode: e.button,
    clicks: e.clicks || 1,
    x: e.x,
    y: e.y,
    nx,
    ny,
    modifiers: {
      ctrl: !!e.ctrlKey,
      meta: !!e.metaKey,
      alt: !!e.altKey,
      shift: !!e.shiftKey
    },
    timestamp: new Date(now).toISOString(),
    timestampMs: now,
    offsetMs,
    offsetSec
  };

  globalMouseTelemetry.push(clickItem);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('global-mouse-click', clickItem);
  }
}

function handleGlobalMouseup(e) {
  if (!isGlobalMouseRecording) return;
  const now = Date.now();
  const screenBounds = getScreenDimensions();
  const offsetMs = now - (globalMouseStartTime || now);
  const offsetSec = parseFloat((offsetMs / 1000).toFixed(3));
  const nx = screenBounds.width > 0 ? +(e.x / screenBounds.width).toFixed(4) : 0;
  const ny = screenBounds.height > 0 ? +(e.y / screenBounds.height).toFixed(4) : 0;
  const buttonName = MOUSE_BUTTON_NAMES[e.button] || `button_${e.button}`;

  const clickItem = {
    id: globalMouseTelemetry.length + 1,
    t: offsetMs,
    type: 'mouseup',
    button: buttonName,
    buttonCode: e.button,
    clicks: e.clicks || 1,
    x: e.x,
    y: e.y,
    nx,
    ny,
    modifiers: {
      ctrl: !!e.ctrlKey,
      meta: !!e.metaKey,
      alt: !!e.altKey,
      shift: !!e.shiftKey
    },
    timestamp: new Date(now).toISOString(),
    timestampMs: now,
    offsetMs,
    offsetSec
  };

  globalMouseTelemetry.push(clickItem);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('global-mouse-click', clickItem);
  }
}

function handleGlobalWheel(e) {
  if (!isGlobalMouseRecording) return;
  const now = Date.now();
  const screenBounds = getScreenDimensions();
  const offsetMs = now - (globalMouseStartTime || now);
  const offsetSec = parseFloat((offsetMs / 1000).toFixed(3));
  const nx = screenBounds.width > 0 ? +(e.x / screenBounds.width).toFixed(4) : 0;
  const ny = screenBounds.height > 0 ? +(e.y / screenBounds.height).toFixed(4) : 0;

  const wheelItem = {
    id: globalMouseTelemetry.length + 1,
    t: offsetMs,
    type: 'wheel',
    x: e.x,
    y: e.y,
    nx,
    ny,
    amount: e.amount || 0,
    direction: e.direction === 4 ? 'horizontal' : 'vertical',
    rotation: e.rotation || 0,
    modifiers: {
      ctrl: !!e.ctrlKey,
      meta: !!e.metaKey,
      alt: !!e.altKey,
      shift: !!e.shiftKey
    },
    timestamp: new Date(now).toISOString(),
    timestampMs: now,
    offsetMs,
    offsetSec
  };

  globalMouseTelemetry.push(wheelItem);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('global-mouse-wheel', wheelItem);
  }
}

function ensureUiohookStarted() {
  if (!uiohookRunning) {
    uIOhook.on('keydown', handleGlobalKeydown);
    uIOhook.on('keyup', handleGlobalKeyup);
    uIOhook.on('mousemove', handleGlobalMousemove);
    uIOhook.on('mousedown', handleGlobalMousedown);
    uIOhook.on('mouseup', handleGlobalMouseup);
    uIOhook.on('wheel', handleGlobalWheel);
    uIOhook.start();
    uiohookRunning = true;
  }
}

function stopUiohook() {
  if (uiohookRunning && !isGlobalKbRecording && !isGlobalMouseRecording) {
    uIOhook.removeListener('keydown', handleGlobalKeydown);
    uIOhook.removeListener('keyup', handleGlobalKeyup);
    uIOhook.removeListener('mousemove', handleGlobalMousemove);
    uIOhook.removeListener('mousedown', handleGlobalMousedown);
    uIOhook.removeListener('mouseup', handleGlobalMouseup);
    uIOhook.removeListener('wheel', handleGlobalWheel);
    uIOhook.stop();
    uiohookRunning = false;
  }
}

// -------------------------------------------------------------
// IPC Handlers for Global Keyboard Shortcut Recording
// -------------------------------------------------------------
ipcMain.handle('start-global-kb-recording', async () => {
  try {
    isGlobalKbRecording = true;
    globalKbStartTime = Date.now();
    globalKbTelemetry = [];
    ensureUiohookStarted();
    return { success: true, startedAt: globalKbStartTime };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-global-kb-recording', async (event, { defaultFilename, promptSaveAs } = {}) => {
  try {
    const endTime = Date.now();
    isGlobalKbRecording = false;
    stopUiohook();

    const totalDurationMs = endTime - (globalKbStartTime || endTime);
    const telemetryExport = {
      metadata: {
        type: "global_keyboard_shortcut_telemetry",
        version: "2.0.0",
        captureScope: "system_wide_global",
        platform: process.platform
      },
      session: {
        startedAt: new Date(globalKbStartTime || endTime).toISOString(),
        endedAt: new Date(endTime).toISOString(),
        durationMs: totalDurationMs,
        durationSeconds: parseFloat((totalDurationMs / 1000).toFixed(3)),
        totalShortcuts: globalKbTelemetry.length
      },
      telemetry: globalKbTelemetry
    };

    const timestampStr = new Date(globalKbStartTime || endTime).toISOString().replace(/[:.]/g, '-');
    const fallbackFilename = defaultFilename || `global-kb-telemetry-${timestampStr}.json`;
    let savePath;

    if (promptSaveAs) {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Global Keyboard Shortcut Telemetry',
        defaultPath: path.join(app.getPath('documents'), fallbackFilename),
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (canceled || !filePath) {
        return {
          success: true,
          canceled: true,
          session: telemetryExport.session,
          telemetry: globalKbTelemetry
        };
      }
      savePath = filePath;
    } else {
      const telemetryDir = path.join(__dirname, 'telemetry');
      if (!fs.existsSync(telemetryDir)) {
        fs.mkdirSync(telemetryDir, { recursive: true });
      }
      savePath = path.join(telemetryDir, fallbackFilename);
    }

    const jsonString = JSON.stringify(telemetryExport, null, 2);
    fs.writeFileSync(savePath, jsonString, 'utf-8');

    return {
      success: true,
      filePath: savePath,
      itemCount: globalKbTelemetry.length,
      session: telemetryExport.session,
      telemetry: globalKbTelemetry
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// -------------------------------------------------------------
// IPC Handlers for Global Mouse & Cursor Telemetry Recording
// -------------------------------------------------------------
ipcMain.handle('start-global-mouse-recording', async () => {
  try {
    isGlobalMouseRecording = true;
    globalMouseStartTime = Date.now();
    globalMouseTelemetry = [];
    lastRecordedMoveTime = 0;
    lastRecordedX = -1;
    lastRecordedY = -1;
    lastIpcSendTime = 0;
    ensureUiohookStarted();
    return {
      success: true,
      startedAt: globalMouseStartTime,
      screenBounds: getScreenDimensions()
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-global-mouse-recording', async (event, { defaultFilename, promptSaveAs } = {}) => {
  try {
    const endTime = Date.now();
    isGlobalMouseRecording = false;
    stopUiohook();

    const screenBounds = getScreenDimensions();
    const totalDurationMs = endTime - (globalMouseStartTime || endTime);

    let moveCount = 0;
    let clickCount = 0;
    let wheelCount = 0;
    for (const item of globalMouseTelemetry) {
      if (item.type === 'move') moveCount++;
      else if (item.type === 'mousedown' || item.type === 'mouseup') clickCount++;
      else if (item.type === 'wheel') wheelCount++;
    }

    const telemetryExport = {
      metadata: {
        type: "global_mouse_telemetry",
        version: "2.0.0",
        captureScope: "system_wide_global",
        platform: process.platform,
        screenBounds: screenBounds
      },
      session: {
        startedAt: new Date(globalMouseStartTime || endTime).toISOString(),
        endedAt: new Date(endTime).toISOString(),
        durationMs: totalDurationMs,
        durationSeconds: parseFloat((totalDurationMs / 1000).toFixed(3)),
        totalEvents: globalMouseTelemetry.length,
        moveEvents: moveCount,
        clickEvents: clickCount,
        wheelEvents: wheelCount
      },
      telemetry: globalMouseTelemetry
    };

    const timestampStr = new Date(globalMouseStartTime || endTime).toISOString().replace(/[:.]/g, '-');
    const fallbackFilename = defaultFilename || `global-mouse-telemetry-${timestampStr}.json`;
    let savePath;

    if (promptSaveAs) {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Global Mouse Telemetry',
        defaultPath: path.join(app.getPath('documents'), fallbackFilename),
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (canceled || !filePath) {
        return {
          success: true,
          canceled: true,
          itemCount: globalMouseTelemetry.length,
          session: telemetryExport.session,
          telemetry: globalMouseTelemetry
        };
      }
      savePath = filePath;
    } else {
      const telemetryDir = path.join(__dirname, 'telemetry');
      if (!fs.existsSync(telemetryDir)) {
        fs.mkdirSync(telemetryDir, { recursive: true });
      }
      savePath = path.join(telemetryDir, fallbackFilename);
    }

    const jsonString = JSON.stringify(telemetryExport, null, 2);
    fs.writeFileSync(savePath, jsonString, 'utf-8');

    return {
      success: true,
      filePath: savePath,
      itemCount: globalMouseTelemetry.length,
      session: telemetryExport.session,
      telemetry: globalMouseTelemetry
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-screen-bounds', async () => {
  return getScreenDimensions();
});

// IPC Handler: Save Keyboard Shortcut Telemetry JSON
ipcMain.handle('save-keyboard-telemetry', async (event, { data, defaultFilename, promptSaveAs }) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fallbackFilename = defaultFilename || `kb-shortcut-telemetry-${timestamp}.json`;
    let savePath;

    if (promptSaveAs) {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Keyboard Shortcut Telemetry',
        defaultPath: path.join(app.getPath('documents'), fallbackFilename),
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }
      savePath = filePath;
    } else {
      const telemetryDir = path.join(__dirname, 'telemetry');
      if (!fs.existsSync(telemetryDir)) {
        fs.mkdirSync(telemetryDir, { recursive: true });
      }
      savePath = path.join(telemetryDir, fallbackFilename);
    }

    const jsonString = JSON.stringify(data, null, 2);
    fs.writeFileSync(savePath, jsonString, 'utf-8');

    return {
      success: true,
      filePath: savePath,
      itemCount: Array.isArray(data.telemetry) ? data.telemetry.length : 0
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
});

// IPC Handler: Reveal file in file manager
ipcMain.handle('show-in-folder', async (event, filePath) => {
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return { success: true };
  }
  return { success: false, error: 'File does not exist' };
});

app.on('will-quit', () => {
  isGlobalKbRecording = false;
  isGlobalMouseRecording = false;
  stopUiohook();
});



