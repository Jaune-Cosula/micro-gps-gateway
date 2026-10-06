/**
 * Erätutka Forwarding Service
 * Forwards parsed GPS positions to Erätutka via HTTPS POST
 */
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { GpsPosition, ForwardResult } from '../src/types';

export const DEFAULT_ERATUTKA_URL =
  process.env.ERATUTKA_FORWARD_URL ||
  'https://ais-pre-7fq53keha2opjy5hitirh4-471959473114.europe-west2.run.app/api/gps/update';

export async function forwardToEratutka(
  position: GpsPosition,
  targetUrl: string = DEFAULT_ERATUTKA_URL
): Promise<ForwardResult> {
  const startTime = Date.now();
  const payload = {
    id: String(position.id),
    lat: Number(position.lat),
    lon: Number(position.lon),
    speed: Number(position.speed),
    battery: Number(position.battery),
    heading: Number(position.heading),
    timestamp: Number(position.timestamp || Date.now()),
    isBarking: Boolean(position.isBarking),
    barkRate: Number(position.barkRate || 0)
  };

  const jsonBody = JSON.stringify(payload);

  return new Promise<ForwardResult>((resolve) => {
    try {
      const parsedUrl = new URL(targetUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + (parsedUrl.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(jsonBody),
          'User-Agent': 'Micro-GPS-Gateway/1.0 (Node.js/TypeScript)',
          'Accept': 'application/json'
        },
        timeout: 8000 // 8s timeout
      };

      const req = client.request(options, (res) => {
        let resData = '';
        res.on('data', (chunk) => {
          resData += chunk;
        });

        res.on('end', () => {
          const durationMs = Date.now() - startTime;
          const status = res.statusCode || 0;
          const success = status >= 200 && status < 300;

          resolve({
            id: position.id,
            success,
            status,
            durationMs,
            targetUrl,
            payload,
            responseBody: resData.slice(0, 500),
            timestamp: Date.now()
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          id: position.id,
          success: false,
          status: 408,
          durationMs: Date.now() - startTime,
          error: 'HTTP Request Timeout (>8000ms)',
          targetUrl,
          payload,
          timestamp: Date.now()
        });
      });

      req.on('error', (err) => {
        resolve({
          id: position.id,
          success: false,
          status: 0,
          durationMs: Date.now() - startTime,
          error: err.message || 'Network error',
          targetUrl,
          payload,
          timestamp: Date.now()
        });
      });

      req.write(jsonBody);
      req.end();
    } catch (err: any) {
      resolve({
        id: position.id,
        success: false,
        status: 0,
        durationMs: Date.now() - startTime,
        error: err.message || 'Invalid target URL',
        targetUrl,
        payload,
        timestamp: Date.now()
      });
    }
  });
}
