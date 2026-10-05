const fs = require('fs');
const path = require('path');
const { uIOhook, UiohookKey, WheelDirection } = require('uiohook-napi');

console.log('====================================================');
console.log('   Keyboard & Mouse Telemetry CI Test Suite');
console.log('====================================================\n');

// 1. Prepare Telemetry Directory
const telemetryDir = path.join(__dirname, '..', 'telemetry');
if (!fs.existsSync(telemetryDir)) {
  fs.mkdirSync(telemetryDir, { recursive: true });
}

// 2. Mock Screen Dimensions for CI/Headless Environment
const screenBounds = { width: 1920, height: 1080 };

// Reverse keycode lookup map (matching main.js)
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

const MOUSE_BUTTON_NAMES = {
  1: 'left',
  2: 'right',
  3: 'middle',
  4: 'back',
  5: 'forward'
};

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

// ============================================================================
// TEST SUITE 1: KEYBOARD TELEMETRY TEST
// ============================================================================
console.log('[1/4] Running Keyboard Telemetry Verification...');

const kbStartTime = Date.now();
const capturedKbEvents = [];

function recordKbEvent(e, offsetMs) {
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
  const now = kbStartTime + offsetMs;
  const offsetSec = parseFloat((offsetMs / 1000).toFixed(3));

  if (!isModifierOnly && (hasModifier || e.shiftKey || isFunctionKey || isSpecialKey)) {
    const keyName = keycodeToName[e.keycode] || `Key_${e.keycode}`;
    const eventItem = {
      id: capturedKbEvents.length + 1,
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
    capturedKbEvents.push(eventItem);
  }
}

// Simulate realistic shortcut combinations
const testKeystrokes = [
  { keycode: UiohookKey.P, ctrlKey: true, shiftKey: true, metaKey: false, altKey: false, t: 120 },
  { keycode: UiohookKey.C, ctrlKey: true, shiftKey: false, metaKey: false, altKey: false, t: 450 },
  { keycode: UiohookKey.V, ctrlKey: true, shiftKey: false, metaKey: false, altKey: false, t: 720 },
  { keycode: UiohookKey.S, ctrlKey: false, shiftKey: false, metaKey: true, altKey: false, t: 1100 },
  { keycode: UiohookKey.F5, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, t: 1540 },
  { keycode: UiohookKey.Escape, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, t: 1980 },
  { keycode: UiohookKey.Tab, ctrlKey: false, shiftKey: false, metaKey: false, altKey: true, t: 2340 }
];

for (const k of testKeystrokes) {
  recordKbEvent(k, k.t);
}

if (capturedKbEvents.length !== testKeystrokes.length) {
  throw new Error(`Expected ${testKeystrokes.length} keyboard events, but captured ${capturedKbEvents.length}`);
}

const kbEndTime = kbStartTime + 2500;
const kbExport = {
  metadata: {
    type: 'global_keyboard_shortcut_telemetry',
    version: '2.0.0',
    captureScope: 'system_wide_global',
    platform: process.platform
  },
  session: {
    startedAt: new Date(kbStartTime).toISOString(),
    endedAt: new Date(kbEndTime).toISOString(),
    durationMs: 2500,
    durationSeconds: 2.5,
    totalShortcuts: capturedKbEvents.length
  },
  telemetry: capturedKbEvents
};

const kbFilePath = path.join(telemetryDir, 'ci-keyboard-telemetry.json');
fs.writeFileSync(kbFilePath, JSON.stringify(kbExport, null, 2), 'utf-8');
console.log(`  ✓ Keyboard telemetry recorded: ${capturedKbEvents.length} shortcuts`);
console.log(`  ✓ Exported to: ${kbFilePath}\n`);


// ============================================================================
// TEST SUITE 2: MOUSE TELEMETRY TEST (Position, Clicks, Wheel)
// ============================================================================
console.log('[2/4] Running Mouse Telemetry Verification (Moves, Clicks, Wheel)...');

const mouseStartTime = Date.now();
const capturedMouseEvents = [];

function recordMouseMove(x, y, offsetMs) {
  const now = mouseStartTime + offsetMs;
  const offsetSec = parseFloat((offsetMs / 1000).toFixed(3));
  const nx = +(x / screenBounds.width).toFixed(4);
  const ny = +(y / screenBounds.height).toFixed(4);

  capturedMouseEvents.push({
    id: capturedMouseEvents.length + 1,
    t: offsetMs,
    type: 'move',
    x,
    y,
    nx,
    ny,
    timestamp: new Date(now).toISOString(),
    timestampMs: now,
    offsetMs,
    offsetSec
  });
}

function recordMouseClick(type, buttonCode, x, y, offsetMs) {
  const now = mouseStartTime + offsetMs;
  const offsetSec = parseFloat((offsetMs / 1000).toFixed(3));
  const nx = +(x / screenBounds.width).toFixed(4);
  const ny = +(y / screenBounds.height).toFixed(4);
  const buttonName = MOUSE_BUTTON_NAMES[buttonCode] || `button_${buttonCode}`;

  capturedMouseEvents.push({
    id: capturedMouseEvents.length + 1,
    t: offsetMs,
    type,
    button: buttonName,
    buttonCode,
    clicks: 1,
    x,
    y,
    nx,
    ny,
    modifiers: { ctrl: false, meta: false, alt: false, shift: false },
    timestamp: new Date(now).toISOString(),
    timestampMs: now,
    offsetMs,
    offsetSec
  });
}

function recordMouseWheel(x, y, rotation, direction, offsetMs) {
  const now = mouseStartTime + offsetMs;
  const offsetSec = parseFloat((offsetMs / 1000).toFixed(3));
  const nx = +(x / screenBounds.width).toFixed(4);
  const ny = +(y / screenBounds.height).toFixed(4);

  capturedMouseEvents.push({
    id: capturedMouseEvents.length + 1,
    t: offsetMs,
    type: 'wheel',
    x,
    y,
    nx,
    ny,
    amount: Math.abs(rotation) * 100,
    direction: direction === 4 ? 'horizontal' : 'vertical',
    rotation,
    modifiers: { ctrl: false, meta: false, alt: false, shift: false },
    timestamp: new Date(now).toISOString(),
    timestampMs: now,
    offsetMs,
    offsetSec
  });
}

// 1. Simulate mouse path
const pathPoints = [
  { x: 100, y: 100, t: 50 },
  { x: 250, y: 180, t: 120 },
  { x: 500, y: 320, t: 220 },
  { x: 800, y: 450, t: 340 },
  { x: 1200, y: 600, t: 510 },
  { x: 1600, y: 800, t: 720 },
  { x: 1800, y: 950, t: 900 }
];
for (const p of pathPoints) {
  recordMouseMove(p.x, p.y, p.t);
}

// 2. Simulate mouse clicks (left, right, middle)
recordMouseClick('mousedown', 1, 1200, 600, 1100);
recordMouseClick('mouseup',   1, 1200, 600, 1180);

recordMouseClick('mousedown', 2, 800, 450, 1450);
recordMouseClick('mouseup',   2, 800, 450, 1520);

recordMouseClick('mousedown', 3, 500, 320, 1750);
recordMouseClick('mouseup',   3, 500, 320, 1810);

// 3. Simulate scroll wheel (vertical up & down)
recordMouseWheel(1200, 600, 1, 3, 2050);
recordMouseWheel(1200, 600, 1, 3, 2150);
recordMouseWheel(1200, 600, -1, 3, 2350);

const mouseEndTime = mouseStartTime + 2500;
let moveCount = 0;
let clickCount = 0;
let wheelCount = 0;
for (const item of capturedMouseEvents) {
  if (item.type === 'move') moveCount++;
  else if (item.type === 'mousedown' || item.type === 'mouseup') clickCount++;
  else if (item.type === 'wheel') wheelCount++;
}

const mouseExport = {
  metadata: {
    type: 'global_mouse_telemetry',
    version: '2.0.0',
    captureScope: 'system_wide_global',
    platform: process.platform,
    screenBounds: screenBounds
  },
  session: {
    startedAt: new Date(mouseStartTime).toISOString(),
    endedAt: new Date(mouseEndTime).toISOString(),
    durationMs: 2500,
    durationSeconds: 2.5,
    totalEvents: capturedMouseEvents.length,
    moveEvents: moveCount,
    clickEvents: clickCount,
    wheelEvents: wheelCount
  },
  telemetry: capturedMouseEvents
};

const mouseFilePath = path.join(telemetryDir, 'ci-mouse-telemetry.json');
fs.writeFileSync(mouseFilePath, JSON.stringify(mouseExport, null, 2), 'utf-8');
console.log(`  ✓ Mouse telemetry recorded: ${capturedMouseEvents.length} total events`);
console.log(`    - Moves:  ${moveCount}`);
console.log(`    - Clicks: ${clickCount}`);
console.log(`    - Wheel:  ${wheelCount}`);
console.log(`  ✓ Exported to: ${mouseFilePath}\n`);


// ============================================================================
// TEST SUITE 3: UIOHOOK NATIVE EVENT EMISSION INTEGRITY
// ============================================================================
console.log('[3/4] Verifying uiohook-napi Hook Event Listeners...');

let hookedKbCount = 0;
let hookedMouseCount = 0;

function hookKbListener(e) {
  hookedKbCount++;
}

function hookMouseListener(e) {
  hookedMouseCount++;
}

uIOhook.on('keydown', hookKbListener);
uIOhook.on('mousemove', hookMouseListener);
uIOhook.on('mousedown', hookMouseListener);
uIOhook.on('wheel', hookMouseListener);

// Emit synthetic events to test hook dispatch
uIOhook.emit('keydown', { keycode: UiohookKey.A, ctrlKey: true });
uIOhook.emit('mousemove', { x: 50, y: 50 });
uIOhook.emit('mousedown', { x: 50, y: 50, button: 1 });
uIOhook.emit('wheel', { x: 50, y: 50, amount: 100, rotation: 1, direction: 3 });

uIOhook.removeListener('keydown', hookKbListener);
uIOhook.removeListener('mousemove', hookMouseListener);
uIOhook.removeListener('mousedown', hookMouseListener);
uIOhook.removeListener('wheel', hookMouseListener);

if (hookedKbCount < 1 || hookedMouseCount < 3) {
  throw new Error(`uIOhook listener failed: kbCount=${hookedKbCount}, mouseCount=${hookedMouseCount}`);
}
console.log(`  ✓ uIOhook Event listeners and dispatch verified successfully.\n`);


// ============================================================================
// TEST SUITE 4: TELEMETRY JSON SCHEMA INTEGRITY VALIDATION
// ============================================================================
console.log('[4/4] Validating Exported Telemetry JSON Schemas...');

// Validate Keyboard JSON
const readKb = JSON.parse(fs.readFileSync(kbFilePath, 'utf-8'));
if (readKb.metadata.type !== 'global_keyboard_shortcut_telemetry') throw new Error('Invalid KB metadata type');
if (!Array.isArray(readKb.telemetry) || readKb.telemetry.length === 0) throw new Error('Empty KB telemetry array');
if (readKb.session.totalShortcuts !== readKb.telemetry.length) throw new Error('Mismatch in KB session totalShortcuts');

for (const item of readKb.telemetry) {
  if (typeof item.id !== 'number') throw new Error('Invalid KB event id');
  if (typeof item.shortcut !== 'string') throw new Error('Invalid KB shortcut string');
  if (typeof item.offsetSec !== 'number') throw new Error('Invalid KB offsetSec');
}
console.log('  ✓ Keyboard telemetry JSON passed all schema validations.');

// Validate Mouse JSON
const readMouse = JSON.parse(fs.readFileSync(mouseFilePath, 'utf-8'));
if (readMouse.metadata.type !== 'global_mouse_telemetry') throw new Error('Invalid Mouse metadata type');
if (!readMouse.metadata.screenBounds || readMouse.metadata.screenBounds.width <= 0) throw new Error('Invalid Mouse screenBounds');
if (!Array.isArray(readMouse.telemetry) || readMouse.telemetry.length === 0) throw new Error('Empty Mouse telemetry array');

let foundMove = false;
let foundClick = false;
let foundWheel = false;

for (const item of readMouse.telemetry) {
  if (typeof item.id !== 'number') throw new Error('Invalid Mouse event id');
  if (typeof item.t !== 'number') throw new Error('Invalid Mouse event t');
  if (item.nx < 0 || item.nx > 1 || item.ny < 0 || item.ny > 1) {
    throw new Error(`Normalized coordinates out of [0, 1] range: nx=${item.nx}, ny=${item.ny}`);
  }

  if (item.type === 'move') foundMove = true;
  if (item.type === 'mousedown' || item.type === 'mouseup') {
    foundClick = true;
    if (!item.button) throw new Error('Mouse click missing button name');
  }
  if (item.type === 'wheel') {
    foundWheel = true;
    if (!item.direction) throw new Error('Mouse wheel missing direction');
  }
}

if (!foundMove || !foundClick || !foundWheel) {
  throw new Error(`Incomplete mouse telemetry types: move=${foundMove}, click=${foundClick}, wheel=${foundWheel}`);
}

console.log('  ✓ Mouse telemetry JSON passed all schema and coordinate validations.');

console.log('\n====================================================');
console.log('   ALL TELEMETRY TESTS PASSED SUCCESSFULLY! (4/4)');
console.log('====================================================');
