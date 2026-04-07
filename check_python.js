import { spawn } from 'child_process';
const pythonCmd = process.platform === "win32" ? "python" : "python3";
const python = spawn(pythonCmd, ['--version']);
python.stdout.on('data', (data) => console.log(`Python version: ${data}`));
python.stderr.on('data', (data) => console.error(`Python error: ${data}`));
python.on('close', (code) => console.log(`Python process exited with code ${code}`));
