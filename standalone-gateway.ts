#!/usr/bin/env node
/**
 * Standalone Ultra-Lightweight GPS Gateway for Linux / GCE e2-micro
 * Uses pure Node.js built-in modules (net, http, https) with ZERO external dependencies!
 * Total RAM usage: ~15-25 MB.
 *
 * Runs TCP listeners for:
 *   - SinoTrack ST-904L: Port 5013
 *   - ICAR IK122T:       Port 5023
 *   - Web Status UI:     Port 8080 (or PORT env)
 */

import net from 'net';
import http from 'http';
import https from 'https';
import { URL } from 'url';

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------
const CONFIG = {
  ERATUTKA_URL:
    process.env.ERATUTKA_FORWARD_URL ||
    'https://ais-pre-ih3r3aegkvykcunl6ox36r-471959473114.europe-west2.run.app/api/gps/update',
  SINOTRACK_PORT: parseInt(process.env.SINOTRACK_PORT || '5013', 10),
  ICAR_PORT: parseInt(process.env.ICAR_PORT || '5023', 10),
  WEB_PORT: parseInt(process.env.WEB_PORT || process.env.PORT || '8080', 10),
  FORWARDING_ENABLED: process.env.FORWARDING_ENABLED !== 'false'
};

// --------------------------------------------------------------------------
// In-Memory State & Metrics
// --------------------------------------------------------------------------
const state = {
  startTime: Date.now(),
  packetsReceived: 0,
  packetsForwarded: 0,
  forwardErrors: 0,
  activeSockets: 0,
  devices: new Map<string, any>(),
  recentLogs: [] as Array<{ time: string; msg: string; type: string }>
};

function log(msg: string, type: 'info' | 'pkt' | 'fwd' | 'err' = 'info') {
  const time = new Date().toISOString().substring(11, 19);
  const entry = { time, msg, type };
  state.recentLogs.push(entry);
  if (state.recentLogs.length > 100) state.recentLogs.shift();
  console.log(`[${time}] [${type.toUpperCase()}] ${msg}`);
}

// --------------------------------------------------------------------------
// CRC-16 for GT06 / ICAR
// --------------------------------------------------------------------------
const CRC_TABLE = [
  0x0000, 0x1189, 0x2312, 0x329b, 0x4624, 0x57ad, 0x6536, 0x74bf,
  0x8c48, 0x9dc1, 0xaf5a, 0xbed3, 0xca6c, 0xdbe5, 0xe97e, 0xf8f7,
  0x1081, 0x0108, 0x3393, 0x221a, 0x56a5, 0x472c, 0x75b7, 0x643e,
  0x9cc9, 0x8d40, 0xbfdb, 0xae52, 0xdaed, 0xcb64, 0xf9ff, 0xe876,
  0x2102, 0x308b, 0x0210, 0x1399, 0x6726, 0x76af, 0x4434, 0x55bd,
  0xad4a, 0xbcc3, 0x8e58, 0x9fd1, 0xeb6e, 0xfae7, 0xc87c, 0xd9f5,
  0x3183, 0x200a, 0x1291, 0x0318, 0x77a7, 0x662e, 0x54b5, 0x453c,
  0xbdcb, 0xac42, 0x9ed9, 0x8f50, 0xfbef, 0xea66, 0xd8fd, 0xc974,
  0x4204, 0x538d, 0x6116, 0x709f, 0x0420, 0x15a9, 0x2732, 0x36bb,
  0xce4c, 0xdfc5, 0xed5e, 0xfcd7, 0x8868, 0x99e1, 0xab7a, 0xbaf3,
  0x5285, 0x430c, 0x7197, 0x601e, 0x14a1, 0x0528, 0x37b3, 0x263a,
  0xdecd, 0xcf44, 0xfddf, 0xec56, 0x98e9, 0x8960, 0xbbfb, 0xaa72,
  0x6306, 0x728f, 0x4014, 0x519d, 0x2522, 0x34ab, 0x0630, 0x17b9,
  0xef4e, 0xfec7, 0xcc5c, 0xddd5, 0xa96a, 0xb8e3, 0x8a78, 0x9bf1,
  0x7387, 0x620e, 0x5095, 0x411c, 0x35a3, 0x242a, 0x16b1, 0x0738,
  0xffcf, 0xee46, 0xdcdd, 0xcd54, 0xb9eb, 0xa862, 0x9af9, 0x8b70
];

function getCrc16(buffer: Buffer, start = 0, len = buffer.length - start): number {
  let crc = 0xffff;
  for (let i = start; i < start + len; i++) {
    const byte = buffer[i];
    crc = (crc >> 8) ^ (CRC_TABLE[(crc ^ byte) & 0x0f] || 0);
  }
  return (~crc) & 0xffff;
}

function buildGt06Ack(protocol: number, serial: number): Buffer {
  const buf = Buffer.alloc(10);
  buf[0] = 0x78;
  buf[1] = 0x78;
  buf[2] = 0x05;
  buf[3] = protocol;
  buf.writeUInt16BE(serial, 4);
  const crc = getCrc16(buf, 2, 4);
  buf.writeUInt16BE(crc, 6);
  buf[8] = 0x0d;
  buf[9] = 0x0a;
  return buf;
}

// --------------------------------------------------------------------------
// Forwarder to Erätutka HTTPS API
// --------------------------------------------------------------------------
async function forwardGps(payload: {
  id: string;
  lat: number;
  lon: number;
  speed: number;
  battery: number;
  heading: number;
  timestamp: number;
}) {
  if (!CONFIG.FORWARDING_ENABLED) return;

  const jsonStr = JSON.stringify(payload);
  const parsed = new URL(CONFIG.ERATUTKA_URL);
  const client = parsed.protocol === 'https:' ? https : http;

  const req = client.request(
    {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonStr)
      },
      timeout: 8000
    },
    (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          state.packetsForwarded++;
          log(`Erätutka OK [${res.statusCode}] -> Laite ${payload.id}: lat=${payload.lat}, lon=${payload.lon}`, 'fwd');
        } else {
          state.forwardErrors++;
          log(`Erätutka VIRHE [${res.statusCode}] -> ${data.slice(0, 100)}`, 'err');
        }
      });
    }
  );

  req.on('error', (e) => {
    state.forwardErrors++;
    log(`Erätutka yhteysvirhe: ${e.message}`, 'err');
  });

  req.write(jsonStr);
  req.end();
}

// --------------------------------------------------------------------------
// Parsers
// --------------------------------------------------------------------------
function parseNmeaCoord(val: string, hem: string): number {
  if (!val) return 0;
  const dot = val.indexOf('.');
  if (dot === -1) return parseFloat(val) || 0;
  const deg = parseFloat(val.substring(0, dot - 2));
  const min = parseFloat(val.substring(dot - 2));
  let dec = deg + min / 60.0;
  if (hem === 'S' || hem === 'W') dec = -dec;
  return Number(dec.toFixed(6));
}

function handleSinoTrack(raw: string) {
  state.packetsReceived++;
  const clean = raw.trim().replace(/^[*]/, '').replace(/[#]$/, '');
  const parts = clean.split(',');
  if (parts.length < 9) return;

  const id = parts[1];
  const cmd = parts[2];
  if (cmd === 'V1' || cmd === 'V4' || cmd === 'NBR' || cmd === 'UD') {
    const lat = parseNmeaCoord(parts[5], parts[6]);
    const lon = parseNmeaCoord(parts[7], parts[8]);
    const speed = parseFloat(parts[9] || '0') || 0;
    const heading = parseInt(parts[10] || '0', 10) || 0;
    let battery = 90;
    if (parts.length > 13) {
      const b = parseInt(parts[13], 10);
      if (!isNaN(b)) battery = b;
    }

    if (lat !== 0 || lon !== 0) {
      const point = {
        id,
        lat,
        lon,
        speed: Number(speed.toFixed(1)),
        battery,
        heading,
        timestamp: Date.now()
      };
      state.devices.set(id, { ...point, lastSeen: Date.now(), protocol: 'SinoTrack' });
      log(`SinoTrack ID:${id} Lat:${lat} Lon:${lon} ${speed}km/h Akku:${battery}%`, 'pkt');
      forwardGps(point);
    }
  }
}

function handleIcar(buf: Buffer, socket: net.Socket, knownIdRef: { id?: string }) {
  state.packetsReceived++;
  if (buf.length >= 6 && buf[0] === 0x78 && buf[1] === 0x78) {
    const protocol = buf[3];

    // Login (0x01)
    if (protocol === 0x01 && buf.length >= 10) {
      let imei = '';
      for (let i = 4; i < 12; i++) {
        imei += ((buf[i] >> 4) & 0x0f).toString(16) + (buf[i] & 0x0f).toString(16);
      }
      imei = imei.replace(/^0+/, '');
      knownIdRef.id = imei;
      const serial = buf.readUInt16BE(12);
      const ack = buildGt06Ack(0x01, serial);
      socket.write(ack);
      log(`ICAR Login kuitattu ID: ${imei}`, 'pkt');
      return;
    }

    // Location (0x12 / 0x22)
    if ((protocol === 0x12 || protocol === 0x22) && buf.length >= 18) {
      const latRaw = buf.readUInt32BE(11);
      const lonRaw = buf.readUInt32BE(15);
      let lat = Number((latRaw / 1800000.0).toFixed(6));
      let lon = Number((lonRaw / 1800000.0).toFixed(6));
      const speed = buf.length > 19 ? buf[19] : 0;
      let heading = 0;
      if (buf.length > 21) {
        const cs = buf.readUInt16BE(20);
        heading = cs & 0x03ff;
      }
      const id = knownIdRef.id || 'ICAR_DOG';
      const point = {
        id,
        lat,
        lon,
        speed,
        battery: 88,
        heading,
        timestamp: Date.now()
      };
      state.devices.set(id, { ...point, lastSeen: Date.now(), protocol: 'ICAR' });
      log(`ICAR GT06 ID:${id} Lat:${lat} Lon:${lon} ${speed}km/h`, 'pkt');
      forwardGps(point);
    }
  }
}

// --------------------------------------------------------------------------
// Start TCP Servers
// --------------------------------------------------------------------------
const sinoServer = net.createServer((sock) => {
  state.activeSockets++;
  sock.on('data', (d) => handleSinoTrack(d.toString('utf8')));
  sock.on('close', () => state.activeSockets--);
  sock.on('error', () => {});
});
sinoServer.listen(CONFIG.SINOTRACK_PORT, '0.0.0.0', () => {
  log(`SinoTrack TCP kuuntelee portissa ${CONFIG.SINOTRACK_PORT}`);
});

const icarServer = net.createServer((sock) => {
  state.activeSockets++;
  const idRef = { id: undefined };
  sock.on('data', (d) => handleIcar(d, sock, idRef));
  sock.on('close', () => state.activeSockets--);
  sock.on('error', () => {});
});
icarServer.listen(CONFIG.ICAR_PORT, '0.0.0.0', () => {
  log(`ICAR GT06 TCP kuuntelee portissa ${CONFIG.ICAR_PORT}`);
});

// --------------------------------------------------------------------------
// Lightweight HTTP Status Server (Port 8080)
// --------------------------------------------------------------------------
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  }

  if (req.url === '/api/status') {
    const mem = process.memoryUsage();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        uptimeSeconds: Math.floor((Date.now() - state.startTime) / 1000),
        ramMb: Number((mem.rss / (1024 * 1024)).toFixed(1)),
        packetsReceived: state.packetsReceived,
        packetsForwarded: state.packetsForwarded,
        forwardErrors: state.forwardErrors,
        activeSockets: state.activeSockets,
        devices: Array.from(state.devices.values()),
        recentLogs: state.recentLogs
      })
    );
  }

  // Simple HTML Dashboard
  const mem = process.memoryUsage();
  const ramMb = (mem.rss / (1024 * 1024)).toFixed(1);
  const uptimeMin = Math.floor((Date.now() - state.startTime) / 60000);
  const devRows = Array.from(state.devices.values())
    .map(
      (d) =>
        `<tr><td><b>${d.id}</b></td><td>${d.protocol}</td><td>${d.lat}, ${d.lon}</td><td>${d.speed} km/h</td><td>${d.battery}%</td><td>${new Date(d.lastSeen).toLocaleTimeString()}</td></tr>`
    )
    .join('');

  const logRows = state.recentLogs
    .slice(-15)
    .reverse()
    .map((l) => `<div style="font-family:monospace;font-size:13px;padding:3px 0;">[${l.time}] ${l.msg}</div>`)
    .join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Micro GPS Gateway</title><style>
  body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;margin:0;padding:20px;background:#0d1117;color:#c9d1d9;}
  .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:16px;}
  table{width:100%;border-collapse:collapse;}th,td{text-align:left;padding:8px;border-bottom:1px solid #21262d;}
  .badge{background:#238636;color:#fff;padding:2px 8px;border-radius:12px;font-size:12px;}
  </style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:center;">
    <h2>🐕 Erätutka Micro GPS Gateway</h2>
    <span class="badge">Aktiivinen (GCE Linux)</span>
  </div>
  <div class="card" style="display:flex;gap:24px;">
    <div>RAM: <b>${ramMb} MB</b></div>
    <div>Uptime: <b>${uptimeMin} min</b></div>
    <div>Paketteja saapunut: <b>${state.packetsReceived}</b></div>
    <div>Välitetty Erätutkaan: <b style="color:#3fb950">${state.packetsForwarded}</b></div>
    <div>Virheet: <b style="color:#f85149">${state.forwardErrors}</b></div>
  </div>
  <div class="card">
    <h3>Yhteydessä olevat koirapannat</h3>
    <table><tr><th>ID</th><th>Protokolla</th><th>Koordinaatit</th><th>Nopeus</th><th>Akku</th><th>Viimeksi nähty</th></tr>${devRows || '<tr><td colspan="6" style="color:#8b949e">Ei pantoja vielä yhdistettynä.</td></tr>'}</table>
  </div>
  <div class="card">
    <h3>Reaaliaikainen loki</h3>
    ${logRows || '<div style="color:#8b949e">Odotetaan paketteja...</div>'}
  </div>
  <p style="font-size:12px;color:#8b949e">Kuuntelee: TCP 5013 (SinoTrack), TCP 5023 (ICAR), HTTP ${CONFIG.WEB_PORT} (Web)</p>
  </body></html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

httpServer.listen(CONFIG.WEB_PORT, '0.0.0.0', () => {
  log(`Hallintapaneeli kuuntelee HTTP-portissa ${CONFIG.WEB_PORT}`);
});
