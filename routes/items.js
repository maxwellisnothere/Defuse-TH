const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// โหลด CS2 items จาก JSON
let cs2Items = [];
try {
  const raw = fs.readFileSync(path.join(__dirname, '../data/cs2_items.json'), 'utf8');
  const rawItems = JSON.parse(raw);

  // แปลงข้อมูลให้ตรงกับ format ที่ App ใช้
  cs2Items = rawItems.map((item, index) => ({
    id: item.id,
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
    image: item.image || null,
    minFloat: item.min_float || 0,
    maxFloat: item.max_float || 1,
    stattrak: item.stattrak || false,
    souvenir: item.souvenir || false,
    wears: item.wears?.map(w => w.name) || [],
    collections: item.collections || [],
    crates: item.crates || [],
    paintIndex: item.paint_index || null,
    // ราคาเริ่มต้น (random สำหรับ mock)
    basePrice: Math.floor(Math.random() * 50000) + 500,
  }));

  console.log(`✅ โหลด CS2 items สำเร็จ: ${cs2Items.length} items`);
} catch (err) {
  console.error('❌ โหลด cs2_items.json ไม่ได้:', err.message);
}

// ── GET /items ─────────────────────────────────────────
// ดึง items ทั้งหมด (มี filter + pagination)
router.get('/', (req, res) => {
  const {
    search, category, rarity, weapon,
    page = 1, limit = 20,
    sort = 'name',
  } = req.query;

  let result = [...cs2Items];

  // Filter
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.weapon.toLowerCase().includes(q) ||
      i.skin.toLowerCase().includes(q)
    );
  }
  if (category) result = result.filter(i => i.category.toLowerCase().includes(category.toLowerCase()));
  if (rarity)   result = result.filter(i => i.rarity.toLowerCase().includes(rarity.toLowerCase()));
  if (weapon)   result = result.filter(i => i.weapon.toLowerCase().includes(weapon.toLowerCase()));

  // Sort
  if (sort === 'name')      result.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'price_asc') result.sort((a, b) => a.basePrice - b.basePrice);
  if (sort === 'price_desc')result.sort((a, b) => b.basePrice - a.basePrice);
  if (sort === 'rarity')    result.sort((a, b) => a.rarityId.localeCompare(b.rarityId));

  // Pagination
  const total = result.length;
  const start = (Number(page) - 1) * Number(limit);
  const items = result.slice(start, start + Number(limit));

  res.json({
    success: true,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / Number(limit)),
    items,
  });
});

// ── GET /items/:id ─────────────────────────────────────
// ดึง item เดียว
router.get('/:id', (req, res) => {
  const item = cs2Items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'ไม่พบ item' });
  res.json({ success: true, item });
});

// ── GET /items/category/list ───────────────────────────
// ดึงหมวดหมู่ทั้งหมด
router.get('/meta/categories', (req, res) => {
  const categories = [...new Set(cs2Items.map(i => i.category))].sort();
  res.json({ success: true, categories });
});

// ── GET /items/meta/weapons ────────────────────────────
// ดึงประเภท weapons ทั้งหมด
router.get('/meta/weapons', (req, res) => {
  const weapons = [...new Set(cs2Items.map(i => i.weapon))].sort();
  res.json({ success: true, weapons });
});

// ── GET /items/meta/rarities ───────────────────────────
router.get('/meta/rarities', (req, res) => {
  const rarities = [...new Set(cs2Items.map(i => i.rarity))];
  res.json({ success: true, rarities });
});

module.exports = router;
module.exports.cs2Items = cs2Items;