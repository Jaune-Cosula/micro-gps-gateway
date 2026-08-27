import React, { useState } from 'react';
import {
  Battery,
  BatteryMedium,
  BatteryLow,
  Compass,
  Gauge,
  Clock,
  Radio,
  Send,
  Navigation,
  CheckCircle2,
  AlertCircle,
  Volume2,
  Activity,
  BellRing
} from 'lucide-react';
import { DeviceState } from '../types';

interface DeviceCardProps {
  device: DeviceState;
  isSelected: boolean;
  onSelect: (device: DeviceState) => void;
  onManualForward?: (device: DeviceState) => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  isSelected,
  onSelect,
  onManualForward
}) => {
  const [triggeringBark, setTriggeringBark] = useState(false);
  const isOnline = Date.now() - device.lastSeen < 180000;
  const timeAgoSec = Math.floor((Date.now() - device.lastSeen) / 1000);

  const getBatteryIcon = (bat: number) => {
    if (bat > 75) return <Battery className="w-4 h-4 text-[#4ADE80]" />;
    if (bat > 30) return <BatteryMedium className="w-4 h-4 text-[#FACC15]" />;
    return <BatteryLow className="w-4 h-4 text-[#EF4444] animate-pulse" />;
  };

  const getBatteryColor = (bat: number) => {
    if (bat > 75) return 'text-[#4ADE80] bg-[#181B22] border-[#4ADE80]/30';
    if (bat > 30) return 'text-[#FACC15] bg-[#181B22] border-[#FACC15]/30';
    return 'text-[#EF4444] bg-[#181B22] border-[#EF4444]/30';
  };

  const handleQuickBark = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setTriggeringBark(true);
      await fetch('/api/simulate/bark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: device.id, burst: false })
      });
    } catch {
      // ignore
    } finally {
      setTimeout(() => setTriggeringBark(false), 500);
    }
  };

  return (
    <div
      id={`device-card-${device.id}`}
      onClick={() => onSelect(device)}
      className={`p-4 rounded-sm border transition-all cursor-pointer ${
        device.isBarking
          ? 'bg-[#1e1710] border-[#F97316] shadow-lg shadow-[#F97316]/10 ring-1 ring-[#F97316]/40'
          : isSelected
          ? 'bg-[#181B22] border-[#D4AF37] shadow-lg shadow-[#D4AF37]/5 ring-1 ring-[#D4AF37]/30'
          : 'bg-[#181B22] hover:bg-[#20242D] border-[#2A2D35] hover:border-[#3F4450]'
      }`}
    >
      {/* Top row: Name, Protocol, Online status */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <div className={`w-9 h-9 rounded-sm border flex items-center justify-center text-base transition-colors ${
              device.isBarking
                ? 'bg-[#ea580c]/20 border-[#f97316] animate-pulse'
                : 'bg-[#0F1115] border-[#2A2D35]'
            }`}>
              🐕
            </div>
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#181B22] ${
                device.isBarking
                  ? 'bg-[#F97316] animate-ping'
                  : isOnline
                  ? 'bg-[#4ADE80]'
                  : 'bg-[#5C6370]'
              }`}
            />
          </div>
          <div>
            <h3 className="font-semibold text-[#E0E2E5] text-sm flex items-center gap-1.5 font-sans">
              {device.name || `Panta ${device.id}`}
            </h3>
            <div className="flex items-center gap-1.5 text-xs text-[#7E8492]">
              <span className="font-mono text-[11px]">ID: {device.id}</span>
              <span>•</span>
              <span className="px-1.5 py-0.2 rounded-sm text-[10px] font-mono bg-[#0F1115] text-[#7E8492] border border-[#2A2D35]">
                {device.protocol}
              </span>
            </div>
          </div>
        </div>

        {/* Battery badge */}
        <div className={`px-2 py-0.5 rounded-sm border flex items-center gap-1.5 text-xs font-mono font-medium ${getBatteryColor(device.battery)}`}>
          {getBatteryIcon(device.battery)}
          <span>{device.battery}%</span>
        </div>
      </div>

      {/* Barking Alert Banner */}
      {device.isBarking && (
        <div className="mb-3 p-2 rounded-sm bg-[#ea580c]/15 border border-[#f97316]/50 flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-2 text-[#fb923c] font-medium text-xs">
            <BellRing className="w-4 h-4 text-[#ea580c] animate-bounce shrink-0" />
            <span className="font-semibold tracking-wide">HAUKKUU</span>
            <span className="text-[#fdba74] font-mono text-[11px]">
              ({device.barkRate || 0} krt/min)
            </span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-[#fed7aa] font-mono">
            <Activity className="w-3 h-3 text-[#ea580c]" />
            <span>IK122T 0x13</span>
          </div>
        </div>
      )}

      {/* Grid: Coordinates, Speed, Heading, Last Ping */}
      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        {/* Speed */}
        <div className="p-2 rounded-sm bg-[#0F1115] border border-[#2A2D35] flex items-center gap-2">
          <Gauge className="w-3.5 h-3.5 text-[#7E8492] shrink-0" />
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[#7E8492]">Nopeus</div>
            <div className="font-mono text-[#E0E2E5] text-xs">{device.speed} <span className="text-[10px] text-[#7E8492]">km/h</span></div>
          </div>
        </div>

        {/* Heading / Bearing */}
        <div className="p-2 rounded-sm bg-[#0F1115] border border-[#2A2D35] flex items-center gap-2">
          <Compass
            className="w-3.5 h-3.5 text-[#D4AF37] shrink-0 transition-transform"
            style={{ transform: `rotate(${device.heading}deg)` }}
          />
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[#7E8492]">Suunta</div>
            <div className="font-mono text-[#E0E2E5] text-xs">{device.heading}°</div>
          </div>
        </div>

        {/* Coordinates */}
        <div className="p-2 rounded-sm bg-[#0F1115] border border-[#2A2D35] col-span-2 flex items-center justify-between font-mono">
          <div className="flex items-center gap-1.5 text-[#D4AF37] text-xs">
            <Navigation className="w-3.5 h-3.5 text-[#4ADE80] shrink-0" />
            <span>
              {device.lat.toFixed(4)}, {device.lon.toFixed(4)}
            </span>
          </div>
          <span className="text-[10px] text-[#7E8492] font-sans">
            {device.trail.length} pistettä
          </span>
        </div>
      </div>

      {/* Quick Actions & Forward status */}
      <div className="pt-2 border-t border-[#2A2D35] flex items-center justify-between text-[11px] text-[#7E8492]">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-[#5C6370]" />
            <span>
              {timeAgoSec < 60 ? `${timeAgoSec}s sitten` : `${Math.floor(timeAgoSec / 60)}min sitten`}
            </span>
          </div>
          <button
            id={`btn-bark-test-${device.id}`}
            type="button"
            onClick={handleQuickBark}
            disabled={triggeringBark}
            title="Lähetä IK122T 0x13 haukkupaketti tälle pannalle"
            className="px-1.5 py-0.5 rounded-sm bg-[#2A2D35] hover:bg-[#ea580c]/30 text-[#E0E2E5] hover:text-[#fb923c] border border-[#3F4450] hover:border-[#f97316]/50 text-[10px] font-sans flex items-center gap-1 transition-colors"
          >
            <Volume2 className="w-3 h-3 text-[#f97316]" />
            <span>Haukku</span>
          </button>
        </div>

        {device.lastForwardStatus && (
          <div className="flex items-center gap-1">
            {device.lastForwardStatus.success ? (
              <span className="flex items-center gap-1 text-[#4ADE80] font-mono text-[10px]">
                <CheckCircle2 className="w-3 h-3" />
                200 OK ({device.lastForwardStatus.durationMs}ms)
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[#EF4444] font-mono text-[10px]">
                <AlertCircle className="w-3 h-3" />
                Virhe ({device.lastForwardStatus.status || 'Fail'})
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
