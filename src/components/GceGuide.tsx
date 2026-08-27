import React, { useState } from 'react';
import {
  Server,
  Terminal,
  Shield,
  Smartphone,
  Copy,
  Check,
  Download,
  FileCode,
  CheckCircle2,
  ExternalLink,
  Cpu,
  Zap,
  HelpCircle
} from 'lucide-react';

export const GceGuide: React.FC = () => {
  const [serverIp, setServerIp] = useState('34.88.120.45');
  const [apn, setApn] = useState('internet');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const gcloudFirewallCmd = `gcloud compute firewall-rules create allow-gps-collars \\
    --direction=INGRESS \\
    --priority=1000 \\
    --network=default \\
    --action=ALLOW \\
    --rules=tcp:5013,tcp:5023,tcp:8080 \\
    --source-ranges=0.0.0.0/0 \\
    --description="SinoTrack (5013), ICAR (5023) ja GPS Gateway Web UI (8080)"`;

  const installOneLiner = `curl -fsSL https://raw.githubusercontent.com/eratutka/micro-gps-gateway/main/install.sh | sudo bash`;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Title Card */}
      <div className="p-6 rounded-sm bg-[#181B22] border border-[#2A2D35] shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#D4AF37] font-serif italic text-lg mb-1">
              <Server className="w-5 h-5 text-[#D4AF37]" />
              <span>Google Compute Engine (e2-micro) Asennus ja Koirapantojen Konfigurointi</span>
            </div>
            <p className="text-xs text-[#7E8492] max-w-2xl leading-relaxed">
              Tämä mikropalvelin on optimoitu toimimaan Googlen ilmaisessa <strong className="text-[#E0E2E5]">e2-micro (1 Gt RAM)</strong> virtuaalikoneessa. Muistinkulutus on vain <strong className="text-[#4ADE80]">~15–25 MB RAM</strong>.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 rounded-sm bg-[#0F1115] border border-[#D4AF37]/30 text-[#D4AF37] text-xs font-mono font-medium flex items-center gap-1.5">
              <Cpu className="w-4 h-4" />
              <span>Max 30 MB RAM</span>
            </span>
          </div>
        </div>
      </div>

      {/* Interactive SMS Command Generator */}
      <div className="p-6 rounded-sm bg-[#181B22] border border-[#2A2D35] shadow-2xl">
        <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-[#2A2D35]">
          <div className="w-8 h-8 rounded-sm bg-[#0F1115] border border-[#D4AF37]/30 flex items-center justify-center text-[#D4AF37]">
            <Smartphone className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-serif italic text-[#D4AF37] text-base">
              Koirapannan SMS-komentogeneraattori
            </h3>
            <p className="text-[11px] text-[#7E8492]">
              Syötä GCE-virtuaalipalvelimesi ulkoinen IP-osoite ja kopioi valmiit tekstiviestikomennot
            </p>
          </div>
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5 text-xs">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[#7E8492] mb-1">
              GCE Palvelimen Ulkoinen IP (External IP)
            </label>
            <input
              id="sms-server-ip-input"
              type="text"
              value={serverIp}
              onChange={(e) => setServerIp(e.target.value)}
              placeholder="esim. 34.88.120.45"
              className="w-full px-3 py-2 bg-[#0F1115] border border-[#2A2D35] rounded-sm text-[#D4AF37] font-mono focus:border-[#D4AF37] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[#7E8492] mb-1">
              Pannan SIM-kortin APN (Oletus: internet)
            </label>
            <input
              id="sms-apn-input"
              type="text"
              value={apn}
              onChange={(e) => setApn(e.target.value)}
              placeholder="internet"
              className="w-full px-3 py-2 bg-[#0F1115] border border-[#2A2D35] rounded-sm text-[#E0E2E5] font-mono focus:border-[#D4AF37] focus:outline-none"
            />
          </div>
        </div>

        {/* Commands Side-by-Side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* SinoTrack ST-904L (Port 5013) */}
          <div className="p-4 rounded-sm bg-[#0F1115] border border-[#2A2D35]">
            <div className="flex items-center justify-between mb-2">
              <span className="font-serif italic text-[#D4AF37] text-sm">
                1. SinoTrack ST-904L (Portti 5013)
              </span>
              <span className="text-[9px] text-[#7E8492] font-mono uppercase tracking-wider">ASCII / Text</span>
            </div>
            <p className="text-[11px] text-[#7E8492] mb-3">
              Lähetä nämä SMS-viestit järjestyksessä pannan numeroon:
            </p>

            <div className="space-y-2 text-xs font-mono">
              {/* Step 1 IP */}
              <div className="p-2.5 rounded-sm bg-[#181B22] border border-[#2A2D35] flex items-center justify-between">
                <div>
                  <div className="text-[9px] text-[#7E8492] uppercase tracking-wider">1. IP ja Portti:</div>
                  <div className="text-[#D4AF37] font-bold">{`8030000 ${serverIp || '<IP>'} 5013`}</div>
                </div>
                <button
                  onClick={() => handleCopy(`8030000 ${serverIp} 5013`, 'st-ip')}
                  className="p-1.5 rounded-sm hover:bg-[#20242D] text-[#7E8492] hover:text-[#E0E2E5] transition"
                >
                  {copiedKey === 'st-ip' ? <Check className="w-3.5 h-3.5 text-[#4ADE80]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Step 2 APN */}
              <div className="p-2.5 rounded-sm bg-[#181B22] border border-[#2A2D35] flex items-center justify-between">
                <div>
                  <div className="text-[9px] text-[#7E8492] uppercase tracking-wider">2. APN yhteyspiste:</div>
                  <div className="text-[#E0E2E5]">{`APN000000 ${apn || 'internet'}`}</div>
                </div>
                <button
                  onClick={() => handleCopy(`APN000000 ${apn}`, 'st-apn')}
                  className="p-1.5 rounded-sm hover:bg-[#20242D] text-[#7E8492] hover:text-[#E0E2E5] transition"
                >
                  {copiedKey === 'st-apn' ? <Check className="w-3.5 h-3.5 text-[#4ADE80]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Step 3 GPRS */}
              <div className="p-2.5 rounded-sm bg-[#181B22] border border-[#2A2D35] flex items-center justify-between">
                <div>
                  <div className="text-[9px] text-[#7E8492] uppercase tracking-wider">3. GPRS-tila:</div>
                  <div className="text-[#E0E2E5]">7100000</div>
                </div>
                <button
                  onClick={() => handleCopy('7100000', 'st-gprs')}
                  className="p-1.5 rounded-sm hover:bg-[#20242D] text-[#7E8492] hover:text-[#E0E2E5] transition"
                >
                  {copiedKey === 'st-gprs' ? <Check className="w-3.5 h-3.5 text-[#4ADE80]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Step 4 Interval */}
              <div className="p-2.5 rounded-sm bg-[#181B22] border border-[#2A2D35] flex items-center justify-between">
                <div>
                  <div className="text-[9px] text-[#7E8492] uppercase tracking-wider">4. Päivitysväli (5s):</div>
                  <div className="text-[#E0E2E5]">8050000 5</div>
                </div>
                <button
                  onClick={() => handleCopy('8050000 5', 'st-int')}
                  className="p-1.5 rounded-sm hover:bg-[#20242D] text-[#7E8492] hover:text-[#E0E2E5] transition"
                >
                  {copiedKey === 'st-int' ? <Check className="w-3.5 h-3.5 text-[#4ADE80]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* ICAR IK122T (Port 5023) */}
          <div className="p-4 rounded-sm bg-[#0F1115] border border-[#2A2D35]">
            <div className="flex items-center justify-between mb-2">
              <span className="font-serif italic text-[#93C5FD] text-sm">
                2. ICAR IK122T (Portti 5023)
              </span>
              <span className="text-[9px] text-[#7E8492] font-mono uppercase tracking-wider">GT06 Binääri</span>
            </div>
            <p className="text-[11px] text-[#7E8492] mb-3">
              Lähetä nämä SMS-viestit järjestyksessä pannan numeroon:
            </p>

            <div className="space-y-2 text-xs font-mono">
              {/* Step 1 Server */}
              <div className="p-2.5 rounded-sm bg-[#181B22] border border-[#2A2D35] flex items-center justify-between">
                <div>
                  <div className="text-[9px] text-[#7E8492] uppercase tracking-wider">1. Palvelin ja Portti:</div>
                  <div className="text-[#93C5FD] font-bold">{`SERVER,1,${serverIp || '<IP>'},5023,0#`}</div>
                </div>
                <button
                  onClick={() => handleCopy(`SERVER,1,${serverIp},5023,0#`, 'icar-srv')}
                  className="p-1.5 rounded-sm hover:bg-[#20242D] text-[#7E8492] hover:text-[#E0E2E5] transition"
                >
                  {copiedKey === 'icar-srv' ? <Check className="w-3.5 h-3.5 text-[#4ADE80]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Step 2 APN */}
              <div className="p-2.5 rounded-sm bg-[#181B22] border border-[#2A2D35] flex items-center justify-between">
                <div>
                  <div className="text-[9px] text-[#7E8492] uppercase tracking-wider">2. APN yhteyspiste:</div>
                  <div className="text-[#E0E2E5]">{`APN,${apn || 'internet'}#`}</div>
                </div>
                <button
                  onClick={() => handleCopy(`APN,${apn}#`, 'icar-apn')}
                  className="p-1.5 rounded-sm hover:bg-[#20242D] text-[#7E8492] hover:text-[#E0E2E5] transition"
                >
                  {copiedKey === 'icar-apn' ? <Check className="w-3.5 h-3.5 text-[#4ADE80]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Step 3 Timer */}
              <div className="p-2.5 rounded-sm bg-[#181B22] border border-[#2A2D35] flex items-center justify-between">
                <div>
                  <div className="text-[9px] text-[#7E8492] uppercase tracking-wider">3. Paikannusväli (10s):</div>
                  <div className="text-[#E0E2E5]">TIMER,10#</div>
                </div>
                <button
                  onClick={() => handleCopy('TIMER,10#', 'icar-timer')}
                  className="p-1.5 rounded-sm hover:bg-[#20242D] text-[#7E8492] hover:text-[#E0E2E5] transition"
                >
                  {copiedKey === 'icar-timer' ? <Check className="w-3.5 h-3.5 text-[#4ADE80]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Step 4 Bark Alarm (IK122T Pro) */}
              <div className="p-2.5 rounded-sm bg-[#1e1710] border border-[#f97316]/40 flex items-center justify-between">
                <div>
                  <div className="text-[9px] text-[#fb923c] uppercase tracking-wider font-bold">4. Haukunilmaisin (IK122T Pro):</div>
                  <div className="text-[#fed7aa] font-bold">VIBALM,1#</div>
                  <div className="text-[10px] text-[#fdba74]/70 font-sans mt-0.5">Aktivoi haukku-/tärinähälytykset (0x13 GT06)</div>
                </div>
                <button
                  onClick={() => handleCopy('VIBALM,1#', 'icar-bark')}
                  className="p-1.5 rounded-sm hover:bg-[#20242D] text-[#fb923c] hover:text-white transition"
                >
                  {copiedKey === 'icar-bark' ? <Check className="w-3.5 h-3.5 text-[#4ADE80]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Step 5 Param */}
              <div className="p-2.5 rounded-sm bg-[#181B22] border border-[#2A2D35] flex items-center justify-between">
                <div>
                  <div className="text-[9px] text-[#7E8492] uppercase tracking-wider">5. Tilan tarkistus:</div>
                  <div className="text-[#E0E2E5]">PARAM#</div>
                </div>
                <button
                  onClick={() => handleCopy('PARAM#', 'icar-param')}
                  className="p-1.5 rounded-sm hover:bg-[#20242D] text-[#7E8492] hover:text-[#E0E2E5] transition"
                >
                  {copiedKey === 'icar-param' ? <Check className="w-3.5 h-3.5 text-[#4ADE80]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Step-by-Step GCE Installation */}
      <div className="p-6 rounded-sm bg-[#181B22] border border-[#2A2D35] shadow-2xl space-y-5">
        <h3 className="font-serif italic text-[#D4AF37] text-base flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[#D4AF37]" />
          <span>Palvelimen Asennusvaiheet (Google Cloud Compute Engine)</span>
        </h3>

        {/* Step 1: Firewall */}
        <div className="p-4 rounded-sm bg-[#0F1115] border border-[#2A2D35] space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-xs text-[#E0E2E5]">
              Vaihe 1: Avaa GCP VPC Palomuuri (Google Cloud Shellissä tai GCP Konsolissa)
            </span>
            <button
              onClick={() => handleCopy(gcloudFirewallCmd, 'fw-cmd')}
              className="px-2.5 py-1 rounded-sm bg-[#181B22] hover:bg-[#20242D] border border-[#2A2D35] text-[#E0E2E5] text-xs flex items-center gap-1.5 transition"
            >
              {copiedKey === 'fw-cmd' ? <Check className="w-3.5 h-3.5 text-[#4ADE80]" /> : <Copy className="w-3.5 h-3.5" />}
              <span>Kopioi gcloud-komento</span>
            </button>
          </div>
          <p className="text-[11px] text-[#7E8492]">
            💡 <em>Huom:</em> Aja tämä komento <strong>Google Cloud Shellissä</strong> (GCP Konsolin yläkulman <code className="text-[#D4AF37]">&gt;_</code> pääte) tai luo sääntö GCP Konsolin <strong>VPC-verkko &gt; Palomuurit</strong> -sivulta. (Virtuaalikoneen omalla oletustilillä ei ole oikeutta muokata projektin palomuuria).
          </p>
          <pre className="p-2.5 rounded-sm bg-[#08090C] border border-[#2A2D35] text-[11px] text-[#E0E2E5] font-mono overflow-x-auto">
            {gcloudFirewallCmd}
          </pre>
        </div>

        {/* Step 2: One-liner install */}
        <div className="p-4 rounded-sm bg-[#0F1115] border border-[#2A2D35] space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-xs text-[#E0E2E5]">
              Vaihe 2: Aja asennus virtuaalikoneella (SSH)
            </span>
            <button
              onClick={() => handleCopy(installOneLiner, 'install-cmd')}
              className="px-2.5 py-1 rounded-sm bg-[#181B22] hover:bg-[#20242D] border border-[#2A2D35] text-[#E0E2E5] text-xs flex items-center gap-1.5 transition"
            >
              {copiedKey === 'install-cmd' ? <Check className="w-3.5 h-3.5 text-[#4ADE80]" /> : <Copy className="w-3.5 h-3.5" />}
              <span>Kopioi asennuskomento</span>
            </button>
          </div>
          <pre className="p-2.5 rounded-sm bg-[#08090C] border border-[#2A2D35] text-[11px] text-[#4ADE80] font-mono overflow-x-auto">
            {installOneLiner}
          </pre>
        </div>

        {/* Step 3: Commands */}
        <div className="p-4 rounded-sm bg-[#0F1115] border border-[#2A2D35] space-y-2">
          <span className="font-medium text-xs text-[#E0E2E5]">
            Vaihe 3: Hyödylliset hallintakomennot palvelimella
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono text-[#E0E2E5]">
            <div className="p-2.5 rounded-sm bg-[#181B22] border border-[#2A2D35]">
              <div className="text-[9px] text-[#7E8492] uppercase tracking-wider">Tarkista palvelun tila:</div>
              <div className="text-[#4ADE80]">sudo systemctl status eratutka-gateway</div>
            </div>
            <div className="p-2.5 rounded-sm bg-[#181B22] border border-[#2A2D35]">
              <div className="text-[9px] text-[#7E8492] uppercase tracking-wider">Reaaliaikaiset lokit:</div>
              <div className="text-[#93C5FD]">sudo journalctl -u eratutka-gateway -f</div>
            </div>
            <div className="p-2.5 rounded-sm bg-[#181B22] border border-[#2A2D35]">
              <div className="text-[9px] text-[#7E8492] uppercase tracking-wider">Käynnistä uudelleen:</div>
              <div className="text-[#D4AF37]">sudo systemctl restart eratutka-gateway</div>
            </div>
            <div className="p-2.5 rounded-sm bg-[#181B22] border border-[#2A2D35]">
              <div className="text-[9px] text-[#7E8492] uppercase tracking-wider">Muokkaa asetuksia:</div>
              <div className="text-[#E0E2E5]">sudo nano /opt/eratutka-gateway/.env</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
