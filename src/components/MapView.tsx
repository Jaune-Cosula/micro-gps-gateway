import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Navigation,
  Compass,
  Gauge,
  Battery,
  MapPin,
  Layers,
  Crosshair,
  Play,
  Square,
  Sparkles,
  ExternalLink
} from 'lucide-react';
import { DeviceState } from '../types';
import { DeviceCard } from './DeviceCard';

interface MapViewProps {
  devices: DeviceState[];
  selectedDevice: DeviceState | null;
  onSelectDevice: (device: DeviceState) => void;
  isSimulating: boolean;
  onToggleSimulation: () => void;
  eratutkaUrl: string;
}

export const MapView: React.FC<MapViewProps> = ({
  devices,
  selectedDevice,
  onSelectDevice,
  isSimulating,
  onToggleSimulation,
  eratutkaUrl
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const polylinesRef = useRef<Map<string, L.Polyline>>(new Map());
  const [autoFollow, setAutoFollow] = useState(true);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Default center in Finland (e.g. Heinola / Lahti forest)
    const initialLat = selectedDevice?.lat || 60.85214;
    const initialLon = selectedDevice?.lon || 25.68142;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLon],
      zoom: 14,
      zoomControl: true,
    });

    // Dark-styled OpenStreetMap tile layer (CartoDB Dark Matter or standard OSM)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Markers and Polyline Trails when devices change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    devices.forEach((dev) => {
      const isSelected = selectedDevice?.id === dev.id;
      const isOnline = Date.now() - dev.lastSeen < 180000;

      // Custom HTML Marker with dog icon and rotating direction pointer
      const customIcon = L.divIcon({
        className: 'custom-collar-marker',
        html: `
          <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
            ${
              isOnline
                ? '<div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background: rgba(74, 222, 128, 0.2); animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>'
                : ''
            }
            <div style="position: relative; width: 34px; height: 34px; border-radius: 50%; background: ${
              isSelected ? '#181B22' : '#0F1115'
            }; border: 2px solid ${
          isSelected ? '#D4AF37' : '#4ADE80'
        }; box-shadow: 0 4px 16px rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; color: white; font-size: 16px;">
              🐕
              <div style="position: absolute; top: -6px; right: -6px; width: 15px; height: 15px; border-radius: 50%; background: #D4AF37; border: 1.5px solid #0F1115; display: flex; align-items: center; justify-content: center; transform: rotate(${
                dev.heading
              }deg); transition: transform 0.3s;">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="#0F1115"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
              </div>
            </div>
            <div style="position: absolute; bottom: -18px; white-space: nowrap; background: rgba(15, 17, 21, 0.95); color: #E0E2E5; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 2px; border: 1px solid #2A2D35; pointer-events: none; font-family: monospace;">
              ${dev.name || dev.id} (${dev.speed} km/h)
            </div>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });

      // Update or create marker
      let marker = markersRef.current.get(dev.id);
      if (!marker) {
        marker = L.marker([dev.lat, dev.lon], { icon: customIcon }).addTo(map);
        marker.on('click', () => onSelectDevice(dev));
        markersRef.current.set(dev.id, marker);
      } else {
        marker.setLatLng([dev.lat, dev.lon]);
        marker.setIcon(customIcon);
      }

      // Update or create trail polyline
      if (dev.trail && dev.trail.length > 1) {
        const latLngs = dev.trail.map((t) => [t.lat, t.lon] as [number, number]);
        let polyline = polylinesRef.current.get(dev.id);
        if (!polyline) {
          polyline = L.polyline(latLngs, {
            color: isSelected ? '#D4AF37' : '#4ADE80',
            weight: 2.5,
            opacity: 0.8,
            dashArray: '4, 6',
          }).addTo(map);
          polylinesRef.current.set(dev.id, polyline);
        } else {
          polyline.setLatLngs(latLngs);
          polyline.setStyle({
            color: isSelected ? '#D4AF37' : '#4ADE80',
          });
        }
      }
    });

    // Auto-center on selected device if auto-follow enabled
    if (autoFollow && selectedDevice) {
      map.panTo([selectedDevice.lat, selectedDevice.lon], { animate: true });
    }
  }, [devices, selectedDevice, autoFollow, onSelectDevice]);

  const handleCenterOnDog = () => {
    if (!mapInstanceRef.current || !selectedDevice) return;
    mapInstanceRef.current.setView([selectedDevice.lat, selectedDevice.lon], 15, { animate: true });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-160px)] min-h-[580px]">
      {/* Map Canvas (8 cols on desktop) */}
      <div className="lg:col-span-8 flex flex-col bg-[#181B22] border border-[#2A2D35] rounded-sm overflow-hidden shadow-2xl relative">
        {/* Map Container */}
        <div id="leaflet-map-stage" ref={mapContainerRef} className="w-full h-full min-h-[400px] z-10" />

        {/* Floating Quick Action Overlay on Map */}
        <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
          <button
            id="center-dog-btn"
            onClick={handleCenterOnDog}
            className="p-2.5 bg-[#181B22]/95 hover:bg-[#20242D] border border-[#2A2D35] rounded-sm text-[#E0E2E5] hover:text-white shadow-xl backdrop-blur flex items-center gap-2 text-xs font-medium transition"
            title="Keskitä valittuun koiraan"
          >
            <Crosshair className="w-4 h-4 text-[#D4AF37]" />
            <span>Keskitä</span>
          </button>

          <button
            id="toggle-autofollow-btn"
            onClick={() => setAutoFollow(!autoFollow)}
            className={`p-2.5 border rounded-sm shadow-xl backdrop-blur flex items-center gap-2 text-xs font-medium transition ${
              autoFollow
                ? 'bg-[#181B22]/95 border-[#D4AF37] text-[#D4AF37]'
                : 'bg-[#181B22]/95 border-[#2A2D35] text-[#7E8492]'
            }`}
            title="Automaattinen kameran seuranta"
          >
            <Navigation className="w-4 h-4" />
            <span>{autoFollow ? 'Seuraa: Päällä' : 'Seuraa: Pois'}</span>
          </button>

          <button
            id="map-sim-toggle-btn"
            onClick={onToggleSimulation}
            className={`p-2.5 border rounded-sm shadow-xl backdrop-blur flex items-center gap-2 text-xs font-medium transition ${
              isSimulating
                ? 'bg-[#181B22] border-rose-500/50 text-rose-300 hover:bg-rose-500/20'
                : 'bg-[#D4AF37] text-[#0F1115] border-[#D4AF37] hover:bg-[#E5C158]'
            }`}
          >
            {isSimulating ? (
              <>
                <Square className="w-4 h-4 text-rose-400" />
                <span>Pysäytä Simulaatio</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Simuloi Maastoa</span>
              </>
            )}
          </button>
        </div>

        {/* Bottom Banner: Forward Target Info */}
        <div className="absolute bottom-3 left-3 right-3 z-20 p-2.5 bg-[#0F1115]/95 backdrop-blur border border-[#2A2D35] rounded-sm text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[#7E8492]">
          <div className="flex items-center gap-2 truncate">
            <div className="w-2 h-2 rounded-full bg-[#4ADE80] animate-pulse shrink-0" />
            <span className="text-[#7E8492]">Erätutka kohderajapinta:</span>
            <span className="font-mono text-[#D4AF37] text-[11px] truncate max-w-md">
              {eratutkaUrl}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0 text-[#7E8492] text-[11px]">
            <span>TCP 5013 (SinoTrack)</span>
            <span>•</span>
            <span>TCP 5023 (ICAR GT06)</span>
          </div>
        </div>
      </div>

      {/* Side Panel: Active Collars List & Telemetry (4 cols on desktop) */}
      <div className="lg:col-span-4 flex flex-col gap-3 overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-serif italic text-[#D4AF37]">
              Yhteydessä olevat koirat ({devices.length})
            </h2>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-[#7E8492]">
            Reaaliaikainen
          </span>
        </div>

        {/* Collars List */}
        <div className="flex flex-col gap-2.5">
          {devices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              isSelected={selectedDevice?.id === device.id}
              onSelect={onSelectDevice}
            />
          ))}

          {devices.length === 0 && (
            <div className="p-8 text-center bg-[#181B22] border border-[#2A2D35] rounded-sm text-[#7E8492] text-xs flex flex-col items-center gap-3">
              <MapPin className="w-8 h-8 text-[#5C6370] animate-bounce" />
              <div>Ei pantoja vielä yhdistettynä.</div>
              <button
                onClick={onToggleSimulation}
                className="px-3.5 py-1.5 rounded-sm bg-[#D4AF37] text-[#0F1115] font-medium hover:bg-[#E5C158] transition text-xs"
              >
                Käynnistä demosimulaattori
              </button>
            </div>
          )}
        </div>

        {/* Quick Instructions Card */}
        <div className="mt-auto p-4 rounded-sm bg-[#181B22] border border-[#2A2D35] text-xs text-[#7E8492] flex flex-col gap-2 shadow-inner">
          <div className="flex items-center gap-1.5 font-medium text-[#E0E2E5]">
            <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span className="font-serif italic text-sm text-[#D4AF37]">Erätutka Automaattinen Välitys</span>
          </div>
          <p className="leading-relaxed text-[11px]">
            Kun panta lähettää koordinaatit TCP-porttiin <strong className="text-[#E0E2E5]">5013</strong> tai <strong className="text-[#E0E2E5]">5023</strong>, mikropalvelin parsii WGS84-sijainnin, nopeuden ja akun sekä tekee välittömästi HTTPS POST -kutsun Erätutkan rajapintaan.
          </p>
        </div>
      </div>
    </div>
  );
};
