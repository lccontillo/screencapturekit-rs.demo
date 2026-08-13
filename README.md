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

## GitHub Actions

[`.github/workflows/macos.yml`](.github/workflows/macos.yml) runs on a hosted
Apple Silicon macOS 26 runner. It checks formatting, runs Clippy and unit tests,
builds the release binary, and uploads that binary as a workflow artifact.

The workflow does not execute a live recording because hosted GitHub Actions
runners cannot grant interactive Screen Recording permission. A successful
workflow verifies that the Rust and Swift bridge code compiles and links against
Apple's ScreenCaptureKit framework; the permission-dependent recording path
still needs one manual run on a Mac.
