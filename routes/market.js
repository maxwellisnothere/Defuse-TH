const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const Listing = require('../models/Listing');
const Order   = require('../models/Order');
const User    = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'defuse_th_jwt_2024';

const verifyToken = (req) => {
  const auth = req.headers.authorization;
  if (!auth) return null;
  try { return jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET); }
  catch { return null; }
};

// ── GET /market/listings ──────────────────────────────
router.get('/listings', async (req, res) => {
  try {
    const { weapon, rarity, wear, minPrice, maxPrice, sort = 'newest' } = req.query;
    const query = { status: 'active' };

    if (weapon)   query['item.weapon'] = new RegExp(weapon, 'i');
    if (rarity)   query['item.rarity'] = new RegExp(rarity, 'i');
    if (wear)     query['item.wear']   = wear;
    if (minPrice) query.price = { ...query.price, $gte: Number(minPrice) };
    if (maxPrice) query.price = { ...query.price, $lte: Number(maxPrice) };

    let sortObj = { createdAt: -1 };
    if (sort === 'price_asc')  sortObj = { price: 1 };
    if (sort === 'price_desc') sortObj = { price: -1 };

    const listings = await Listing.find(query).sort(sortObj).limit(100);
    res.json({ success: true, total: listings.length, listings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /market/list ─────────────────────────────────
router.post('/list', async (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

  const { item, price } = req.body;
  if (!item || !price || price <= 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
  }

  try {
    const listing = new Listing({
      listingId:    `LST-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      sellerId:     user.steamId,
      sellerName:   user.displayName,
      sellerAvatar: user.avatar,
      item: {
        assetId:    item.assetId || item.id,
        name:       item.name,
        weapon:     item.weapon,
        skin:       item.skin,
        rarity:     item.rarity,
        rarityColor: item.rarityColor,
        wear:       item.wear,
        float:      item.float || null,
        image:      item.image,
        stattrak:   item.stattrak || false,
        souvenir:   item.souvenir || false,
      },
      price:         Number(price),
      priceUSD:      Math.round(Number(price) / 35 * 100) / 100,
      fee:           Math.round(Number(price) * 0.05),
      sellerReceive: Math.round(Number(price) * 0.95),
    });

    await listing.save();

    // อัปเดต inventory ของ user ว่า listed แล้ว
    await User.findOneAndUpdate(
      { steamId: user.steamId, 'inventory.assetId': item.assetId || item.id },
      { $set: { 'inventory.$.listed': true, 'inventory.$.listingId': listing.listingId } }
    );

    res.json({ success: true, listing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /market/list/:listingId ────────────────────
router.delete('/list/:listingId', async (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

  try {
    const listing = await Listing.findOneAndUpdate(
      { listingId: req.params.listingId, sellerId: user.steamId },
      { status: 'removed' },
      { new: true }
    );
    if (!listing) return res.status(404).json({ error: 'ไม่พบรายการ' });

    // คืนสถานะ inventory
    await User.findOneAndUpdate(
      { steamId: user.steamId, 'inventory.listingId': req.params.listingId },
      { $set: { 'inventory.$.listed': false, 'inventory.$.listingId': null } }
    );

    res.json({ success: true, message: 'ถอนรายการสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /market/buy/:listingId ───────────────────────
router.post('/buy/:listingId', async (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

  try {
    const listing = await Listing.findOne({
      listingId: req.params.listingId,
      status: 'active',
    });

    if (!listing) return res.status(404).json({ error: 'ไม่พบรายการหรือขายไปแล้ว' });
    if (listing.sellerId === user.steamId) {
      return res.status(400).json({ error: 'ซื้อของตัวเองไม่ได้' });
    }

    // เช็ค balance ผู้ซื้อ
    const buyer = await User.findOne({ steamId: user.steamId });
    if (!buyer || buyer.balance < listing.price) {
      return res.status(400).json({
        error: 'ยอดเงินไม่พอ',
        required: listing.price,
        current: buyer?.balance || 0,
      });
    }

    // ทำธุรกรรม
    listing.status = 'active' ? 'sold' : listing.status;
    listing.status = 'sold';
    listing.soldAt = new Date();
    await listing.save();

    // หัก balance ผู้ซื้อ
    await User.findOneAndUpdate(
      { steamId: user.steamId },
      {
        $inc: { balance: -listing.price },
        $push: {
          inventory: {
            assetId:    listing.item.assetId,
            name:       listing.item.name,
            weapon:     listing.item.weapon,
            skin:       listing.item.skin,
            rarity:     listing.item.rarity,
            rarityColor: listing.item.rarityColor,
            wear:       listing.item.wear,
            float:      listing.item.float,
            image:      listing.item.image,
            stattrak:   listing.item.stattrak,
            souvenir:   listing.item.souvenir,
            acquiredAt: new Date(),
          }
        }
      }
    );

    // เพิ่ม balance ผู้ขาย (หัก fee 5%)
    await User.findOneAndUpdate(
      { steamId: listing.sellerId },
      { $inc: { balance: listing.sellerReceive } }
    );

    // บันทึก order
    const order = new Order({
      orderId:       `ORD-${Date.now()}`,
      listingId:     listing.listingId,
      buyerId:       user.steamId,
      buyerName:     user.displayName,
      sellerId:      listing.sellerId,
      sellerName:    listing.sellerName,
      item:          listing.item,
      price:         listing.price,
      fee:           listing.fee,
      sellerReceive: listing.sellerReceive,
    });
    await order.save();

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /market/my-listings ───────────────────────────
router.get('/my-listings', async (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

  try {
    const listings = await Listing.find({ sellerId: user.steamId }).sort({ createdAt: -1 });
    res.json({ success: true, listings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /market/orders ────────────────────────────────
router.get('/orders', async (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

  try {
    const orders = await Order.find({
      $or: [{ buyerId: user.steamId }, { sellerId: user.steamId }]
    }).sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /market/balance ───────────────────────────────
router.get('/balance', async (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

  try {
    const dbUser = await User.findOne({ steamId: user.steamId });
    res.json({ success: true, steamId: user.steamId, balance: dbUser?.balance || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /market/deposit ──────────────────────────────
router.post('/deposit', async (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'จำนวนเงินไม่ถูกต้อง' });

  try {
    const dbUser = await User.findOneAndUpdate(
      { steamId: user.steamId },
      { $inc: { balance: Number(amount) } },
      { new: true, upsert: true }
    );
    res.json({ success: true, newBalance: dbUser.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;