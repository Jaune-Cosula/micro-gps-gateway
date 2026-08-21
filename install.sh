#!/bin/bash
# ==============================================================================
# Erätutka Micro GPS Gateway - Automaattinen asennusskripti GCE e2-micro Linuxille
# Ubuntu / Debian
# ==============================================================================

set -e

echo "=========================================================="
echo "🐕 Erätutka Micro GPS Gateway - Asennus Google Cloudiin"
echo "=========================================================="

if [ "$EUID" -ne 0 ]; then
  echo "⚠️  Suorita tämä skripti pääkäyttäjänä (sudo bash install.sh)"
  exit 1
fi

INSTALL_DIR="/opt/eratutka-gateway"
SERVICE_NAME="eratutka-gateway"
NODE_VERSION="20"

echo "1. Päivitetään paketinhallinta ja asennetaan tarvittavat työkalut..."
apt-get update -y
apt-get install -y curl wget git ufw

# Asenna Node.js 20 LTS jos ei vielä asennettu
if ! command -v node &> /dev/null || [[ $(node -v) != v20* && $(node -v) != v22* ]]; then
  echo "2. Asennetaan Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "Node.js versio: $(node -v)"
echo "NPM versio: $(npm -v)"

echo "3. Luodaan kohdekansio $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/dist"

# Kopioidaan lähdekoodi tai luodaan standalone-tiedosto
if [ -f "./standalone-gateway.ts" ]; then
  cp ./standalone-gateway.ts "$INSTALL_DIR/standalone-gateway.ts"
fi

if [ -f "./package.json" ]; then
  cp ./package.json "$INSTALL_DIR/package.json"
fi

cd "$INSTALL_DIR"

echo "4. Asennetaan tsx / dependencies..."
npm install --production --no-audit --no-fund tsx dotenv

# Luodaan .env jos puuttuu
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cat << 'EOF' > "$INSTALL_DIR/.env"
ERATUTKA_FORWARD_URL="https://ais-pre-ih3r3aegkvykcunl6ox36r-471959473114.europe-west2.run.app/api/gps/update"
SINOTRACK_PORT="5013"
ICAR_PORT="5023"
WEB_PORT="8080"
FORWARDING_ENABLED="true"
EOF
  echo "Luotu oletusasetustiedosto: $INSTALL_DIR/.env"
fi

echo "5. Luodaan systemd-palvelu (/etc/systemd/system/${SERVICE_NAME}.service)..."
cat << EOF > /etc/systemd/system/${SERVICE_NAME}.service
[Unit]
Description=Eratutka Micro GPS Gateway (SinoTrack & ICAR)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/npx tsx ${INSTALL_DIR}/standalone-gateway.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=eratutka-gps

# Muistiraja e2-micro koneelle (RAM max 60 MB)
MemoryMax=60M
MemoryHigh=50M

[Install]
WantedBy=multi-user.target
EOF

echo "6. Ladataan systemd ja käynnistetään palvelu..."
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "7. Määritetään paikallinen palomuuri (UFW) jos käytössä..."
if command -v ufw &> /dev/null; then
  ufw allow 5013/tcp comment "SinoTrack ST-904L" || true
  ufw allow 5023/tcp comment "ICAR IK122T" || true
  ufw allow 8080/tcp comment "GPS Gateway Web UI" || true
fi

echo ""
echo "=========================================================="
echo "✅ ASENNUS VALMIS JA PALVELU KÄYNNISSÄ!"
echo "=========================================================="
echo ""
echo "Palvelun tila: systemctl status ${SERVICE_NAME}"
echo "Reaaliaikaiset lokit: journalctl -u ${SERVICE_NAME} -f"
echo "Asetusten muokkaus: nano ${INSTALL_DIR}/.env"
echo "Palvelun uudelleenkäynnistys: systemctl restart ${SERVICE_NAME}"
echo ""
echo "Muista avata Google Cloud Console -> VPC Network -> Firewall:"
echo " - TCP 5013 (SinoTrack)"
echo " - TCP 5023 (ICAR IK122T)"
echo " - TCP 8080 (Hallintapaneeli)"
echo ""
echo "Web-hallintapaneeli: http://<PALVELIMEN_JULKINEN_IP>:8080"
echo "=========================================================="
