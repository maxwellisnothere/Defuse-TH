const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { CS2_APP_ID, CS2_CONTEXT_ID, parseItem } = require('../utils/csItemParser');

const JWT_SECRET = process.env.JWT_SECRET || 'defuse_th_jwt_2024';

// ── ระบบดึงราคา & Cache (จากโค้ดเพื่อน) ──
const priceCache = {};

const fetchPrice = async (marketHashName) => {
  try {
    const url = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${encodeURIComponent(marketHashName)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.success) {
      return parseFloat(data.median_price?.replace(/[^0-9.]/g, '') || "0");
    }
  } catch (err) {
    console.log("❌ price error:", err.message);
  }
  return 0;
};

const fetchPriceCached = async (name) => {
  if (priceCache[name]) return priceCache[name];
  const price = await fetchPrice(name);
  priceCache[name] = price;
  return price;
};

const verifyToken = (req) => {
  const auth = req.headers.authorization;
  if (!auth) return null;
  try { return jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET); }
  catch { return null; }
};

// ── GET /inventory/sync (ผสมแล้ว!) ──
router.get('/sync', async (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

  const steamId = user.steamId;
  const count = req.query.count || 100; // ให้กำหนดจำนวนที่ดึงได้
  const url = `https://steamcommunity.com/inventory/${steamId}/${CS2_APP_ID}/${CS2_CONTEXT_ID}?l=english&count=${count}`;

  try {
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });

    if (response.status === 403) return res.status(403).json({ error: 'PRIVATE_INVENTORY', message: 'Inventory ถูกตั้งเป็น Private' });
    if (response.status === 429) return res.status(429).json({ error: 'RATE_LIMITED', message: 'Steam API rate limit กรุณารอ 1 นาที' });
    if (!response.ok) return res.status(response.status).json({ error: `Steam API error: ${response.status}` });

    const data = await response.json();
    if (!data.assets || !data.descriptions) {
      return res.json({ success: true, message: 'ไม่พบไอเทมในคลัง', total: 0, items: [] });
    }

    const descMap = {};
    data.descriptions.forEach(d => descMap[d.classid] = d);

    // 1. แปลงข้อมูลไอเทม
    const rawItems = data.assets
      .map(asset => parseItem(asset, descMap[asset.classid], steamId))
      .filter(item => item !== null && !item.tradeLock && item.category !== 'Cases');

    // 2. ดึงราคาจาก Steam (โค้ดเพื่อน)
    const itemsWithPrices = await Promise.all(
      rawItems.map(async (item) => {
        // ดีเลย์เล็กน้อยเพื่อป้องกันการโดนแบน API จาก Steam (Rate Limit)
        await new Promise(r => setTimeout(r, 200)); 
        const priceUSD = await fetchPriceCached(item.marketHashName);
        const priceTHB = Math.round(priceUSD * 35);

        return {
          ...item,
          marketPriceUSD: priceUSD, // แยกเป็นชื่อ marketPrice เพื่อไม่ให้สับสนกับราคาที่ยูสเซอร์จะตั้งขาย
          marketPriceTHB: priceTHB
        };
      })
    );

    // 3. จัดการระบบ Database (โค้ดเรา)
    const dbUser = await User.findOne({ steamId });
    const existingInventory = dbUser?.inventory || [];
    const listedItems = existingInventory.filter(item => item.listed === true);

    const finalInventory = itemsWithPrices.map(newItem => {
      const matchListed = listedItems.find(ex => ex.assetId === newItem.assetId);
      return matchListed ? matchListed : newItem; 
    });

    // เซฟลง Database
    await User.findOneAndUpdate({ steamId }, { $set: { inventory: finalInventory } });

    res.json({ success: true, steamId, total: finalInventory.length, items: finalInventory });

  } catch (err) {
    console.error('❌ Sync Error:', err);
    res.status(500).json({ error: 'Fetch failed: ' + err.message });
  }
});

// ── GET PRICE (สำหรับดึงรายกระบอก) ──
router.get('/price/:marketHashName', async (req, res) => {
  const name = decodeURIComponent(req.params.marketHashName);
  const url = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${encodeURIComponent(name)}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.success) {
      const usdPrice = parseFloat(data.median_price?.replace(/[^0-9.]/g, '') || '0');
      res.json({
        success: true, name, usd: usdPrice, thb: Math.round(usdPrice * 35),
        lowest: data.lowest_price || null, median: data.median_price || null
      });
    } else {
      res.json({ success: false, name, usd: 0, thb: 0 });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;