/**
 * In-memory state and event hub for Micro GPS Gateway
 * Designed for extreme lightweight memory footprint (<30 MB RAM).
 */
import { Response } from 'express';
import { DeviceState, GpsPosition, LogEntry, ServerConfig, SystemMetrics, ForwardResult } from '../src/types';
import { DEFAULT_ERATUTKA_URL, forwardToEratutka } from './forwarder';

class GatewayState {
  private devices = new Map<string, DeviceState>();
  private logs: LogEntry[] = [];
  private readonly MAX_LOGS = 300;
  private readonly MAX_TRAIL_POINTS = 100;
  
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
      valid: true
    });

    this.addLog({
      id: 'init-' + Date.now(),
      timestamp: Date.now(),
      type: 'system',
      message: 'GPS Gateway alustettu. Kuunnellaan TCP-portteja 5013 (SinoTrack) ja 5023 (ICAR).'
    });

    // Metric update ticker
    setInterval(() => {
      this.updateMetrics();
    }, 3000);
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
    return Array.from(this.devices.values()).map(dev => ({
      ...dev,
      online: now - dev.lastSeen < 180000 // online if seen within 3 min
    }));
  }

  public getDevice(id: string): DeviceState | undefined {
    return this.devices.get(id);
  }

  public async handlePosition(position: GpsPosition, rawTextOrHex?: string): Promise<ForwardResult | null> {
    this.metrics.packetsReceived++;
    
    // Update local device record
    this.addDevice(position, rawTextOrHex);

    // Forward to Erätutka if enabled
    let forwardResult: ForwardResult | null = null;
    if (this.config.forwardingEnabled) {
      forwardResult = await forwardToEratutka(position, this.config.eratutkaUrl);
      
      if (forwardResult.success) {
        this.metrics.packetsForwarded++;
        this.addLog({
          id: 'fwd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
          timestamp: Date.now(),
          type: 'forward_success',
          protocol: position.protocol,
          deviceId: position.id,
          message: `Välitetty Erätutkaan [${forwardResult.status} OK] (${forwardResult.durationMs}ms): lat=${position.lat}, lon=${position.lon}, nopeus=${position.speed}km/h`,
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
      const existing = this.devices.get(position.id);
      if (existing) {
        existing.lastForwardStatus = {
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

    const newTrailPoint = {
      lat: position.lat,
      lon: position.lon,
      speed: position.speed,
      heading: position.heading,
      timestamp: position.timestamp || Date.now()
    };

    if (existing) {
      existing.lat = position.lat;
      existing.lon = position.lon;
      existing.speed = position.speed;
      existing.battery = position.battery;
      existing.heading = position.heading;
      existing.lastSeen = Date.now();
      existing.packetCount++;
      existing.protocol = position.protocol || existing.protocol;
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
        lastRawPacket: rawPacket
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
