#!/usr/bin/env node
/**
 * Standalone Ultra-Lightweight GPS Gateway for Linux / GCE e2-micro
 * Uses pure Node.js built-in modules (net, http, https, fs, url) with ZERO external dependencies!
 * Total RAM usage: ~15-25 MB.
 *
 * Runs TCP listeners for:
 *   - SinoTrack ST-904L: Port 5013 (ASCII *HQ,V1/V4/V8/NBR/UD...# + Binary fallback)
 *   - ICAR IK122T / Pro: Port 5023 (JT808 0x7E + GT06 0x78 0x78 + SinoTrack ASCII fallback)
 *   - Web Status & API:  Port 8080 (or PORT env)
 */

import net from 'net';
import http from 'http';
import https from 'https';
import fs from 'fs';
import { URL } from 'url';

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------
const CONFIG = {
  ERATUTKA_URL:
    process.env.ERATUTKA_FORWARD_URL ||
    'https://ais-pre-7fq53keha2opjy5hitirh4-471959473114.europe-west2.run.app/api/gps/update',
  SINOTRACK_PORT: parseInt(process.env.SINOTRACK_PORT || '5013', 10),
  ICAR_PORT: parseInt(process.env.ICAR_PORT || '5023', 10),
  WEB_PORT: parseInt(process.env.WEB_PORT || process.env.PORT || '8080', 10),
  FORWARDING_ENABLED: process.env.FORWARDING_ENABLED !== 'false',
  RAW_LOG_PATH: process.env.RAW_LOG_PATH || '/opt/eratutka-gateway/raw_packets.log'
};

interface RawPacketEntry {
  time: string;
  isoTime: string;
  timestamp: number;
  devId?: string;
  protocol: string;
  msgId?: string;
  serial?: number;
  alarmFlag?: string;
  statusFlag?: string;
  lat?: number;
  lon?: number;
  speed?: number;
  battery?: number;
  extraHex?: string;
  parsedExtras?: Array<{ id: string; len: number; hex: string }>;
  rawHex: string;
  text?: string;
  note?: string;
}

// --------------------------------------------------------------------------
// In-Memory State & Metrics
// --------------------------------------------------------------------------
const state = {
  startTime: Date.now(),
  packetsReceived: 0,
  packetsForwarded: 0,
  forwardErrors: 0,
  activeSockets: 0,
  socketMap: new Map<string, net.Socket>(),
  devices: new Map<string, any>(),
  history: new Map<string, any[]>(),
  barkTimestamps: new Map<string, number[]>(),
  rawPackets: [] as RawPacketEntry[],
  recentLogs: [] as Array<{ time: string; msg: string; type: string }>
};

function formatTimeFi(d = new Date()): string {
  return d.toISOString().substring(11, 19).replace(/:/g, '.');
}

function recordRawPacket(entry: Omit<RawPacketEntry, 'time' | 'isoTime' | 'timestamp'>) {
  const now = new Date();
  const fullEntry: RawPacketEntry = {
    time: formatTimeFi(now),
    isoTime: now.toISOString(),
    timestamp: now.getTime(),
    ...entry
  };
  state.rawPackets.unshift(fullEntry);
  if (state.rawPackets.length > 300) {
    state.rawPackets.pop();
  }
  try {
    fs.appendFileSync(CONFIG.RAW_LOG_PATH, JSON.stringify(fullEntry) + '\n');
  } catch {}
}

function log(msg: string, type: 'info' | 'pkt' | 'fwd' | 'err' = 'info') {
  const time = new Date().toISOString().substring(11, 19);
  const entry = { time, msg, type };
  state.recentLogs.push(entry);
  if (state.recentLogs.length > 200) state.recentLogs.shift();
  console.log(`[${time}] [${type.toUpperCase()}] ${msg}`);
}

function sendDownlinkCommand(deviceId: string, rawCommand: string): { success: boolean; error?: string; bytesSent?: number } {
  const id = String(deviceId);
  let sock = state.socketMap.get(id);

  // Fallback: if only 1 device connected or partial ID match
  if (!sock && state.socketMap.size === 1) {
    const [firstKey, firstSock] = Array.from(state.socketMap.entries())[0];
    if (firstKey.includes(id) || id.includes(firstKey)) {
      sock = firstSock;
    }
  }

  if (!sock || sock.destroyed || !sock.writable) {
    const activeList = Array.from(state.socketMap.keys());
    return {
      success: false,
      error: `Laite ${id} ei ole aktiivisessa TCP-yhteydessä (Kytketyt: ${activeList.join(', ') || 'Ei kytkettyjä laitteita'})`
    };
  }

  const formattedCmd = rawCommand.endsWith('\n') || rawCommand.endsWith('\r') ? rawCommand : `${rawCommand}\r\n`;
  const buf = Buffer.from(formattedCmd, 'ascii');

  try {
    sock.write(buf);
    log(`📤 [KOMENTO LÄHETETTY] Laite: ${id} -> "${formattedCmd.trim()}" (${buf.length} tavua)`, 'pkt');
    return {
      success: true,
      bytesSent: buf.length
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Komennon lähetysvirhe: ${err.message}`
    };
  }
}

function recordBark(deviceId: string, source = 'IK122T GT06 0x13') {
  const now = Date.now();
  const timestamps = state.barkTimestamps.get(deviceId) || [];
  timestamps.push(now);
  const cutoff = now - 60000;
  const recent = timestamps.filter((t) => t >= cutoff);
  state.barkTimestamps.set(deviceId, recent);

  let barkRate = recent.length;
  if (recent.length >= 2) {
    const windowSec = Math.max(2, (recent[recent.length - 1] - recent[0]) / 1000);
    if (windowSec < 60) barkRate = Math.round((recent.length / windowSec) * 60);
  }
  barkRate = Math.min(140, Math.max(1, barkRate));

  let dev = state.devices.get(deviceId);
  if (!dev) {
    // No known position yet: start at 0,0 rather than a fabricated one. A bark that arrives
    // before the collar's first fix must not place the dog at an invented coordinate - the
    // app keeps showing the last real position, and until there is one it shows no position.
    dev = {
      id: deviceId,
      name: `Koirapanta ${deviceId}`,
      lat: 0,
      lng: 0,
      lon: 0,
      speed: 0,
      battery: 90,
      heading: 0,
      satellites: 12,
      protocol: 'ICAR_JT808',
      timestamp: now,
      lastSeen: now
    };
  }

  dev.isBarking = true;
  dev.barking = true;
  dev.barkRate = barkRate;
  dev.bark = barkRate;
  dev.barks = barkRate;
  dev.alarm = 'bark';
  dev.lastBarkTime = now;
  dev.totalBarks = (dev.totalBarks || 0) + 1;
  dev.lastSeen = now;
  state.devices.set(deviceId, dev);

  log(`🔔 [HAUKKU] Koira haukkuu! (${deviceId}) -> ${barkRate} haukkua/min (${source})`, 'pkt');
  forwardGps({ ...dev, timestamp: now });
}

// Bark decay check (10s decay)
setInterval(() => {
  const now = Date.now();
  for (const [id, dev] of state.devices.entries()) {
    if (dev.isBarking && now - (dev.lastBarkTime || 0) > 10000) {
      dev.isBarking = false;
      dev.barking = false;
      dev.barkRate = 0;
      dev.bark = 0;
      dev.barks = 0;
      dev.alarm = 'none';
      state.barkTimestamps.set(id, []);
    }
  }
}, 2000);

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
  0xffcf, 0xee46, 0xdcdd, 0xcd54, 0xb9eb, 0xa862, 0x9af9, 0x8b70,
  0x8408, 0x9581, 0xa71a, 0xb693, 0xc22c, 0xd3a5, 0xe13e, 0xf0b7,
  0x0840, 0x19c9, 0x2b52, 0x3adb, 0x4e64, 0x5fed, 0x6d76, 0x7cf7,
  0x9489, 0x8500, 0xb79b, 0xa612, 0xd2ad, 0xc324, 0xf1bf, 0xe036,
  0x18c1, 0x0948, 0x3bd3, 0x2a5a, 0x5ee5, 0x4f6c, 0x7df7, 0x6c7e,
  0xa50a, 0xb483, 0x8618, 0x9791, 0xe32e, 0xf2a7, 0xc03c, 0xd1b5,
  0x2942, 0x38cb, 0x0a50, 0x1bd9, 0x6f66, 0x7eef, 0x4c74, 0x5dfd,
  0xb58b, 0xa402, 0x9699, 0x8710, 0xf3af, 0xe226, 0xd0bd, 0xc134,
  0x39c3, 0x284a, 0x1ad1, 0x0b58, 0x7fe7, 0x6e6e, 0x5cf5, 0x4d7c,
  0xc60c, 0xd785, 0xe51e, 0xf497, 0x8028, 0x91a1, 0xa33a, 0xb2b3,
  0x4a44, 0x5bcd, 0x6956, 0x78df, 0x0c60, 0x1de9, 0x2f72, 0x3efb,
  0xd68d, 0xc704, 0xf59f, 0xe416, 0x90a9, 0x8120, 0xb3bb, 0xa232,
  0x5ac5, 0x4b4c, 0x79d7, 0x685e, 0x1ce1, 0x0d68, 0x3ff3, 0x2e7a,
  0xe70e, 0xf687, 0xc41c, 0xd595, 0xa12a, 0xb0a3, 0x8238, 0x93b1,
  0x6b46, 0x7acf, 0x4854, 0x59dd, 0x2d62, 0x3ceb, 0x0e70, 0x1ff9,
  0xf78f, 0xe606, 0xd49d, 0xc514, 0xb1ab, 0xa022, 0x92b9, 0x8330,
  0x7bc7, 0x6a4e, 0x58d5, 0x495c, 0x3de3, 0x2c6a, 0x1ef1, 0x0f78
];

function getCrc16(buffer: Buffer, start = 0, len = buffer.length - start): number {
  let crc = 0xffff;
  for (let i = start; i < start + len; i++) {
    const byte = buffer[i];
    crc = (crc >> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
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
  isBarking?: boolean;
  barkRate?: number;
}) {
  if (!CONFIG.FORWARDING_ENABLED) return;

  const jsonStr = JSON.stringify({
    id: String(payload.id),
    lat: Number(payload.lat),
    lon: Number(payload.lon),
    speed: Number(payload.speed),
    battery: Number(payload.battery),
    heading: Number(payload.heading),
    timestamp: Number(payload.timestamp || Date.now()),
    isBarking: Boolean(payload.isBarking),
    barkRate: Number(payload.barkRate || 0)
  });
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
          const barkMsg = payload.isBarking ? ` [🔔 HAUKKUU ${payload.barkRate || 0}/min]` : '';
          log(`Erätutka OK [${res.statusCode}] -> Laite ${payload.id}: lat=${payload.lat}, lon=${payload.lon}${barkMsg}`, 'fwd');
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

function appendHistory(deviceId: string, point: any) {
  const list = state.history.get(deviceId) || [];
  list.push({
    lat: point.lat,
    lng: point.lon,
    speed: point.speed || 0,
    battery: point.battery || 100,
    heading: point.heading || 0,
    barkRate: point.barkRate || 0,
    bark: point.barkRate || 0,
    barks: point.barkRate || 0,
    isBarking: Boolean(point.isBarking),
    barking: Boolean(point.isBarking),
    alarm: point.isBarking ? 'bark' : 'none',
    satellites: point.satellites || 12,
    timestamp: point.timestamp || Date.now()
  });
  if (list.length > 3600) list.shift();
  state.history.set(deviceId, list);
}

function upsertDevice(point: {
  id: string;
  lat: number;
  lon: number;
  speed: number;
  battery: number;
  heading: number;
  satellites?: number;
  protocol: string;
  timestamp: number;
  isBarking: boolean;
  barkRate: number;
}) {
  const existing = state.devices.get(point.id);
  const now = Date.now();
  const devObj = {
    id: point.id,
    name: existing?.name || `Koirapanta ${point.id}`,
    lat: point.lat,
    lng: point.lon,
    lon: point.lon,
    speed: point.speed,
    battery: point.battery,
    heading: point.heading,
    barkRate: point.barkRate,
    bark: point.barkRate,
    barks: point.barkRate,
    isBarking: point.isBarking,
    barking: point.isBarking,
    alarm: point.isBarking ? 'bark' : 'none',
    satellites: point.satellites ?? existing?.satellites ?? 12,
    timestamp: point.timestamp || now,
    lastSeen: now,
    lastBarkTime: point.isBarking ? now : existing?.lastBarkTime || 0,
    protocol: point.protocol
  };
  state.devices.set(point.id, devObj);
  appendHistory(point.id, devObj);
}

function handleSinoTrack(raw: string, socket?: net.Socket, knownIdRef?: { id?: string }) {
  state.packetsReceived++;
  const rawPackets = raw.match(/(\*[^*#]+#|\[[^\]]+\]|\([^\)]+\))/g) || [raw];
  for (const singleRaw of rawPackets) {
    processSingleSinoTrackPacket(singleRaw, socket, knownIdRef);
  }
}

function processSingleSinoTrackPacket(raw: string, socket?: net.Socket, knownIdRef?: { id?: string }) {
  const trimmed = raw.trim();
  if (!trimmed) return;

  const rawHex = Buffer.from(trimmed, 'utf8').toString('hex').toUpperCase();
  const clean = trimmed.replace(/^[*]/, '').replace(/[#]$/, '');
  const parts = clean.split(',');

  if (parts.length < 3) {
    recordRawPacket({
      protocol: 'SINOTRACK_ASCII',
      rawHex,
      text: trimmed,
      note: 'Tuntematon ASCII-paketti'
    });
    return;
  }

  const id = parts[1] || knownIdRef?.id || 'SINOTRACK';
  if (knownIdRef && parts[1]) knownIdRef.id = parts[1];
  if (socket && id) state.socketMap.set(id, socket);

  const cmd = parts[2] || '';
  // Support V1, V4, V8, and all V* location reports as well as NBR / UD
  if ((cmd.startsWith('V') || cmd === 'NBR' || cmd === 'UD') && parts.length >= 9) {
    const validFlag = parts[4]; // 'A' = valid GPS fix, 'V' = last known / LBS
    const lat = parseNmeaCoord(parts[5], parts[6]);
    const lon = parseNmeaCoord(parts[7], parts[8]);
    const speed = parseFloat(parts[9] || '0') || 0;
    const heading = parseInt(parts[10] || '0', 10) || 0;

    // ST-904L puts battery % as the last parameter before # (e.g. ...,14,20,40,98#)
    let battery = 100;
    const lastPart = parts[parts.length - 1];
    if (lastPart) {
      const lastBat = parseInt(lastPart, 10);
      if (!isNaN(lastBat) && lastBat >= 0 && lastBat <= 100) {
        battery = lastBat;
      }
    }
    if (battery === 100 && parts.length > 13) {
      for (let i = parts.length - 1; i >= 12; i--) {
        const val = parseInt(parts[i], 10);
        // Avoid MCC e.g. 244
        if (!isNaN(val) && val >= 0 && val <= 100 && !parts[i].toUpperCase().startsWith('FF')) {
          battery = val;
          break;
        }
      }
    }

    let satellites = 12;
    if (parts.length >= 18) {
      const satVal = parseInt(parts[17], 10);
      if (!isNaN(satVal) && satVal >= 0 && satVal <= 32) {
        satellites = satVal;
      }
    }

    recordRawPacket({
      devId: id,
      protocol: 'SINOTRACK_ASCII',
      msgId: cmd,
      lat,
      lon,
      speed: Number(speed.toFixed(1)),
      battery,
      rawHex,
      text: trimmed,
      note: `Sijainti (${lat}, ${lon}) [${validFlag}] Akku: ${battery}%`
    });

    if (lat !== 0 || lon !== 0) {
      const existing = state.devices.get(id);
      const isBarking = Boolean(existing?.isBarking && Date.now() - (existing.lastBarkTime || 0) <= 10000);
      const barkRate = isBarking ? existing.barkRate || 0 : 0;
      const point = {
        id,
        lat,
        lon,
        speed: Number(speed.toFixed(1)),
        battery,
        heading,
        satellites,
        protocol: 'SinoTrack',
        timestamp: Date.now(),
        isBarking,
        barkRate
      };
      upsertDevice(point);
      log(`SinoTrack (${cmd}) ID:${id} Lat:${lat} Lon:${lon} ${speed}km/h Akku:${battery}%`, 'pkt');
      forwardGps(point);
    }
  } else {
    recordRawPacket({
      devId: id,
      protocol: 'SINOTRACK_ASCII',
      msgId: cmd || 'ASCII',
      rawHex,
      text: trimmed,
      note: `SinoTrack viesti (${cmd || 'Keep-Alive'})`
    });
  }
}

function unescapeJt808(buf: Buffer): Buffer {
  const result: number[] = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x7d && i + 1 < buf.length) {
      if (buf[i + 1] === 0x02) {
        result.push(0x7e);
        i++;
        continue;
      } else if (buf[i + 1] === 0x01) {
        result.push(0x7d);
        i++;
        continue;
      }
    }
    result.push(buf[i]);
  }
  return Buffer.from(result);
}

function escapeJt808(body: Buffer): Buffer {
  const result: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const b = body[i];
    if (b === 0x7e) {
      result.push(0x7d, 0x02);
    } else if (b === 0x7d) {
      result.push(0x7d, 0x01);
    } else {
      result.push(b);
    }
  }
  return Buffer.from(result);
}

function buildJt808Response(
  respMsgId: number,
  phoneBcd: Buffer,
  clientSerial: number,
  originalMsgId = 0,
  result = 0,
  authToken = 'AUTH_OK'
): Buffer {
  let body: Buffer;
  if (respMsgId === 0x8100) {
    const tokenBuf = Buffer.from(authToken, 'ascii');
    body = Buffer.alloc(3 + tokenBuf.length);
    body.writeUInt16BE(clientSerial, 0);
    body[2] = result; // 0 = Success
    tokenBuf.copy(body, 3);
  } else {
    // 0x8001 General Response
    body = Buffer.alloc(5);
    body.writeUInt16BE(clientSerial, 0);
    body.writeUInt16BE(originalMsgId, 2);
    body[4] = result;
  }

  const header = Buffer.alloc(12);
  header.writeUInt16BE(respMsgId, 0);
  header.writeUInt16BE(body.length, 2);
  phoneBcd.copy(header, 4, 0, Math.min(6, phoneBcd.length));
  header.writeUInt16BE(1, 10);

  const unescapedPayload = Buffer.concat([header, body]);
  let checksum = 0;
  for (let i = 0; i < unescapedPayload.length; i++) {
    checksum ^= unescapedPayload[i];
  }

  const fullPayload = Buffer.concat([unescapedPayload, Buffer.from([checksum])]);
  const escaped = escapeJt808(fullPayload);
  return Buffer.concat([Buffer.from([0x7e]), escaped, Buffer.from([0x7e])]);
}

function extractIcarFrames(streamBuffer: Buffer): { frames: Buffer[]; remainder: Buffer } {
  const frames: Buffer[] = [];
  let offset = 0;

  while (offset < streamBuffer.length) {
    const remaining = streamBuffer.length - offset;
    if (remaining < 2) break;

    const b0 = streamBuffer[offset];
    const b1 = streamBuffer[offset + 1];

    if (b0 === 0x7e) {
      const endIdx = streamBuffer.indexOf(0x7e, offset + 1);
      if (endIdx === -1) break;
      frames.push(streamBuffer.subarray(offset, endIdx + 1));
      offset = endIdx + 1;
      continue;
    }

    if (b0 === 0x78 && b1 === 0x78) {
      if (remaining < 5) break;
      const lengthByte = streamBuffer[offset + 2];
      const packetLength = lengthByte + 5;
      if (remaining < packetLength) break;
      frames.push(streamBuffer.subarray(offset, offset + packetLength));
      offset += packetLength;
      continue;
    }

    if (b0 === 0x79 && b1 === 0x79) {
      if (remaining < 6) break;
      const lengthWord = streamBuffer.readUInt16BE(offset + 2);
      const packetLength = lengthWord + 6;
      if (remaining < packetLength) break;
      frames.push(streamBuffer.subarray(offset, offset + packetLength));
      offset += packetLength;
      continue;
    }

    if (b0 === 0x2a || b0 === 0x5b || b0 === 0x28) {
      let endIdx = -1;
      for (let i = offset + 1; i < streamBuffer.length; i++) {
        const c = streamBuffer[i];
        if (c === 0x23 || c === 0x0a || c === 0x5d || c === 0x29) {
          endIdx = i;
          break;
        }
      }
      if (endIdx === -1) break;
      frames.push(streamBuffer.subarray(offset, endIdx + 1));
      offset = endIdx + 1;
      continue;
    }

    let foundNextStart = false;
    for (let i = offset + 1; i < streamBuffer.length; i++) {
      const b = streamBuffer[i];
      if (
        b === 0x7e ||
        b === 0x2a ||
        b === 0x5b ||
        b === 0x28 ||
        (b === 0x78 && streamBuffer[i + 1] === 0x78) ||
        (b === 0x79 && streamBuffer[i + 1] === 0x79)
      ) {
        offset = i;
        foundNextStart = true;
        break;
      }
    }
    if (!foundNextStart) {
      if (streamBuffer[streamBuffer.length - 1] === 0x78 || streamBuffer[streamBuffer.length - 1] === 0x79) {
        offset = streamBuffer.length - 1;
      } else {
        offset = streamBuffer.length;
      }
      break;
    }
  }

  return { frames, remainder: streamBuffer.subarray(offset) };
}

function handleIcar(buf: Buffer, socket: net.Socket, knownIdRef: { id?: string }) {
  state.packetsReceived++;
  const rawHex = buf.toString('hex').toUpperCase();

  // 0. SinoTrack ASCII Protocol fallback on port 5023
  if (buf[0] === 0x2a || buf[0] === 0x5b || buf[0] === 0x28) {
    const rawAscii = buf.toString('utf8');
    handleSinoTrack(rawAscii, socket, knownIdRef);
    return;
  }

  // 1. JT808 Protocol (Starts with 0x7E)
  if (buf[0] === 0x7e && buf.length >= 12) {
    try {
      const unescaped = unescapeJt808(buf);
      if (unescaped.length >= 12 && unescaped[0] === 0x7e) {
        const msgId = unescaped.readUInt16BE(1);
        const msgIdHex = '0x' + msgId.toString(16).toUpperCase().padStart(4, '0');
        const phoneBcd = unescaped.subarray(5, 11);
        let phoneStr = '';
        for (let i = 5; i < 11; i++) {
          phoneStr += ((unescaped[i] >> 4) & 0x0f).toString(16) + (unescaped[i] & 0x0f).toString(16);
        }
        phoneStr = phoneStr.replace(/^0+/, '');
        const serial = unescaped.readUInt16BE(11);
        const devId = phoneStr || knownIdRef.id || 'JT808_DOG';
        knownIdRef.id = devId;
        state.socketMap.set(devId, socket);

        // A. 0x0100 Register Request -> Respond with 0x8100
        if (msgId === 0x0100) {
          const resp = buildJt808Response(0x8100, phoneBcd, serial, 0x0100, 0, 'AUTH_OK');
          socket.write(resp);
          recordRawPacket({
            devId,
            protocol: 'JT808',
            msgId: msgIdHex,
            serial,
            rawHex,
            note: 'Rekisterointi OK'
          });
          log(`✅ [JT808 REGISTER OK] ID: ${devId}, Serial: ${serial}`, 'pkt');
          return;
        }

        // B. 0x0102 Auth Request -> Respond with 0x8001
        if (msgId === 0x0102) {
          const resp = buildJt808Response(0x8001, phoneBcd, serial, 0x0102, 0);
          socket.write(resp);
          recordRawPacket({
            devId,
            protocol: 'JT808',
            msgId: msgIdHex,
            serial,
            rawHex,
            note: 'Auth'
          });
          log(`✅ [JT808 AUTH OK] ID: ${devId}`, 'pkt');
          return;
        }

        // C. 0x0002 Heartbeat -> Respond with 0x8001
        if (msgId === 0x0002) {
          const resp = buildJt808Response(0x8001, phoneBcd, serial, 0x0002, 0);
          socket.write(resp);
          recordRawPacket({
            devId,
            protocol: 'JT808',
            msgId: msgIdHex,
            serial,
            rawHex,
            note: 'Heartbeat'
          });
          log(`JT808 Heartbeat ID: ${devId}`, 'pkt');
          return;
        }

        // D. 0x0200 Location Report
        if (msgId === 0x0200 && unescaped.length >= 41) {
          const resp = buildJt808Response(0x8001, phoneBcd, serial, 0x0200, 0);
          socket.write(resp);

          const alarmFlag = unescaped.readUInt32BE(13);
          const statusFlag = unescaped.readUInt32BE(17);
          const latRaw = unescaped.readUInt32BE(21);
          const lonRaw = unescaped.readUInt32BE(25);
          const speedRaw = unescaped.readUInt16BE(31);
          const heading = unescaped.readUInt16BE(33);

          let lat = Number((latRaw / 1000000.0).toFixed(6));
          let lon = Number((lonRaw / 1000000.0).toFixed(6));
          const speed = Number((speedRaw / 10.0).toFixed(1));

          if ((statusFlag & 0x04) !== 0 && lat > 0) lat = -lat;
          if ((statusFlag & 0x08) !== 0 && lon > 0) lon = -lon;

          // Parse JT808 Extra TLV fields (starts at byte 41 up to unescaped.length - 2)
          const extraSlice = unescaped.subarray(41, unescaped.length - 2);
          const extraHex = extraSlice.toString('hex').toUpperCase();
          const parsedExtras: Array<{ id: string; len: number; hex: string }> = [];
          let battery = state.devices.get(devId)?.battery ?? 90;
          let satellites = 12;

          let posIdx = 0;
          while (posIdx + 2 <= extraSlice.length) {
            const eId = extraSlice[posIdx];
            const eLen = extraSlice[posIdx + 1];
            if (posIdx + 2 + eLen > extraSlice.length) break;
            const eVal = extraSlice.subarray(posIdx + 2, posIdx + 2 + eLen);
            parsedExtras.push({
              id: '0x' + eId.toString(16).toUpperCase().padStart(2, '0'),
              len: eLen,
              hex: eVal.toString('hex').toUpperCase()
            });

            // 0xE4: Battery percentage (2 bytes UInt16BE, e.g. 0x0060 = 96%)
            if (eId === 0xe4 && eLen >= 2) {
              const batVal = eVal.readUInt16BE(0);
              if (batVal >= 0 && batVal <= 100) battery = batVal;
            }
            // 0x31: GNSS satellite count (1 byte)
            if (eId === 0x31 && eLen >= 1) {
              satellites = eVal[0];
            }
            posIdx += 2 + eLen;
          }

          // IK122T Pro does not raise any alarmFlag bit for a bark: it sends a position-less
          // 0x0200 report carrying a vendor TLV item 0xE1 (28 bytes). Over this collar's whole
          // packet log 0xE1 was present in every bark and absent from every normal report, so it
          // is the reliable signal - the alarm-bit test alone never fires for it. The alarm bits
          // are kept for other collar models that do use them.
          const hasBarkTlv = parsedExtras.some((x) => x.id === '0xE1');
          const isBark =
            hasBarkTlv ||
            (alarmFlag & 0x01) !== 0 ||
            (alarmFlag & 0x08) !== 0 ||
            (alarmFlag & 0x10) !== 0;

          if (isBark) {
            recordBark(devId, 'JT808 Hälytys');
          }

          const existing = state.devices.get(devId);
          const barkingState = Boolean(existing?.isBarking && Date.now() - (existing.lastBarkTime || 0) <= 10000);
          const barkRate = barkingState ? existing.barkRate || 0 : 0;

          const alarmFlagHex = '0x' + alarmFlag.toString(16).toUpperCase().padStart(8, '0');
          const statusFlagHex = '0x' + statusFlag.toString(16).toUpperCase().padStart(8, '0');

          recordRawPacket({
            devId,
            protocol: 'JT808',
            msgId: msgIdHex,
            serial,
            alarmFlag: alarmFlagHex,
            statusFlag: statusFlagHex,
            lat,
            lon,
            speed,
            battery,
            extraHex,
            parsedExtras,
            rawHex,
            note: `Sijainti (${lat}, ${lon})${isBark ? ' [HALYTYS/HAUKKU!]' : ''}`
          });

          // If valid coordinates (or retain last known coords if 0,0)
          const finalLat = lat !== 0 ? lat : existing?.lat || 0;
          const finalLon = lon !== 0 ? lon : existing?.lon || 0;

          if (finalLat !== 0 || finalLon !== 0) {
            const point = {
              id: devId,
              lat: finalLat,
              lon: finalLon,
              speed,
              battery,
              heading,
              satellites,
              protocol: 'ICAR_JT808',
              timestamp: Date.now(),
              isBarking: barkingState,
              barkRate
            };
            upsertDevice(point);
            log(`📍 [JT808 GPS] ID:${devId} Lat:${finalLat} Lon:${finalLon} ${speed}km/h Akku:${battery}%`, 'pkt');
            if (lat !== 0 || lon !== 0) {
              forwardGps(point);
            }
          }
          return;
        }

        // Generic fallback ACK
        const genResp = buildJt808Response(0x8001, phoneBcd, serial, msgId, 0);
        socket.write(genResp);
        recordRawPacket({
          devId,
          protocol: 'JT808',
          msgId: msgIdHex,
          serial,
          rawHex,
          note: `Muu / Uusi viestityyppi (${msgIdHex})`
        });
        return;
      }
    } catch {
      // Fall through to GT06
    }
  }

  // 2. GT06 Protocol (0x78 0x78)
  if (buf.length >= 6 && buf[0] === 0x78 && buf[1] === 0x78) {
    const length = buf[2];
    const protocol = buf[3];
    const protoHex = '0x' + protocol.toString(16).toUpperCase().padStart(2, '0');

    // Login (0x01)
    if (protocol === 0x01 && buf.length >= 10) {
      let imei = '';
      for (let i = 4; i < 12; i++) {
        imei += ((buf[i] >> 4) & 0x0f).toString(16) + (buf[i] & 0x0f).toString(16);
      }
      imei = imei.replace(/^0+/, '');
      knownIdRef.id = imei;
      state.socketMap.set(imei, socket);
      const serial = buf.readUInt16BE(12);
      const ack = buildGt06Ack(0x01, serial);
      socket.write(ack);
      recordRawPacket({
        devId: imei,
        protocol: 'GT06',
        msgId: protoHex,
        serial,
        rawHex,
        note: 'GT06 Login OK'
      });
      log(`ICAR Login kuitattu ID: ${imei}`, 'pkt');
      return;
    }

    // Status packet (0x13) - Heartbeat & Vibration/Bark Alarm
    if (protocol === 0x13) {
      const serialOffset = Math.max(4, length + 2 - 4);
      let serial = 1;
      if (buf.length >= serialOffset + 2) {
        serial = buf.readUInt16BE(serialOffset);
      }
      const ack = buildGt06Ack(0x13, serial);
      socket.write(ack);

      const id = knownIdRef.id || 'IK122T_DOG';
      state.socketMap.set(id, socket);

      const termInfo = buf[4];
      const alarmCode = buf.length > 7 ? buf[7] : 0;
      const isVibrationOrBark = ((termInfo & 0x38) === 0x08) || [0x01, 0x03, 0x09, 0x0a, 0x11].includes(alarmCode);

      recordRawPacket({
        devId: id,
        protocol: 'GT06',
        msgId: protoHex,
        serial,
        rawHex,
        note: isVibrationOrBark ? 'GT06 Heartbeat [HALYTYS/HAUKKU!]' : 'GT06 Heartbeat'
      });

      if (isVibrationOrBark) {
        recordBark(id, 'GT06 0x13 Status/Vibration Alarm');
      } else {
        log(`ICAR 0x13 Heartbeat kuitattu ID: ${id}`, 'pkt');
      }
      return;
    }

    // Alarm packet (0x16 / 0x26)
    if (protocol === 0x16 || protocol === 0x26) {
      const serialOffset = Math.max(4, length + 2 - 4);
      let serial = 1;
      if (buf.length >= serialOffset + 2) {
        serial = buf.readUInt16BE(serialOffset);
      }
      const ack = buildGt06Ack(protocol, serial);
      socket.write(ack);

      const id = knownIdRef.id || 'IK122T_DOG';
      state.socketMap.set(id, socket);
      recordBark(id, `GT06 0x${protocol.toString(16)} Alarm`);
    }

    // Location (0x12 / 0x22 / 0x16 / 0x26)
    if ((protocol === 0x12 || protocol === 0x22 || protocol === 0x16 || protocol === 0x26) && buf.length >= 18) {
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
      state.socketMap.set(id, socket);
      const existing = state.devices.get(id);
      const isBarking = Boolean(existing?.isBarking && Date.now() - (existing.lastBarkTime || 0) <= 10000);
      const barkRate = isBarking ? existing.barkRate || 0 : 0;

      recordRawPacket({
        devId: id,
        protocol: 'GT06',
        msgId: protoHex,
        lat,
        lon,
        speed,
        rawHex,
        note: `GT06 Sijainti (${lat}, ${lon})`
      });

      const point = {
        id,
        lat,
        lon,
        speed,
        battery: 88,
        heading,
        satellites: 10,
        protocol: 'ICAR_GT06',
        timestamp: Date.now(),
        isBarking,
        barkRate
      };
      upsertDevice(point);
      log(`ICAR GT06 ID:${id} Lat:${lat} Lon:${lon} ${speed}km/h`, 'pkt');
      forwardGps(point);
    }
  }
}

// --------------------------------------------------------------------------
// Startup Hydration from raw_packets.log (Preserves state across restarts)
// --------------------------------------------------------------------------
function hydrateFromLogFile() {
  try {
    if (!fs.existsSync(CONFIG.RAW_LOG_PATH)) return;
    const stat = fs.statSync(CONFIG.RAW_LOG_PATH);
    const readSize = Math.min(stat.size, 256 * 1024); // Read last 256 KB
    const fd = fs.openSync(CONFIG.RAW_LOG_PATH, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);

    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    // Skip first potentially partial line if we seeked into the file
    const validLines = stat.size > readSize ? lines.slice(1) : lines;
    const recentSlice = validLines.slice(-300);

    for (const line of recentSlice) {
      try {
        const entry = JSON.parse(line) as RawPacketEntry;
        if (entry.protocol === 'SINOTRACK_ASCII' && entry.text) {
          const clean = entry.text.trim().replace(/^[*]/, '').replace(/[#]$/, '');
          const parts = clean.split(',');
          const cmd = parts[2] || '';
          if (parts.length >= 9 && (cmd.startsWith('V') || cmd === 'NBR' || cmd === 'UD')) {
            const id = parts[1];
            const validFlag = parts[4];
            const lat = parseNmeaCoord(parts[5], parts[6]);
            const lon = parseNmeaCoord(parts[7], parts[8]);
            const speed = parseFloat(parts[9] || '0') || 0;
            const heading = parseInt(parts[10] || '0', 10) || 0;
            let battery = 100;
            const lastBat = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(lastBat) && lastBat >= 0 && lastBat <= 100) battery = lastBat;
            let satellites = 12;
            if (parts.length >= 18) {
              const satVal = parseInt(parts[17], 10);
              if (!isNaN(satVal) && satVal >= 0 && satVal <= 32) satellites = satVal;
            }
            entry.devId = id;
            entry.msgId = cmd;
            entry.lat = lat;
            entry.lon = lon;
            entry.speed = Number(speed.toFixed(1));
            entry.battery = battery;
            entry.note = `Sijainti (${lat}, ${lon}) [${validFlag}] Akku: ${battery}%`;
            if (id && (lat !== 0 || lon !== 0)) {
              upsertDevice({
                id,
                lat,
                lon,
                speed: Number(speed.toFixed(1)),
                battery,
                heading,
                satellites,
                protocol: 'SinoTrack',
                timestamp: entry.timestamp || Date.now(),
                isBarking: false,
                barkRate: 0
              });
            }
          }
        } else if (entry.devId && entry.lat && entry.lon && (entry.lat !== 0 || entry.lon !== 0)) {
          let battery = entry.battery ?? 90;
          let satellites = 12;
          if (entry.parsedExtras) {
            for (const ex of entry.parsedExtras) {
              if (ex.id === '0xE4' && ex.hex.length >= 4) {
                const bVal = parseInt(ex.hex, 16);
                if (!isNaN(bVal) && bVal >= 0 && bVal <= 100) battery = bVal;
              }
              if (ex.id === '0x31' && ex.hex.length >= 2) {
                const sVal = parseInt(ex.hex, 16);
                if (!isNaN(sVal)) satellites = sVal;
              }
            }
          }
          upsertDevice({
            id: entry.devId,
            lat: entry.lat,
            lon: entry.lon,
            speed: entry.speed || 0,
            battery,
            heading: 0,
            satellites,
            protocol: entry.protocol === 'JT808' ? 'ICAR_JT808' : entry.protocol,
            timestamp: entry.timestamp || Date.now(),
            isBarking: false,
            barkRate: 0
          });
        }
        state.rawPackets.unshift(entry);
      } catch {}
    }
    if (state.rawPackets.length > 300) {
      state.rawPackets.length = 300;
    }
    log(`Ladattu ${state.rawPackets.length} aiempaa pakettia ja ${state.devices.size} laitetta lokitiedostosta.`);
  } catch {}
}

hydrateFromLogFile();

// --------------------------------------------------------------------------
// Start TCP Servers
// --------------------------------------------------------------------------
const sinoServer = net.createServer((sock) => {
  state.activeSockets++;
  const idRef = { id: undefined as string | undefined };
  let bufferAcc = Buffer.alloc(0);

  sock.on('data', (d) => {
    if (d[0] === 0x7e || (d[0] === 0x78 && d[1] === 0x78) || (d[0] === 0x79 && d[1] === 0x79)) {
      bufferAcc = Buffer.concat([bufferAcc, d]);
      const { frames, remainder } = extractIcarFrames(bufferAcc);
      bufferAcc = remainder;
      for (const frame of frames) {
        handleIcar(frame, sock, idRef);
      }
    } else {
      handleSinoTrack(d.toString('utf8'), sock, idRef);
    }
  });
  sock.on('close', () => {
    bufferAcc = Buffer.alloc(0);
    state.activeSockets = Math.max(0, state.activeSockets - 1);
    if (idRef.id) state.socketMap.delete(idRef.id);
  });
  sock.on('error', () => {
    bufferAcc = Buffer.alloc(0);
    if (idRef.id) state.socketMap.delete(idRef.id);
  });
});
sinoServer.listen(CONFIG.SINOTRACK_PORT, '0.0.0.0', () => {
  log(`SinoTrack TCP kuuntelee portissa ${CONFIG.SINOTRACK_PORT}`);
});

const icarServer = net.createServer((sock) => {
  state.activeSockets++;
  const idRef = { id: undefined as string | undefined };
  let bufferAcc = Buffer.alloc(0);

  sock.on('data', (d) => {
    bufferAcc = Buffer.concat([bufferAcc, d]);
    const { frames, remainder } = extractIcarFrames(bufferAcc);
    bufferAcc = remainder;
    for (const frame of frames) {
      handleIcar(frame, sock, idRef);
    }
  });

  sock.on('close', () => {
    bufferAcc = Buffer.alloc(0);
    state.activeSockets = Math.max(0, state.activeSockets - 1);
    if (idRef.id) state.socketMap.delete(idRef.id);
  });
  sock.on('error', () => {
    bufferAcc = Buffer.alloc(0);
    if (idRef.id) state.socketMap.delete(idRef.id);
  });
});
icarServer.listen(CONFIG.ICAR_PORT, '0.0.0.0', () => {
  log(`ICAR JT808/GT06 TCP kuuntelee portissa ${CONFIG.ICAR_PORT}`);
});

// --------------------------------------------------------------------------
// Lightweight HTTP Status, RawLog & Command Server (Port 8080)
// --------------------------------------------------------------------------
const httpServer = http.createServer((req, res) => {
  // Mandatory CORS Headers for all responses (Rule 4)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. Health
  if (pathname === '/health' || pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  }

  // 2. Real-time Devices & Positions (PULL API - returns direct array like live GCE server)
  if (pathname === '/api/positions' || pathname === '/api/devices') {
    const devList = Array.from(state.devices.values()).map((d) => ({
      ...d,
      lng: d.lon
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(devList));
  }

  // 3. Raw Packets JSON API (/api/rawlogs)
  if (pathname === '/api/rawlogs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify(
        {
          success: true,
          count: state.rawPackets.length,
          packets: state.rawPackets
        },
        null,
        2
      )
    );
  }

  // 3.1 Raw Packets Log Download (/api/rawlogs/download or /raw_packets.log)
  if (pathname === '/api/rawlogs/download' || pathname === '/raw_packets.log' || pathname === '/api/raw_packets.log') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="raw_packets.log"');
    if (fs.existsSync(CONFIG.RAW_LOG_PATH)) {
      return fs.createReadStream(CONFIG.RAW_LOG_PATH).pipe(res);
    } else {
      const fallback = state.rawPackets.map((p) => JSON.stringify(p)).join('\n');
      return res.end(fallback || 'Ei tallennettuja lokitietoja.');
    }
  }

  // 4. GPS History & Tracks (/api/history, /api/history/:id, /api/tracks)
  if (
    pathname.startsWith('/api/history') ||
    pathname.startsWith('/api/tracks') ||
    (pathname.startsWith('/api/positions/') && pathname.length > 15)
  ) {
    let deviceId = parsedUrl.searchParams.get('id') || '';
    if (!deviceId) {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length >= 3) deviceId = parts[2];
    }

    if (!deviceId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Device ID required (e.g. /api/history?id=89067647125)' }));
    }

    const list = state.history.get(deviceId) || [];
    const since = parsedUrl.searchParams.get('since') ? Number(parsedUrl.searchParams.get('since')) : undefined;
    const hours = parsedUrl.searchParams.get('hours') ? Number(parsedUrl.searchParams.get('hours')) : 6;
    const limit = parsedUrl.searchParams.get('limit') ? Number(parsedUrl.searchParams.get('limit')) : 2000;

    let cutoff = since;
    if (!cutoff && hours) {
      cutoff = Date.now() - hours * 3600 * 1000;
    }

    let filtered = list;
    if (cutoff) {
      filtered = list.filter((p) => p.timestamp >= cutoff!);
    }
    const points = filtered.slice(-limit);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        success: true,
        deviceId,
        count: points.length,
        points
      })
    );
  }

  // 5. Downlink Two-Way Commands (POST /api/devices/:id/command or POST /api/command)
  if (req.method === 'POST' && (pathname === '/api/command' || pathname.includes('/command'))) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let json: any = {};
      try {
        if (body.trim()) json = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Virheellinen JSON-pyyntö' }));
      }

      let deviceId = json.deviceId || json.id || parsedUrl.searchParams.get('id') || '';
      if (!deviceId && pathname.includes('/devices/')) {
        const parts = pathname.split('/').filter(Boolean);
        if (parts.length >= 3) deviceId = parts[2];
      }

      if (!deviceId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            success: false,
            error: 'Laitteen ID puuttuu (määritä deviceId parametrina tai JSON-rungossa)'
          })
        );
      }

      let command = json.command;
      const interval = json.interval;

      if (interval !== undefined && interval !== null && !command) {
        const sec = Math.max(1, parseInt(String(interval), 10) || 10);
        command = `UPLOAD,${sec}#`;
      }

      if (!command || typeof command !== 'string' || !command.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            success: false,
            error: 'Komento tai päivitysväli puuttuu (anna "command": "UPLOAD,10#" tai "interval": 10)'
          })
        );
      }

      const cleanCmd = command.trim();
      const sendResult = sendDownlinkCommand(deviceId, cleanCmd);

      if (sendResult.success) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            success: true,
            message: 'Komento lähetetty laitteelle',
            deviceId,
            command: cleanCmd,
            bytesSent: sendResult.bytesSent,
            timestamp: Date.now()
          })
        );
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            success: false,
            error: sendResult.error || 'Laite ei ole aktiivisessa TCP-yhteydessä',
            deviceId,
            activeDevices: Array.from(state.socketMap.keys())
          })
        );
      }
    });
    return;
  }

  // 6. Device Connection Check (GET /api/devices/:id/connected)
  if (req.method === 'GET' && pathname.includes('/devices/') && pathname.endsWith('/connected')) {
    const parts = pathname.split('/').filter(Boolean);
    const deviceId = parts.length >= 3 ? parts[2] : '';
    const sock = state.socketMap.get(deviceId);
    const connected = Boolean(sock && !sock.destroyed && sock.writable);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        deviceId,
        connected,
        activeDevices: Array.from(state.socketMap.keys())
      })
    );
  }

  // 7. Interactive HTML Dashboard (GET / or GET /api/status)
  const devRows = Array.from(state.devices.values())
    .map((d) => {
      const sock = state.socketMap.get(d.id);
      const isOnline = Boolean(sock && !sock.destroyed && sock.writable);
      const updatedStr = formatTimeFi(new Date(d.lastSeen || Date.now()));
      return `<tr>
        <td><b style="color:#79c0ff;">${d.id}</b> <span style="font-size:11px;color:#8b949e;">(${d.protocol})</span></td>
        <td>${d.lat}, ${d.lon}</td>
        <td>${d.speed} km/h</td>
        <td>${d.battery}%</td>
        <td>${
          d.isBarking
            ? `<span style="background:#f0883e;color:#000;font-weight:bold;padding:2px 8px;border-radius:10px;">🔔 HAUKKUU (${d.barkRate || 0}/min)</span>`
            : '<span style="color:#7ee787;">Hiljaa</span>'
        }</td>
        <td>${isOnline ? '<span style="color:#3fb950">● Yhdistetty</span>' : '<span style="color:#8b949e">○ Ei yhteytta</span>'}</td>
        <td>${updatedStr}</td>
      </tr>`;
    })
    .join('');

  const packetCards = state.rawPackets
    .slice(0, 40)
    .map((p) => {
      const isLocOrAlarm = p.msgId === '0x0200' || p.protocol === 'SINOTRACK_ASCII' || (p.note && p.note.includes('HAUKKU'));
      const bgStyle = isLocOrAlarm
        ? 'background:#2e1a1a;border-left:3px solid #ff7b72;'
        : 'border-left:3px solid #30363d;';
      const extrasRow =
        p.parsedExtras && p.parsedExtras.length > 0
          ? `<div style="color:#d2a8ff;margin-bottom:4px;">Lisakentat (Extras): ${JSON.stringify(p.parsedExtras)}</div>`
          : p.text
          ? `<div style="color:#d2a8ff;margin-bottom:4px;">ASCII: ${p.text}</div>`
          : '';
      return `<div style="margin-bottom:8px;padding:8px 12px;border-radius:4px;font-family:monospace;font-size:12px;${bgStyle}">
        <div style="display:flex;justify-content:space-between;color:#8b949e;margin-bottom:4px;">
          <span><b>[${p.time}]</b> ${p.devId || ''} | Msg: <b style="color:#58a6ff;">${p.msgId || p.protocol}</b> | Alarm: <b style="color:#ff7b72;">${p.alarmFlag || '-'}</b> | Status: ${p.statusFlag || '-'}</span>
          <span style="color:#7ee787;">${p.note || ''}</span>
        </div>
        ${extrasRow}
        <div style="word-break:break-all;color:#c9d1d9;font-size:11px;opacity:0.85;">HEX: ${p.rawHex}</div>
      </div>`;
    })
    .join('');

  const defaultDevId =
    Array.from(state.socketMap.keys())[0] || Array.from(state.devices.keys())[0] || '89067647125';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Micro GPS Gateway & Downlink</title><meta http-equiv="refresh" content="3"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; margin: 0; }
  h1 { color: #58a6ff; font-size: 22px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { padding: 10px 12px; border-bottom: 1px solid #21262d; text-align: left; }
  th { color: #8b949e; font-size: 13px; text-transform: uppercase; }
  .btn { background: #238636; color: #fff; text-decoration: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; display: inline-block; }
  .btn-secondary { background: #21262d; color: #58a6ff; border: 1px solid #30363d; }
  .live { display: inline-block; width: 10px; height: 10px; background: #3fb950; border-radius: 50%; margin-right: 8px; box-shadow: 0 0 8px #3fb950; }
  code { background: #21262d; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 13px; }
  input, select, button { background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 8px 12px; border-radius: 6px; font-size: 13px; }
  button { background: #238636; color: #fff; cursor: pointer; border: none; font-weight: 600; }
  </style></head><body>
  <h1>
    <span><span class="live"></span> Micro GPS Gateway - Koirapannat & Downlink</span>
    <div>
      <a href="/api/rawlogs/download" class="btn">Lataa raakapakettiloki (.log)</a>
      <a href="/api/rawlogs" target="_blank" class="btn btn-secondary" style="margin-left:8px;">JSON API</a>
    </div>
  </h1>
  <div class="card">
    <h3 style="margin:0 0 8px 0;font-size:15px;color:#58a6ff;">📤 Kaksisuuntainen Komentotuki (Downlink)</h3>
    <p style="font-size:12px;color:#8b949e;margin:0 0 10px 0;">Laheta paivitysvali- tai asetuskomennot suoraan pannan TCP-yhteyteen:</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <input type="text" id="cmdDevId" placeholder="Pannan ID" value="${defaultDevId}" style="width:160px;" />
      <select id="quickInterval" onchange="if(this.value) document.getElementById('cmdText').value='UPLOAD,'+this.value+'#'">
        <option value="">-- Valitse vali --</option>
        <option value="5">5s (UPLOAD,5#)</option>
        <option value="10">10s (UPLOAD,10#)</option>
        <option value="30">30s (UPLOAD,30#)</option>
        <option value="60">60s (UPLOAD,60#)</option>
      </select>
      <input type="text" id="cmdText" value="UPLOAD,10#" style="width:140px;" />
      <button onclick="sendCommand()">Laheta Pantaan</button>
      <span id="cmdStatus" style="font-size:12px;margin-left:8px;"></span>
    </div>
    <script>
      async function sendCommand(){
        const id=document.getElementById("cmdDevId").value.trim();
        const cmd=document.getElementById("cmdText").value.trim();
        const s=document.getElementById("cmdStatus");
        if(!id||!cmd){alert("Tayta ID ja komento!");return;}
        s.innerText="Lahetetaan...";s.style.color="#e3b341";
        try{
          const r=await fetch("/api/devices/"+encodeURIComponent(id)+"/command",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({command:cmd})
          });
          const d=await r.json();
          if(d.success){s.innerText="OK! ("+d.command+")";s.style.color="#3fb950";}
          else{s.innerText="Virhe: "+(d.error||"Epäonnistui");s.style.color="#f85149";}
        }catch(e){
          s.innerText="Verkkovirhe: "+e.message;s.style.color="#f85149";
        }
      }
    </script>
  </div>
  <div class="card">
    <table style="margin-top:0;">
      <thead>
        <tr><th>Pannan ID</th><th>Sijainti (Lat, Lng)</th><th>Nopeus</th><th>Akku</th><th>Haukku</th><th>Socket</th><th>Paivitetty</th></tr>
      </thead>
      <tbody>
        ${devRows || '<tr><td colspan="7" style="color:#8b949e">Ei pantoja viela yhdistettyna.</td></tr>'}
      </tbody>
    </table>
  </div>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;font-size:16px;color:#58a6ff;">Viimeisimmat raakapaketit & Halytysanalyysi</h3>
      <span style="font-size:12px;color:#8b949e;">Automaattipaivitys 3s valein | Tallennus: <code>${CONFIG.RAW_LOG_PATH}</code></span>
    </div>
    <div style="max-height:480px;overflow-y:auto;background:#010409;padding:12px;border-radius:6px;border:1px solid #21262d;">
      ${packetCards || '<div style="color:#8b949e;font-family:monospace;font-size:12px;">Odotetaan paketteja...</div>'}
    </div>
  </div>
  </body></html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

httpServer.listen(CONFIG.WEB_PORT, '0.0.0.0', () => {
  log(`Web-hallinta & REST API kuuntelee portissa ${CONFIG.WEB_PORT}`);
});
