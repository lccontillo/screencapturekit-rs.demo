const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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
    height: 680,
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
          const image = await mainWindow.webContents.capturePage();
          const outputPath = path.join(process.cwd(), 'screenshot.png');
          fs.writeFileSync(outputPath, image.toPNG());
          console.log(`[CI] Screenshot successfully saved to ${outputPath}`);
          app.exit(0);
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
