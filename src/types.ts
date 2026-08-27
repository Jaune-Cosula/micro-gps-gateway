/**
 * Micro GPS Gateway - Shared Types
 */

export interface GpsPosition {
  id: string; // Device ID or IMEI (e.g. "7026216737")
  name?: string; // Optional nickname
  lat: number; // Decimal degrees WGS84 (e.g. 60.85214)
  lon: number; // Decimal degrees WGS84 (e.g. 25.68142)
  speed: number; // km/h
  battery: number; // 0 - 100 %
  heading: number; // 0 - 360 degrees
  timestamp: number; // Unix epoch ms
  protocol?: 'SinoTrack' | 'ICAR_GT06' | 'ICAR_JT808' | 'ICAR_H02' | 'Manual_Test';
  rawPacket?: string;
  altitude?: number; // meters
  satellites?: number;
  valid?: boolean;
  isBarking?: boolean; // True if dog is currently barking
  barkRate?: number; // Barks per minute (e.g. 65)
  lastBarkTimestamp?: number;
}

export interface ForwardResult {
  id: string;
  success: boolean;
  status?: number;
  durationMs: number;
  error?: string;
  timestamp: number;
  targetUrl: string;
  payload: {
    id: string;
    lat: number;
    lon: number;
    speed: number;
    battery: number;
    heading: number;
    timestamp: number;
    isBarking?: boolean;
    barkRate?: number;
  };
  responseBody?: string;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  type: 'tcp_in' | 'forward_success' | 'forward_error' | 'login_ack' | 'system' | 'simulated' | 'bark_alarm';
  protocol?: string;
  deviceId?: string;
  message: string;
  rawHex?: string;
  rawAscii?: string;
  data?: any;
}

export interface TrailPoint {
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  timestamp: number;
  isBarking?: boolean;
  barkRate?: number;
}

export interface GpsHistoryPoint {
  lat: number;
  lng: number;
  speed: number;
  battery: number;
  heading: number;
  barkRate: number;
  isBarking: boolean;
  satellites: number;
  timestamp: number;
}

export interface DeviceState {
  id: string;
  name?: string;
  protocol: 'SinoTrack' | 'ICAR_GT06' | 'ICAR_JT808' | 'ICAR_H02' | 'Manual_Test';
  lastSeen: number;
  lat: number;
  lon: number;
  speed: number;
  battery: number;
  heading: number;
  packetCount: number;
  online: boolean;
  trail: TrailPoint[];
  lastRawPacket?: string;
  isBarking?: boolean;
  barkRate?: number;
  lastBarkTime?: number;
  totalBarks?: number;
  lastForwardStatus?: {
    success: boolean;
    timestamp: number;
    status?: number;
    durationMs: number;
  };
}

export interface ServerConfig {
  eratutkaUrl: string;
  sinotrackPort: number;
  icarPort: number;
  httpPort: number;
  forwardingEnabled: boolean;
  logRawPackets: boolean;
}

export interface SystemMetrics {
  uptimeSeconds: number;
  memoryRssMb: number;
  memoryHeapMb: number;
  packetsReceived: number;
  packetsForwarded: number;
  forwardErrors: number;
  activeSockets: number;
  sinotrackActive: boolean;
  icarActive: boolean;
}
