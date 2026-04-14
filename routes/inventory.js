const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { parseItem } = require('../utils/csItemParser'); 

const JWT_SECRET = process.env.JWT_SECRET || 'defuse_th_jwt_2024';

const APP_ID = 730;
const CONTEXT_ID = 2;

// ── ระบบดึงราคา & Cache ──
const priceCache = {};

const fetchPrice = async (marketHashName) => {
  try {
    const url = `https://steamcommunity.com/market/priceoverview/?appid=${APP_ID}&currency=1&market_hash_name=${encodeURIComponent(marketHashName)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    
    // ✅ ดักจับ Error ถ้า Steam บล็อกหรือคืนค่า 429
    if (!res.ok) return 0;

    const data = await res.json();
    
    // ✅ ดักจับ null ก่อนเรียก .success
    if (data && data.success) {
      return parseFloat(data.lowest_price?.replace(/[^0-9.]/g, '') || data.median_price?.replace(/[^0-9.]/g, '') || "0");
    }
  } catch (err) {
    console.log("❌ price error:", err.message);
  }
  return 0;
};

const fetchPriceCached = async (name) => {
  if (priceCache[name]) return priceCache[name];
  const price = await fetchPrice(name);
  if (price > 0) priceCache[name] = price; // เซฟเฉพาะตอนที่ดึงราคาสำเร็จ
  return price;
};

const verifyToken = (req) => {
  const auth = req.headers.authorization;
  if (!auth) return null;
  try { return jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET); }
  catch { return null; }
};

// ── GET /inventory/sync ──
router.get('/sync', async (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

  const steamId = user.steamId;
  const count = req.query.count || 100;
  const url = `https://steamcommunity.com/inventory/${steamId}/${APP_ID}/${CONTEXT_ID}?l=english&count=${count}`;

  try {
    const response = await fetch(url, { 
      headers: { 
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' 
      } 
    });

    if (response.status === 403) return res.status(403).json({ error: 'PRIVATE_INVENTORY', message: 'Inventory ถูกตั้งเป็น Private' });
    if (response.status === 429) return res.status(429).json({ error: 'RATE_LIMITED', message: 'Steam API rate limit กรุณารอ 1 นาที' });
    if (!response.ok) return res.status(response.status).json({ error: `Steam API error: ${response.status}` });

    const data = await response.json();
    if (!data.assets || !data.descriptions) {
      return res.json({ success: true, message: 'ไม่พบไอเทมในคลัง', total: 0, items: [] });
    }

    const descMap = {};
    data.descriptions.forEach(d => descMap[d.classid] = d);

    const rawItems = data.assets
      .map(asset => parseItem(asset, descMap[asset.classid], steamId))
      .filter(item => item !== null && !item.tradeLock && item.category !== 'Cases');

    const itemsWithPrices = await Promise.all(
      rawItems.map(async (item) => {
        await new Promise(r => setTimeout(r, 200)); 
        const priceUSD = await fetchPriceCached(item.marketHashName);
        // ✅ เลิกใช้ Math.round() เพื่อให้ทศนิยมยังอยู่
        const priceTHB = priceUSD * 35; 

        return {
          ...item,
          marketPriceUSD: priceUSD, 
          marketPriceTHB: priceTHB
        };
      })
    );

    const dbUser = await User.findOne({ steamId });
    const existingInventory = dbUser?.inventory || [];
    const listedItems = existingInventory.filter(item => item.listed === true);

    const finalInventory = itemsWithPrices.map(newItem => {
      const matchListed = listedItems.find(ex => ex.assetId === newItem.assetId);
      return matchListed ? matchListed : newItem; 
    });

    await User.findOneAndUpdate({ steamId }, { $set: { inventory: finalInventory } });
    res.json({ success: true, steamId, total: finalInventory.length, items: finalInventory });

  } catch (err) {
    console.error('❌ Sync Error:', err);
    res.status(500).json({ error: 'Fetch failed: ' + err.message });
  }
});

// ── GET PRICE (สำหรับดึงรายกระบอก) ──
const livePriceCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; 

router.get('/price/:marketHashName', async (req, res) => {
  const name = decodeURIComponent(req.params.marketHashName);
  
  if (livePriceCache.has(name)) {
    const cachedItem = livePriceCache.get(name);
    if (Date.now() - cachedItem.timestamp < CACHE_TTL) {
      return res.json({ success: true, ...cachedItem.data, cached: true });
    }
  }

  const url = `https://steamcommunity.com/market/priceoverview/?appid=${APP_ID}&currency=1&market_hash_name=${encodeURIComponent(name)}`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    
    // ✅ ดักจับ Error ตรงนี้ด้วย
    if (!response.ok) {
       return res.json({ success: false, name, usd: 0, thb: 0 });
    }

    const data = await response.json();

    // ✅ ดักจับ null ให้ปลอดภัย
    if (data && data.success) {
      const lowestString = data.lowest_price?.replace(/[^0-9.]/g, '') || '0';
      const usdPrice = parseFloat(lowestString); 
      const thbPrice = usdPrice * 35; // ✅ ไม่ตัดทศนิยม

      const resultData = {
        name, usd: usdPrice, thb: thbPrice,
        lowest: data.lowest_price || null, median: data.median_price || null
      };

      livePriceCache.set(name, { timestamp: Date.now(), data: resultData });
      res.json({ success: true, ...resultData, cached: false });
    } else {
      res.json({ success: false, name, usd: 0, thb: 0 });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;