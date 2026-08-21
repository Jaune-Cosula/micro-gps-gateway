/**
 * Protocol Simulator & Testing Suite
 * Generates valid raw SinoTrack ST-904L ASCII and ICAR IK122T GT06 Binary packets
 * and handles live dog movement simulation.
 */
import { gatewayState } from './state';
import { parseSinoTrackPacket } from './protocols/sinotrack';
import { parseIcarData, buildGt06Ack } from './protocols/icar';
import { getCrc16 } from './protocols/crc';

interface SimDog {
  id: string;
  name: string;
  protocol: 'SinoTrack' | 'ICAR_GT06';
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  battery: number;
  active: boolean;
  timer?: NodeJS.Timeout;
}

class CollarSimulator {
  private activeSimulations = new Map<string, SimDog>();

  /**
   * Generates a valid SinoTrack ST-904L raw ASCII packet
   * *HQ,7026216737,V1,123456,A,6051.1284,N,02540.8852,E,012.4,045,200826,FFFFFBFF,92#
   */
  public createSinoTrackRaw(
    deviceId: string,
    lat: number,
    lon: number,
    speedKmH: number,
    headingDeg: number,
    batteryPct: number,
    dateObj: Date = new Date()
  ): string {
    // Convert decimal latitude to DDMM.MMMM
    const latDeg = Math.floor(Math.abs(lat));
    const latMin = (Math.abs(lat) - latDeg) * 60;
    const latStr = `${String(latDeg).padStart(2, '0')}${latMin.toFixed(4).padStart(7, '0')}`;
    const latHem = lat >= 0 ? 'N' : 'S';

    // Convert decimal longitude to DDDMM.MMMM
    const lonDeg = Math.floor(Math.abs(lon));
    const lonMin = (Math.abs(lon) - lonDeg) * 60;
    const lonStr = `${String(lonDeg).padStart(3, '0')}${lonMin.toFixed(4).padStart(7, '0')}`;
    const lonHem = lon >= 0 ? 'E' : 'W';

    // Time HHmmss
    const timeStr = `${String(dateObj.getUTCHours()).padStart(2, '0')}${String(dateObj.getUTCMinutes()).padStart(2, '0')}${String(dateObj.getUTCSeconds()).padStart(2, '0')}`;

    // Date DDMMYY
    const day = String(dateObj.getUTCDate()).padStart(2, '0');
    const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const year = String(dateObj.getUTCFullYear()).slice(-2);
    const dateStr = `${day}${month}${year}`;

    const speedStr = speedKmH.toFixed(1).padStart(5, '0');
    const headingStr = String(Math.round(headingDeg)).padStart(3, '0');
    const batteryStr = String(Math.round(batteryPct));

    return `*HQ,${deviceId},V1,${timeStr},A,${latStr},${latHem},${lonStr},${lonHem},${speedStr},${headingStr},${dateStr},FFFFFBFF,${batteryStr}#`;
  }

  /**
   * Generates a valid ICAR IK122T GT06 Binary Location buffer (0x12)
   */
  public createIcarBinaryRaw(
    deviceId: string,
    lat: number,
    lon: number,
    speedKmH: number,
    headingDeg: number,
    batteryPct: number,
    dateObj: Date = new Date()
  ): Buffer {
    const buf = Buffer.alloc(30);
    buf[0] = 0x78;
    buf[1] = 0x78;
    buf[2] = 0x16; // Length
    buf[3] = 0x12; // Protocol (Location)

    // Date & Time (Bytes 4-9)
    buf[4] = dateObj.getUTCFullYear() - 2000;
    buf[5] = dateObj.getUTCMonth() + 1;
    buf[6] = dateObj.getUTCDate();
    buf[7] = dateObj.getUTCHours();
    buf[8] = dateObj.getUTCMinutes();
    buf[9] = dateObj.getUTCSeconds();

    // Satellites (Byte 10)
    buf[10] = 0x0c; // 12 satellites

    // Latitude (Bytes 11-14)
    const latInt = Math.round(Math.abs(lat) * 1800000);
    buf.writeUInt32BE(latInt, 11);

    // Longitude (Bytes 15-18)
    const lonInt = Math.round(Math.abs(lon) * 1800000);
    buf.writeUInt32BE(lonInt, 15);

    // Speed (Byte 19)
    buf[19] = Math.min(255, Math.round(speedKmH));

    // Course & Status (Bytes 20-21)
    let courseStatus = Math.round(headingDeg) & 0x03ff;
    // North bit (0x0400), East bit (0x0000), Realtime GPS (0x1000)
    courseStatus |= 0x1400;
    buf.writeUInt16BE(courseStatus, 20);

    // LBS info (Bytes 22-25)
    buf[22] = 0x01;
    buf[23] = 0xf4;
    buf[24] = 0x27;
    buf[25] = 0x10;

    // Serial (Bytes 26-27)
    const serial = Math.floor(Math.random() * 65000);
    buf.writeUInt16BE(serial, 26);

    // CRC (Bytes 28-29)
    const crc = getCrc16(buf, 2, 26);
    buf.writeUInt16BE(crc, 28);

    // Stop bytes
    const fullBuf = Buffer.concat([buf, Buffer.from([0x0d, 0x0a])]);
    return fullBuf;
  }

  /**
   * Simulates a single raw SinoTrack packet
   */
  public async simulateSinoTrack(
    deviceId = '7026216737',
    lat = 60.85214,
    lon = 25.68142,
    speed = 12.4,
    heading = 45,
    battery = 92
  ) {
    const rawAscii = this.createSinoTrackRaw(deviceId, lat, lon, speed, heading, battery);
    gatewayState.addLog({
      id: 'sim-st-' + Date.now(),
      timestamp: Date.now(),
      type: 'simulated',
      protocol: 'SinoTrack',
      deviceId,
      rawAscii,
      message: `[Simulaattori] SinoTrack ST-904L raakapaketti generoitu: ${rawAscii}`
    });

    const pos = parseSinoTrackPacket(rawAscii);
    if (pos) {
      return await gatewayState.handlePosition(pos, rawAscii);
    }
    return null;
  }

  /**
   * Simulates a single raw ICAR GT06 binary packet
   */
  public async simulateIcar(
    deviceId = '868120394857211',
    lat = 60.85420,
    lon = 25.68950,
    speed = 18.6,
    heading = 120,
    battery = 88
  ) {
    const rawBuffer = this.createIcarBinaryRaw(deviceId, lat, lon, speed, heading, battery);
    const rawHex = rawBuffer.toString('hex');

    gatewayState.addLog({
      id: 'sim-icar-' + Date.now(),
      timestamp: Date.now(),
      type: 'simulated',
      protocol: 'ICAR IK122T (GT06)',
      deviceId,
      rawHex,
      message: `[Simulaattori] ICAR IK122T GT06 binääripaketti generoitu (${rawBuffer.length} tavua): ${rawHex}`
    });

    const parsed = parseIcarData(rawBuffer, deviceId);
    if (parsed.position) {
      parsed.position.id = deviceId;
      return await gatewayState.handlePosition(parsed.position, rawHex);
    }
    return null;
  }

  /**
   * Starts a continuous live dog movement simulation in the forest
   */
  public startLiveDogSimulation(
    id: string = '7026216737',
    name: string = 'Jämtlanninpystykorva "Reko"',
    protocol: 'SinoTrack' | 'ICAR_GT06' = 'SinoTrack',
    intervalMs: number = 4000
  ) {
    if (this.activeSimulations.has(id)) {
      this.stopSimulation(id);
    }

    // Starting location near Heinola / Lahti forest (WGS84)
    let curLat = 60.85214;
    let curLon = 25.68142;
    let curHeading = 45;
    let curSpeed = 12.4;
    let curBattery = 95;

    const dog: SimDog = {
      id,
      name,
      protocol,
      lat: curLat,
      lon: curLon,
      speed: curSpeed,
      heading: curHeading,
      battery: curBattery,
      active: true
    };

    const runStep = async () => {
      if (!dog.active) return;

      // Realistic hunting dog behavior: turns, speeds up, slows down, wanders in forest
      const headingDelta = (Math.random() - 0.48) * 35; // gentle curves
      dog.heading = (dog.heading + headingDelta + 360) % 360;

      // Speed variation (0 - 32 km/h)
      const speedDelta = (Math.random() - 0.5) * 6;
      dog.speed = Math.max(0, Math.min(32, Number((dog.speed + speedDelta).toFixed(1))));

      // Distance step in meters: speed (km/h) / 3.6 * (intervalMs / 1000)
      const distMeters = (dog.speed / 3.6) * (intervalMs / 1000);
      // 1 deg lat ~ 111,320m, 1 deg lon ~ 111,320m * cos(lat)
      const latDelta = (distMeters * Math.cos((dog.heading * Math.PI) / 180)) / 111320;
      const lonDelta =
        (distMeters * Math.sin((dog.heading * Math.PI) / 180)) /
        (111320 * Math.cos((dog.lat * Math.PI) / 180));

      dog.lat = Number((dog.lat + latDelta).toFixed(6));
      dog.lon = Number((dog.lon + lonDelta).toFixed(6));

      // Slow battery drain
      dog.battery = Math.max(5, Number((dog.battery - 0.02).toFixed(1)));

      if (dog.protocol === 'SinoTrack') {
        const raw = this.createSinoTrackRaw(
          dog.id,
          dog.lat,
          dog.lon,
          dog.speed,
          dog.heading,
          Math.round(dog.battery)
        );
        const pos = parseSinoTrackPacket(raw);
        if (pos) {
          pos.id = dog.id;
          await gatewayState.handlePosition(pos, raw);
        }
      } else {
        const rawBuf = this.createIcarBinaryRaw(
          dog.id,
          dog.lat,
          dog.lon,
          dog.speed,
          dog.heading,
          Math.round(dog.battery)
        );
        const parsed = parseIcarData(rawBuf, dog.id);
        if (parsed.position) {
          parsed.position.id = dog.id;
          await gatewayState.handlePosition(parsed.position, rawBuf.toString('hex'));
        }
      }

      if (dog.active) {
        dog.timer = setTimeout(runStep, intervalMs);
      }
    };

    dog.timer = setTimeout(runStep, 1000);
    this.activeSimulations.set(id, dog);

    gatewayState.addLog({
      id: 'sim-start-' + Date.now(),
      timestamp: Date.now(),
      type: 'system',
      message: `[Simulaattori] Koiran reaaliaikainen maastoseuranta aloitettu: ${name} (${id}) - Päivitysväli ${intervalMs / 1000}s`
    });
  }

  public stopSimulation(id: string) {
    const dog = this.activeSimulations.get(id);
    if (dog) {
      dog.active = false;
      if (dog.timer) clearTimeout(dog.timer);
      this.activeSimulations.delete(id);
      gatewayState.addLog({
        id: 'sim-stop-' + Date.now(),
        timestamp: Date.now(),
        type: 'system',
        message: `[Simulaattori] Koiraseuranta pysäytetty: ${dog.name} (${id})`
      });
    }
  }

  public getActiveSimulations(): string[] {
    return Array.from(this.activeSimulations.keys());
  }

  public isSimulating(id: string): boolean {
    return this.activeSimulations.has(id);
  }
}

export const collarSimulator = new CollarSimulator();
