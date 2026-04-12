require('dotenv').config();
const express   = require('express');
const session   = require('express-session');
const passport  = require('passport');
const cors      = require('cors');
const mongoose  = require('mongoose');

const authRoutes      = require('./routes/auth');
const inventoryRoutes = require('./routes/inventory');
const marketRoutes    = require('./routes/market');
const itemsRoutes     = require('./routes/items');

const app  = express();
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

// ── Start ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Defuse TH Backend: http://localhost:${PORT}`);
  console.log(`🎮 Items:   http://localhost:${PORT}/items`);
  console.log(`🏪 Market:  http://localhost:${PORT}/market/listings`);
  console.log(`🔑 Login:   http://localhost:${PORT}/auth/steam\n`);
});

app.get("/steam/price-history", async (req, res) => {
  const name = req.query.name;

  try {
    const url = https://steamcommunity.com/market/pricehistory/?appid=730&market_hash_name=${encodeURIComponent(name)};

    const response = await fetch(url);
    const data = await response.json();

    res.json(data);
  } catch (err) {
    console.error("Steam API error:", err);
    res.status(500).json({ error: "steam fetch error" });
  }
});
