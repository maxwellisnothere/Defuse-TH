const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { parseItem } = require('../utils/csItemParser'); 

const JWT_SECRET = process.env.JWT_SECRET || 'defuse_th_jwt_2024';
const APP_ID = 730;
const CONTEXT_ID = 2;

// ── Helpers ──
const verifyToken = (req) => {
  const auth = req.headers.authorization;
  if (!auth) return null;
  try { return jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET); }
  catch { return null; }
};

// ── GET /inventory/sync ──
// กลยุทธ์: ดึงไอเทมมาโชว์ก่อน ราคาสดให้หน้าบ้านเรียกแยก จะทำให้ Sync เร็วขึ้นมาก
router.get('/sync', async (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'กรุณา Login ก่อนนะคะ' });

  const steamId = user.steamId;
  const count = req.query.count || 100;
  const url = `https://steamcommunity.com/inventory/${steamId}/${APP_ID}/${CONTEXT_ID}?l=english&count=${count}`;

  try {
    const response = await fetch(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } 
    });

    if (response.status === 403) return res.status(403).json({ error: 'PRIVATE_INVENTORY', message: 'Inventory ถูกตั้งเป็น Private ค่ะ' });
    if (response.status === 429) return res.status(429).json({ error: 'RATE_LIMITED', message: 'Steam API ติดขัด กรุณารอ 1 นาทีนะคะ' });
    if (!response.ok) return res.status(response.status).json({ error: `Steam API error: ${response.status}` });

    const data = await response.json();
    if (!data.assets || !data.descriptions) {
      return res.json({ success: true, message: 'ไม่พบไอเทมในคลังค่ะ', total: 0, items: [] });
    }

    const descMap = {};
    data.descriptions.forEach(d => descMap[d.classid] = d);

    // 1. แปลงข้อมูลไอเทมเบื้องต้น
    const rawItems = data.assets
      .map(asset => parseItem(asset, descMap[asset.classid], steamId))
      .filter(item => item !== null && !item.tradeLock && item.category !== 'Cases');

    // 2. ดึงข้อมูลใน DB เดิมมาตรวจสอบสถานะ Listed
    const dbUser = await User.findOne({ steamId });
    const oldInvMap = new Map(dbUser?.inventory.map(i => [i.assetId, i]) || []);

    // 3. รวมร่างข้อมูล (เน้นความเร็ว ไม่โหลดราคาสดในขั้นตอนนี้)
    const finalInventory = rawItems.map(newItem => {
      const oldItem = oldInvMap.get(newItem.assetId);
      
      return {
        ...newItem,
        // ถ้าเคยมีราคาอยู่แล้วให้ดึงมาใช้ก่อน ถ้าไม่มีให้เป็น 0
        marketPriceUSD: oldItem?.marketPriceUSD || 0,
        marketPriceTHB: oldItem?.marketPriceTHB || 0,
        listed: oldItem?.listed || false,
        listingId: oldItem?.listingId || null
      };
    });

    // อัปเดต DB
    await User.findOneAndUpdate({ steamId }, { $set: { inventory: finalInventory } });
    
    res.json({ 
      success: true, 
      steamId, 
      total: finalInventory.length, 
      items: finalInventory 
    });

  } catch (err) {
    console.error('❌ Sync Error:', err);
    res.status(500).json({ error: 'Fetch failed: ' + err.message });
  }
});

// ── GET /inventory/price/:marketHashName ──
// สำหรับให้หน้าบ้านทยอยดึงราคา (Lazy Load)
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
    
    if (!response.ok) return res.json({ success: false, name, usd: 0, thb: 0 });

    const data = await response.json();

    if (data && data.success) {
      const lowestString = data.lowest_price?.replace(/[^0-9.]/g, '') || '0';
      const usdPrice = parseFloat(lowestString); 
      const thbPrice = usdPrice * 35; 

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