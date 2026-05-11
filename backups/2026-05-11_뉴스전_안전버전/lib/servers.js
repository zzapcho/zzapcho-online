/**
 * servers.dat 파일 읽기/쓰기 (GZip 압축 NBT 형식)
 * Minecraft 1.7+ 표준 서버 목록 형식
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ─── NBT primitive helpers ───────────────────────────────────

function tagString(name, value) {
  const n = Buffer.from(name,  'utf8');
  const v = Buffer.from(value, 'utf8');
  const buf = Buffer.allocUnsafe(1 + 2 + n.length + 2 + v.length);
  let o = 0;
  buf[o++] = 8;
  buf.writeUInt16BE(n.length, o); o += 2;
  n.copy(buf, o); o += n.length;
  buf.writeUInt16BE(v.length, o); o += 2;
  v.copy(buf, o);
  return buf;
}

function tagByte(name, value) {
  const n = Buffer.from(name, 'utf8');
  const buf = Buffer.allocUnsafe(1 + 2 + n.length + 1);
  let o = 0;
  buf[o++] = 1;
  buf.writeUInt16BE(n.length, o); o += 2;
  n.copy(buf, o); o += n.length;
  buf.writeInt8(value, o);
  return buf;
}

const TAG_END = Buffer.from([0x00]);

// ─── Encode ──────────────────────────────────────────────────

function encodeServersDat(servers) {
  const entries = servers.map(s => {
    const ip = (s.port && s.port !== 25565) ? `${s.ip}:${s.port}` : (s.ip || '');
    return Buffer.concat([
      tagString('name', s.name || 'Server'),
      tagString('ip',   ip),
      tagByte('acceptTextures', 1),
      TAG_END
    ]);
  });

  const listName = Buffer.from('servers', 'utf8');
  const listHead = Buffer.allocUnsafe(1 + 2 + listName.length + 1 + 4);
  let o = 0;
  listHead[o++] = 9;
  listHead.writeUInt16BE(listName.length, o); o += 2;
  listName.copy(listHead, o); o += listName.length;
  listHead[o++] = 10;
  listHead.writeInt32BE(servers.length, o);

  return Buffer.concat([
    Buffer.from([0x0A, 0x00, 0x00]),
    listHead,
    ...entries,
    TAG_END
  ]);
}

// ─── Decode ──────────────────────────────────────────────────

function isGzipBuffer(buf) {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

function parseServersDat(buf) {
  const servers = [];
  let o = 0;

  function readString() {
    const len = buf.readUInt16BE(o); o += 2;
    const s = buf.slice(o, o + len).toString('utf8'); o += len;
    return s;
  }

  try {
    if (buf[o++] !== 10) return [];
    readString(); // root name

    while (o < buf.length) {
      const type = buf[o++];
      if (type === 0) break;
      const tagName = readString();

      if (type === 9 && tagName === 'servers') {
        o++; // element type
        const count = buf.readInt32BE(o); o += 4;

        for (let i = 0; i < count; i++) {
          const sv = {};
          while (o < buf.length) {
            const ft = buf[o++];
            if (ft === 0) break;
            const fn = readString();
            if      (ft === 8) { sv[fn] = readString(); }
            else if (ft === 1) { o++; }
            else if (ft === 2) { o += 2; }
            else if (ft === 3) { o += 4; }
            else if (ft === 4) { o += 8; }
            else if (ft === 5) { o += 4; }
            else if (ft === 6) { o += 8; }
          }
          if (sv.ip !== undefined) {
            const lastColon = sv.ip.lastIndexOf(':');
            let host = sv.ip, port = 25565;
            if (lastColon > 0) {
              const p = parseInt(sv.ip.slice(lastColon + 1));
              if (!isNaN(p)) { host = sv.ip.slice(0, lastColon); port = p; }
            }
            servers.push({ name: sv.name || 'Server', ip: host, port });
          }
        }
      }
    }
  } catch {}

  return servers;
}

function normalizeIp(ip) {
  if (!ip) return '';
  const s = String(ip).toLowerCase();
  const lastColon = s.lastIndexOf(':');
  if (lastColon > 0 && !isNaN(parseInt(s.slice(lastColon + 1)))) {
    return s.slice(0, lastColon);
  }
  return s;
}

// ─── Public API ──────────────────────────────────────────────

function readServersDat(gamePath) {
  const dest = path.join(gamePath, 'servers.dat');
  if (!fs.existsSync(dest)) return [];
  try {
    const raw = fs.readFileSync(dest);
    const buf = isGzipBuffer(raw) ? zlib.gunzipSync(raw) : raw;
    return parseServersDat(buf);
  } catch { return []; }
}

function isServersDatCompressed(gamePath) {
  const dest = path.join(gamePath, 'servers.dat');
  try {
    return fs.existsSync(dest) && isGzipBuffer(fs.readFileSync(dest));
  } catch {
    return false;
  }
}

function writeServersDatExact(gamePath, servers) {
  if (!Array.isArray(servers) || servers.length === 0) return;
  fs.mkdirSync(gamePath, { recursive: true });
  fs.writeFileSync(path.join(gamePath, 'servers.dat'), encodeServersDat(servers));
  console.log('[servers.dat] written:', servers.map(s => s.ip).join(', '));
}

function backupUnreadableServersDat(dest) {
  if (!fs.existsSync(dest)) return;
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(dest, `${dest}.corrupt-${stamp}`);
  } catch {}
}

/**
 * servers.dat 쓰기
 * - manifest 서버는 항상 맨 위
 * - 사용자 추가 서버(manifest/이전manifest 제외)는 보존
 * - 실패해도 setup:run을 중단시키지 않음 (try/catch 포함)
 */
function writeServersDat(gamePath, manifestServers, prevManifestServers = []) {
  try {
    if (!Array.isArray(manifestServers)) manifestServers = [];

    fs.mkdirSync(gamePath, { recursive: true });

    // 사용자 추가 서버 추출 (manifest & 이전 preset 서버 제외)
    let userServers = [];
    try {
      const existing = readServersDat(gamePath);
      const toExclude = new Set(
        [...(manifestServers), ...(prevManifestServers || [])].map(s => normalizeIp(s.ip))
      );
      userServers = existing.filter(s => !toExclude.has(normalizeIp(s.ip)));
    } catch {}

    // manifest 서버 상단 고정 + 사용자 서버
    const merged = [...manifestServers, ...userServers];
    if (merged.length === 0) return;

    writeServersDatExact(gamePath, merged);
  } catch (e) {
    console.error('[servers.dat] write failed:', e.message);
  }
}

function sameServer(left, right) {
  return normalizeIp(left?.ip) === normalizeIp(right?.ip) && Number(left?.port || 25565) === Number(right?.port || 25565);
}

function ensureServerEntry(gamePath, server) {
  const dest = path.join(gamePath, 'servers.dat');
  if (!fs.existsSync(dest)) {
    writeServersDatExact(gamePath, [server]);
    return;
  }

  const existing = readServersDat(gamePath);
  if (existing.some(item => sameServer(item, server))) {
    if (isServersDatCompressed(gamePath)) writeServersDatExact(gamePath, existing);
    return;
  }

  // 기존 파일을 읽지 못하면 백업 후 기본 서버 목록을 다시 만든다.
  if (existing.length === 0) {
    backupUnreadableServersDat(dest);
    writeServersDatExact(gamePath, [server]);
    return;
  }

  writeServersDatExact(gamePath, [server, ...existing]);
}

module.exports = { writeServersDat, readServersDat, ensureServerEntry };
