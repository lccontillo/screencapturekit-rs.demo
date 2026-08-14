const backendStatusPill = document.getElementById('backend-status-pill');
const platformValue = document.getElementById('platform-value');
const binaryPathValue = document.getElementById('binary-path-value');
const durationInput = document.getElementById('duration-input');
const recordBtn = document.getElementById('record-btn');
const logOutput = document.getElementById('log-output');
const clearLogsBtn = document.getElementById('clear-logs-btn');

function appendLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  logOutput.textContent += `\n[${timestamp}] ${message}`;
  logOutput.scrollTop = logOutput.scrollHeight;
}

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
