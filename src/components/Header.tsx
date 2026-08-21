import React from 'react';
import {
  Activity,
  Cpu,
  Radio,
  Send,
  Server,
  AlertTriangle,
  Settings,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  Terminal,
  MapPin,
  Flame,
  FileCode
} from 'lucide-react';
import { ServerConfig, SystemMetrics } from '../types';

interface HeaderProps {
  activeTab: 'map' | 'logs' | 'test' | 'gce' | 'settings';
  setActiveTab: (tab: 'map' | 'logs' | 'test' | 'gce' | 'settings') => void;
  metrics: SystemMetrics;
  config: ServerConfig;
  connectedCollarsCount: number;
  sseConnected: boolean;
  onRefresh: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  metrics,
  config,
  connectedCollarsCount,
  sseConnected,
  onRefresh
}) => {
  const uptimeMinutes = Math.floor(metrics.uptimeSeconds / 60);
  const uptimeHours = Math.floor(uptimeMinutes / 60);
  const uptimeDays = Math.floor(uptimeHours / 24);
  const formattedUptime = `${uptimeDays}d ${uptimeHours % 24}h ${uptimeMinutes % 60}m`;

  return (
    <header id="app-header" className="bg-[#0F1115] border-b border-[#2A2D35] sticky top-0 z-30 shadow-2xl">
      {/* Top Banner with Service Details */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-[#2A2D35]">
          
          {/* Logo & Branding */}
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-sm bg-[#181B22] border border-[#D4AF37]/30 flex items-center justify-center text-[#D4AF37] shadow-inner">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl sm:text-3xl font-serif italic text-[#D4AF37] tracking-tight">
                  Micro GPS Gateway
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm bg-[#181B22] text-[#4ADE80] border border-[#4ADE80]/30 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] animate-pulse"></span>
                  GCE e2-micro
                </span>
              </div>
              <p className="text-xs uppercase tracking-widest text-[#7E8492] mt-0.5">
                Erätutka Technical Backbone • TCP {config.sinotrackPort} & {config.icarPort}
              </p>
            </div>
          </div>

          {/* Real-time Hardware & Gateway Telemetry */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            {/* Live SSE Status */}
            <div
              id="sse-status-badge"
              className={`px-3 py-1.5 rounded-sm border flex items-center gap-2 ${
                sseConnected
                  ? 'bg-[#181B22] border-[#4ADE80]/30 text-[#4ADE80]'
                  : 'bg-[#181B22] border-amber-500/30 text-amber-300'
              }`}
            >
              <div className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-[#4ADE80] animate-pulse' : 'bg-amber-400'}`} />
              <span className="font-mono text-[11px] uppercase tracking-wider">{sseConnected ? 'Live Stream' : 'Connecting'}</span>
            </div>

            {/* RAM Metric */}
            <div id="ram-metric" className="px-3 py-1.5 rounded-sm bg-[#181B22] border border-[#2A2D35] text-[#E0E2E5] flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-[#7E8492]" />
              <span className="text-[11px] uppercase text-[#7E8492]">RAM:</span>
              <strong className="font-mono text-sm text-[#4ADE80] font-normal">{metrics.memoryRssMb} <span className="text-[10px] text-[#7E8492]">MB</span></strong>
            </div>

            {/* Collars Active */}
            <div id="collars-active-metric" className="px-3 py-1.5 rounded-sm bg-[#181B22] border border-[#2A2D35] text-[#E0E2E5] flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span className="text-[11px] uppercase text-[#7E8492]">Koirat:</span>
              <strong className="font-mono text-sm text-[#D4AF37] font-normal">{connectedCollarsCount}</strong>
            </div>

            {/* Forwarded packets */}
            <div id="forward-metric" className="px-3 py-1.5 rounded-sm bg-[#181B22] border border-[#2A2D35] text-[#E0E2E5] flex items-center gap-2">
              <Send className="w-3.5 h-3.5 text-[#7E8492]" />
              <span className="text-[11px] uppercase text-[#7E8492]">Välitetty:</span>
              <strong className="font-mono text-sm text-[#E0E2E5] font-normal">{metrics.packetsForwarded}</strong>
            </div>

            {/* Errors */}
            {metrics.forwardErrors > 0 && (
              <div id="errors-metric" className="px-3 py-1.5 rounded-sm bg-[#181B22] border border-rose-500/30 text-rose-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                <span>Virheet: <strong className="font-mono">{metrics.forwardErrors}</strong></span>
              </div>
            )}

            <button
              id="refresh-btn"
              onClick={onRefresh}
              className="p-2 rounded-sm bg-[#181B22] hover:bg-[#20242D] border border-[#2A2D35] text-[#7E8492] hover:text-[#E0E2E5] transition"
              title="Päivitä tiedot"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

        </div>

        {/* Navigation Tabs */}
        <div className="mt-3 flex items-center justify-between gap-2 overflow-x-auto">
          <nav className="flex items-center gap-1 sm:gap-2">
            <button
              id="nav-tab-map"
              onClick={() => setActiveTab('map')}
              className={`px-3.5 py-1.5 rounded-sm text-xs font-medium transition flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'map'
                  ? 'bg-[#181B22] text-[#D4AF37] border border-[#D4AF37]/50 shadow-sm'
                  : 'text-[#7E8492] hover:text-[#E0E2E5] hover:bg-[#181B22]/60'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>Kartta & Koirapannat</span>
            </button>

            <button
              id="nav-tab-logs"
              onClick={() => setActiveTab('logs')}
              className={`px-3.5 py-1.5 rounded-sm text-xs font-medium transition flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'logs'
                  ? 'bg-[#181B22] text-[#D4AF37] border border-[#D4AF37]/50 shadow-sm'
                  : 'text-[#7E8492] hover:text-[#E0E2E5] hover:bg-[#181B22]/60'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Pakettiloki & Välitys</span>
              {metrics.packetsReceived > 0 && (
                <span className={`px-1.5 py-0.2 rounded-sm text-[10px] font-mono ${
                  activeTab === 'logs' ? 'bg-[#0F1115] text-[#4ADE80] border border-[#4ADE80]/30' : 'bg-[#2A2D35] text-[#7E8492]'
                }`}>
                  {metrics.packetsReceived}
                </span>
              )}
            </button>

            <button
              id="nav-tab-test"
              onClick={() => setActiveTab('test')}
              className={`px-3.5 py-1.5 rounded-sm text-xs font-medium transition flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'test'
                  ? 'bg-[#181B22] text-[#D4AF37] border border-[#D4AF37]/50 shadow-sm'
                  : 'text-[#7E8492] hover:text-[#E0E2E5] hover:bg-[#181B22]/60'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              <span>Testaus & Simulaattori</span>
            </button>

            <button
              id="nav-tab-gce"
              onClick={() => setActiveTab('gce')}
              className={`px-3.5 py-1.5 rounded-sm text-xs font-medium transition flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'gce'
                  ? 'bg-[#181B22] text-[#D4AF37] border border-[#D4AF37]/50 shadow-sm'
                  : 'text-[#7E8492] hover:text-[#E0E2E5] hover:bg-[#181B22]/60'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>GCE Asennus & SMS</span>
            </button>
          </nav>

          <button
            id="nav-tab-settings"
            onClick={() => setActiveTab('settings')}
            className={`px-3.5 py-1.5 rounded-sm text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'settings'
                ? 'bg-[#181B22] text-[#D4AF37] border border-[#D4AF37]/50'
                : 'text-[#7E8492] hover:text-[#E0E2E5] hover:bg-[#181B22]/60'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Asetukset</span>
          </button>
        </div>
      </div>
    </header>
  );
};
