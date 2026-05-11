const views = {
  login: document.getElementById('view-login'),
  main: document.getElementById('view-main')
};

const pages = {
  home: document.getElementById('page-home'),
  mods: document.getElementById('page-mods'),
  resourcepacks: document.getElementById('page-resourcepacks'),
  shaderpacks: document.getElementById('page-shaderpacks'),
  updates: document.getElementById('page-updates'),
  settings: document.getElementById('page-settings'),
  logs: document.getElementById('page-logs'),
  about: document.getElementById('page-about')
};

const els = {
  loginBtn: document.getElementById('btn-login'),
  loginServerAddress: document.getElementById('login-server-address'),
  logoutBtn: document.getElementById('btn-logout'),
  avatar: document.getElementById('player-avatar'),
  playerName: document.getElementById('player-name'),
  playBtn: document.getElementById('btn-play'),
  playLabel: document.getElementById('play-label'),
  gameVersion: document.getElementById('game-version'),
  modloaderBadge: document.getElementById('modloader-badge'),
  setupBox: document.getElementById('setup-box'),
  setupText: document.getElementById('setup-text'),
  setupBar: document.getElementById('setup-bar'),
  progressSection: document.getElementById('progress-section'),
  progressFill: document.getElementById('progress-fill'),
  progressText: document.getElementById('progress-text'),
  serverCard: document.getElementById('server-card'),
  serverAddress: document.getElementById('server-address'),
  serverDot: document.getElementById('server-dot'),
  serverPlayers: document.getElementById('server-players'),
  serverVersion: document.getElementById('server-version'),
  serverMotd: document.getElementById('server-motd'),
  serverPing: document.getElementById('server-ping'),
  serverSample: document.getElementById('server-sample'),
  currentLauncherVersion: document.getElementById('current-launcher-version'),
  latestLauncherVersion: document.getElementById('latest-launcher-version'),
  manifestVersion: document.getElementById('manifest-version'),
  updateStatus: document.getElementById('update-status'),
  updateProgressFill: document.getElementById('update-progress-fill'),
  restartUpdateBtn: document.getElementById('btn-restart-update'),
  navUpdates: document.getElementById('nav-updates'),
  logType: document.getElementById('log-type'),
  logQuery: document.getElementById('log-query'),
  logBody: document.getElementById('log-body'),
  refreshLogBtn: document.getElementById('btn-refresh-log'),
  stopGameBtn: document.getElementById('btn-stop-game'),
  settingRamMin: document.getElementById('setting-ram-min'),
  settingRamMax: document.getElementById('setting-ram-max'),
  ramMinValue: document.getElementById('ram-min-value'),
  ramMaxValue: document.getElementById('ram-max-value'),
  settingWidth: document.getElementById('setting-width'),
  settingHeight: document.getElementById('setting-height'),
  settingJava: document.getElementById('setting-java'),
  scanJavaBtn: document.getElementById('btn-scan-java'),
  javaRuntimeMenu: document.getElementById('java-runtime-menu'),
  aboutVersion: document.getElementById('about-version'),
  aboutProfile: document.getElementById('about-profile'),
  aboutManifestUrl: document.getElementById('about-manifest-url'),
  launcherVersion: document.getElementById('launcher-version'),
  addShaderBtn: document.getElementById('btn-add-shader'),
  shaderDropZone: document.getElementById('shader-drop-zone'),
  shaderModrinthBtn: document.getElementById('btn-shader-modrinth'),
  shaderSearchPanel: document.getElementById('shader-search-panel'),
  shaderSearchInput: document.getElementById('shader-search-input'),
  shaderSearchBtn: document.getElementById('btn-shader-search'),
  shaderResults: document.getElementById('shader-results')
};

let loggedIn = false;
let launching = false;
let launcherUpdateRequired = false;
let currentManifest = null;
let serverStatusTimer = null;
let serverStatusInFlight = false;
let pendingGameLog = '';
let pendingGameLogTimer = null;

function showView(name) {
  Object.values(views).forEach(view => view.classList.remove('active'));
  views[name]?.classList.add('active');
}

function showPage(name) {
  Object.values(pages).forEach(page => page?.classList.remove('active'));
  pages[name]?.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.view === name);
  });
  if (['mods', 'resourcepacks'].includes(name)) refreshOfficialFiles();
  if (name === 'shaderpacks') refreshShaderpacks();
  if (name === 'logs') refreshLog();
  updateGameLogStreaming();
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

function setPlayState(label, disabled = false) {
  els.playLabel.textContent = label;
  els.playBtn.disabled = disabled || !loggedIn || launcherUpdateRequired || launching;
}

function updateGameControls() {
  if (els.stopGameBtn) els.stopGameBtn.disabled = !launching;
}

function shouldStreamGameLog() {
  return pages.logs.classList.contains('active') && els.logType.value === 'game';
}

function updateGameLogStreaming() {
  window.launcher.streamGameLog(shouldStreamGameLog());
}

function appendGameLog(line) {
  pendingGameLog += line.endsWith('\n') ? line : `${line}\n`;
  if (pendingGameLogTimer) return;
  pendingGameLogTimer = setTimeout(() => {
    pendingGameLogTimer = null;
    if (!shouldStreamGameLog()) {
      pendingGameLog = '';
      updateGameLogStreaming();
      return;
    }
    const nextText = `${els.logBody.textContent || ''}${pendingGameLog}`;
    pendingGameLog = '';
    const lines = nextText.split('\n');
    els.logBody.textContent = lines.length > 2500 ? lines.slice(-2500).join('\n') : nextText;
    els.logBody.scrollTop = els.logBody.scrollHeight;
  }, 250);
}

function setSetupVisible(visible) {
  els.setupBox?.classList.toggle('is-hidden', !visible);
}

function markSetupReady() {
  els.setupText.textContent = '실행 준비 완료';
  els.setupBar.style.width = '100%';
  setTimeout(() => setSetupVisible(false), 350);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function compareVersions(a, b) {
  const left = String(a || '0').split('.').map(part => Number.parseInt(part, 10) || 0);
  const right = String(b || '0').split('.').map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function setUpdateAttention(active, ready = false) {
  if (!els.navUpdates) return;
  els.navUpdates.classList.toggle('update-attention', Boolean(active));
  els.navUpdates.classList.toggle('update-ready', Boolean(active && ready));
}

function updateModloaderBadge(minecraft) {
  const loader = minecraft?.loader || 'vanilla';
  const version = minecraft?.loaderVersion || '';
  els.modloaderBadge.textContent = `${loader} ${version}`.trim();
}

function formatServerAddress(server) {
  if (!server?.host) return 'online.zzapcho.kr';
  return server.port && server.port !== 25565 ? `${server.host}:${server.port}` : server.host;
}

function applyManifest(manifest) {
  if (!manifest) return;
  currentManifest = manifest;
  const serverAddress = formatServerAddress(manifest.server);
  if (els.serverAddress) els.serverAddress.textContent = serverAddress;
  if (els.loginServerAddress) els.loginServerAddress.textContent = serverAddress;
  els.gameVersion.textContent = manifest.minecraft?.version || '-';
  updateModloaderBadge(manifest.minecraft);
  const currentVersion = els.currentLauncherVersion.textContent;
  const manifestLatest = manifest.launcher?.latestVersion || currentVersion;
  els.latestLauncherVersion.textContent = compareVersions(currentVersion, manifestLatest) > 0 ? currentVersion : manifestLatest;
  els.manifestVersion.textContent = manifest.manifestVersion || '-';
  refreshOfficialFiles();
}

async function refreshProfile() {
  const profile = await window.launcher.getProfile();
  const serverAddress = formatServerAddress(profile.server || profile.manifest?.server);
  if (els.serverAddress) els.serverAddress.textContent = serverAddress;
  if (els.loginServerAddress) els.loginServerAddress.textContent = serverAddress;
  els.aboutVersion.textContent = profile.appVersion;
  els.currentLauncherVersion.textContent = profile.appVersion;
  els.launcherVersion.textContent = `런처 버전 v${profile.appVersion}`;
  els.aboutProfile.textContent = profile.id;
  els.aboutManifestUrl.textContent = profile.manifestUrl;
  applyManifest(profile.manifest);
}

async function checkManifestUpdate() {
  els.updateStatus.textContent = '업데이트 확인 중';
  const result = await window.launcher.checkUpdate();
  if (!result.success) {
    els.updateStatus.textContent = '업데이트 확인 실패';
    showToast(result.error || 'manifest 확인 실패', 'error');
    setPlayState('오류 발생', true);
    return;
  }

  applyManifest(result.manifest);
  els.currentLauncherVersion.textContent = result.currentLauncherVersion;
  els.latestLauncherVersion.textContent = result.latestLauncherVersion;
  launcherUpdateRequired = result.launcherUpdateRequired;
  const hasNewLauncherVersion = compareVersions(result.currentLauncherVersion, result.latestLauncherVersion) < 0;
  setUpdateAttention(launcherUpdateRequired || hasNewLauncherVersion);
  if (launcherUpdateRequired) {
    els.updateStatus.textContent = '런처 업데이트가 필요합니다';
    setPlayState('런처 업데이트 필요', true);
  } else if (hasNewLauncherVersion) {
    els.updateStatus.textContent = '새 런처 버전이 있습니다';
    setPlayState(loggedIn ? '실행하기' : '로그인 필요', !loggedIn);
  } else {
    setUpdateAttention(false);
    els.updateStatus.textContent = result.source === 'remote' ? '최신 manifest 확인 완료' : `로컬 manifest 사용 중 (${result.source})`;
    setPlayState(loggedIn ? '실행하기' : '로그인 필요', !loggedIn);
  }
}

async function refreshServerStatus({ silent = false } = {}) {
  if (serverStatusInFlight) return;
  serverStatusInFlight = true;
  if (!silent) els.serverMotd.textContent = '서버 확인 중';
  try {
    const status = await window.launcher.getServerStatus();
    const online = Boolean(status.online);
    els.serverCard.classList.toggle('online', online);
    els.serverCard.classList.toggle('offline', !online);
    els.serverDot.classList.toggle('online', online);
    els.serverDot.classList.toggle('offline', !online);

    if (!online) {
      els.serverMotd.textContent = '오프라인';
      els.serverPlayers.textContent = '-';
      els.serverVersion.textContent = '-';
      els.serverPing.textContent = '-';
      els.serverSample.textContent = '접속자 목록은 서버 API 연결 후 표시됩니다.';
      return;
    }

    els.serverPlayers.textContent = `${status.onlineCount ?? 0}/${status.maxCount ?? 0}`;
    els.serverPlayers.classList.toggle('has-players', (status.onlineCount ?? 0) > 0);
    els.serverVersion.textContent = status.version || '-';
    els.serverMotd.textContent = status.motd || '온라인';
    els.serverPing.textContent = status.ping === null || status.ping === undefined ? '-' : `${status.ping} ms`;
    const sample = status.samplePlayers || [];
    els.serverSample.textContent = sample.length > 0 ? sample.join(', ') : '접속자 목록은 서버 API 연결 후 표시됩니다.';
  } catch {
    els.serverMotd.textContent = '확인 실패';
  } finally {
    serverStatusInFlight = false;
  }
}

function shouldPollServerStatus() {
  return document.visibilityState === 'visible' || document.hasFocus();
}

function stopServerStatusPolling() {
  if (!serverStatusTimer) return;
  clearInterval(serverStatusTimer);
  serverStatusTimer = null;
}

function startServerStatusPolling() {
  if (!shouldPollServerStatus()) {
    stopServerStatusPolling();
    return;
  }
  if (!serverStatusTimer) {
    serverStatusTimer = setInterval(() => refreshServerStatus({ silent: true }), 3000);
  }
  refreshServerStatus({ silent: true });
}

function updateServerStatusPolling() {
  if (shouldPollServerStatus()) startServerStatusPolling();
  else stopServerStatusPolling();
}

function renderOfficialList(category) {
  const target = document.getElementById(`server-${category}`);
  if (!target) return;
  const files = (currentManifest?.files || []).filter(file => file.path.startsWith(`${category}/`));
  target.innerHTML = '';
  if (files.length === 0) {
    target.innerHTML = '<div class="file-list-empty">아직 등록된 공식 파일이 없습니다.</div>';
    return;
  }
  for (const file of files) {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <span class="file-item-name" title="${file.path}">${file.path}</span>
      <span class="file-item-meta">${formatBytes(file.size)}</span>
      <span class="server-badge">공식</span>
    `;
    target.appendChild(item);
  }
}

function refreshOfficialFiles() {
  ['mods', 'resourcepacks'].forEach(renderOfficialList);
}

function renderShaderpacks(files) {
  const target = document.getElementById('user-shaderpacks');
  if (!target) return;
  target.innerHTML = '';
  if (!files || files.length === 0) {
    target.innerHTML = '<div class="file-list-empty">추가된 셰이더가 없습니다.</div>';
    return;
  }
  for (const file of files) {
    const item = document.createElement('div');
    item.className = 'file-item';
    const name = file.name || file.path?.replace(/^shaderpacks\//, '') || file.path;
    item.innerHTML = `
      <span class="file-item-name" title="${name}">${name}</span>
      <span class="file-item-meta">${formatBytes(file.size)}</span>
      <button class="file-item-del" title="삭제">×</button>
    `;
    item.querySelector('.file-item-del').addEventListener('click', async () => {
      const result = await window.launcher.removeFile('shaderpacks', name);
      if (result.success) renderShaderpacks(result.files);
      else showToast(`삭제 실패: ${result.error}`, 'error');
    });
    target.appendChild(item);
  }
}

async function refreshShaderpacks() {
  const data = await window.launcher.listFiles();
  renderShaderpacks(data.user?.shaderpacks || []);
}

function setProfile(name, uuid) {
  loggedIn = true;
  els.playerName.textContent = name;
  els.avatar.src = `https://mc-heads.net/avatar/${uuid}/32`;
  showView('main');
  setPlayState(launcherUpdateRequired ? '런처 업데이트 필요' : '실행하기');
}

async function runSetupOnly() {
  setSetupVisible(true);
  setPlayState('파일 확인 중', true);
  els.setupText.textContent = '공식 파일 확인 중';
  els.setupBar.style.width = '0%';
  const result = await window.launcher.runSetup();
  if (!result.success) {
    showToast(result.error || '파일 검증 실패', 'error');
    els.setupText.textContent = result.error || '파일 검증 실패';
    setPlayState('오류 발생', true);
    return false;
  }
  applyManifest(result.manifest);
  markSetupReady();
  setPlayState('실행하기');
  return true;
}

els.loginBtn.addEventListener('click', async () => {
  els.loginBtn.disabled = true;
  els.loginBtn.textContent = '로그인 중...';
  const result = await window.launcher.login();
  if (result.success) {
    setProfile(result.name, result.uuid);
    await checkManifestUpdate();
    await runSetupOnly();
    refreshServerStatus();
  } else {
    showToast(`로그인 실패: ${result.error || '알 수 없는 오류'}`, 'error');
  }
  els.loginBtn.disabled = false;
  els.loginBtn.textContent = 'Microsoft 계정으로 로그인';
});

els.logoutBtn.addEventListener('click', async () => {
  await window.launcher.logout();
  loggedIn = false;
  showView('login');
});

els.playBtn.addEventListener('click', async () => {
  if (launching || launcherUpdateRequired) return;
  launching = true;
  setPlayState('파일 확인 중', true);
  const ready = await runSetupOnly();
  if (!ready) {
    launching = false;
    updateGameControls();
    return;
  }

  launching = true;
  updateGameControls();
  setPlayState('게임 시작 중', true);
  els.progressSection.classList.add('visible');
  els.progressText.textContent = '실행 환경 준비 중';
  const result = await window.launcher.launch();
  if (result.success) {
    setPlayState('실행 중', true);
    showToast('Minecraft를 실행했습니다.', 'success');
  } else {
    showToast(`실행 실패: ${result.error || '오류 발생'}`, 'error');
    launching = false;
    updateGameControls();
    setPlayState('오류 발생', true);
  }
});

window.launcher.onSetupProgress(({ message, percent }) => {
  els.setupText.textContent = message;
  if (percent >= 0) els.setupBar.style.width = `${Math.min(100, percent)}%`;
});

window.launcher.onProgress(event => {
  if (event.total > 0) {
    const percent = Math.round((event.task / event.total) * 100);
    els.progressFill.style.width = `${percent}%`;
    els.progressText.textContent = `${event.type || '다운로드'} ${event.task}/${event.total}`;
  }
});

window.launcher.onDownloadStatus(event => {
  if (event.total > 0) {
    const percent = Math.round((event.current / event.total) * 100);
    els.progressFill.style.width = `${percent}%`;
    els.progressText.textContent = `${event.name || '파일'} ${percent}%`;
  }
});

window.launcher.onGameClosed(code => {
  launching = false;
  updateGameControls();
  els.progressSection.classList.remove('visible');
  setPlayState('실행하기');
  if (code === 0) showToast('게임이 종료되었습니다.', 'success');
  else showToast(`게임이 종료되었습니다. 코드: ${code}`, 'error');
});

window.launcher.onGameLog(line => {
  if (shouldStreamGameLog()) appendGameLog(line);
});

window.launcher.onUpdaterStatus(data => {
  els.updateStatus.textContent = data.status || '업데이트 상태 변경';
  if (data.status === '최신 버전입니다') {
    setUpdateAttention(false);
  }
});

window.launcher.onUpdaterAvailable(version => {
  setUpdateAttention(true);
  els.latestLauncherVersion.textContent = version;
  els.updateStatus.textContent = '새 버전 다운로드 중';
});

window.launcher.onUpdaterProgress(({ percent, speed }) => {
  setUpdateAttention(true);
  els.updateProgressFill.style.width = `${percent}%`;
  els.updateStatus.textContent = `새 버전 다운로드 중 ${percent}% (${speed} KB/s)`;
});

window.launcher.onUpdaterDownloaded(version => {
  setUpdateAttention(true, true);
  els.latestLauncherVersion.textContent = version;
  els.updateProgressFill.style.width = '100%';
  els.updateStatus.textContent = '업데이트 준비 완료';
  els.restartUpdateBtn.disabled = false;
});

els.restartUpdateBtn.addEventListener('click', () => window.launcher.restartForUpdate());

async function refreshLog() {
  pendingGameLog = '';
  updateGameLogStreaming();
  const text = await window.launcher.readLog(els.logType.value, els.logQuery.value.trim());
  els.logBody.textContent = text || '로그가 없습니다.';
  els.logBody.scrollTop = els.logBody.scrollHeight;
}

els.logType.addEventListener('change', () => {
  updateGameLogStreaming();
  refreshLog();
});
els.logQuery.addEventListener('input', () => {
  clearTimeout(els.logQuery._timer);
  els.logQuery._timer = setTimeout(refreshLog, 250);
});
els.refreshLogBtn?.addEventListener('click', refreshLog);

document.getElementById('btn-copy-log').addEventListener('click', async () => {
  await navigator.clipboard.writeText(els.logBody.textContent);
  showToast('로그를 복사했습니다.', 'success');
});
els.stopGameBtn?.addEventListener('click', async () => {
  if (!launching) return;
  els.stopGameBtn.disabled = true;
  const result = await window.launcher.terminateGame();
  if (result.success) {
    showToast('게임 강제 종료를 요청했습니다.', 'success');
  } else {
    showToast(`강제 종료 실패: ${result.error || '오류 발생'}`, 'error');
    updateGameControls();
  }
});
document.getElementById('btn-open-logs').addEventListener('click', () => window.launcher.openLogsFolder());

function syncRamLabels() {
  if (+els.settingRamMin.value > +els.settingRamMax.value) els.settingRamMax.value = els.settingRamMin.value;
  els.ramMinValue.textContent = els.settingRamMin.value;
  els.ramMaxValue.textContent = els.settingRamMax.value;
}

els.settingRamMin.addEventListener('input', syncRamLabels);
els.settingRamMax.addEventListener('input', syncRamLabels);

function closeJavaRuntimeMenu() {
  els.javaRuntimeMenu.classList.remove('open');
}

function renderJavaRuntimeMenu(result) {
  const runtimes = result.runtimes || [];
  els.javaRuntimeMenu.innerHTML = '';
  if (!runtimes.length) {
    const empty = document.createElement('div');
    empty.className = 'java-runtime-empty';
    empty.textContent = `Java ${result.requiredMajor || ''} 이상을 찾지 못했습니다. 비워두면 실행 시 자동 설치됩니다.`;
    els.javaRuntimeMenu.appendChild(empty);
    els.javaRuntimeMenu.classList.add('open');
    return;
  }

  for (const runtime of runtimes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'java-runtime-option';

    const title = document.createElement('div');
    title.className = 'java-runtime-title';
    const name = document.createElement('span');
    name.textContent = `${runtime.source || 'Java'} ${runtime.version}`;
    const vendor = document.createElement('span');
    vendor.textContent = runtime.vendor || '';
    title.append(name, vendor);

    const runtimePath = document.createElement('div');
    runtimePath.className = 'java-runtime-path';
    runtimePath.textContent = runtime.path;

    button.append(title, runtimePath);
    button.addEventListener('click', () => {
      els.settingJava.value = runtime.path;
      closeJavaRuntimeMenu();
    });
    els.javaRuntimeMenu.appendChild(button);
  }
  els.javaRuntimeMenu.classList.add('open');
}

els.scanJavaBtn.addEventListener('click', async event => {
  event.stopPropagation();
  if (els.javaRuntimeMenu.classList.contains('open')) {
    closeJavaRuntimeMenu();
    return;
  }

  els.scanJavaBtn.disabled = true;
  const previousText = els.scanJavaBtn.textContent;
  els.scanJavaBtn.textContent = '...';
  try {
    const result = await window.launcher.scanJava();
    if (!result.success) throw new Error(result.error || 'Java 스캔 실패');
    renderJavaRuntimeMenu(result);
  } catch (error) {
    showToast(error.message || 'Java 스캔 실패', 'error');
  } finally {
    els.scanJavaBtn.disabled = false;
    els.scanJavaBtn.textContent = previousText;
  }
});

document.addEventListener('click', event => {
  if (!els.javaRuntimeMenu.classList.contains('open')) return;
  if (els.javaRuntimeMenu.contains(event.target) || els.scanJavaBtn.contains(event.target)) return;
  closeJavaRuntimeMenu();
});

async function loadSettings() {
  const settings = await window.launcher.getSettings();
  els.settingRamMin.value = settings.ram?.min || 2;
  els.settingRamMax.value = settings.ram?.max || 4;
  els.settingWidth.value = settings.resolution?.width || 1280;
  els.settingHeight.value = settings.resolution?.height || 720;
  els.settingJava.value = settings.javaPath || '';
  syncRamLabels();
}

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  await window.launcher.setSettings({
    ram: { min: +els.settingRamMin.value, max: +els.settingRamMax.value },
    resolution: { width: +els.settingWidth.value, height: +els.settingHeight.value },
    javaPath: els.settingJava.value.trim()
  });
  showToast('설정을 저장했습니다.', 'success');
});

document.getElementById('btn-open-game-folder').addEventListener('click', () => window.launcher.openGameFolder());

els.addShaderBtn.addEventListener('click', async () => {
  const paths = await window.launcher.openFileDialog('shaderpacks');
  if (!paths.length) return;
  const result = await window.launcher.addFiles('shaderpacks', paths);
  if (result.success) {
    renderShaderpacks(result.files);
    showToast('셰이더를 추가했습니다.', 'success');
  } else {
    showToast(`셰이더 추가 실패: ${result.error}`, 'error');
  }
});

els.shaderDropZone.addEventListener('dragover', event => {
  event.preventDefault();
  els.shaderDropZone.classList.add('drag-over');
});

els.shaderDropZone.addEventListener('dragleave', () => {
  els.shaderDropZone.classList.remove('drag-over');
});

els.shaderDropZone.addEventListener('drop', async event => {
  event.preventDefault();
  els.shaderDropZone.classList.remove('drag-over');
  const paths = Array.from(event.dataTransfer.files)
    .map(file => window.launcher.getPathForFile(file))
    .filter(Boolean);
  if (!paths.length) return;
  const result = await window.launcher.addFiles('shaderpacks', paths);
  if (result.success) {
    renderShaderpacks(result.files);
    showToast(`${paths.length}개 셰이더를 추가했습니다.`, 'success');
  } else {
    showToast(`셰이더 추가 실패: ${result.error}`, 'error');
  }
});

els.shaderModrinthBtn.addEventListener('click', () => {
  const isOpen = els.shaderSearchPanel.style.display !== 'none';
  els.shaderSearchPanel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) els.shaderSearchInput.focus();
});

async function installShaderVersion(projectId, button) {
  button.disabled = true;
  button.textContent = '버전 확인 중';
  const versions = await window.launcher.modrinthVersions({
    projectId,
    gameVersion: currentManifest?.minecraft?.version
  });
  if (!versions.success || !versions.versions.length) {
    button.disabled = false;
    button.textContent = '설치';
    showToast(versions.error || '설치 가능한 버전이 없습니다.', 'error');
    return;
  }
  const version = versions.versions[0];
  const file = version.files?.find(item => item.primary) || version.files?.[0];
  if (!file) {
    button.disabled = false;
    button.textContent = '설치';
    showToast('다운로드 파일이 없습니다.', 'error');
    return;
  }
  button.textContent = '다운로드 중';
  const result = await window.launcher.modrinthDownload({
    url: file.url,
    filename: file.filename
  });
  if (result.success) {
    renderShaderpacks(result.files);
    button.textContent = '완료';
    showToast(`${file.filename} 설치 완료`, 'success');
  } else {
    button.disabled = false;
    button.textContent = '설치';
    showToast(`설치 실패: ${result.error}`, 'error');
  }
}

async function searchShaders() {
  const query = els.shaderSearchInput.value.trim();
  if (!query) return;
  els.shaderResults.innerHTML = '<div class="file-list-empty">검색 중...</div>';
  const result = await window.launcher.modrinthSearch({ query });
  if (!result.success) {
    els.shaderResults.innerHTML = `<div class="file-list-empty">검색 실패: ${result.error}</div>`;
    return;
  }
  if (!result.hits.length) {
    els.shaderResults.innerHTML = '<div class="file-list-empty">검색 결과가 없습니다.</div>';
    return;
  }
  els.shaderResults.innerHTML = '';
  for (const hit of result.hits) {
    const row = document.createElement('div');
    row.className = 'shader-result';
    row.innerHTML = `
      <div>
        <div class="shader-result-title">${hit.title}</div>
        <div class="shader-result-desc">${hit.description || ''}</div>
      </div>
      <button class="btn btn-primary">설치</button>
    `;
    row.querySelector('button').addEventListener('click', event => installShaderVersion(hit.project_id, event.currentTarget));
    els.shaderResults.appendChild(row);
  }
}

els.shaderSearchBtn.addEventListener('click', searchShaders);
els.shaderSearchInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') searchShaders();
});

document.querySelectorAll('.nav-btn').forEach(button => {
  button.addEventListener('click', () => showPage(button.dataset.view));
});

async function copyServerAddress() {
  const address = els.serverAddress?.textContent?.trim() || 'online.zzapcho.kr';
  await navigator.clipboard.writeText(address);
  showToast('서버 주소를 복사했습니다.', 'success');
}

els.serverAddress?.addEventListener('click', copyServerAddress);
els.serverAddress?.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  copyServerAddress();
});

document.addEventListener('visibilitychange', updateServerStatusPolling);
window.addEventListener('focus', updateServerStatusPolling);
window.addEventListener('blur', updateServerStatusPolling);

document.getElementById('btn-minimize').addEventListener('click', () => window.launcher.minimize());
document.getElementById('btn-close').addEventListener('click', () => window.launcher.close());

async function init() {
  refreshServerStatus();
  updateServerStatusPolling();

  await refreshProfile();
  await loadSettings();
  await checkManifestUpdate();

  const auth = await window.launcher.checkAuth();
  if (auth.loggedIn) {
    setProfile(auth.name, auth.uuid);
    await runSetupOnly();
  } else {
    setPlayState('로그인 필요', true);
  }
}

init();
