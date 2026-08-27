import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  Filter,
  Trash2,
  Copy,
  Check,
  Pause,
  Play,
  ArrowDownCircle,
  Search,
  CheckCircle2,
  AlertCircle,
  Radio,
  Send,
  Zap
} from 'lucide-react';
import { LogEntry } from '../types';

interface PacketLogsProps {
  logs: LogEntry[];
  onClearLogs?: () => void;
}

export const PacketLogs: React.FC<PacketLogsProps> = ({ logs, onClearLogs }) => {
  const [filterType, setFilterType] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && !isPaused && scrollBottomRef.current) {
      scrollBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isPaused]);

  const filteredLogs = logs.filter((entry) => {
    if (filterType === 'tcp' && entry.type !== 'tcp_in') return false;
    if (filterType === 'fwd_ok' && entry.type !== 'forward_success') return false;
    if (filterType === 'fwd_err' && entry.type !== 'forward_error') return false;
    if (filterType === 'ack' && entry.type !== 'login_ack') return false;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchMsg = entry.message.toLowerCase().includes(term);
      const matchDev = entry.deviceId?.toLowerCase().includes(term);
      const matchRaw = entry.rawAscii?.toLowerCase().includes(term) || entry.rawHex?.toLowerCase().includes(term);
      return matchMsg || matchDev || matchRaw;
    }
    return true;
  });

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getLogBadge = (entry: LogEntry) => {
    switch (entry.type) {
      case 'bark_alarm':
        return (
          <span className="px-2 py-0.5 rounded-sm text-[10px] font-mono bg-[#ea580c]/20 text-[#fb923c] border border-[#f97316]/50 flex items-center gap-1 font-bold animate-pulse">
            🔔 Haukku-alarm
          </span>
        );
      case 'forward_success':
        return (
          <span className="px-2 py-0.5 rounded-sm text-[10px] font-mono bg-[#181B22] text-[#4ADE80] border border-[#4ADE80]/30 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-[#4ADE80]" />
            Erätutka OK
          </span>
        );
      case 'forward_error':
        return (
          <span className="px-2 py-0.5 rounded-sm text-[10px] font-mono bg-[#181B22] text-[#EF4444] border border-[#EF4444]/30 flex items-center gap-1">
            <AlertCircle className="w-3 h-3 text-[#EF4444]" />
            Erätutka Virhe
          </span>
        );
      case 'tcp_in':
        return (
          <span className="px-2 py-0.5 rounded-sm text-[10px] font-mono bg-[#181B22] text-[#D4AF37] border border-[#D4AF37]/30 flex items-center gap-1">
            <Radio className="w-3 h-3 text-[#D4AF37]" />
            TCP IN
          </span>
        );
      case 'login_ack':
        return (
          <span className="px-2 py-0.5 rounded-sm text-[10px] font-mono bg-[#181B22] text-[#93C5FD] border border-[#93C5FD]/30 flex items-center gap-1">
            <Zap className="w-3 h-3 text-[#93C5FD]" />
            GT06 ACK
          </span>
        );
      case 'simulated':
        return (
          <span className="px-2 py-0.5 rounded-sm text-[10px] font-mono bg-[#181B22] text-[#FACC15] border border-[#FACC15]/30 flex items-center gap-1">
            Simulaattori
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-sm text-[10px] font-mono bg-[#181B22] text-[#7E8492] border border-[#2A2D35]">
            Järjestelmä
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-160px)] min-h-[580px] bg-[#181B22] border border-[#2A2D35] rounded-sm overflow-hidden shadow-2xl">
      {/* Log Header & Control Bar */}
      <div className="p-3.5 bg-[#1C1F26] border-b border-[#2A2D35] flex flex-wrap items-center justify-between gap-3">
        {/* Left: Title & Live status */}
        <div className="flex items-center gap-2.5">
          <Terminal className="w-4 h-4 text-[#D4AF37]" />
          <h2 className="text-base font-serif italic text-[#D4AF37]">
            Reaaliaikainen Pakettiloki & Erätutka-lähetykset
          </h2>
          <span className="text-xs font-mono text-[#7E8492]">
            ({filteredLogs.length} / {logs.length} riviä)
          </span>
        </div>

        {/* Center: Search & Filter */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#7E8492] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              id="log-search-input"
              type="text"
              placeholder="Hae ID, hex, koordinaatit..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-[#0F1115] border border-[#2A2D35] rounded-sm text-[#E0E2E5] placeholder-[#5C6370] focus:outline-none focus:border-[#D4AF37] w-44 sm:w-56 font-mono text-xs"
            />
          </div>

          {/* Filter Types */}
          <select
            id="log-filter-select"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-2.5 py-1.5 bg-[#0F1115] border border-[#2A2D35] rounded-sm text-[#E0E2E5] focus:outline-none focus:border-[#D4AF37] text-xs"
          >
            <option value="all">Kaikki tapahtumat</option>
            <option value="tcp">Vain saapuvat TCP</option>
            <option value="fwd_ok">Erätutka Onnistuneet</option>
            <option value="fwd_err">Erätutka Virheet</option>
            <option value="ack">GT06 ACK vastaukset</option>
          </select>
        </div>

        {/* Right: Controls (Pause, Auto-scroll, Clear) */}
        <div className="flex items-center gap-1.5 text-xs">
          <button
            id="log-pause-btn"
            onClick={() => setIsPaused(!isPaused)}
            className={`px-3 py-1.5 rounded-sm border flex items-center gap-1.5 transition ${
              isPaused
                ? 'bg-[#181B22] border-amber-500/50 text-amber-300'
                : 'bg-[#0F1115] border-[#2A2D35] text-[#7E8492] hover:text-[#E0E2E5]'
            }`}
            title={isPaused ? 'Jatka striimausta' : 'Pysäytä vieritys'}
          >
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            <span>{isPaused ? 'Pysäytetty' : 'Tauko'}</span>
          </button>

          <button
            id="log-autoscroll-btn"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-3 py-1.5 rounded-sm border flex items-center gap-1.5 transition ${
              autoScroll
                ? 'bg-[#181B22] border-[#D4AF37]/50 text-[#D4AF37]'
                : 'bg-[#0F1115] border-[#2A2D35] text-[#7E8492] hover:text-[#E0E2E5]'
            }`}
          >
            <ArrowDownCircle className="w-3.5 h-3.5" />
            <span>Vieritys</span>
          </button>

          {onClearLogs && (
            <button
              id="log-clear-btn"
              onClick={onClearLogs}
              className="p-2 bg-[#0F1115] hover:bg-[#20242D] border border-[#2A2D35] rounded-sm text-[#7E8492] hover:text-[#EF4444] transition"
              title="Tyhjennä loki"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Log Console Body */}
      <div
        id="logs-terminal-viewport"
        className="flex-1 p-3 overflow-y-auto font-mono text-xs space-y-2 bg-[#08090C] selection:bg-[#D4AF37]/30"
      >
        {filteredLogs.map((entry) => {
          const timeStr = new Date(entry.timestamp).toLocaleTimeString();
          const rawPayload = entry.rawAscii || entry.rawHex;

          return (
            <div
              key={entry.id}
              className={`p-2.5 rounded-sm border transition ${
                entry.type === 'forward_success'
                  ? 'bg-[#181B22]/90 border-[#4ADE80]/30 hover:border-[#4ADE80]/50'
                  : entry.type === 'forward_error'
                  ? 'bg-[#181B22]/90 border-[#EF4444]/30 hover:border-[#EF4444]/50'
                  : entry.type === 'tcp_in'
                  ? 'bg-[#181B22]/80 border-[#2A2D35] hover:border-[#3F4450]'
                  : 'bg-[#181B22]/50 border-[#2A2D35]/50'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-[#7E8492] mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[#5C6370]">[{timeStr}]</span>
                  {getLogBadge(entry)}
                  {entry.protocol && (
                    <span className="text-[#7E8492] font-sans text-xs">
                      {entry.protocol}
                    </span>
                  )}
                  {entry.deviceId && (
                    <span className="text-[#D4AF37] font-mono font-medium">
                      ID: {entry.deviceId}
                    </span>
                  )}
                </div>

                {/* Copy Raw */}
                {rawPayload && (
                  <button
                    onClick={() => handleCopy(rawPayload, entry.id)}
                    className="p-1 text-[#7E8492] hover:text-[#E0E2E5] rounded-sm hover:bg-[#0F1115] flex items-center gap-1 text-[10px]"
                    title="Kopioi raakapyyntö leikepöydälle"
                  >
                    {copiedId === entry.id ? (
                      <>
                        <Check className="w-3 h-3 text-[#4ADE80]" />
                        <span className="text-[#4ADE80]">Kopioitu!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Kopioi raaka</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Message */}
              <div className="text-[#E0E2E5] font-sans text-xs leading-relaxed">
                {entry.message}
              </div>

              {/* Raw ASCII or HEX display */}
              {entry.rawAscii && (
                <div className="mt-1.5 p-2 rounded-sm bg-[#0F1115] border border-[#2A2D35] text-[11px] text-[#D4AF37] overflow-x-auto break-all">
                  <span className="text-[#5C6370] select-none uppercase tracking-wider text-[9px] mr-1">ASCII:</span>
                  {entry.rawAscii}
                </div>
              )}

              {entry.rawHex && (
                <div className="mt-1.5 p-2 rounded-sm bg-[#0F1115] border border-[#2A2D35] text-[11px] text-[#93C5FD] overflow-x-auto break-all">
                  <span className="text-[#5C6370] select-none uppercase tracking-wider text-[9px] mr-1">HEX:</span>
                  {entry.rawHex}
                </div>
              )}

              {/* Forward JSON payload details if present */}
              {entry.data?.payload && (
                <div className="mt-1.5 p-2.5 rounded-sm bg-[#0F1115] border border-[#2A2D35] text-[11px] text-[#E0E2E5]">
                  <div className="text-[9px] text-[#7E8492] uppercase tracking-wider mb-1">
                    Erätutka JSON Payload:
                  </div>
                  <pre className="text-[#4ADE80] overflow-x-auto text-[11px]">
                    {JSON.stringify(entry.data.payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}

        {filteredLogs.length === 0 && (
          <div className="h-64 flex flex-col items-center justify-center text-[#5C6370] text-xs gap-2">
            <Terminal className="w-8 h-8 text-[#2A2D35]" />
            <div>Ei lokeja nykyisellä suodatuksella.</div>
          </div>
        )}

        <div ref={scrollBottomRef} />
      </div>
    </div>
  );
};
