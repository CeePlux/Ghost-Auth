import { spawn } from 'child_process';
const pip = spawn('pip', ['install', '-r', 'requirements.txt']);
pip.stdout.on('data', (data) => console.log(`STDOUT: ${data}`));
pip.stderr.on('data', (data) => console.error(`STDERR: ${data}`));
pip.on('close', (code) => console.log(`Exited with code ${code}`));
