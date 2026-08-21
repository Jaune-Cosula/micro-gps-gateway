import React, { useState } from 'react';
import {
  Settings,
  Save,
  CheckCircle2,
  AlertCircle,
  Radio,
  Server,
  ToggleLeft,
  ToggleRight,
  Send,
  RotateCcw
} from 'lucide-react';
import { ServerConfig } from '../types';

interface SettingsModalProps {
  config: ServerConfig;
  onSaveConfig: (newConfig: Partial<ServerConfig>) => Promise<void>;
  onClose?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  config,
  onSaveConfig,
  onClose
}) => {
  const [eratutkaUrl, setEratutkaUrl] = useState(config.eratutkaUrl);
  const [forwardingEnabled, setForwardingEnabled] = useState(config.forwardingEnabled);
  const [logRawPackets, setLogRawPackets] = useState(config.logRawPackets);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleResetDefault = () => {
    setEratutkaUrl(
      'https://ais-pre-ih3r3aegkvykcunl6ox36r-471959473114.europe-west2.run.app/api/gps/update'
    );
    setForwardingEnabled(true);
    setLogRawPackets(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedSuccess(false);
    try {
      await onSaveConfig({
        eratutkaUrl,
        forwardingEnabled,
        logRawPackets
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch {
      // handled
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <div className="p-6 rounded-sm bg-[#181B22] border border-[#2A2D35] shadow-2xl">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[#2A2D35]">
          <div className="w-9 h-9 rounded-sm bg-[#0F1115] border border-[#D4AF37]/30 flex items-center justify-center text-[#D4AF37]">
            <Settings className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <div>
            <h2 className="text-lg font-serif italic text-[#D4AF37]">
              Gateway Asetukset & Erätutka-rajapinta
            </h2>
            <p className="text-xs text-[#7E8492]">
              Määritä Erätutkan vastaanottava HTTPS POST -osoite ja palvelinasetukset
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-5 text-xs">
          
          {/* Target Erätutka URL */}
          <div className="space-y-1.5">
            <label className="block text-[10px] uppercase tracking-wider text-[#7E8492]">
              Erätutka Forwarding URL (HTTPS POST)
            </label>
            <input
              id="settings-eratutka-url"
              type="text"
              value={eratutkaUrl}
              onChange={(e) => setEratutkaUrl(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#0F1115] border border-[#2A2D35] rounded-sm text-[#D4AF37] font-mono text-xs focus:border-[#D4AF37] focus:outline-none"
              placeholder="https://..."
              required
            />
            <p className="text-[11px] text-[#7E8492]">
              Palvelin lähettää tähän osoitteeseen JSON-muodossa: <code className="text-[#E0E2E5] font-mono">{"{ id, lat, lon, speed, battery, heading, timestamp }"}</code>
            </p>
          </div>

          {/* Toggle Forwarding */}
          <div className="p-4 rounded-sm bg-[#0F1115] border border-[#2A2D35] flex items-center justify-between">
            <div>
              <div className="font-serif italic text-[#E0E2E5] text-sm">
                Automaattinen Edelleenlähetys Erätutkaan
              </div>
              <div className="text-[11px] text-[#7E8492]">
                Välitä saapuvat validit GPS-paketit välittömästi Erätutka-palveluun
              </div>
            </div>
            <button
              id="toggle-forwarding-active"
              type="button"
              onClick={() => setForwardingEnabled(!forwardingEnabled)}
              className={`p-1.5 rounded-sm border transition ${
                forwardingEnabled
                  ? 'bg-[#181B22] border-[#D4AF37]/40 text-[#D4AF37]'
                  : 'bg-[#181B22] border-[#2A2D35] text-[#5C6370]'
              }`}
            >
              {forwardingEnabled ? (
                <ToggleRight className="w-7 h-7 text-[#D4AF37]" />
              ) : (
                <ToggleLeft className="w-7 h-7 text-[#5C6370]" />
              )}
            </button>
          </div>

          {/* Ports info (Read-only / info) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="p-3.5 rounded-sm bg-[#0F1115] border border-[#2A2D35]">
              <div className="text-[9px] text-[#7E8492] uppercase tracking-wider font-mono">SinoTrack ST-904L TCP Portti</div>
              <div className="font-bold text-[#D4AF37] font-mono text-base mt-0.5">5013</div>
              <div className="text-[10px] text-[#7E8492] mt-1">ASCII / Text HQ-protokolla</div>
            </div>

            <div className="p-3.5 rounded-sm bg-[#0F1115] border border-[#2A2D35]">
              <div className="text-[9px] text-[#7E8492] uppercase tracking-wider font-mono">ICAR IK122T TCP Portti</div>
              <div className="font-bold text-[#93C5FD] font-mono text-base mt-0.5">5023</div>
              <div className="text-[10px] text-[#7E8492] mt-1">GT06 / H02 Binääriprotokolla</div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-[#2A2D35] flex items-center justify-between">
            <button
              type="button"
              onClick={handleResetDefault}
              className="px-3.5 py-2 rounded-sm bg-[#0F1115] hover:bg-[#20242D] border border-[#2A2D35] text-[#E0E2E5] text-xs flex items-center gap-1.5 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Palauta oletukset</span>
            </button>

            <button
              id="save-settings-btn"
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-sm bg-[#D4AF37] hover:bg-[#E5C158] text-[#0F1115] font-semibold text-xs transition flex items-center gap-2 disabled:opacity-50"
            >
              {savedSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-[#0F1115]" />
                  <span>Tallennettu!</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Tallenna Asetukset</span>
                </>
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
