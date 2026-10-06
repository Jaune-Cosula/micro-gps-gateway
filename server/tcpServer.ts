/**
 * TCP Listeners for GPS Dog Collar Hardware
 * Port 5013: SinoTrack ST-904L (ASCII HQ / Text)
 * Port 5023: ICAR IK122T (GT06 Binary & H02 ASCII)
 */
import net from 'net';
import { gatewayState } from './state';
import { parseSinoTrackPacket } from './protocols/sinotrack';
import { parseIcarData, extractIcarFrames } from './protocols/icar';

export class GpsTcpServer {
  private sinotrackServer: net.Server | null = null;
  private icarServer: net.Server | null = null;
  private activeSocketsCount = 0;
  private deviceSockets = new Map<string, net.Socket>();

  public getActiveDeviceIds(): string[] {
    return Array.from(this.deviceSockets.keys());
  }

  public isDeviceConnected(deviceId: string): boolean {
    const sock = this.deviceSockets.get(String(deviceId));
    return Boolean(sock && !sock.destroyed && sock.writable);
  }

  public sendCommand(deviceId: string, command: string): { success: boolean; error?: string; bytesSent?: number } {
    const id = String(deviceId);
    let sock = this.deviceSockets.get(id);

    // If exact ID not found, check if single socket active or partial match
    if (!sock && this.deviceSockets.size === 1) {
      const [firstKey, firstSock] = Array.from(this.deviceSockets.entries())[0];
      if (firstKey.includes(id) || id.includes(firstKey)) {
        sock = firstSock;
      }
    }

    if (!sock || sock.destroyed || !sock.writable) {
      return {
        success: false,
        error: `Laite ${id} ei ole aktiivisessa TCP-yhteydessä (Aktiiviset: ${Array.from(this.deviceSockets.keys()).join(', ') || 'Ei kytkettyjä laitteita'})`
      };
    }

    // Ensure proper formatting for collar
    const formattedCmd = command.endsWith('\n') || command.endsWith('\r') ? command : `${command}\r\n`;
    const buffer = Buffer.from(formattedCmd, 'ascii');

    try {
      sock.write(buffer);
      gatewayState.addLog({
        id: 'cmd-out-' + Date.now(),
        timestamp: Date.now(),
        type: 'tcp_in',
        deviceId: id,
        protocol: 'Downlink',
        message: `📤 [KOMENTO LÄHETETTY] Laite: ${id} -> "${formattedCmd.trim()}" (${buffer.length} tavua)`
      });
      return {
        success: true,
        bytesSent: buffer.length
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Komennon lähetysvirhe: ${err.message}`
      };
    }
  }

  public start() {
    this.startSinoTrackServer(gatewayState.config.sinotrackPort);
    this.startIcarServer(gatewayState.config.icarPort);
  }

  public stop() {
    if (this.sinotrackServer) {
      this.sinotrackServer.close();
      this.sinotrackServer = null;
      gatewayState.metrics.sinotrackActive = false;
    }
    if (this.icarServer) {
      this.icarServer.close();
      this.icarServer = null;
      gatewayState.metrics.icarActive = false;
    }
  }

  private startSinoTrackServer(port: number) {
    this.sinotrackServer = net.createServer((socket) => {
      this.activeSocketsCount++;
      gatewayState.metrics.activeSockets = this.activeSocketsCount;
      const remote = `${socket.remoteAddress}:${socket.remotePort}`;
      let knownDeviceId: string | undefined = undefined;

      gatewayState.addLog({
        id: 'tcp-conn-' + Date.now(),
        timestamp: Date.now(),
        type: 'tcp_in',
        protocol: 'SinoTrack',
        message: `SinoTrack TCP-yhteys avattu: ${remote}`
      });

      let bufferAccumulator = '';

      socket.on('data', async (chunk) => {
        const rawText = chunk.toString('utf8');
        bufferAccumulator += rawText;

        // Packets usually end with '#' or '\n' or ']'
        const packets = bufferAccumulator.split(/(?<=#|\n|\])/);
        if (!rawText.endsWith('#') && !rawText.endsWith('\n') && !rawText.endsWith(']')) {
          bufferAccumulator = packets.pop() || '';
        } else {
          bufferAccumulator = '';
        }

        for (const packet of packets) {
          const trimmed = packet.trim();
          if (!trimmed) continue;

          gatewayState.addLog({
            id: 'pkt-st-' + Date.now() + '-' + Math.random().toString(36).slice(2, 4),
            timestamp: Date.now(),
            type: 'tcp_in',
            protocol: 'SinoTrack (5013)',
            rawAscii: trimmed,
            message: `Saapuva SinoTrack ST-904L paketti: ${trimmed}`
          });

          const pos = parseSinoTrackPacket(trimmed);
          if (pos) {
            knownDeviceId = pos.id;
            this.deviceSockets.set(pos.id, socket);
            await gatewayState.handlePosition(pos, trimmed);
          } else if (trimmed.includes('LINK') || trimmed.includes('BP00')) {
            // Heartbeat packet
            gatewayState.addLog({
              id: 'hb-st-' + Date.now(),
              timestamp: Date.now(),
              type: 'system',
              protocol: 'SinoTrack',
              message: `SinoTrack Heartbeat (Keep-Alive) kuitattu: ${trimmed}`
            });
          }
        }
      });

      socket.on('error', (err) => {
        gatewayState.addLog({
          id: 'tcp-err-' + Date.now(),
          timestamp: Date.now(),
          type: 'system',
          protocol: 'SinoTrack',
          message: `SinoTrack TCP socket -virhe (${remote}): ${err.message}`
        });
      });

      socket.on('close', () => {
        if (knownDeviceId) {
          this.deviceSockets.delete(knownDeviceId);
        }
        this.activeSocketsCount = Math.max(0, this.activeSocketsCount - 1);
        gatewayState.metrics.activeSockets = this.activeSocketsCount;
      });
    });

    this.sinotrackServer.on('error', (err: any) => {
      gatewayState.metrics.sinotrackActive = false;
      gatewayState.addLog({
        id: 'st-bind-err-' + Date.now(),
        timestamp: Date.now(),
        type: 'system',
        message: `SinoTrack TCP-portin ${port} kuuntelu epäonnistui: ${err.message} (GCE:ssä portti avataan normaalisti).`
      });
    });

    try {
      this.sinotrackServer.listen(port, '0.0.0.0', () => {
        gatewayState.metrics.sinotrackActive = true;
        gatewayState.addLog({
          id: 'st-ok-' + Date.now(),
          timestamp: Date.now(),
          type: 'system',
          message: `SinoTrack ST-904L TCP-palvelin kuuntelee portissa ${port} (0.0.0.0)`
        });
      });
    } catch (e: any) {
      gatewayState.metrics.sinotrackActive = false;
    }
  }

  private startIcarServer(port: number) {
    this.icarServer = net.createServer((socket) => {
      this.activeSocketsCount++;
      gatewayState.metrics.activeSockets = this.activeSocketsCount;
      const remote = `${socket.remoteAddress}:${socket.remotePort}`;
      let knownDeviceId: string | undefined = undefined;

      gatewayState.addLog({
        id: 'icar-conn-' + Date.now(),
        timestamp: Date.now(),
        type: 'tcp_in',
        protocol: 'ICAR IK122T',
        message: `ICAR IK122T TCP-yhteys avattu: ${remote}`
      });

      let bufferAcc = Buffer.alloc(0);

      socket.on('data', async (chunk) => {
        bufferAcc = Buffer.concat([bufferAcc, chunk]);
        const { frames, remainder } = extractIcarFrames(bufferAcc);
        bufferAcc = remainder;

        for (const frame of frames) {
          const rawHex = frame.toString('hex');
          const rawAscii = frame.toString('utf8');

          gatewayState.addLog({
            id: 'pkt-icar-' + Date.now() + '-' + Math.random().toString(36).slice(2, 4),
            timestamp: Date.now(),
            type: 'tcp_in',
            protocol: 'ICAR (5023)',
            rawHex,
            rawAscii: frame[0] === 0x2a ? rawAscii : undefined,
            message: `Saapuva ICAR IK122T kehys (${frame.length} tavua): ${rawHex.slice(0, 60)}...`
          });

          const result = parseIcarData(frame, knownDeviceId);

          if (result.deviceId) {
            knownDeviceId = result.deviceId;
            this.deviceSockets.set(result.deviceId, socket);
          }

          // If GT06 protocol expects an ACK response (e.g. 0x01 login or 0x13 heartbeat)
          if (result.responseBuffer) {
            socket.write(result.responseBuffer);
            gatewayState.addLog({
              id: 'ack-' + Date.now(),
              timestamp: Date.now(),
              type: 'login_ack',
              protocol: 'ICAR IK122T',
              deviceId: knownDeviceId,
              message: `GT06 ACK Lähetetty laitteelle [Tyyppi: ${result.packetType}, Hex: ${result.responseBuffer.toString('hex')}]`
            });
          }

          // If barking was detected in 0x13/0x26/ASCII status packet
          if (result.isBarking) {
            const id = knownDeviceId || result.deviceId || 'IK122T_COLLAR';
            await gatewayState.recordBark(id, Date.now(), result.alarmType || 'IK122T GT06 0x13');
          }

          // If location was parsed, forward to Erätutka
          if (result.position) {
            await gatewayState.handlePosition(result.position, rawHex);
          }
        }
      });

      socket.on('error', (err) => {
        gatewayState.addLog({
          id: 'icar-err-' + Date.now(),
          timestamp: Date.now(),
          type: 'system',
          protocol: 'ICAR IK122T',
          message: `ICAR TCP socket -virhe (${remote}): ${err.message}`
        });
      });

      socket.on('close', () => {
        if (knownDeviceId) {
          this.deviceSockets.delete(knownDeviceId);
        }
        this.activeSocketsCount = Math.max(0, this.activeSocketsCount - 1);
        gatewayState.metrics.activeSockets = this.activeSocketsCount;
      });
    });

    this.icarServer.on('error', (err: any) => {
      gatewayState.metrics.icarActive = false;
      gatewayState.addLog({
        id: 'icar-bind-err-' + Date.now(),
        timestamp: Date.now(),
        type: 'system',
        message: `ICAR TCP-portin ${port} kuuntelu epäonnistui: ${err.message} (GCE:ssä portti avataan normaalisti).`
      });
    });

    try {
      this.icarServer.listen(port, '0.0.0.0', () => {
        gatewayState.metrics.icarActive = true;
        gatewayState.addLog({
          id: 'icar-ok-' + Date.now(),
          timestamp: Date.now(),
          type: 'system',
          message: `ICAR IK122T GT06/H02 TCP-palvelin kuuntelee portissa ${port} (0.0.0.0)`
        });
      });
    } catch (e: any) {
      gatewayState.metrics.icarActive = false;
    }
  }
}

export const gpsTcpServer = new GpsTcpServer();
