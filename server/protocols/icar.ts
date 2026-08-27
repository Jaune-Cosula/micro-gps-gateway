/**
 * ICAR IK122T Protocol Parser (Port 5023)
 * Implements GT06 Binary Protocol (0x01 login, 0x12/0x22 location, 0x13 status/heartbeat, 0x16/0x26 alarm),
 * JT808 Binary Protocol (0x0100 register, 0x0102 auth, 0x0002 heartbeat, 0x0200 location),
 * and H02 ASCII protocol fallback with IK122T Pro barking detection.
 */
import { GpsPosition } from '../../src/types';
import { getCrc16 } from './crc';
import { parseSinoTrackPacket } from './sinotrack';

export interface IcarParseResult {
  position: GpsPosition | null;
  responseBuffer: Buffer | null;
  deviceId?: string;
  packetType: 'login' | 'location' | 'heartbeat' | 'alarm' | 'bark' | 'ascii' | 'unknown';
  isBarking?: boolean;
  alarmType?: string;
  alarmCode?: number;
  battery?: number;
}

/**
 * Converts BCD buffer to string
 */
export function bcdToString(buffer: Buffer, start: number, length: number): string {
  let result = '';
  for (let i = start; i < start + length; i++) {
    const byte = buffer[i];
    const high = (byte >> 4) & 0x0f;
    const low = byte & 0x0f;
    result += high.toString(16) + low.toString(16);
  }
  const trimmed = result.replace(/^0+/, '');
  return trimmed.length >= 6 ? trimmed : result;
}

/**
 * JT808 Unescape: 0x7d 0x02 -> 0x7e, 0x7d 0x01 -> 0x7d
 */
export function unescapeJt808(buf: Buffer): Buffer {
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

/**
 * JT808 Escape: 0x7e -> 0x7d 0x02, 0x7d -> 0x7d 0x01
 */
export function escapeJt808(body: Buffer): Buffer {
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

/**
 * Builds JT808 Response Message (0x8100 Register Response or 0x8001 General Response)
 */
export function buildJt808Response(
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
    body[4] = result; // 0 = Success
  }

  // Header: MsgId (2) + BodyProps (2) + Phone (6) + ServerSerial (2)
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

/**
 * Builds standard GT06 ACK Response Frame
 * Format: 0x78 0x78 0x05 <protocol> <serial_hi> <serial_lo> <crc_hi> <crc_lo> 0x0D 0x0A
 */
export function buildGt06Ack(protocolByte: number, serialNumber: number): Buffer {
  const buf = Buffer.alloc(10);
  buf[0] = 0x78;
  buf[1] = 0x78;
  buf[2] = 0x05; // Length
  buf[3] = protocolByte;
  buf.writeUInt16BE(serialNumber, 4);

  // CRC is calculated over length + protocol + serial (bytes 2 to 5)
  const crc = getCrc16(buf, 2, 4);
  buf.writeUInt16BE(crc, 6);

  buf[8] = 0x0d;
  buf[9] = 0x0a;
  return buf;
}

/**
 * Maps GT06 battery level (0-6) or raw voltage to percentage
 */
export function mapGt06Battery(levelOrVoltage: number): number {
  if (levelOrVoltage <= 6) {
    const levels = [0, 10, 25, 50, 75, 90, 100];
    return levels[levelOrVoltage] ?? 80;
  }
  if (levelOrVoltage <= 100) return levelOrVoltage;
  if (levelOrVoltage >= 3400 && levelOrVoltage <= 4200) {
    return Math.round(((levelOrVoltage - 3400) / (4200 - 3400)) * 100);
  }
  return 85;
}

/**
 * Checks if terminal status byte or alarm byte indicates a barking / vibration alarm
 */
function isBarkingAlarm(terminalInfo: number, alarmByte?: number): { isBark: boolean; description: string } {
  const alarmBits = (terminalInfo >> 3) & 0x07;
  if (alarmBits === 1) {
    return { isBark: true, description: 'IK122T Tärinä/Haukkuhälytys (Terminal Bit 001)' };
  }

  if (alarmByte !== undefined) {
    if (alarmByte === 0x03 || alarmByte === 0x01 || alarmByte === 0x09 || alarmByte === 0x0a || alarmByte === 0x11) {
      return { isBark: true, description: `IK122T Haukkuhälytys (Alarm Code 0x${alarmByte.toString(16).padStart(2, '0')})` };
    }
  }

  return { isBark: false, description: 'Normaali tilapäivitys' };
}

/**
 * Parses ICAR IK122T binary or ASCII data
 */
export function parseIcarData(
  buffer: Buffer,
  knownDeviceId?: string
): IcarParseResult {
  if (!buffer || buffer.length === 0) {
    return { position: null, responseBuffer: null, packetType: 'unknown' };
  }

  // Check if this is an ASCII packet (H02 / SinoTrack text format on port 5023)
  if (buffer[0] === 0x2a || buffer[0] === 0x5b || buffer[0] === 0x28) {
    const asciiStr = buffer.toString('utf8');
    const pos = parseSinoTrackPacket(asciiStr);
    const isBark = /bark|barking|vib|vibration|shock|alm:01|alm:03/i.test(asciiStr);
    
    if (pos) {
      pos.protocol = 'ICAR_H02';
      pos.isBarking = isBark;
      return {
        position: pos,
        responseBuffer: null,
        deviceId: pos.id,
        packetType: isBark ? 'bark' : 'ascii',
        isBarking: isBark,
        alarmType: isBark ? 'ASCII Haukkusignaali' : undefined
      };
    }
  }

  // JT808 Protocol check (Starts and ends with 0x7E)
  if (buffer[0] === 0x7e && buffer.length >= 12) {
    try {
      const unescaped = unescapeJt808(buffer);
      if (unescaped.length >= 12 && unescaped[0] === 0x7e) {
        const msgId = unescaped.readUInt16BE(1);
        const bodyProps = unescaped.readUInt16BE(3);
        const bodyLen = bodyProps & 0x03ff;
        const phoneBcd = unescaped.subarray(5, 11);
        const phoneStr = bcdToString(unescaped, 5, 6);
        const serial = unescaped.readUInt16BE(11);
        const devId = phoneStr || knownDeviceId || 'JT808_DOG';

        // 1. Terminal Registration (0x0100) -> Respond with 0x8100
        if (msgId === 0x0100) {
          const resp = buildJt808Response(0x8100, phoneBcd, serial, 0x0100, 0, 'AUTH_OK');
          return {
            position: null,
            responseBuffer: resp,
            deviceId: devId,
            packetType: 'login'
          };
        }

        // 2. Terminal Authentication (0x0102) -> Respond with 0x8001
        if (msgId === 0x0102) {
          const resp = buildJt808Response(0x8001, phoneBcd, serial, 0x0102, 0);
          return {
            position: null,
            responseBuffer: resp,
            deviceId: devId,
            packetType: 'login'
          };
        }

        // 3. Terminal Heartbeat (0x0002) -> Respond with 0x8001
        if (msgId === 0x0002) {
          const resp = buildJt808Response(0x8001, phoneBcd, serial, 0x0002, 0);
          return {
            position: null,
            responseBuffer: resp,
            deviceId: devId,
            packetType: 'heartbeat'
          };
        }

        // 4. Location Report (0x0200) -> Respond with 0x8001 and parse Lat/Lon
        if (msgId === 0x0200 && unescaped.length >= 41) {
          const resp = buildJt808Response(0x8001, phoneBcd, serial, 0x0200, 0);
          const alarmFlag = unescaped.readUInt32BE(13);
          const statusFlag = unescaped.readUInt32BE(17);
          const latRaw = unescaped.readUInt32BE(21);
          const lonRaw = unescaped.readUInt32BE(25);
          const altitude = unescaped.readUInt16BE(29);
          const speedRaw = unescaped.readUInt16BE(31);
          const heading = unescaped.readUInt16BE(33);
          
          let lat = Number((latRaw / 1000000.0).toFixed(6));
          let lon = Number((lonRaw / 1000000.0).toFixed(6));
          const speed = Number((speedRaw / 10.0).toFixed(1));

          // Hemispheres from status flag
          if ((statusFlag & 0x04) !== 0 && lat > 0) lat = -lat; // South
          if ((statusFlag & 0x08) !== 0 && lon > 0) lon = -lon; // West

          // Check if alarm flag has vibration / SOS / barking
          const isBark = (alarmFlag & 0x01) !== 0 || (alarmFlag & 0x08) !== 0 || (alarmFlag & 0x10) !== 0;

          // Battery from TLV if available
          let battery = 90;
          let offset = 41;
          while (offset + 2 < unescaped.length - 2) {
            const extraId = unescaped[offset];
            const extraLen = unescaped[offset + 1];
            if (extraId === 0x25 && extraLen >= 2) {
              battery = Math.min(100, Math.round(unescaped.readUInt16BE(offset + 2) / 10));
            }
            offset += 2 + extraLen;
          }

          const pos: GpsPosition = {
            id: devId,
            lat,
            lon,
            speed,
            battery,
            heading: Math.max(0, Math.min(360, heading)),
            timestamp: Date.now(),
            protocol: 'ICAR_JT808',
            satellites: 12,
            valid: (statusFlag & 0x02) !== 0,
            rawPacket: buffer.toString('hex')
          };

          return {
            position: pos,
            responseBuffer: resp,
            deviceId: devId,
            packetType: isBark ? 'bark' : 'location',
            isBarking: isBark,
            alarmType: isBark ? 'JT808 Haukkuhälytys' : undefined,
            battery
          };
        }

        // Generic JT808 Fallback Response
        const genResp = buildJt808Response(0x8001, phoneBcd, serial, msgId, 0);
        return {
          position: null,
          responseBuffer: genResp,
          deviceId: devId,
          packetType: 'heartbeat'
        };
      }
    } catch {
      // Fall through to GT06 if error
    }
  }

  // GT06 Binary protocol check (Header 0x78 0x78 or 0x79 0x79)
  if (buffer.length >= 6 && (buffer[0] === 0x78 || buffer[0] === 0x79) && (buffer[1] === 0x78 || buffer[1] === 0x79)) {
    const length = buffer[2];
    const protocol = buffer[3];

    // Protocol 0x01: Login Message
    if (protocol === 0x01 && buffer.length >= 10) {
      const imei = bcdToString(buffer, 4, 8);
      const serialIndex = 4 + 8;
      const serial = buffer.length >= serialIndex + 2 ? buffer.readUInt16BE(serialIndex) : 1;
      const ack = buildGt06Ack(0x01, serial);

      return {
        position: null,
        responseBuffer: ack,
        deviceId: imei,
        packetType: 'login'
      };
    }

    // Protocol 0x12 / 0x22: Standard Location Data Packet
    if ((protocol === 0x12 || protocol === 0x22) && buffer.length >= 18) {
      try {
        // Date Time (Bytes 4-9): Year (offset 2000), Month, Day, Hour, Min, Sec
        const year = 2000 + buffer[4];
        const month = buffer[5] - 1;
        const day = buffer[6];
        const hour = buffer[7];
        const min = buffer[8];
        const sec = buffer[9];
        const timestamp = new Date(Date.UTC(year, month, day, hour, min, sec)).getTime();

        // Satellites (Byte 10)
        const satByte = buffer[10];
        const satellites = satByte & 0x0f;

        // Latitude (Bytes 11-14)
        const latRaw = buffer.readUInt32BE(11);
        let lat = latRaw / 1800000.0;

        // Longitude (Bytes 15-18)
        const lonRaw = buffer.readUInt32BE(15);
        let lon = lonRaw / 1800000.0;

        // Speed (Byte 19)
        const speed = buffer.length > 19 ? buffer[19] : 0;

        // Course & Status (Bytes 20-21)
        let heading = 0;
        let valid = true;
        if (buffer.length > 21) {
          const courseStatus = buffer.readUInt16BE(20);
          heading = courseStatus & 0x03ff; // bits 0-9

          // Bit flags for hemisphere
          const isWest = (courseStatus & 0x0800) !== 0;
          const isSouth = (courseStatus & 0x0400) === 0;

          if (isWest && lon > 0) lon = -lon;
          if (isSouth && lat > 0) lat = -lat;

          // GPS Real-time fix bit
          valid = (courseStatus & 0x1000) !== 0;
        }

        // Battery: GT06 sometimes includes voltage/battery status in subsequent bytes
        let battery = 90;
        if (buffer.length > 26) {
          const possibleBat = buffer[26];
          battery = mapGt06Battery(possibleBat);
        }

        lat = Number(lat.toFixed(6));
        lon = Number(lon.toFixed(6));

        const deviceId = knownDeviceId || 'ICAR_' + (satellites > 0 ? 'DOG' : 'COLLAR');

        const pos: GpsPosition = {
          id: deviceId,
          lat,
          lon,
          speed: Number(speed.toFixed(1)),
          battery,
          heading: Math.max(0, Math.min(360, heading)),
          timestamp: isNaN(timestamp) ? Date.now() : timestamp,
          protocol: 'ICAR_GT06',
          satellites,
          valid,
          rawPacket: buffer.toString('hex')
        };

        // If packet has serial, build ACK
        let ack: Buffer | null = null;
        if (buffer.length >= 26) {
          const stopIdx = buffer.indexOf(Buffer.from([0x0d, 0x0a]));
          if (stopIdx >= 4) {
            const serial = buffer.readUInt16BE(stopIdx - 4);
            ack = buildGt06Ack(protocol, serial);
          }
        }

        return {
          position: pos,
          responseBuffer: ack,
          deviceId,
          packetType: 'location'
        };
      } catch {
        return { position: null, responseBuffer: null, packetType: 'unknown' };
      }
    }

    // Protocol 0x16 / 0x26: Alarm Data Packet (Location + Alarm Status / Barking)
    if ((protocol === 0x16 || protocol === 0x26) && buffer.length >= 20) {
      try {
        const year = 2000 + buffer[4];
        const month = buffer[5] - 1;
        const day = buffer[6];
        const hour = buffer[7];
        const min = buffer[8];
        const sec = buffer[9];
        const timestamp = new Date(Date.UTC(year, month, day, hour, min, sec)).getTime();

        const satByte = buffer[10];
        const satellites = satByte & 0x0f;
        const latRaw = buffer.readUInt32BE(11);
        let lat = Number((latRaw / 1800000.0).toFixed(6));
        const lonRaw = buffer.readUInt32BE(15);
        let lon = Number((lonRaw / 1800000.0).toFixed(6));
        const speed = buffer.length > 19 ? buffer[19] : 0;

        let heading = 0;
        let valid = true;
        if (buffer.length > 21) {
          const courseStatus = buffer.readUInt16BE(20);
          heading = courseStatus & 0x03ff;
          valid = (courseStatus & 0x1000) !== 0;
        }

        // Terminal Info & Alarm status bytes
        const termInfo = buffer.length > 28 ? buffer[28] : 0;
        const voltage = buffer.length > 29 ? buffer[29] : 5;
        const alarmCode = buffer.length > 31 ? buffer[31] : 0x03;

        const barkCheck = isBarkingAlarm(termInfo, alarmCode);
        const battery = mapGt06Battery(voltage);
        const deviceId = knownDeviceId || 'ICAR_DOG';

        const pos: GpsPosition = {
          id: deviceId,
          lat,
          lon,
          speed: Number(speed.toFixed(1)),
          battery,
          heading: Math.max(0, Math.min(360, heading)),
          timestamp: isNaN(timestamp) ? Date.now() : timestamp,
          protocol: 'ICAR_GT06',
          satellites,
          valid,
          isBarking: barkCheck.isBark,
          rawPacket: buffer.toString('hex')
        };

        const stopIdx = buffer.indexOf(Buffer.from([0x0d, 0x0a]));
        const serial = stopIdx >= 4 ? buffer.readUInt16BE(stopIdx - 4) : 1;
        const ack = buildGt06Ack(protocol, serial);

        return {
          position: pos,
          responseBuffer: ack,
          deviceId,
          packetType: barkCheck.isBark ? 'bark' : 'alarm',
          isBarking: barkCheck.isBark,
          alarmType: barkCheck.description,
          alarmCode,
          battery
        };
      } catch {
        return { position: null, responseBuffer: null, packetType: 'unknown' };
      }
    }

    // Protocol 0x13: Status / Heartbeat / Bark Alarm Packet
    if (protocol === 0x13 && buffer.length >= 8) {
      const termInfo = buffer[4];
      const voltage = buffer.length > 5 ? buffer[5] : 5;
      const gsm = buffer.length > 6 ? buffer[6] : 0;
      const alarmCode = buffer.length > 7 ? buffer[7] : undefined;

      const barkCheck = isBarkingAlarm(termInfo, alarmCode);
      const battery = mapGt06Battery(voltage);

      const stopIdx = buffer.indexOf(Buffer.from([0x0d, 0x0a]));
      const serial = stopIdx >= 4 ? buffer.readUInt16BE(stopIdx - 4) : 1;
      const ack = buildGt06Ack(0x13, serial);

      return {
        position: null,
        responseBuffer: ack,
        deviceId: knownDeviceId,
        packetType: barkCheck.isBark ? 'bark' : 'heartbeat',
        isBarking: barkCheck.isBark,
        alarmType: barkCheck.description,
        alarmCode,
        battery
      };
    }
  }

  return { position: null, responseBuffer: null, packetType: 'unknown' };
}

