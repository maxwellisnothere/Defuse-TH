const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// 🟢 1. เปลี่ยนมาเรียกใช้ระบบดูดรูปลงเครื่อง (Local Storage)
const { downloadImage } = require('../utils/localImageStorage'); 

// ดึง BASE_URL จาก .env มาใช้ต่อ URL รูปภาพ (ถ้าไม่มีให้ใช้ 10.0.2.2 สำหรับ Emulator)
const BASE_URL = process.env.BASE_URL || "http://10.0.2.2:3000";

/**
 * 🟢 ฟังก์ชันซ่อม URL รูปภาพ (Super Clean Steam URL)
 */
const cleanSteamUrl = (url) => {
  if (!url) return null;
  return url
    .replace(/community\.cloudflare\.steamstatic\.com/g, 'steamcommunity-a.akamaihd.net')
    .replace(/community\.steamstatic\.com/g, 'steamcommunity-a.akamaihd.net')
    .replace(/akamaihdd+/g, 'akamaihd')       
    .replace(/aka+maihd/g, 'akamaihd')       
    .replace(/\.neet/g, '.net')              
    .replace(/\.ccom/g, '.com')              
    .replace(/economyy+/g, 'economy')         
    .replace(/immage+/g, 'image')             
    .replace(/publ+ic/g, 'public')           
    .replace(/steamsta+tic+/g, 'steamstatic') 
    .replace(/steamstaticc/g, 'steamstatic') 
    .replace(/([^:])\/\/+/g, '$1/');         
};

// ข้อมูลไอเทมในหน่วยความจำ
let cs2Items = [];

/**
 * 🚀 ฟังก์ชันเริ่มต้นโหลดข้อมูลไอเทมและดูดรูปลงเครื่อง
 */
const initItems = async () => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../data/cs2_items.json'), 'utf8');
    const rawItems = JSON.parse(raw);

    console.log(`📦 กำลังเริ่มระบบดูดรูปภาพลงเครื่อง (Local Mirror) สำหรับ ${rawItems.length} ไอเทม...`);

    const processed = [];
    for (const item of rawItems) {
      // 1. ล้าง URL จาก Steam ให้สะอาดก่อน
      const cleanedUrl = cleanSteamUrl(item.image);
      
      // 2. 🟢 สั่งดูดรูปลงโฟลเดอร์ public/uploads/
      const localPath = await downloadImage(cleanedUrl, `skin_${item.id}`);

      // 3. 🟢 จัดฟอร์แมต URL เต็มๆ เพื่อส่งให้แอปมือถือ (เช่น http://10.0.2.2:3000/uploads/skin_123.png)
      const fullImageUrl = localPath.startsWith('http') ? localPath : `${BASE_URL}${localPath}`;

      processed.push({
        id: item.id || String(Math.random()),
        name: item.name,
        weapon: item.weapon?.name || 'Unknown',
        weaponId: item.weapon?.id || '',
        skin: item.pattern?.name || item.name,
        description: item.description || '',
        rarity: item.rarity?.name || 'Base Grade',
        rarityColor: item.rarity?.color || '#B0C3D9',
        rarityId: item.rarity?.id || '',
        category: item.category?.name || 'Guns',
        categoryId: item.category?.id || '',
        image: fullImageUrl, // ✅ รูปพร้อมเสิร์ฟจาก Server เราเอง!
        minFloat: item.min_float || 0,
        maxFloat: item.max_float || 1,
        stattrak: item.stattrak || false,
        souvenir: item.souvenir || false,
        wears: item.wears?.map(w => w.name) || [],
        collections: item.collections || [],
        crates: item.crates || [],
        paintIndex: item.paint_index || null,
        basePrice: Math.floor(Math.random() * 50000) + 500,
      });
    }

    cs2Items = processed;
    console.log(`✅ โหลดไอเทมและดูดรูปภาพสำเร็จพร้อมใช้งาน!`);
  } catch (err) {
    console.error('❌ ระบบโหลดไอเทมพัง:', err.message);
  }
};

// รันคำสั่งโหลดข้อมูล
initItems();

// ── GET /items ─────────────────────────────────────────
router.get('/', (req, res) => {
  const { search, category, rarity, weapon, page = 1, limit = 20, sort = 'name' } = req.query;

  let result = [...cs2Items];

  // 🔍 Filter
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.weapon.toLowerCase().includes(q) ||
      i.skin.toLowerCase().includes(q)
    );
  }
  
  if (category && category !== 'all') {
    result = result.filter(i => i.category.toLowerCase().includes(category.toLowerCase()));
  }
  
  if (rarity) result = result.filter(i => i.rarity.toLowerCase().includes(rarity.toLowerCase()));
  if (weapon) result = result.filter(i => i.weapon.toLowerCase().includes(weapon.toLowerCase()));

  // 🔃 Sort
  if (sort === 'name')       result.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'price_asc')  result.sort((a, b) => a.basePrice - b.basePrice);
  if (sort === 'price_desc') result.sort((a, b) => b.basePrice - a.basePrice);
  if (sort === 'rarity')     result.sort((a, b) => (a.rarityId || '').localeCompare(b.rarityId || ''));

  // 📄 Pagination
  const total = result.length;
  const pageNum = Number(page);
  const limitNum = Number(limit);
  const start = (pageNum - 1) * limitNum;
  const items = result.slice(start, start + limitNum);

  res.json({ success: true, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum), items });
});

router.get('/:id', (req, res) => {
  const item = cs2Items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, error: 'ไม่พบ item' });
  res.json({ success: true, item });
});

router.get('/meta/categories', (req, res) => {
  const categories = [...new Set(cs2Items.map(i => i.category))].sort();
  res.json({ success: true, categories });
});

router.get('/meta/weapons', (req, res) => {
  const weapons = [...new Set(cs2Items.map(i => i.weapon))].sort();
  res.json({ success: true, weapons });
});

router.get('/meta/rarities', (req, res) => {
  const rarities = [...new Set(cs2Items.map(i => i.rarity))];
  res.json({ success: true, rarities });
});

module.exports = router;
module.exports.cs2Items = cs2Items;