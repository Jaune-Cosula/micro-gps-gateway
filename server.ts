/**
 * Micro GPS Gateway - Main Server Entry Point
 * Runs Express HTTP server (port 3000) with Vite middleware
 * and starts GPS TCP listeners (port 5013 for SinoTrack, port 5023 for ICAR).
 */
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { gatewayState } from './server/state';
import { gpsTcpServer } from './server/tcpServer';
import { collarSimulator } from './server/simulator';
import { forwardToEratutka } from './server/forwarder';
import { parseSinoTrackPacket } from './server/protocols/sinotrack';
import { parseIcarData } from './server/protocols/icar';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // ----------------------------------------------------
  // API Routes
  // ----------------------------------------------------

  // 1. Health & Status
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'Micro GPS Gateway (Erätutka)',
      uptime: process.uptime(),
      timestamp: Date.now()
    });
  });

  app.get('/api/status', (req, res) => {
    res.json({
      metrics: gatewayState.getMetrics(),
      config: gatewayState.config,
      devicesCount: gatewayState.getDevices().length,
      activeSimulations: collarSimulator.getActiveSimulations()
    });
  });

  // 2. Devices & Trails
  app.get('/api/devices', (req, res) => {
    res.json({
      devices: gatewayState.getDevices()
    });
  });

  // 3. Real-time Log Stream (SSE)
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unregister = gatewayState.registerSseClient(res);

    req.on('close', () => {
      unregister();
    });
  });

  // 4. Logs Endpoint
  app.get('/api/logs', (req, res) => {
    res.json({
      logs: gatewayState.getLogs()
    });
  });

  // 5. Config Management
  app.post('/api/config', (req, res) => {
    const { eratutkaUrl, forwardingEnabled, logRawPackets } = req.body;
    gatewayState.updateConfig({
      ...(eratutkaUrl ? { eratutkaUrl } : {}),
      ...(typeof forwardingEnabled === 'boolean' ? { forwardingEnabled } : {}),
      ...(typeof logRawPackets === 'boolean' ? { logRawPackets } : {})
    });
    res.json({ success: true, config: gatewayState.config });
  });

  // 6. Manual Test Forwarding to Erätutka
  app.post('/api/forward-test', async (req, res) => {
    try {
      const {
        id = '7026216737',
        lat = 60.85214,
        lon = 25.68142,
        speed = 12.4,
        battery = 92,
        heading = 45,
        targetUrl
      } = req.body;

      const position = {
        id: String(id),
        lat: Number(lat),
        lon: Number(lon),
        speed: Number(speed),
        battery: Number(battery),
        heading: Number(heading),
        timestamp: Date.now(),
        protocol: 'Manual_Test' as const
      };

      const result = await forwardToEratutka(position, targetUrl || gatewayState.config.eratutkaUrl);

      // Add to logs
      gatewayState.addLog({
        id: 'manual-test-' + Date.now(),
        timestamp: Date.now(),
        type: result.success ? 'forward_success' : 'forward_error',
        protocol: 'Manuaalinen Testi',
        deviceId: String(id),
        message: result.success
          ? `[Manuaalinen Testi] Onnistui (${result.status} OK, ${result.durationMs}ms): lat=${lat}, lon=${lon}`
          : `[Manuaalinen Testi] Epäonnistui (${result.status || 'Virhe'}): ${result.error}`,
        data: result
      });

      res.json({
        success: result.success,
        result
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 7. Simulators (SinoTrack, ICAR, Live Dog movement)
  app.post('/api/simulate/sinotrack', async (req, res) => {
    const { id, lat, lon, speed, heading, battery } = req.body;
    const result = await collarSimulator.simulateSinoTrack(id, lat, lon, speed, heading, battery);
    res.json({ success: true, result });
  });

  app.post('/api/simulate/icar', async (req, res) => {
    const { id, lat, lon, speed, heading, battery } = req.body;
    const result = await collarSimulator.simulateIcar(id, lat, lon, speed, heading, battery);
    res.json({ success: true, result });
  });

  app.post('/api/simulate/live-dog/start', (req, res) => {
    const { id, name, protocol, intervalMs } = req.body;
    collarSimulator.startLiveDogSimulation(id, name, protocol, intervalMs || 4000);
    res.json({ success: true, activeSimulations: collarSimulator.getActiveSimulations() });
  });

  app.post('/api/simulate/live-dog/stop', (req, res) => {
    const { id } = req.body;
    collarSimulator.stopSimulation(id);
    res.json({ success: true, activeSimulations: collarSimulator.getActiveSimulations() });
  });

  // 8. Raw Packet Receiver (HTTP Gateway fallback for webhooks/raw strings)
  app.post('/api/collar/raw', async (req, res) => {
    const { protocol, rawText, rawHex, deviceId } = req.body;
    if (rawText) {
      const pos = parseSinoTrackPacket(rawText);
      if (pos) {
        const fwd = await gatewayState.handlePosition(pos, rawText);
        return res.json({ success: true, parsed: pos, forward: fwd });
      }
    }
    if (rawHex) {
      const buf = Buffer.from(rawHex.replace(/\s+/g, ''), 'hex');
      const parsed = parseIcarData(buf, deviceId);
      if (parsed.position) {
        const fwd = await gatewayState.handlePosition(parsed.position, rawHex);
        return res.json({ success: true, parsed: parsed.position, ack: parsed.responseBuffer?.toString('hex'), forward: fwd });
      }
    }
    res.status(400).json({ error: 'Could not parse collar packet' });
  });

  // ----------------------------------------------------
  // Vite Middleware or Static Assets
  // ----------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start HTTP server on 0.0.0.0:3000
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[HTTP/Web] Micro GPS Gateway Dashboard running at http://0.0.0.0:${PORT}`);
  });

  // Start GPS Collar TCP listeners (5013 & 5023)
  gpsTcpServer.start();
}

startServer().catch((err) => {
  console.error('Fatal Server Error:', err);
});
