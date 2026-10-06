/**
 * In-memory state and event hub for Micro GPS Gateway
 * Designed for extreme lightweight memory footprint (<30 MB RAM).
 */
import { Response } from 'express';
import { DeviceState, GpsPosition, LogEntry, ServerConfig, SystemMetrics, ForwardResult, GpsHistoryPoint } from '../src/types';
import { DEFAULT_ERATUTKA_URL, forwardToEratutka } from './forwarder';

class GatewayState {
  private devices = new Map<string, DeviceState>();
  private history = new Map<string, GpsHistoryPoint[]>();
  private barkTimestamps = new Map<string, number[]>(); // Sliding window of bark timestamps
  private logs: LogEntry[] = [];
  private readonly MAX_LOGS = 300;
  private readonly MAX_TRAIL_POINTS = 100;
  private readonly MAX_HISTORY_POINTS = 3600; // ~6-12 hours of GPS pings
  private readonly BARK_DECAY_MS = 10000; // 10 seconds without barks -> isBarking: false
  
  private sseClients: Set<Response> = new Set();

  public config: ServerConfig = {
    eratutkaUrl: DEFAULT_ERATUTKA_URL,
    sinotrackPort: parseInt(process.env.SINOTRACK_PORT || '5013', 10),
    icarPort: parseInt(process.env.ICAR_PORT || '5023', 10),
    httpPort: parseInt(process.env.HTTP_PORT || '3000', 10),
    forwardingEnabled: true,
    logRawPackets: true,
  };

  public metrics: SystemMetrics = {
    uptimeSeconds: 0,
    memoryRssMb: 0,
    memoryHeapMb: 0,
    packetsReceived: 0,
    packetsForwarded: 0,
    forwardErrors: 0,
    activeSockets: 0,
    sinotrackActive: false,
    icarActive: false,
  };

  private startTime = Date.now();

  constructor() {
    // Seed initial demo device state for smooth UI preview until real collar connects
    this.addDevice({
      id: '7026216737',
      name: 'Jämtlanninpystykorva "Reko"',
      protocol: 'SinoTrack',
      lat: 60.85214,
      lon: 25.68142,
      speed: 12.4,
      battery: 92,
      heading: 45,
      timestamp: Date.now() - 15000,
      valid: true,
      isBarking: false,
      barkRate: 0
    });

    this.addLog({
      id: 'init-' + Date.now(),
      timestamp: Date.now(),
      type: 'system',
      message: 'GPS Gateway alustettu. Kuunnellaan TCP-portteja 5013 (SinoTrack) ja 5023 (ICAR/GT06). Haukunilmaisin aktivoitu.'
    });

    // Metric and Bark decay ticker
    setInterval(() => {
      this.updateMetrics();
      this.checkBarkDecay();
    }, 2000);
  }

  /**
   * Records a bark signal from GT06 0x13/0x26 alarm or sensor
   */
  public async recordBark(deviceId: string, timestamp = Date.now(), source = 'IK122T GT06 0x13'): Promise<void> {
    const id = String(deviceId);
    const timestamps = this.barkTimestamps.get(id) || [];
    timestamps.push(timestamp);

    // Keep only timestamps within last 60 seconds
    const cutoff = timestamp - 60000;
    const recent = timestamps.filter(t => t >= cutoff);
    this.barkTimestamps.set(id, recent);

    // Calculate bark rate: number of barks in the last 60s
    // If we have at least 2 barks in a short interval, extrapolate realistic rate
    let barkRate = recent.length;
    if (recent.length >= 2) {
      const windowSec = Math.max(2, (recent[recent.length - 1] - recent[0]) / 1000);
      if (windowSec < 60) {
        barkRate = Math.round((recent.length / windowSec) * 60);
      }
    }
    barkRate = Math.min(140, Math.max(1, barkRate));

    let dev = this.devices.get(id);
    if (!dev) {
      this.addDevice({
        id,
        name: `Koirapanta ${id}`,
        protocol: 'ICAR_GT06',
        lat: 60.85214,
        lon: 25.68142,
        speed: 0,
        battery: 88,
        heading: 0,
        timestamp,
        isBarking: true,
        barkRate
      });
      dev = this.devices.get(id);
    }

    if (dev) {
      dev.isBarking = true;
      dev.barkRate = barkRate;
      dev.lastBarkTime = timestamp;
      dev.totalBarks = (dev.totalBarks || 0) + 1;
      dev.lastSeen = timestamp;
    }

    this.addLog({
      id: 'bark-' + timestamp + '-' + Math.random().toString(36).slice(2, 4),
      timestamp,
      type: 'bark_alarm',
      deviceId: id,
      protocol: 'IK122T Pro (GT06)',
      message: `🔔 [HAUKKUILMOITUS] Koira haukkuu! (${source}) -> Tiheys: ${barkRate} haukkua/min`
    });

    // If device exists and has coordinates, forward updated status to Erätutka immediately
    if (dev) {
      const pos: GpsPosition = {
        id: dev.id,
        lat: dev.lat,
        lon: dev.lon,
        speed: dev.speed,
        battery: dev.battery,
        heading: dev.heading,
        timestamp,
        protocol: dev.protocol,
        isBarking: true,
        barkRate
      };

      if (this.config.forwardingEnabled) {
        forwardToEratutka(pos, this.config.eratutkaUrl).catch(() => {});
      }

      this.broadcast({
        type: 'bark',
        deviceId: id,
        isBarking: true,
        barkRate,
        totalBarks: dev.totalBarks,
        device: dev
      });
    }
  }

  /**
   * Checks if barking state should decay to false
   */
  private checkBarkDecay() {
    const now = Date.now();
    let stateChanged = false;

    for (const [id, dev] of this.devices.entries()) {
      if (dev.isBarking) {
        const timeSinceBark = now - (dev.lastBarkTime || 0);
        if (timeSinceBark > this.BARK_DECAY_MS) {
          dev.isBarking = false;
          dev.barkRate = 0;
          stateChanged = true;

          // Prune timestamps
          this.barkTimestamps.set(id, []);

          this.broadcast({
            type: 'bark_stop',
            deviceId: id,
            device: dev
          });
        }
      }
    }
  }

  public registerSseClient(res: Response): () => void {
    this.sseClients.add(res);
    // Send initial snapshot
    const initData = JSON.stringify({
      type: 'snapshot',
      devices: this.getDevices(),
      metrics: this.getMetrics(),
      config: this.config,
      recentLogs: this.logs.slice(-30)
    });
    res.write(`data: ${initData}\n\n`);

    return () => {
      this.sseClients.delete(res);
    };
  }

  public broadcast(event: { type: string; [key: string]: any }) {
    if (this.sseClients.size === 0) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  public addLog(entry: LogEntry) {
    this.logs.push(entry);
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }
    this.broadcast({ type: 'log', log: entry });
  }

  public getLogs(): LogEntry[] {
    return [...this.logs];
  }

  public getDevices(): DeviceState[] {
    const now = Date.now();
    return Array.from(this.devices.values()).map(dev => {
      const isBarking = Boolean(dev.isBarking && (now - (dev.lastBarkTime || 0) <= this.BARK_DECAY_MS));
      return {
        ...dev,
        isBarking,
        barkRate: isBarking ? (dev.barkRate || 0) : 0,
        online: now - dev.lastSeen < 180000 // online if seen within 3 min
      };
    });
  }

  public getDevice(id: string): DeviceState | undefined {
    const dev = this.devices.get(id);
    if (!dev) return undefined;
    const now = Date.now();
    const isBarking = Boolean(dev.isBarking && (now - (dev.lastBarkTime || 0) <= this.BARK_DECAY_MS));
    return {
      ...dev,
      isBarking,
      barkRate: isBarking ? (dev.barkRate || 0) : 0,
      online: now - dev.lastSeen < 180000
    };
  }

  public getHistory(deviceId: string, options?: { since?: number; limit?: number; hours?: number }): GpsHistoryPoint[] {
    const list = this.history.get(deviceId) || [];
    let since = options?.since;
    if (!since && options?.hours) {
      since = Date.now() - options.hours * 3600 * 1000;
    }
    const limit = options?.limit && options.limit > 0 ? options.limit : 2000;
    
    let filtered = list;
    if (since) {
      filtered = list.filter(p => p.timestamp >= since!);
    }
    return filtered.slice(-limit);
  }

  public async handlePosition(position: GpsPosition, rawTextOrHex?: string): Promise<ForwardResult | null> {
    this.metrics.packetsReceived++;
    
    // Check if barking was set or if device is currently barking
    const existing = this.devices.get(position.id);
    if (position.isBarking) {
      await this.recordBark(position.id, position.timestamp || Date.now(), 'GPS Location/Alarm Packet');
    } else if (existing && existing.isBarking && (Date.now() - (existing.lastBarkTime || 0) <= this.BARK_DECAY_MS)) {
      position.isBarking = true;
      position.barkRate = existing.barkRate || 0;
    }

    // Update local device record
    this.addDevice(position, rawTextOrHex);

    // Forward to Erätutka if enabled
    let forwardResult: ForwardResult | null = null;
    if (this.config.forwardingEnabled) {
      forwardResult = await forwardToEratutka(position, this.config.eratutkaUrl);
      
      if (forwardResult.success) {
        this.metrics.packetsForwarded++;
        const barkInfo = position.isBarking ? ` [🔔 HAUKKUU ${position.barkRate || 0}/min]` : '';
        this.addLog({
          id: 'fwd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
          timestamp: Date.now(),
          type: 'forward_success',
          protocol: position.protocol,
          deviceId: position.id,
          message: `Välitetty Erätutkaan [${forwardResult.status} OK] (${forwardResult.durationMs}ms): lat=${position.lat}, lon=${position.lon}, nopeus=${position.speed}km/h${barkInfo}`,
          data: forwardResult
        });
      } else {
        this.metrics.forwardErrors++;
        this.addLog({
          id: 'fwd-err-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
          timestamp: Date.now(),
          type: 'forward_error',
          protocol: position.protocol,
          deviceId: position.id,
          message: `Virhe Erätutkaan välityksessä (${forwardResult.status || 'FAIL'}): ${forwardResult.error || 'Yhteysvirhe'}`,
          data: forwardResult
        });
      }

      // Update device lastForwardStatus
      const devRecord = this.devices.get(position.id);
      if (devRecord) {
        devRecord.lastForwardStatus = {
          success: forwardResult.success,
          timestamp: Date.now(),
          status: forwardResult.status,
          durationMs: forwardResult.durationMs
        };
      }
    }

    this.broadcast({
      type: 'position',
      position,
      forwardResult,
      device: this.getDevice(position.id)
    });

    return forwardResult;
  }

  private addDevice(position: GpsPosition, rawPacket?: string) {
    const id = String(position.id);
    const existing = this.devices.get(id);

    const isBarking = Boolean(position.isBarking || (existing?.isBarking && Date.now() - (existing.lastBarkTime || 0) <= this.BARK_DECAY_MS));
    const barkRate = position.barkRate || (isBarking ? existing?.barkRate || 0 : 0);

    const newTrailPoint = {
      lat: position.lat,
      lon: position.lon,
      speed: position.speed,
      heading: position.heading,
      timestamp: position.timestamp || Date.now(),
      isBarking,
      barkRate
    };

    // Store in history buffer (max 3600 points)
    const historyList = this.history.get(id) || [];
    historyList.push({
      lat: position.lat,
      lng: position.lon,
      speed: position.speed || 0,
      battery: position.battery || 100,
      heading: position.heading || 0,
      barkRate,
      isBarking,
      satellites: position.satellites || 8,
      timestamp: position.timestamp || Date.now()
    });
    if (historyList.length > this.MAX_HISTORY_POINTS) {
      historyList.shift();
    }
    this.history.set(id, historyList);

    if (existing) {
      existing.lat = position.lat;
      existing.lon = position.lon;
      existing.speed = position.speed;
      existing.battery = position.battery;
      existing.heading = position.heading;
      existing.lastSeen = Date.now();
      existing.packetCount++;
      existing.protocol = position.protocol || existing.protocol;
      existing.isBarking = isBarking;
      existing.barkRate = barkRate;
      if (position.isBarking) {
        existing.lastBarkTime = position.timestamp || Date.now();
      }
      if (rawPacket) existing.lastRawPacket = rawPacket;
      
      // Append trail point if distance or time moved
      existing.trail.push(newTrailPoint);
      if (existing.trail.length > this.MAX_TRAIL_POINTS) {
        existing.trail.shift();
      }
    } else {
      this.devices.set(id, {
        id,
        name: id === '7026216737' ? 'Jämtlanninpystykorva "Reko"' : `Koirapanta ${id}`,
        protocol: position.protocol || 'SinoTrack',
        lastSeen: Date.now(),
        lat: position.lat,
        lon: position.lon,
        speed: position.speed,
        battery: position.battery,
        heading: position.heading,
        packetCount: 1,
        online: true,
        trail: [newTrailPoint],
        lastRawPacket: rawPacket,
        isBarking,
        barkRate,
        lastBarkTime: position.isBarking ? Date.now() : undefined,
        totalBarks: position.isBarking ? 1 : 0
      });
    }
  }

  public updateConfig(newConfig: Partial<ServerConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.broadcast({ type: 'config', config: this.config });
    this.addLog({
      id: 'cfg-' + Date.now(),
      timestamp: Date.now(),
      type: 'system',
      message: `Asetukset päivitetty: Erätutka URL = ${this.config.eratutkaUrl}, Välitys = ${this.config.forwardingEnabled ? 'Päällä' : 'Pois'}`
    });
  }

  private updateMetrics() {
    const mem = process.memoryUsage();
    this.metrics.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    this.metrics.memoryRssMb = Number((mem.rss / (1024 * 1024)).toFixed(1));
    this.metrics.memoryHeapMb = Number((mem.heapUsed / (1024 * 1024)).toFixed(1));
    
    this.broadcast({ type: 'metrics', metrics: this.metrics });
  }

  public getMetrics(): SystemMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }
}

export const gatewayState = new GatewayState();
