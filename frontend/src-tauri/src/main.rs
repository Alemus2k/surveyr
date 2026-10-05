// Surveyr desktop shell: starts the bundled Python analysis engine on a free
// local port, tells the dashboard where it is, and stops it when the app quits.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, File};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{App, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows: start the engine without flashing a console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Engine executable name inside the bundled resources.
const ENGINE_EXE: &str = if cfg!(windows) { "surveyr-backend.exe" } else { "surveyr-backend" };

/// Handle to the engine process so it can be stopped on exit.
struct Engine(Mutex<Option<Child>>);

fn free_port() -> std::io::Result<u16> {
    // Bind to port 0 so the OS picks an unused port, then release it for the engine.
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

/// Engine log file (~/Library/Logs/app.surveyr.desktop/engine.log), for troubleshooting.
fn log_file(app: &App) -> Option<File> {
    let dir = app.path().app_log_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    File::create(dir.join("engine.log")).ok()
}

/// Release builds run the PyInstaller engine shipped in the app's Resources;
/// `tauri dev` runs the backend straight from the checkout's virtualenv.
fn engine_command(app: &App) -> tauri::Result<Command> {
    if cfg!(debug_assertions) {
        let backend = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../backend");
        let python = if cfg!(windows) { ".venv/Scripts/python.exe" } else { ".venv/bin/python" };
        let mut cmd = Command::new(backend.join(python));
        cmd.arg(backend.join("surveyr_server.py"))
            .arg("--data-dir")
            .arg(backend.join("data"));
        return Ok(cmd);
    }
    let exe = app
        .path()
        .resource_dir()?
        .join("surveyr-backend")
        .join(ENGINE_EXE);
    Ok(Command::new(exe))
}

fn start_engine(app: &App, port: u16) -> tauri::Result<Child> {
    let mut cmd = engine_command(app)?;
    cmd.arg("--port")
        .arg(port.to_string())
        .arg("--parent-pid")
        .arg(std::process::id().to_string())
        .stdin(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    match log_file(app).and_then(|f| Some((f.try_clone().ok()?, f))) {
        Some((out, err)) => cmd.stdout(out).stderr(err),
        None => cmd.stdout(Stdio::null()).stderr(Stdio::null()),
    };
    Ok(cmd.spawn()?)
}

fn stop_engine(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<Engine>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let port = free_port()?;
            let child = start_engine(app, port)?;
            app.manage(Engine(Mutex::new(Some(child))));

            // Runs before the page's own scripts, so api.ts sees the address on load.
            let api = format!("window.__SURVEYR_API__ = 'http://127.0.0.1:{port}/api';");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Surveyr")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 620.0)
                .initialization_script(&api)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Surveyr")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_engine(app);
            }
        });
}
