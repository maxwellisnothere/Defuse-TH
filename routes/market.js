const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const Listing = require('../models/Listing');
const Order   = require('../models/Order');
const User    = require('../models/User');
const Transaction = require('../models/Transaction');
const Withdrawal = require('../models/Withdrawal');
const io = require('../utils/socket'); // 🟢 ดึง socket มาใช้

const JWT_SECRET = process.env.JWT_SECRET || 'defuse_th_jwt_2024';

// ── ฟังก์ชันตรวจสอบ Token ──
const verifyToken = (req) => {
  const auth = req.headers.authorization;
  if (!auth) return null;
  try { return jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET); }
  catch { return null; }
};

// ── GET /market/mock-login/:steamId (สำหรับเทสเท่านั้น) ──
router.get('/mock-login/:steamId', async (req, res) => { 
  try {
    await User.findOneAndUpdate(
      { steamId: req.params.steamId },
      { 
        $setOnInsert: { 
          displayName: 'User_' + req.params.steamId,
          avatar: 'mock_avatar_url'
        } 
      },
      { upsert: true, returnDocument: 'after' } 
    );

    const token = jwt.sign({
      steamId: req.params.steamId,
      displayName: 'User_' + req.params.steamId,
      avatar: 'mock_avatar_url'
    }, JWT_SECRET);
    
    res.json({ success: true, steamId: req.params.steamId, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
    // ดึงข้อมูล User จริงจาก DB เพื่อให้ได้ displayName ล่าสุดตอนลงขาย
    const dbUser = await User.findOne({ steamId: user.steamId });

    const listing = new Listing({
      listingId:    `LST-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      sellerId:     dbUser.steamId,
      sellerName:   dbUser.displayName || user.displayName,
      sellerAvatar: dbUser.avatar || user.avatar,
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

    await User.findOneAndUpdate(
      { steamId: user.steamId, 'inventory.listingId': req.params.listingId },
      { $set: { 'inventory.$.listed': false, 'inventory.$.listingId': null } }
    );

    res.json({ success: true, message: 'ถอนรายการสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /market/buy/:listingId (ระบบ Escrow) ──
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

    // ดึงข้อมูลผู้ซื้อล่าสุดจาก Database
    const buyer = await User.findOne({ steamId: user.steamId });
    if (!buyer || buyer.balance < listing.price) {
      return res.status(400).json({
        error: 'ยอดเงินไม่พอ',
        required: listing.price,
        current: buyer?.balance || 0,
      });
    }

    // ดึงข้อมูลผู้ขายล่าสุดจาก Database เพื่อเอา displayName 
    const seller = await User.findOne({ steamId: listing.sellerId });
    if (!seller) return res.status(404).json({ error: 'ไม่พบข้อมูลผู้ขายในระบบ' });

    listing.status = 'sold';
    listing.soldAt = new Date();
    await listing.save();

    await User.findOneAndUpdate(
      { steamId: user.steamId },
      { $inc: { balance: -listing.price } }
    );

    const order = new Order({
      orderId:       `ORD-${Date.now()}`,
      listingId:     listing.listingId,
      buyerId:       buyer.steamId,
      buyerName:     buyer.displayName, // ✅ ใช้ชื่อจาก Database
      sellerId:      seller.steamId,
      sellerName:    seller.displayName, // ✅ ใช้ชื่อจาก Database
      item:          listing.item,
      price:         listing.price,
      fee:           listing.fee,
      sellerReceive: listing.sellerReceive,
      status:        'pending' 
    });
    await order.save();
    
    // 🟢 ส่งแจ้งเตือน Real-time ไปให้คนขาย
    io.getIO().to(seller.steamId).emit('tradeNotification', {
      type: 'NEW_ORDER',
      title: '🎉 ขายออกแล้ว!',
      message: `คุณ ${buyer.displayName} ได้สั่งซื้อ ${listing.item.weapon} | ${listing.item.skin} ของคุณแล้ว! กรุณาส่ง Trade Offer ภายใน 7`,
      orderId: order.orderId,
      price: listing.price
    });

    res.json({ success: true, message: 'สั่งซื้อสำเร็จ กรุณารอผู้ขายส่งไอเทมบน Steam', order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /market/confirm-trade/:orderId ──
router.post('/confirm-trade/:orderId', async (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

  const { tradeOfferId } = req.body;
  if (!tradeOfferId) return res.status(400).json({ error: 'กรุณาระบุ Trade Offer ID จาก Steam' });

  try {
    const order = await Order.findOne({ orderId: req.params.orderId, sellerId: user.steamId, status: 'pending' });
    if (!order) return res.status(404).json({ error: 'ไม่พบออเดอร์ หรือออเดอร์ไม่ได้อยู่ในสถานะรอส่งของ' });

    order.tradeOfferId = tradeOfferId;
    order.status = 'verifying';
    await order.save();

    res.json({ success: true, message: 'บันทึก Trade ID สำเร็จ ระบบกำลังตรวจสอบการส่งมอบ', order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /market/complete-trade/:orderId ──
router.post('/complete-trade/:orderId', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId, status: 'verifying' });
    if (!order) return res.status(404).json({ error: 'ไม่พบออเดอร์ที่รอการตรวจสอบ' });

    // 1. โอนเงินให้ผู้ขาย และเอาปืนออกจากคลังคนขาย
    await User.findOneAndUpdate(
      { steamId: order.sellerId },
      { 
        $inc: { balance: order.sellerReceive },
        $pull: { inventory: { listingId: order.listingId } } 
      }
    );

    // 2. โอนไอเทมเข้า Inventory ผู้ซื้อ
    await User.findOneAndUpdate(
      { steamId: order.buyerId },
      {
        $push: {
          inventory: {
            assetId:    order.item.assetId,
            name:       order.item.name,
            weapon:     order.item.weapon,
            skin:       order.item.skin,
            rarity:     order.item.rarity,
            rarityColor: order.item.rarityColor,
            wear:       order.item.wear,
            float:      order.item.float,
            image:      order.item.image,
            stattrak:   order.item.stattrak,
            souvenir:   order.item.souvenir,
            acquiredAt: new Date(),
          }
        }
      }
    );

    order.status = 'completed';
    await order.save();

    res.json({ success: true, message: 'ตรวจสอบสำเร็จ! โอนเงินและไอเทมเรียบร้อยแล้ว' });
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
    res.json({ success: true, balance: dbUser?.balance || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /market/deposit (เติมเงิน + บันทึกประวัติ) ──
router.post('/deposit', async (req, res) => {
  const userToken = verifyToken(req);
  if (!userToken) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'จำนวนเงินไม่ถูกต้อง' });

  try {
    const dbUser = await User.findOneAndUpdate(
      { steamId: userToken.steamId },
      { $inc: { balance: amount } },
      { new: true, upsert: true }
    );

    const newTransaction = new Transaction({
      steamId: userToken.steamId,
      type: 'deposit',
      amount: amount,
      status: 'completed'
    });
    await newTransaction.save();

    res.json({ success: true, message: 'เติมเงินสำเร็จ', newBalance: dbUser.balance, transaction: newTransaction });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /market/withdraw (ขอถอนเงิน) ──
router.post('/withdraw', async (req, res) => {
  const userToken = verifyToken(req);
  if (!userToken) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

  const { amount, bankName, accountNumber, accountName } = req.body;
  const withdrawAmount = Number(amount);

  if (!withdrawAmount || withdrawAmount < 100) {
    return res.status(400).json({ error: 'ขั้นต่ำการถอนคือ 100 บาท' });
  }

  try {
    const dbUser = await User.findOne({ steamId: userToken.steamId });
    if (!dbUser || dbUser.balance < withdrawAmount) {
      return res.status(400).json({ error: 'ยอดเงินคงเหลือไม่เพียงพอ' });
    }

    dbUser.balance -= withdrawAmount;
    await dbUser.save();

    const withdrawal = new Withdrawal({
      steamId: userToken.steamId,
      amount: withdrawAmount,
      bankName,
      accountNumber,
      accountName,
      status: 'pending'
    });
    await withdrawal.save();

    const transaction = new Transaction({
      steamId: userToken.steamId,
      type: 'withdraw',
      amount: -withdrawAmount, 
      status: 'pending',
      referenceId: withdrawal._id
    });
    await transaction.save();

    res.json({ success: true, message: 'ส่งคำขอถอนเงินเรียบร้อย รอแอดมินดำเนินการ', withdrawal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;