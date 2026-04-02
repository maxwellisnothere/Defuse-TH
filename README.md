1. https://defuse-th-backend.onrender.com/

หน้าหลัก ของ API — ปกติแสดงข้อความ welcome หรือ Cannot GET /

2. https://defuse-th-backend.onrender.com/items?limit=5

ดึงข้อมูลไอเทม CS2 จาก database
?limit=5 = จำกัดให้แสดงแค่ 5 รายการ
ใช้ใน frontend เพื่อแสดงสินค้าในตลาด

3. https://defuse-th-backend.onrender.com/auth/steam

เข้าสู่ระบบด้วย Steam
กดแล้วจะ redirect ไปหน้า login ของ Steam
หลัง login สำเร็จ Steam จะส่งข้อมูล user กลับมาให้ backend

# 🎮 Defuse TH - Backend

Backend API สำหรับเว็บไซต์ซื้อขายไอเทม CS2 ของไทย พัฒนาด้วย Node.js + Express + MongoDB

🌐 **Live API:** https://defuse-th-backend.onrender.com/

---

## 📋 Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB + Mongoose
- **Auth:** Steam OpenID
- **Deploy:** Render

---

## 🚀 Getting Started

### 1. Clone repo

```bash
git clone https://github.com/SaranphatTreepien/csgo-backend.git
cd csgo-backend
```

### 2. ติดตั้ง dependencies

```bash
npm install
```

### 3. ตั้งค่า Environment Variables

สร้างไฟล์ `.env` แล้วเพิ่มค่าต่อไปนี้:

```env
MONGO_URI=your_mongodb_connection_string
SESSION_SECRET=your_session_secret
STEAM_API_KEY=your_steam_api_key
BASE_URL=http://localhost:5000
CLIENT_URL=http://localhost:3000
PORT=5000
```

### 4. รัน server

```bash
# Development
npm run dev

# Production
npm start
```

---

## 📡 API Endpoints

### 🔐 Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/steam` | เข้าสู่ระบบด้วย Steam |
| GET | `/auth/steam/return` | Steam callback |
| GET | `/auth/logout` | ออกจากระบบ |
| GET | `/auth/me` | ดูข้อมูล user ปัจจุบัน |

### 🎒 Items

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/items` | ดูไอเทมทั้งหมด |
| GET | `/items?limit=5` | ดูไอเทมแบบจำกัดจำนวน |
| GET | `/items/:id` | ดูไอเทมตาม ID |

### 📦 Inventory

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/inventory` | ดู inventory ของ user |

### 🏪 Market

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/market` | ดูรายการในตลาด |
| POST | `/market` | ลงขายไอเทม |
| DELETE | `/market/:id` | ยกเลิกการขาย |

### 📋 Listings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/listings` | ดูรายการประกาศ |

---

## 📁 Project Structure

```
csgobackend/
├── data/
│   └── cs2_items.json      # ข้อมูลไอเทม CS2
├── models/
│   ├── Listing.js
│   ├── Order.js
│   └── User.js
├── routes/
│   ├── auth.js
│   ├── inventory.js
│   ├── items.js
│   └── market.js
├── .env
├── server.js
└── package.json
```

---

## 🔗 Related

- **Frontend:** https://github.com/SaranphatTreepien/csgo-frontend
