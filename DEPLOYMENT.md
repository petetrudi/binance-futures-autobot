# Panduan Deployment Binance Futures AutoBot ke VPS Linux 24/7

Dokumen ini menjelaskan cara menjalankan bot trading secara nonstop 24/7 di VPS Linux (Ubuntu / Debian).

---

## 1. Mengapa Vercel Tidak Bisa Digunakan?

**Vercel adalah platform Serverless (Edge Hosting)**, bukan VPS.
- **Batas Timeout:** Di Vercel, fungsi serverless otomatis dimatikan setelah 10–60 detik. Bot trading membutuhkan proses `Node.js` yang menyala terus 24 jam sehari.
- **Koneksi WebSocket:** Bot harus terhubung tanpa putus ke Binance WebSocket (`stream.binancefuture.com`) untuk menerima pergerakan harga per detik. Vercel tidak mengizinkan background daemon WebSocket.
- **Penyimpanan SQLite:** Filesystem di Vercel bersifat sementara (*ephemeral*), sehingga database riwayat posisi & transaksi (`bot.sqlite`) akan terhapus saat instance berganti.

---

## 2. Rekomendasi VPS yang Tepat

Pilihlah penyedia **VPS Linux (KVM / Cloud Server)** dengan spesifikasi minimum:
- **OS:** Ubuntu 22.04 LTS / 24.04 LTS atau Debian 12
- **RAM:** 1 GB – 2 GB (sudah sangat cukup)
- **CPU:** 1 Core
- **Lokasi / Region:** **Singapura (SGP)** atau **Tokyo (TYO)**
  *(Sangat penting: IP Singapura dan Jepang tidak diblokir oleh Binance, latensi order ke server Binance Futures sangat rendah < 5 ms).*

**Penyedia VPS Murah & Terpercaya ($3 – $5 / bulan):**
- **DigitalOcean** (Droplet $4 - $6 / bln, region Singapore)
- **Hetzner Cloud** (~€3.5 / bln)
- **Contabo** (€4.5 / bln, 4 vCPU, 6GB RAM)
- **Vultr** ($5 / bln, region Singapore / Tokyo)
- **IDCloudHost / Biznet GIO** (Penyedia lokal jika ingin pembayaran bank lokal/QRIS, pilih data center Singapore)

---

## 3. Cara Deploy Menggunakan Docker (Paling Praktis)

Setelah Anda membeli VPS dan login melalui SSH:

### Langkah A: Install Docker di VPS
```bash
# Update paket
sudo apt update && sudo apt upgrade -y

# Install Docker & Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

### Langkah B: Upload / Clone Proyek ke VPS
```bash
# Clone repository Anda atau copy folder proyek ke VPS
git clone <url-repo-anda> /opt/binance-bot
cd /opt/binance-bot
```

### Langkah C: Konfigurasi File `.env`
```bash
cp .env.example .env
nano .env
```
Isi konfigurasi trading Anda:
```env
PORT=4000
TRADING_MODE=PAPER

# Jika sudah siap ke TESTNET atau LIVE:
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_api_secret

# AI Gemini untuk membaca sentimen berita:
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash

# Notifikasi Telegram otomatis (opsional):
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

### Langkah D: Jalankan Bot
```bash
# Build dan jalankan di background
docker compose up -d --build

# Periksa status kontainer
docker compose ps

# Lihat log aktivitas trading bot secara realtime
docker compose logs -f
```

Buka browser di laptop atau HP Anda:
`http://IP_VPS_ANDA:4000`

---

## 4. Cara Deploy Menggunakan PM2 (Tanpa Docker)

Jika tidak ingin menggunakan Docker:
```bash
# Install Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs build-essential

# Install PM2
sudo npm install -g pm2

# Masuk ke folder proyek, install, dan build
cd /opt/binance-bot
npm install
npm run build

# Jalankan bot dengan PM2 (otomatis restart jika crash atau VPS reboot)
pm2 start npm --name "binance-bot" -- start
pm2 save
pm2 startup
```

---

## 5. Mengamankan Dashboard & Port
Jika ingin dashboard hanya bisa diakses menggunakan password atau domain HTTPS, Anda bisa menambahkan Nginx Reverse Proxy dengan Certbot (SSL Gratis Let's Encrypt).
