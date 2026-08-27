# Micro GPS Gateway - Projektin säännöt ja pysyvät arkkitehtuuriohjeet

Tämä tiedosto latautuu automaattisesti tekoälyagentin järjestelmäohjeisiin jokaisessa uudessa keskustelussa ja sessiossa. Älä poista näitä sääntöjä.

---

## 1. Pysyvä ja kriittinen GT06 & JT808 (ICAR IK122T / IK122T Pro) Kättelylogiikka (Portti 5023)

### Miksi tämä on elintärkeää:
IK122T / IK122T Pro -koirapannat käyttävät joko GT06- tai JT808-binääriprotokollaa (`0x78 0x78` tai `0x7E ... 0x7E`). Panta lähettää heti yhteyden avattuaan Login/Register -paketin (`0x01` GT06 tai `0x0100` JT808). **Jos palvelin ei vastaa välittömästi oikealla ACK-kuittauksella (`0x8100` JT808:lle tai `0x01` GT06:lle), panta katkaisee TCP-yhteyden eikä koskaan lähetä GPS-sijainteja tai haukkupaketteja.**

### JT808 Protokollan kuittaukset (Portti 5023):
- **0x0100 (Terminal Register)**: Vastattava heti viestillä **`0x8100`** (Terminal Register Response, result=00 OK + authToken "AUTH_OK").
- **0x0102 (Terminal Auth)** & **0x0002 (Heartbeat)** & **0x0200 (Location Report)**: Vastattava viestillä **`0x8001`** (General Response, result=00 OK).

### GT06 ACK -paketin rakenne (10 tavua):
- `0x78 0x78` (Alkutavut)
- `0x05` (Pituus: 5 tavua = Protocol + SerialNumber + CRC)
- `[Protocol]` (Esim. `0x01` Loginille, `0x13` Status/Heartbeatille, `0x12`/`0x16`/`0x22`/`0x26` Sijainnille/Hälytykselle)
- `[SerialNumber]` (2 tavua, UInt16BE – täsmälleen sama sarjanumero kuin pannan saapuneessa paketissa)
- `[CRC-16]` (2 tavua, ITU CRC16-CCITT: Poly `0x1021`, Init `0xFFFF`, XorOut `0xFFFF` laskettuna tavuista `Length` - `SerialNumber`)
- `0x0D 0x0A` (Pysäytystavut)

### Pakolliset protokollasäännöt koodissa:
1. **Login (0x01)**: On AINA kuitattava välittömästi `0x01` ACK -paketilla. Pannan IMEI tallennetaan socket-kontekstiin.
2. **Heartbeat / Status (0x13)**: On AINA kuitattava `0x13` ACK -paketilla. Terminal Info -tavusta (bitti 001) tai Alarm-tavusta (`0x03`, `0x01`, `0x09`, `0x0A`, `0x11`) tunnistetaan IK122T Pro haukku/tärinä.
3. **Alarm Data (0x16 / 0x26)**: On kuitattava vastaavalla ACK-paketilla ja tulkittava haukuksi.
4. **Location Data (0x12 / 0x22)**: Kuitataan ACK-paketilla ja puretaan lat/lon/nopeus/suunta.

---

## 2. Haukkulaskuri & Erätutka JSON Payload

Gateway laskee liukuvalla 60 sekunnin ikkunalla todellisen haukkutiheyden (`barkRate`, haukkua/min) ja ylläpitää `isBarking` -tilaa (10s decay).

Erätutkan (`/api/gps/update`) HTTP POST -rungossa on **AINA** oltava mukana kentät:
```json
{
  "id": "7026216737",
  "lat": 60.85214,
  "lon": 25.68142,
  "speed": 12.4,
  "battery": 92,
  "heading": 45,
  "timestamp": 1724789000000,
  "isBarking": true,
  "barkRate": 65
}
```

---

## 3. GCE Standalone Gateway (`/opt/eratutka-gateway/server.js` & `standalone-gateway.ts`)

GCE e2-micro -palvelimella ajetaan 0-riippuvuuksista standalone-palvelinta Node.js:llä (`systemd`: `eratutka-gateway.service`). 
- Portti **5013**: SinoTrack ST-904L (ASCII)
- Portti **5023**: ICAR IK122T / IK122T Pro (GT06 binääri + kättely + haukunilmaisin)
- Portti **8080**: HTTP REST API (PULL), Dashboard ja `/api/status`

Kaikki muutokset protokollatulkkeihin on synkronoitava sekä `server/protocols/icar.ts` että `standalone-gateway.ts` / GCE-skripteihin ilman kättelyn rikkomista.

---

## 4. Erätutka Integraatio: PULL-malli (Portti 8080) & CORS

Gateway tukee ensisijaisesti **PULL-mallia**, jossa Erätutka (tai muu karttasovellus) hakee koirien ja pantojen tiedot suoraan Gatewayn HTTP REST API:sta:

### Pakolliset PULL-rajapinnat (Portti 8080):
1. **`GET /api/positions` & `GET /api/devices`**:
   - Palauttaa JSON-muodossa kaikkien aktiivisten laitteiden reaaliaikaiset tiedot (`id`, `lat`, `lon`, `speed`, `battery`, `heading`, `timestamp`, `isBarking`, `barkRate`).
2. **`GET /api/history` & `GET /api/history/:id` / `GET /api/tracks`**:
   - Palauttaa pannan kulkeman GPS-jäljen (points-taulukko).
3. **Pakolliset CORS-otsikot kaikissa HTTP-vastauksissa**:
   ```javascript
   res.setHeader('Access-Control-Allow-Origin', '*');
   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
   res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
   ```
   (CORS on välttämätön, jotta selaimessa pyörivä Erätutka-sovellus voi hakea tiedot suoraan ilman selainestoja).

