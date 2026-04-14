require('dotenv').config();
const express   = require('express');
const http      = require('http'); // 🟢 1. ดึง module http ของ Node.js มาใช้
const session   = require('express-session');
const passport  = require('passport');
const cors      = require('cors');
const mongoose  = require('mongoose');

const socket    = require('./utils/socket'); // 🟢 2. ดึงไฟล์ socket ที่เราจะสร้างแยกไว้

const authRoutes      = require('./routes/auth');
const inventoryRoutes = require('./routes/inventory');
const marketRoutes    = require('./routes/market');
const itemsRoutes     = require('./routes/items');

const app  = express();
const server = http.createServer(app); // 🟢 3. ห่อ app ของเราด้วย http server
const PORT = process.env.PORT || 3000;

// ── Connect MongoDB ────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected!'))
  .catch(err => console.error('❌ MongoDB error:', err.message));

// ── Middleware ─────────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'defuse_th_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
}));
app.use(passport.initialize());
app.use(passport.session());

// ── Routes ─────────────────────────────────────────────
app.use('/auth',      authRoutes);
app.use('/inventory', inventoryRoutes);
app.use('/market',    marketRoutes);
app.use('/items',     itemsRoutes);

// ── Setup Socket.io ──────────────────────────────────── // 🟢 4. ตั้งค่า Socket.io
const io = socket.init(server);

io.on('connection', (socketClient) => {
    console.log('✅ Client connected to Socket.io (ID:', socketClient.id, ')');

    // เมื่อหน้าเว็บส่งคำขอ joinRoom พร้อมเลข SteamID เข้ามา
    socketClient.on('joinRoom', (steamId) => {
        socketClient.join(steamId);
        console.log(`👤 User ${steamId} joined private notification room`);
    });

    socketClient.on('disconnect', () => {
        console.log('❌ Client disconnected');
    });
});

// ── Health Check ───────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Defuse TH Backend 🚀',
    mongodb: mongoose.connection.readyState === 1 ? '✅ Connected' : '❌ Disconnected',
    endpoints: {
      items:   '/items?search=ak&page=1',
      market:  '/market/listings',
      auth:    '/auth/steam',
    },
  });
});

// ── Start ────────────────────────────────────────────── // 🟢 5. เปลี่ยนจาก app.listen เป็น server.listen
server.listen(PORT, () => {
  console.log(`\n🚀 Defuse TH Backend: http://localhost:${PORT}`);
  console.log(`🎮 Items:   http://localhost:${PORT}/items`);
  console.log(`🏪 Market:  http://localhost:${PORT}/market/listings`);
  console.log(`🔑 Login:   http://localhost:${PORT}/auth/steam\n`);
});