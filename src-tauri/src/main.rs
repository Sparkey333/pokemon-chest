// Pokémon Chest — Tauri shell. © 2026 DarkHearts
// Spawns the bundled Python backend (server.py) on a free localhost port with a
// writable home dir, shows the splash, then navigates the window to the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent};

struct Backend(Mutex<Option<Child>>);

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8787)
}

fn python3() -> String {
    for c in ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"] {
        if std::path::Path::new(c).exists() {
            return c.to_string();
        }
    }
    "python3".to_string()
}

/// Bundled app payload (Resources/app), with a dev fallback to the project root.
fn app_root(handle: &tauri::AppHandle) -> PathBuf {
    if let Ok(res) = handle.path().resource_dir() {
        let bundled = res.join("app");
        if bundled.join("server.py").exists() {
            return bundled;
        }
    }
    // dev: src-tauri/.. is the project root
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let addr = format!("127.0.0.1:{port}").parse().unwrap();
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(120));
    }
    false
}

fn main() {
    tauri::Builder::default()
        .manage(Backend(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let root = app_root(&handle);
            let server = root.join("server.py");
            let home = handle
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| root.clone());
            std::fs::create_dir_all(&home).ok();
            let port = free_port();

            let child = Command::new(python3())
                .arg(&server)
                .current_dir(&root)
                .env("POKECHEST_PORT", port.to_string())
                .env("POKEVAULT_PORT", port.to_string()) // pre-revamp fallback name
                .env("POKECHEST_HOME", &home)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();

            match child {
                Ok(c) => {
                    *handle.state::<Backend>().0.lock().unwrap() = Some(c);
                    std::thread::spawn(move || {
                        let ok = wait_for_port(port, Duration::from_secs(25));
                        if let Some(win) = handle.get_webview_window("main") {
                            let js = if ok {
                                // pad the in-app topbar clear of the macOS traffic lights
                                format!(
                                    "sessionStorage.setItem('pokechest.native','1');\
                                     window.location.replace('http://127.0.0.1:{port}/index.html?native=1')"
                                )
                            } else {
                                "document.querySelector('p').textContent=\
                                 'Could not start the local engine. Is python3 installed? \
                                  (xcode-select --install)';".to_string()
                            };
                            let _ = win.eval(&js);
                        }
                    });
                }
                Err(e) => {
                    if let Some(win) = handle.get_webview_window("main") {
                        let _ = win.eval(&format!(
                            "document.querySelector('p').textContent='Failed to launch backend: {e}'"
                        ));
                    }
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Pokémon Chest")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut c) = app.state::<Backend>().0.lock().unwrap().take() {
                    let _ = c.kill();
                }
            }
        });
}
