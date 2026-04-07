import { spawn } from 'child_process';
const python = spawn('python3', ['sniffer.py']);
python.stdout.on('data', (data) => console.log(`STDOUT: ${data}`));
python.stderr.on('data', (data) => console.error(`STDERR: ${data}`));
python.on('close', (code) => console.log(`Exited with code ${code}`));
setTimeout(() => python.kill(), 30000); // Run for 30s
