# macOS Screen Recorder

A minimal command-line screen recorder built with
[`screencapturekit-rs`](https://github.com/doom-fish/screencapturekit-rs). It
records the first available display to an H.264 MP4 file using Apple's direct
`SCRecordingOutput` API.

## Requirements

- macOS 15.0 or newer
- Xcode 16 or newer, including its command-line tools
- Rust 1.76 or newer
- Screen Recording permission for the terminal application that launches it

The first run may prompt for Screen Recording access. If it does not, enable
the launching terminal under **System Settings > Privacy & Security > Screen
Recording**, then restart the terminal.

## Run

```sh
cargo run --release -- --duration 10 --output recording.mp4
```

The output path must end in `.mp4` and must not already exist. Run
`cargo run -- --help` for all options.

The recorder captures the first display returned by ScreenCaptureKit at its
native dimensions, includes the pointer, and records without system audio.

## Electron App Integration

You can integrate `screencapturekit-rs` with Electron using the bundled sidecar architecture. The Electron app provides a graphical interface to configure durations and trigger recordings via IPC.

### Running the Electron App

1. **Install Node.js dependencies:**
   ```sh
   npm install
   ```

2. **Build the Rust binary:**
   ```sh
   npm run build:rust
   ```

3. **Start the Electron application:**
   ```sh
   npm start
   ```

4. **Capture screenshot headless / CI mode:**
   ```sh
   npm run screenshot
   ```

## GitHub Actions

- [`.github/workflows/macos.yml`](.github/workflows/macos.yml): Runs formatting, Clippy, unit tests, and compiles the release binary.
- [`.github/workflows/electron-macos.yml`](.github/workflows/electron-macos.yml): Builds the Rust ScreenCaptureKit binary, installs Electron dependencies, launches the app on a `macos-15` runner, captures a screenshot of the running Electron app, and uploads the screenshot artifact.
