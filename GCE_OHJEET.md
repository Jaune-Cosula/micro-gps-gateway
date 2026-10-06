# 🐕 Erätutka Micro GPS Gateway — Google Compute Engine (e2-micro) Asennusohje

Tämä itsenäinen, äärimmäisen kevyt mikropalvelin vastaanottaa **SinoTrack ST-904L** ja **ICAR IK122T** -koirapantojen GPS-raakadatan TCP-porteissa ja välittää sen suoraan Erätutka-sovellukseen reaaliajassa.

Palvelimen RAM-muistinkulutus on vain **~15–25 MB**, joten se pyörii täydellisesti Googlen ilmaisessa **e2-micro (1 Gt RAM / Always Free)** virtuaalikoneessa ilman kuluja.

---

## 1. Virtuaalikoneen luominen Google Cloudissa (e2-micro)

1. Avaa [Google Cloud Console](https://console.cloud.google.com/) -> **Compute Engine** -> **VM instances**.
2. Klikkaa **Create Instance**:
   - **Name**: `eratutka-gps-gateway`
   - **Region**: `europe-north1` (Hamina, Suomi) tai `europe-west1` (Belgia)
   - **Machine configuration**: Series **E2**, Machine type **e2-micro** (2 vCPU, 1 GB memory — *Always Free Eligible*)
   - **Boot disk**: Ubuntu 22.04 LTS tai 24.04 LTS (Standard persistent disk 10–30 GB)
   - **Firewall**: Rasti ruutuun *"Allow HTTP traffic"*
3. Klikkaa **Create**.
4. Kun kone on käynnistynyt, ota talteen sen **External IP** (Ulkoinen IP-osoite, esim. `34.88.120.45`).

---

## 2. Palomuurin avaaminen Google Cloudissa (VPC Firewall)

Koirapantojen TCP-yhteyksien ja hallintapaneelin tulee päästä virtuaalipalvelimeen:

### Vaihtoehto A: Google Cloud Console selaimessa
1. Siirry: **VPC Network** -> **Firewall**.
2. Klikkaa **Create Firewall Rule**:
   - **Name**: `allow-gps-collars`
   - **Targets**: `All instances in the network`
   - **Source IPv4 ranges**: `0.0.0.0/0`
   - **Specified protocols and ports**:
     - TCP: `5013, 5023, 8080`
3. Klikkaa **Create**.

### Vaihtoehto B: Google Cloud Shell / gcloud -komento
```bash
gcloud compute firewall-rules create allow-gps-collars \
    --direction=INGRESS \
    --priority=1000 \
    --network=default \
    --action=ALLOW \
    --rules=tcp:5013,tcp:5023,tcp:8080 \
    --source-ranges=0.0.0.0/0 \
    --description="SinoTrack (5013), ICAR (5023) ja GPS Gateway Web UI (8080)"
```

---

## 3. Palvelimen asennus virtuaalikoneelle (1 Komento)

Avaa SSH-yhteys virtuaalikoneeseen (klikkaa **SSH**-nappia Google Cloud Consolessa) ja aja:

```bash
curl -fsSL https://raw.githubusercontent.com/eratutka/micro-gps-gateway/main/install.sh | sudo bash
```
*(Tai lataa ja aja `sudo bash install.sh`)*

Skripti tekee automaattisesti:
- Asentaa Node.js 20 LTS
- Luo hakemiston `/opt/eratutka-gateway`
- Asentaa systemd-palvelun `eratutka-gateway.service` (automaattikäynnistys bootissa)
- Asettaa muistirajan 60 MB RAM
- Käynnistää palvelun taustalle

---

## 4. Koirapantojen SMS-konfigurointi

Aseta koirapantoihin virtuaalikoneesi **Ulkoinen IP-osoite** tekstiviesteillä:

### A) SinoTrack ST-904L (Portti 5013)
Lähetä pannan SIM-kortin puhelinnumeroon seuraavat SMS-viestit järjestyksessä:

1. **IP-osoite ja portti**:
   ```
   8030000 <PALVELIMEN_IP> 5013
   ```
   *Esimerkki: `8030000 34.88.120.45 5013`*
   *(Panta vastaa: `SET IP AND PORT OK`)*

2. **APN (operaattorin yhteyspiste)**:
   - Telia: `APN000000 internet`
   - Elisa / Moi: `APN000000 internet`
   - DNA: `APN000000 internet`

3. **GPRS-tilan aktivointi**:
   ```
   7100000
   ```
   *(Panta vastaa: `SET GPRS OK`)*

4. **Päivitysväli (esim. 5 sekuntia)**:
   ```
   8050000 5
   ```

---

### B) ICAR IK122T / IK122T Pro (Portti 5023 - GT06)
Lähetä pannan numeroon:

1. **Palvelin ja portti**:
   ```
   SERVER,1,<PALVELIMEN_IP>,5023,0#
   ```
   *Esimerkki: `SERVER,1,34.88.120.45,5023,0#`*

2. **APN**:
   ```
   APN,internet#
   ```

3. **Paikannusväli (10 sekuntia)**:
   ```
   TIMER,10#
   ```

4. **Haukunilmaisimen / Tärinähälytyksen aktivointi (IK122T Pro)**:
   ```
   VIBALM,1#
   ```
   *(tai `VIB,1#` / `SHOCK,1#` mallista riippuen. Panta alkaa lähettää GT06 0x13/0x26 hälytyspaketteja koiran haukkuessa, jolloin Gateway laskee haukkutiheyden ja välittää sen Erätutkaan).*

5. **Tilan tarkistus**:
   ```
   PARAM#
   ```

---

## 5. Päivittäminen uusimpaan versioon (1 Komento)

Kun haluat päivittää palvelimen uusimpaan versioon (sisältää SinoTrack multi-packet ja portin 5023 automaattitunnistuksen):

```bash
sudo curl -fsSL https://ais-pre-7fq53keha2opjy5hitirh4-471959473114.europe-west2.run.app/standalone-gateway.ts -o /opt/eratutka-gateway/standalone-gateway.ts && sudo systemctl restart eratutka-gateway
```

---

## 6. Hallinta ja lokit

Voit tarkistaa palvelun tilan ja lokit milloin vain SSH-yhteyden kautta:

- **Tarkista tila**: `sudo systemctl status eratutka-gateway`
- **Reaaliaikainen loki**: `sudo journalctl -u eratutka-gateway -f`
- **Käynnistä uudelleen**: `sudo systemctl restart eratutka-gateway`
- **Pysäytä palvelu**: `sudo systemctl stop eratutka-gateway`
- **Asetustiedosto**: `sudo nano /opt/eratutka-gateway/.env`

Avaa selain osoitteessa `http://<PALVELIMEN_IP>:8080` nähdäksesi reaaliaikaisen hallintapaneelin!
