const { Client } = require('minecraft-launcher-core');

const parentPort = process.parentPort || null;
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
      if (logStreamEnabled) send('log', { data: normalizeLog(event) });
    });
    launcher.on('debug', event => {
      if (logStreamEnabled) send('log', { data: `[debug] ${normalizeLog(event)}` });
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

function handleControlMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'set-log-stream') {
    logStreamEnabled = Boolean(message.enabled);
    return;
  }
  handleMessage(message);
}

if (parentPort) parentPort.on('message', handleControlMessage);
process.on('message', handleControlMessage);

process.on('disconnect', () => {
  try { minecraftProcess?.kill(); } catch {}
});
