// Build the bundled Python engine (PyInstaller) on macOS, Windows or Linux.
// Uses backend/.venv if it exists, otherwise the system Python.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const backend = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "backend");
const isWindows = process.platform === "win32";
const venvPython = isWindows
  ? join(backend, ".venv", "Scripts", "python.exe")
  : join(backend, ".venv", "bin", "python");
const python = existsSync(venvPython) ? venvPython : isWindows ? "python" : "python3";

const result = spawnSync(
  python,
  ["-m", "PyInstaller", "surveyr-backend.spec", "--noconfirm", "--log-level", "WARN"],
  { cwd: backend, stdio: "inherit" }
);
if (result.error) {
  console.error(`Couldn't run ${python}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
