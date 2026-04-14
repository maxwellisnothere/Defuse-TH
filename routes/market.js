const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const Listing = require('../models/Listing');
const Order   = require('../models/Order');
const User    = require('../models/User');
const Transaction = require('../models/Transaction');
const Withdrawal = require('../models/Withdrawal');
const io = require('../utils/socket'); 

const JWT_SECRET = process.env.JWT_SECRET || 'defuse_th_jwt_2024';

const verifyToken = (req) => {
  const auth = req.headers.authorization;
  if (!auth) return null;
  try { return jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET); }
  catch { return null; }
};

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

router.post('/list', async (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

  const { item, price } = req.body;
  if (!item || !price || price <= 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
  }

  try {
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

// ── POST /market/buy/:listingId ──
router.post('/buy/:listingId', async (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

  try {
    // ✅ 1. หารายการขายให้เจอ
    const listing = await Listing.findOne({
      listingId: req.params.listingId,
      status: 'active',
    });

    if (!listing) return res.status(404).json({ error: 'ไม่พบรายการหรือถูกขายไปแล้ว' });
    
    // ✅ 2. ห้ามซื้อของตัวเอง
    if (listing.sellerId === user.steamId) {
      return res.status(400).json({ error: 'ไม่สามารถซื้อไอเทมของตัวเองได้' });
    }

    // ✅ 3. เช็คเงินผู้ซื้อ
    const buyer = await User.findOne({ steamId: user.steamId });
    if (!buyer || buyer.balance < listing.price) {
      return res.status(400).json({ error: 'ยอดเงินของคุณไม่เพียงพอ' });
    }

    // ✅ 4. อัปเดตสถานะให้เป็น sold
    listing.status = 'sold';
    listing.soldAt = new Date();
    await listing.save();

    // ✅ 5. หักเงินผู้ซื้อทันที
    await User.findOneAndUpdate(
      { steamId: user.steamId },
      { $inc: { balance: -listing.price } }
    );

    // ✅ 6. สร้าง Order (ใช้ชื่อจาก Listing ถ้าหาผู้ขายไม่เจอ)
    const order = new Order({
      orderId:       `ORD-${Date.now()}`,
      listingId:     listing.listingId,
      buyerId:       buyer.steamId,
      buyerName:     buyer.displayName || 'Unknown Buyer',
      sellerId:      listing.sellerId,
      sellerName:    listing.sellerName || 'Unknown Seller', 
      item:          listing.item,
      price:         listing.price,
      fee:           listing.fee,
      sellerReceive: listing.sellerReceive,
      status:        'pending' 
    });
    await order.save();
    
    // 🟢 แจ้งเตือนคนขาย
    if (io && io.getIO) {
        try {
            io.getIO().to(listing.sellerId).emit('tradeNotification', {
            type: 'NEW_ORDER',
            title: '🎉 ขายออกแล้ว!',
            message: `คุณ ${buyer.displayName} ได้สั่งซื้อ ${listing.item.weapon} | ${listing.item.skin} ของคุณแล้ว!`,
            orderId: order.orderId,
            price: listing.price
            });
        } catch(e) { console.log('Socket error ignored') }
    }

    res.json({ success: true, message: 'สั่งซื้อสำเร็จ กรุณารอผู้ขายส่งไอเทม', order });
  } catch (err) {
    console.log("❌ Buy Error in Backend:", err);
    res.status(500).json({ error: err.message });
  }
});

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

router.post('/complete-trade/:orderId', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId, status: 'verifying' });
    if (!order) return res.status(404).json({ error: 'ไม่พบออเดอร์ที่รอการตรวจสอบ' });

    await User.findOneAndUpdate(
      { steamId: order.sellerId },
      { 
        $inc: { balance: order.sellerReceive },
        $pull: { inventory: { listingId: order.listingId } } 
      }
    );

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


// ── GET /market/orders/buy (ประวัติการซื้อของฉัน) ──
router.get('/orders/buy', async (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'กรุณา Login ก่อน' });
  try {
    const orders = await Order.find({ buyerId: user.steamId }).sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /market/orders/sell (ประวัติการขายของฉัน) ──
router.get('/orders/sell', async (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'กรุณา Login ก่อน' });
  try {
    // ดึงออเดอร์ที่คนอื่นกดซื้อของๆ เราไป
    const orders = await Order.find({ sellerId: user.steamId }).sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;