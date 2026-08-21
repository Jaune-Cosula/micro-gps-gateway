/**
 * Micro GPS Gateway - Main React Application
 * Real-time Dashboard for SinoTrack ST-904L & ICAR IK122T & Erätutka Forwarding
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { MapView } from './components/MapView';
import { PacketLogs } from './components/PacketLogs';
import { TestSuite } from './components/TestSuite';
import { GceGuide } from './components/GceGuide';
import { SettingsModal } from './components/SettingsModal';
import { DeviceState, LogEntry, ServerConfig, SystemMetrics } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<'map' | 'logs' | 'test' | 'gce' | 'settings'>('map');
  const [devices, setDevices] = useState<DeviceState[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<DeviceState | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);

  const [metrics, setMetrics] = useState<SystemMetrics>({
    uptimeSeconds: 0,
    memoryRssMb: 18.4,
    memoryHeapMb: 11.2,
    packetsReceived: 0,
    packetsForwarded: 0,
    forwardErrors: 0,
    activeSockets: 0,
    sinotrackActive: true,
    icarActive: true
  });

  const [config, setConfig] = useState<ServerConfig>({
    eratutkaUrl: 'https://ais-pre-ih3r3aegkvykcunl6ox36r-471959473114.europe-west2.run.app/api/gps/update',
    sinotrackPort: 5013,
    icarPort: 5023,
    httpPort: 3000,
    forwardingEnabled: true,
    logRawPackets: true
  });

  // Fetch initial data
  const fetchData = useCallback(async () => {
    try {
      const [statusRes, devRes, logsRes] = await Promise.all([
        fetch('/api/status').then((r) => r.json()),
        fetch('/api/devices').then((r) => r.json()),
        fetch('/api/logs').then((r) => r.json())
      ]);

      if (statusRes.metrics) setMetrics(statusRes.metrics);
      if (statusRes.config) setConfig(statusRes.config);
      if (statusRes.activeSimulations) setIsSimulating(statusRes.activeSimulations.length > 0);
      if (devRes.devices) {
        setDevices(devRes.devices);
        if (!selectedDevice && devRes.devices.length > 0) {
          setSelectedDevice(devRes.devices[0]);
        }
      }
      if (logsRes.logs) setLogs(logsRes.logs);
    } catch {
      // Fallback
    }
  }, [selectedDevice]);

  // Connect SSE Stream for real-time live events
  useEffect(() => {
    fetchData();

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource('/api/events');

      eventSource.onopen = () => {
        setSseConnected(true);
      };

      eventSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);

          if (data.type === 'snapshot') {
            if (data.devices) setDevices(data.devices);
            if (data.metrics) setMetrics(data.metrics);
            if (data.config) setConfig(data.config);
            if (data.recentLogs) setLogs(data.recentLogs);
          } else if (data.type === 'position') {
            // Update device list
            setDevices((prev) => {
              const existingIdx = prev.findIndex((d) => d.id === data.device.id);
              if (existingIdx >= 0) {
                const updated = [...prev];
                updated[existingIdx] = data.device;
                return updated;
              }
              return [...prev, data.device];
            });

            setSelectedDevice((prev) => {
              if (prev && prev.id === data.device.id) {
                return data.device;
              }
              return prev || data.device;
            });
          } else if (data.type === 'log') {
            setLogs((prev) => [...prev.slice(-250), data.log]);
          } else if (data.type === 'metrics') {
            setMetrics(data.metrics);
          } else if (data.type === 'config') {
            setConfig(data.config);
          }
        } catch {
          // parse error
        }
      };

      eventSource.onerror = () => {
        setSseConnected(false);
      };
    } catch {
      setSseConnected(false);
    }

    return () => {
      if (eventSource) eventSource.close();
    };
  }, [fetchData]);

  // Toggle Live Hunting Dog Simulation
  const handleToggleSimulation = async () => {
    try {
      if (isSimulating) {
        await fetch('/api/simulate/live-dog/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: '7026216737' })
        });
        setIsSimulating(false);
      } else {
        await fetch('/api/simulate/live-dog/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: '7026216737',
            name: 'Jämtlanninpystykorva "Reko"',
            protocol: 'SinoTrack',
            intervalMs: 4000
          })
        });
        setIsSimulating(true);
      }
    } catch {
      // handled
    }
  };

  const handleSaveConfig = async (newConfig: Partial<ServerConfig>) => {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    });
    const data = await res.json();
    if (data.config) setConfig(data.config);
  };

  return (
    <div className="min-h-screen bg-[#0F1115] text-[#E0E2E5] flex flex-col font-sans selection:bg-[#D4AF37]/30 selection:text-[#E0E2E5]">
      {/* Header with Navigation & Live Telemetry */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        metrics={metrics}
        config={config}
        connectedCollarsCount={devices.length}
        sseConnected={sseConnected}
        onRefresh={fetchData}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === 'map' && (
          <MapView
            devices={devices}
            selectedDevice={selectedDevice}
            onSelectDevice={setSelectedDevice}
            isSimulating={isSimulating}
            onToggleSimulation={handleToggleSimulation}
            eratutkaUrl={config.eratutkaUrl}
          />
        )}

        {activeTab === 'logs' && (
          <PacketLogs
            logs={logs}
            onClearLogs={() => setLogs([])}
          />
        )}

        {activeTab === 'test' && (
          <TestSuite
            eratutkaUrl={config.eratutkaUrl}
            isSimulating={isSimulating}
            onToggleLiveDogSimulation={handleToggleSimulation}
            onRefreshDevices={fetchData}
          />
        )}

        {activeTab === 'gce' && <GceGuide />}

        {activeTab === 'settings' && (
          <SettingsModal
            config={config}
            onSaveConfig={handleSaveConfig}
          />
        )}
      </main>

      {/* Sophisticated Dark Technical Footer */}
      <footer className="border-t border-[#2A2D35] bg-[#0A0C0F] py-3 px-6 text-[10px] uppercase tracking-widest text-[#5C6370]">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-2">
          <div className="flex items-center gap-2 truncate">
            <span>Erätutka Forwarding:</span>
            <span className="text-[#D4AF37] font-mono lowercase truncate">{config.eratutkaUrl}</span>
          </div>
          <div className="flex items-center gap-4 text-[#7E8492]">
            <span>GCE: e2-micro (Linux)</span>
            <span>•</span>
            <span>Ports: <strong className="text-[#4ADE80]">5013</strong> / <strong className="text-[#4ADE80]">5023</strong> TCP</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
