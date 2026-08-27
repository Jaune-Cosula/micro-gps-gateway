import React, { useState } from 'react';
import {
  Send,
  Radio,
  Play,
  Square,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Clock,
  Compass,
  Gauge,
  Battery,
  Navigation,
  FileCode,
  Zap
} from 'lucide-react';
import { ForwardResult } from '../types';

interface TestSuiteProps {
  eratutkaUrl: string;
  isSimulating: boolean;
  onToggleLiveDogSimulation: () => void;
  onRefreshDevices: () => void;
}

export const TestSuite: React.FC<TestSuiteProps> = ({
  eratutkaUrl,
  isSimulating,
  onToggleLiveDogSimulation,
  onRefreshDevices
}) => {
  // Manual Test State
  const [manualId, setManualId] = useState('7026216737');
  const [manualLat, setManualLat] = useState('60.85214');
  const [manualLon, setManualLon] = useState('25.68142');
  const [manualSpeed, setManualSpeed] = useState('12.4');
  const [manualBattery, setManualBattery] = useState('92');
  const [manualHeading, setManualHeading] = useState('45');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<ForwardResult | null>(null);

  // SinoTrack Sim State
  const [stLoading, setStLoading] = useState(false);
  const [stResult, setStResult] = useState<any>(null);

  // ICAR Sim State
  const [icarLoading, setIcarLoading] = useState(false);
  const [icarResult, setIcarResult] = useState<any>(null);

  // Presets in Finland
  const setLocationPreset = (name: string, lat: number, lon: number) => {
    setManualLat(lat.toString());
    setManualLon(lon.toString());
  };

  const handleManualSend = async () => {
    setManualLoading(true);
    setManualResult(null);
    try {
      const res = await fetch('/api/forward-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: manualId,
          lat: parseFloat(manualLat),
          lon: parseFloat(manualLon),
          speed: parseFloat(manualSpeed),
          battery: parseInt(manualBattery, 10),
          heading: parseInt(manualHeading, 10),
          targetUrl: eratutkaUrl
        })
      });
      const data = await res.json();
      setManualResult(data.result || data);
      onRefreshDevices();
    } catch (err: any) {
      setManualResult({
        id: manualId,
        success: false,
        durationMs: 0,
        error: err.message,
        timestamp: Date.now(),
        targetUrl: eratutkaUrl,
        payload: {
          id: manualId,
          lat: parseFloat(manualLat),
          lon: parseFloat(manualLon),
          speed: parseFloat(manualSpeed),
          battery: parseInt(manualBattery, 10),
          heading: parseInt(manualHeading, 10),
          timestamp: Date.now()
        }
      });
    } finally {
      setManualLoading(false);
    }
  };

  const handleSimulateSinoTrack = async () => {
    setStLoading(true);
    try {
      const res = await fetch('/api/simulate/sinotrack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '7026216737',
          lat: parseFloat(manualLat) + (Math.random() - 0.5) * 0.005,
          lon: parseFloat(manualLon) + (Math.random() - 0.5) * 0.005,
          speed: 14.2,
          heading: 65,
          battery: 94
        })
      });
      const data = await res.json();
      setStResult(data);
      onRefreshDevices();
    } catch (err: any) {
      setStResult({ error: err.message });
    } finally {
      setStLoading(false);
    }
  };

  const handleSimulateIcar = async () => {
    setIcarLoading(true);
    try {
      const res = await fetch('/api/simulate/icar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '868120394857211',
          lat: parseFloat(manualLat) + (Math.random() - 0.5) * 0.005,
          lon: parseFloat(manualLon) + (Math.random() - 0.5) * 0.005,
          speed: 18.5,
          heading: 130,
          battery: 89
        })
      });
      const data = await res.json();
      setIcarResult(data);
      onRefreshDevices();
    } catch (err: any) {
      setIcarResult({ error: err.message });
    } finally {
      setIcarLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Overview Banner */}
      <div className="p-5 rounded-sm bg-[#181B22] border border-[#2A2D35] shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[#D4AF37] font-serif italic text-lg mb-1">
            <Sparkles className="w-5 h-5 text-[#D4AF37]" />
            <span>Erätutka Rajapinnan Testaus- ja Simulaattorityökalut</span>
          </div>
          <p className="text-xs text-[#7E8492] max-w-2xl leading-relaxed">
            Testaa koordinaattien suoraa HTTPS POST -lähetystä Erätutkaan tai simuloi aitoja SinoTrack ST-904L (ASCII) ja ICAR IK122T (GT06 binääri) TCP-paketteja.
          </p>
        </div>

        {/* Live Dog Simulation Button */}
        <button
          id="testsuite-sim-dog-btn"
          onClick={onToggleLiveDogSimulation}
          className={`px-5 py-3 rounded-sm font-medium text-xs shadow-xl flex items-center gap-2.5 transition whitespace-nowrap ${
            isSimulating
              ? 'bg-[#181B22] border border-rose-500/50 text-rose-300 hover:bg-rose-500/20'
              : 'bg-[#D4AF37] hover:bg-[#E5C158] text-[#0F1115] font-semibold'
          }`}
        >
          {isSimulating ? (
            <>
              <Square className="w-4 h-4 text-rose-400" />
              <span>Pysäytä Koiran Seurantasimulaatio</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Käynnistä Koiran Seurantasimulaatio (4s välein)</span>
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* SECTION 1: Manuaalinen Erätutka-testi (7 cols) */}
        <div className="lg:col-span-7 p-5 rounded-sm bg-[#181B22] border border-[#2A2D35] shadow-2xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#2A2D35]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-sm bg-[#0F1115] border border-[#D4AF37]/30 flex items-center justify-center text-[#D4AF37]">
                  <Send className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-serif italic text-[#D4AF37] text-base">
                    Manuaalinen Testilähetys Erätutkaan
                  </h3>
                  <p className="text-[11px] text-[#7E8492]">
                    Lähettää syötetyt koordinaatit suoraan Erätutkan HTTPS POST -rajapintaan
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Location Presets */}
            <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[#7E8492] text-[11px] mr-1">Pikasijainnit:</span>
              <button
                type="button"
                onClick={() => setLocationPreset('Heinola', 60.85214, 25.68142)}
                className="px-2.5 py-1 rounded-sm bg-[#0F1115] hover:bg-[#20242D] border border-[#2A2D35] text-[#E0E2E5] text-[11px] transition"
              >
                🌲 Heinola (Metsä)
              </button>
              <button
                type="button"
                onClick={() => setLocationPreset('Kainuu', 64.22510, 27.72890)}
                className="px-2.5 py-1 rounded-sm bg-[#0F1115] hover:bg-[#20242D] border border-[#2A2D35] text-[#E0E2E5] text-[11px] transition"
              >
                🦌 Kainuu (Hirvialue)
              </button>
              <button
                type="button"
                onClick={() => setLocationPreset('Lappi', 67.41250, 26.58410)}
                className="px-2.5 py-1 rounded-sm bg-[#0F1115] hover:bg-[#20242D] border border-[#2A2D35] text-[#E0E2E5] text-[11px] transition"
              >
                ❄️ Lappi (Sodankylä)
              </button>
            </div>

            {/* Form Inputs Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs mb-4">
              {/* ID */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[#7E8492] mb-1">
                  Laite-ID / IMEI
                </label>
                <input
                  id="manual-test-id"
                  type="text"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0F1115] border border-[#2A2D35] rounded-sm text-[#E0E2E5] font-mono focus:border-[#D4AF37] focus:outline-none"
                  placeholder="7026216737"
                />
              </div>

              {/* Akku */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[#7E8492] mb-1">
                  Akun varaus (%)
                </label>
                <div className="relative">
                  <input
                    id="manual-test-battery"
                    type="number"
                    min="0"
                    max="100"
                    value={manualBattery}
                    onChange={(e) => setManualBattery(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0F1115] border border-[#2A2D35] rounded-sm text-[#E0E2E5] font-mono focus:border-[#D4AF37] focus:outline-none"
                  />
                  <span className="absolute right-3 top-2 text-[#5C6370]">%</span>
                </div>
              </div>

              {/* Latitude */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[#7E8492] mb-1">
                  Leveysaste (Latitude WGS84)
                </label>
                <input
                  id="manual-test-lat"
                  type="text"
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0F1115] border border-[#2A2D35] rounded-sm text-[#E0E2E5] font-mono focus:border-[#D4AF37] focus:outline-none"
                  placeholder="60.85214"
                />
              </div>

              {/* Longitude */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[#7E8492] mb-1">
                  Pituusaste (Longitude WGS84)
                </label>
                <input
                  id="manual-test-lon"
                  type="text"
                  value={manualLon}
                  onChange={(e) => setManualLon(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0F1115] border border-[#2A2D35] rounded-sm text-[#E0E2E5] font-mono focus:border-[#D4AF37] focus:outline-none"
                  placeholder="25.68142"
                />
              </div>

              {/* Speed */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[#7E8492] mb-1">
                  Nopeus (km/h)
                </label>
                <input
                  id="manual-test-speed"
                  type="number"
                  step="0.1"
                  value={manualSpeed}
                  onChange={(e) => setManualSpeed(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0F1115] border border-[#2A2D35] rounded-sm text-[#E0E2E5] font-mono focus:border-[#D4AF37] focus:outline-none"
                />
              </div>

              {/* Heading */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[#7E8492] mb-1">
                  Suuntakulma (0-360°)
                </label>
                <input
                  id="manual-test-heading"
                  type="number"
                  min="0"
                  max="360"
                  value={manualHeading}
                  onChange={(e) => setManualHeading(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0F1115] border border-[#2A2D35] rounded-sm text-[#E0E2E5] font-mono focus:border-[#D4AF37] focus:outline-none"
                />
              </div>
            </div>

            {/* Target URL indicator */}
            <div className="mb-4 p-2.5 rounded-sm bg-[#0F1115] border border-[#2A2D35] text-[11px] font-mono text-[#7E8492] flex items-center justify-between">
              <span className="text-[#5C6370] uppercase tracking-wider text-[9px]">Kohde:</span>
              <span className="text-[#D4AF37] truncate max-w-xs">{eratutkaUrl}</span>
            </div>
          </div>

          <div>
            <button
              id="send-manual-test-btn"
              onClick={handleManualSend}
              disabled={manualLoading}
              className="w-full py-2.5 rounded-sm bg-[#D4AF37] hover:bg-[#E5C158] text-[#0F1115] font-semibold text-xs transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {manualLoading ? (
                <span>Lähetetään Erätutkaan...</span>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Lähetä testipiste Erätutkaan</span>
                </>
              )}
            </button>

            {/* Result Box */}
            {manualResult && (
              <div
                className={`mt-4 p-3.5 rounded-sm border text-xs ${
                  manualResult.success
                    ? 'bg-[#0F1115] border-[#4ADE80]/40 text-[#4ADE80]'
                    : 'bg-[#0F1115] border-rose-500/40 text-rose-300'
                }`}
              >
                <div className="flex items-center justify-between font-semibold mb-1.5">
                  <div className="flex items-center gap-1.5">
                    {manualResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-[#4ADE80]" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-400" />
                    )}
                    <span>
                      {manualResult.success
                        ? `Välitys onnistui! [HTTP ${manualResult.status} OK]`
                        : `Välitys epäonnistui [HTTP ${manualResult.status || 'Fail'}]`}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] opacity-80">
                    {manualResult.durationMs} ms
                  </span>
                </div>

                {manualResult.error && (
                  <div className="text-[11px] text-rose-400 mb-2">
                    Virhe: {manualResult.error}
                  </div>
                )}

                <div className="text-[9px] uppercase tracking-wider text-[#7E8492] mb-1">
                  Lähetetty JSON-runko:
                </div>
                <pre className="p-2.5 rounded-sm bg-[#08090C] border border-[#2A2D35] text-[11px] text-[#E0E2E5] overflow-x-auto font-mono">
                  {JSON.stringify(manualResult.payload, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* SECTION 2: Protocol Generators (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          
          {/* SinoTrack ST-904L Generator */}
          <div className="p-5 rounded-sm bg-[#181B22] border border-[#2A2D35] shadow-2xl">
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="w-7 h-7 rounded-sm bg-[#0F1115] border border-[#D4AF37]/30 flex items-center justify-center text-[#D4AF37] font-bold text-xs font-mono">
                ST
              </div>
              <div>
                <h4 className="font-serif italic text-[#D4AF37] text-base">
                  SinoTrack ST-904L Simulaattori
                </h4>
                <p className="text-[11px] text-[#7E8492]">Portti 5013 (ASCII HQ -protokolla)</p>
              </div>
            </div>

            <p className="text-xs text-[#7E8492] mb-3.5 leading-relaxed">
              Generoi aidon ASCII-muotoisen paketin (DDMM.MMMM -koordinaateilla) ja ajaa sen mikropalvelimen SinoTrack-jäsentimen läpi.
            </p>

            <button
              id="sim-sinotrack-btn"
              onClick={handleSimulateSinoTrack}
              disabled={stLoading}
              className="w-full py-2 px-3 rounded-sm bg-[#0F1115] hover:bg-[#20242D] border border-[#2A2D35] text-[#D4AF37] font-medium text-xs transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>Simuloi SinoTrack ST-904L Raakapaketti</span>
            </button>

            {stResult && (
              <div className="mt-3 p-2.5 rounded-sm bg-[#08090C] border border-[#2A2D35] text-[11px] font-mono text-[#E0E2E5]">
                <div className="text-[#4ADE80] font-semibold mb-1">Paketti käsitelty ja välitetty:</div>
                <div className="truncate text-[#7E8492]">Tulos: 200 OK</div>
              </div>
            )}
          </div>

          {/* ICAR IK122T Generator */}
          <div className="p-5 rounded-sm bg-[#181B22] border border-[#2A2D35] shadow-2xl">
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="w-7 h-7 rounded-sm bg-[#0F1115] border border-[#93C5FD]/30 flex items-center justify-center text-[#93C5FD] font-bold text-xs font-mono">
                ICAR
              </div>
              <div>
                <h4 className="font-serif italic text-[#93C5FD] text-base">
                  ICAR IK122T (GT06) Simulaattori
                </h4>
                <p className="text-[11px] text-[#7E8492]">Portti 5023 (GT06 Binääriprotokolla)</p>
              </div>
            </div>

            <p className="text-xs text-[#7E8492] mb-3.5 leading-relaxed">
              Luo GT06 0x12 binääripaketin, laskee CRC16-tarkistussumman, parsii WGS84-pisteen ja lähettää Erätutkaan.
            </p>

            <button
              id="sim-icar-btn"
              onClick={handleSimulateIcar}
              disabled={icarLoading}
              className="w-full py-2 px-3 rounded-sm bg-[#0F1115] hover:bg-[#20242D] border border-[#2A2D35] text-[#93C5FD] font-medium text-xs transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5 text-[#93C5FD]" />
              <span>Simuloi ICAR IK122T GT06 Binääripaketti</span>
            </button>

            {icarResult && (
              <div className="mt-3 p-2.5 rounded-sm bg-[#08090C] border border-[#2A2D35] text-[11px] font-mono text-[#E0E2E5]">
                <div className="text-[#4ADE80] font-semibold mb-1">Binääripaketti käsitelty ja kuitattu:</div>
                <div className="truncate text-[#7E8492]">Tulos: 200 OK</div>
              </div>
            )}
          </div>

          {/* IK122T Pro Haukunilmaisin Testaus */}
          <div className="p-5 rounded-sm bg-[#1e1710] border border-[#f97316]/40 shadow-2xl">
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="w-7 h-7 rounded-sm bg-[#ea580c]/20 border border-[#f97316]/50 flex items-center justify-center text-[#fb923c] font-bold text-xs font-mono">
                🔔
              </div>
              <div>
                <h4 className="font-serif italic text-[#fb923c] text-base">
                  IK122T Pro Haukunilmaisin (GT06 0x13)
                </h4>
                <p className="text-[11px] text-[#fdba74]/70">Haukku-/tärinähälytyksen ja tiheyden simulointi</p>
              </div>
            </div>

            <p className="text-xs text-[#fed7aa]/80 mb-3.5 leading-relaxed">
              Testaa GT06 0x13/0x26 Status/Alarm -pakettien tunnistusta, liukuvaa 60s haukkutiheyden laskentaa (haukkua/min) ja välitystä Erätutkaan.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                id="sim-single-bark-btn"
                type="button"
                onClick={async () => {
                  await fetch('/api/simulate/bark', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: manualId, burst: false })
                  });
                  onRefreshDevices();
                }}
                className="py-2 px-3 rounded-sm bg-[#ea580c]/20 hover:bg-[#ea580c]/35 border border-[#f97316]/60 text-[#fed7aa] font-medium text-xs transition flex items-center justify-center gap-1.5"
              >
                <span>🔔 Yksittäinen Haukku (0x13)</span>
              </button>

              <button
                id="sim-bark-burst-btn"
                type="button"
                onClick={async () => {
                  await fetch('/api/simulate/bark', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: manualId, burst: true, duration: 30, targetBpm: 78 })
                  });
                  onRefreshDevices();
                }}
                className="py-2 px-3 rounded-sm bg-[#ea580c] hover:bg-[#c2410c] text-[#ffffff] font-semibold text-xs transition flex items-center justify-center gap-1.5 shadow"
              >
                <span>📢 30s Sarja (78/min)</span>
              </button>
            </div>

            <button
              id="stop-bark-burst-btn"
              type="button"
              onClick={async () => {
                await fetch('/api/simulate/bark/stop', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: manualId })
                });
                onRefreshDevices();
              }}
              className="mt-2 w-full py-1.5 px-3 rounded-sm bg-[#0F1115] hover:bg-[#20242D] border border-[#2A2D35] text-[#7E8492] hover:text-[#E0E2E5] text-[11px] transition"
            >
              Pysäytä haukkusarja
            </button>
          </div>

        </div>

      </div>
    </div>
  );
};
