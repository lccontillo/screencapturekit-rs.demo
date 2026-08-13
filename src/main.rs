use screencapturekit::prelude::*;
use screencapturekit::recording_output::{
    SCRecordingOutput, SCRecordingOutputCodec, SCRecordingOutputConfiguration,
    SCRecordingOutputFileType,
};
use std::env;
use std::error::Error;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::thread;
use std::time::Duration;

const DEFAULT_DURATION_SECONDS: u64 = 10;
const DEFAULT_OUTPUT_PATH: &str = "recording.mp4";
const USAGE: &str = "Usage: macos-screen-recorder [--duration SECONDS] [--output PATH]\n\
\n\
Options:\n\
  -d, --duration SECONDS  Recording duration (default: 10)\n\
  -o, --output PATH       Output MP4 path (default: recording.mp4)\n\
  -h, --help              Print this help";

#[derive(Debug, PartialEq, Eq)]
struct Options {
    duration: Duration,
    output: PathBuf,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            duration: Duration::from_secs(DEFAULT_DURATION_SECONDS),
            output: PathBuf::from(DEFAULT_OUTPUT_PATH),
        }
    }
}

fn main() -> ExitCode {
    match run(env::args_os().skip(1)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: impl IntoIterator<Item = OsString>) -> Result<(), Box<dyn Error>> {
    let Some(options) = parse_options(args)? else {
        println!("{USAGE}");
        return Ok(());
    };

    ensure_mp4_extension(&options.output)?;
    let output = absolute_path(&options.output)?;
    if output.exists() {
        return Err(format!("output already exists: {}", output.display()).into());
    }

    let content = SCShareableContent::get().map_err(|error| {
        format!(
            "could not access shareable displays: {error}. Grant Screen Recording permission in System Settings > Privacy & Security > Screen Recording"
        )
    })?;
    let display = content
        .displays()
        .into_iter()
        .next()
        .ok_or("no displays are available to record")?;

    let filter = SCContentFilter::create()
        .with_display(&display)
        .with_excluding_windows(&[])
        .build();
    let stream_config = SCStreamConfiguration::new()
        .with_width(display.width())
        .with_height(display.height())
        .with_pixel_format(PixelFormat::BGRA)
        .with_shows_cursor(true);
    let recording_config = SCRecordingOutputConfiguration::new()
        .with_output_url(&output)
        .with_video_codec(SCRecordingOutputCodec::H264)
        .with_output_file_type(SCRecordingOutputFileType::MP4);
    let recording = SCRecordingOutput::new(&recording_config)
        .ok_or("failed to create recording output; macOS 15.0 or newer is required")?;

    let mut stream = SCStream::new(&filter, &stream_config);
    stream.add_recording_output(&recording)?;

    println!(
        "Recording display {} ({}x{}) to {} for {} second(s)...",
        display.display_id(),
        display.width(),
        display.height(),
        output.display(),
        options.duration.as_secs()
    );
    stream.start_capture()?;
    thread::sleep(options.duration);

    let stop_result = stream.stop_capture();
    let remove_result = stream.remove_recording_output(&recording);
    stop_result?;
    remove_result?;

    println!(
        "Saved {} ({} bytes)",
        output.display(),
        recording.recorded_file_size()
    );
    Ok(())
}

fn parse_options(
    args: impl IntoIterator<Item = OsString>,
) -> Result<Option<Options>, Box<dyn Error>> {
    let mut options = Options::default();
    let mut args = args.into_iter();

    while let Some(argument) = args.next() {
        match argument.to_str() {
            Some("-h" | "--help") => return Ok(None),
            Some("-d" | "--duration") => {
                let value = args.next().ok_or("--duration requires a value")?;
                let value = value
                    .to_str()
                    .ok_or("--duration must contain valid UTF-8")?;
                let seconds = value
                    .parse::<u64>()
                    .map_err(|_| "--duration must be a positive whole number")?;
                if seconds == 0 {
                    return Err("--duration must be greater than zero".into());
                }
                options.duration = Duration::from_secs(seconds);
            }
            Some("-o" | "--output") => {
                options.output = PathBuf::from(args.next().ok_or("--output requires a path")?);
            }
            Some(value) => return Err(format!("unknown argument: {value}\n\n{USAGE}").into()),
            None => return Err("arguments must contain valid UTF-8".into()),
        }
    }

    Ok(Some(options))
}

fn ensure_mp4_extension(path: &Path) -> Result<(), Box<dyn Error>> {
    if path.extension().and_then(|extension| extension.to_str()) == Some("mp4") {
        Ok(())
    } else {
        Err("--output must use the .mp4 extension".into())
    }
}

fn absolute_path(path: &Path) -> Result<PathBuf, Box<dyn Error>> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        Ok(env::current_dir()?.join(path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args<'a>(values: &'a [&'a str]) -> impl Iterator<Item = OsString> + 'a {
        values.iter().map(OsString::from)
    }

    #[test]
    fn defaults_are_stable() {
        assert_eq!(parse_options(args(&[])).unwrap(), Some(Options::default()));
    }

    #[test]
    fn parses_duration_and_output() {
        assert_eq!(
            parse_options(args(&["--duration", "3", "--output", "demo.mp4"])).unwrap(),
            Some(Options {
                duration: Duration::from_secs(3),
                output: PathBuf::from("demo.mp4"),
            })
        );
    }

    #[test]
    fn rejects_zero_duration() {
        assert!(parse_options(args(&["--duration", "0"])).is_err());
    }

    #[test]
    fn help_short_circuits_parsing() {
        assert_eq!(parse_options(args(&["--help"])).unwrap(), None);
    }
}
