/**
 * SinoTrack ST-904L Protocol Parser (Port 5013)
 * Handles ASCII-based protocols (*HQ..., [ST904*...], etc.)
 */
import { GpsPosition } from '../../src/types';

/**
 * Converts NMEA / GPS DDMM.MMMM format to Decimal Degrees (WGS84)
 * e.g. 6051.1284, N -> 60.85214
 * e.g. 02540.8852, E -> 25.68142
 */
export function convertNmeaToDecimal(coordStr: string, hemisphere: string): number {
  if (!coordStr) return 0;
  
  // If already decimal degrees (e.g. 60.85214)
  if (!hemisphere && coordStr.includes('.')) {
    return parseFloat(coordStr);
  }

  const dotIndex = coordStr.indexOf('.');
  if (dotIndex === -1) {
    const val = parseFloat(coordStr);
    return isNaN(val) ? 0 : val;
  }

  // DDMM.MMMM or DDDMM.MMMM
  // Latitude has 2 digits for degrees, Longitude has 3 digits for degrees
  const degreesLength = dotIndex - 2;
  const degrees = parseFloat(coordStr.substring(0, degreesLength));
  const minutes = parseFloat(coordStr.substring(degreesLength));

  if (isNaN(degrees) || isNaN(minutes)) return 0;

  let decimal = degrees + minutes / 60.0;
  if (hemisphere === 'S' || hemisphere === 'W') {
    decimal = -decimal;
  }

  return Number(decimal.toFixed(6));
}

/**
 * Parses date (DDMMYY) and time (HHmmss) into Unix epoch ms
 */
export function parseDateTime(timeStr?: string, dateStr?: string): number {
  try {
    const now = new Date();
    if (!timeStr && !dateStr) return now.getTime();

    let hours = now.getUTCHours();
    let minutes = now.getUTCMinutes();
    let seconds = now.getUTCSeconds();

    if (timeStr && timeStr.length >= 6) {
      hours = parseInt(timeStr.substring(0, 2), 10);
      minutes = parseInt(timeStr.substring(2, 4), 10);
      seconds = parseInt(timeStr.substring(4, 6), 10);
    }

    let day = now.getUTCDate();
    let month = now.getUTCMonth();
    let year = now.getUTCFullYear();

    if (dateStr && dateStr.length === 6) {
      day = parseInt(dateStr.substring(0, 2), 10);
      month = parseInt(dateStr.substring(2, 4), 10) - 1;
      const yr2 = parseInt(dateStr.substring(4, 6), 10);
      year = yr2 >= 70 ? 1900 + yr2 : 2000 + yr2;
    }

    const d = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
    return isNaN(d.getTime()) ? Date.now() : d.getTime();
  } catch {
    return Date.now();
  }
}

/**
 * Parses SinoTrack ST-904L ASCII message
 * Typical packet:
 * *HQ,7026216737,V1,123456,A,6051.1284,N,02540.8852,E,012.4,045,200826,FFFFFBFF,92#
 */
export function parseSinoTrackPacket(raw: string): GpsPosition | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Format 1: *HQ,id,V1,...# or *HQ,id,NBR,...#
  if (trimmed.startsWith('*HQ') || trimmed.startsWith('HQ')) {
    const clean = trimmed.replace(/^[*]/, '').replace(/[#]$/, '');
    const parts = clean.split(',');

    if (parts.length < 5) return null;

    const deviceId = parts[1];
    const cmd = parts[2]; // V1, V4, NBR, LINK, etc.

    // Position packet: *HQ,id,V1,time,A,lat,N,lon,E,speed,heading,date,status,battery#
    if (cmd === 'V1' || cmd === 'V4' || cmd === 'NBR' || cmd === 'UD') {
      const timeStr = parts[3];
      const validFlag = parts[4]; // 'A' = valid, 'V' = void
      const latStr = parts[5];
      const latHem = parts[6];
      const lonStr = parts[7];
      const lonHem = parts[8];
      const speedStr = parts[9];
      const headingStr = parts[10];
      const dateStr = parts[11];
      
      // Battery might be in part 13, or part 12
      let battery = 100;
      if (parts.length > 13 && parts[13] !== '') {
        const parsedBat = parseInt(parts[13], 10);
        if (!isNaN(parsedBat)) battery = Math.min(100, Math.max(0, parsedBat));
      } else if (parts.length > 12 && parts[12] && !parts[12].startsWith('FF') && !isNaN(parseInt(parts[12], 10))) {
        battery = parseInt(parts[12], 10);
      }

      const lat = convertNmeaToDecimal(latStr, latHem);
      const lon = convertNmeaToDecimal(lonStr, lonHem);
      let speed = parseFloat(speedStr || '0');
      // If speed is in knots, convert or keep as km/h. Standard SinoTrack reports in km/h or knots.
      if (isNaN(speed)) speed = 0;
      speed = Number(speed.toFixed(1));

      let heading = parseInt(headingStr || '0', 10);
      if (isNaN(heading)) heading = 0;
      heading = Math.max(0, Math.min(360, heading));

      const timestamp = parseDateTime(timeStr, dateStr);

      if (lat === 0 && lon === 0) {
        return null; // Invalid coordinate
      }

      return {
        id: deviceId,
        lat,
        lon,
        speed,
        battery,
        heading,
        timestamp,
        protocol: 'SinoTrack',
        rawPacket: trimmed,
        valid: validFlag === 'A'
      };
    }
  }

  // Format 2: [ST904*ID*LEN*UD,date,time,A,lat,N,lon,E,speed,heading,altitude,battery...]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const clean = trimmed.slice(1, -1);
    const mainParts = clean.split('*');
    if (mainParts.length >= 4) {
      const deviceId = mainParts[1];
      const dataPayload = mainParts.slice(3).join('*');
      const parts = dataPayload.split(',');
      if (parts.length >= 8) {
        const dateStr = parts[1];
        const timeStr = parts[2];
        const validFlag = parts[3];
        const lat = convertNmeaToDecimal(parts[4], parts[5]);
        const lon = convertNmeaToDecimal(parts[6], parts[7]);
        const speed = parseFloat(parts[8] || '0') || 0;
        const heading = parseInt(parts[9] || '0', 10) || 0;
        let battery = 90;
        if (parts.length > 11) {
          const b = parseInt(parts[11], 10);
          if (!isNaN(b)) battery = b;
        }

        if (lat !== 0 || lon !== 0) {
          return {
            id: deviceId,
            lat,
            lon,
            speed: Number(speed.toFixed(1)),
            battery,
            heading,
            timestamp: parseDateTime(timeStr, dateStr),
            protocol: 'SinoTrack',
            rawPacket: trimmed,
            valid: validFlag === 'A'
          };
        }
      }
    }
  }

  return null;
}
