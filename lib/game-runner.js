const { Client } = require('minecraft-launcher-core');
const { spawn } = require('child_process');

let parentPort = null;
try {
  parentPort = require('worker_threads').parentPort || process.parentPort || require('electron').parentPort || null;
} catch {}
let logStreamEnabled = false;
let minecraftProcess = null;

function send(type, payload = {}) {
  if (parentPort) {
    parentPort.postMessage({ type, ...payload });
    return;
  }
  if (process.send) process.send({ type, ...payload });
}

function normalizeLog(event) {
  if (typeof event === 'string') return event;
  if (event?.data) return event.data;
  try {
    return JSON.stringify(event);
  } catch {
    return String(event);
  }
}

async function handleMessage(message) {
  if (!message || message.type !== 'launch') return;
  try {
    const launcher = new Client();
    launcher.on('progress', data => send('progress', { data }));
    launcher.on('download-status', data => send('download-status', { data }));
    launcher.on('data', event => {
      send('log', { data: normalizeLog(event) });
    });
    launcher.on('debug', event => {
      send('log', { data: `[debug] ${normalizeLog(event)}` });
    });
    launcher.on('close', code => {
      send('closed', { code });
      setTimeout(() => process.exit(0), 50);
    });

    minecraftProcess = await launcher.launch(message.opts);
    send('launched');
  } catch (error) {
    send('error', { error: error.stack || error.message });
    setTimeout(() => process.exit(1), 50);
  }
}

function terminateMinecraft() {
  if (!minecraftProcess) {
    send('closed', { code: null });
    setTimeout(() => process.exit(0), 50);
    return;
  }

  if (process.platform !== 'win32' || !minecraftProcess.pid) {
    try { minecraftProcess.kill('SIGKILL'); } catch {}
    return;
  }

  const killer = spawn('taskkill.exe', ['/PID', String(minecraftProcess.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore'
  });
  killer.on('exit', () => setTimeout(() => process.exit(0), 50));
  killer.on('error', () => {
    try { minecraftProcess.kill(); } catch {}
    setTimeout(() => process.exit(0), 50);
  });
}

function handleControlMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'set-log-stream') {
    logStreamEnabled = Boolean(message.enabled);
    return;
  }
  if (message.type === 'terminate') {
    terminateMinecraft();
    return;
  }
  handleMessage(message);
}

if (parentPort) parentPort.on('message', handleControlMessage);
process.on('message', handleControlMessage);

send('ready');

process.on('disconnect', () => {
  try { minecraftProcess?.kill(); } catch {}
});
