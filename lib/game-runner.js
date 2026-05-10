const { Client } = require('minecraft-launcher-core');

function send(type, payload = {}) {
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

process.on('message', async message => {
  if (!message || message.type !== 'launch') return;
  try {
    const launcher = new Client();
    launcher.on('progress', data => send('progress', { data }));
    launcher.on('download-status', data => send('download-status', { data }));
    launcher.on('data', event => send('log', { data: normalizeLog(event) }));
    launcher.on('close', code => {
      send('closed', { code });
      setTimeout(() => process.exit(0), 50);
    });

    await launcher.launch(message.opts);
    send('launched');
  } catch (error) {
    send('error', { error: error.stack || error.message });
    setTimeout(() => process.exit(1), 50);
  }
});
