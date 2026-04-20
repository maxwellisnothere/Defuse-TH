const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Listing = require('../models/Listing');
const Order = require('../models/Order');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Withdrawal = require('../models/Withdrawal');
const PriceHistory = require('../models/PriceHistory');
const io = require('../utils/socket');

// 🟢 นำเข้า Middleware จากไฟล์กลาง แทนฟังก์ชัน verifyToken เดิมในไฟล์นี้
const verifyToken = require('../middleware/auth');

// ---------------------------------------------------------------------------
// Mock Login (ไม่ต้องใช้ verifyToken เพราะเป็นจุดออก Token)
// ---------------------------------------------------------------------------
router.get('/mock-login/:steamId', async (req, res) => {
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'defuse_th_jwt_2024';

  try {
    await User.findOneAndUpdate(
      { steamId: req.params.steamId },
      {
        $setOnInsert: {
          displayName: 'User_' + req.params.steamId,
          avatar: 'mock_avatar_url',
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    const token = jwt.sign(
      {
        steamId: req.params.steamId,
        displayName: 'User_' + req.params.steamId,
        avatar: 'mock_avatar_url',
      },
      JWT_SECRET
    );

    res.json({ success: true, steamId: req.params.steamId, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /listings — ดูรายการขายทั้งหมด (ไม่ต้อง Login)
// ---------------------------------------------------------------------------
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
    if (sort === 'price_asc')  sortObj = { price:  1 };
    if (sort === 'price_desc') sortObj = { price: -1 };

    const listings = await Listing.find(query).sort(sortObj).limit(100);
    res.json({ success: true, total: listings.length, listings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /list — ตั้งขายไอเทม
// ---------------------------------------------------------------------------
router.post('/list', verifyToken, async (req, res) => {
  const { item, price } = req.body;
  if (!item || !price || price <= 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
  }

  try {
    const dbUser = await User.findOne({ steamId: req.user.steamId });

    const listing = new Listing({
      listingId:    `LST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sellerId:     dbUser.steamId,
      sellerName:   dbUser.displayName || req.user.displayName,
      sellerAvatar: dbUser.avatar      || req.user.avatar,
      item: {
        assetId:     item.assetId || item.id,
        name:        item.name,
        weapon:      item.weapon,
        skin:        item.skin,
        rarity:      item.rarity,
        rarityColor: item.rarityColor,
        wear:        item.wear,
        float:       item.float || null,
        image:       item.image,
        stattrak:    item.stattrak  || false,
        souvenir:    item.souvenir  || false,
      },
      price:         Number(price),
      priceUSD:      Math.round(Number(price) / 35 * 100) / 100,
      fee:           Math.round(Number(price) * 0.05),
      sellerReceive: Math.round(Number(price) * 0.95),
    });

    await listing.save();

    await User.findOneAndUpdate(
      { steamId: req.user.steamId, 'inventory.assetId': item.assetId || item.id },
      { $set: { 'inventory.$.listed': true, 'inventory.$.listingId': listing.listingId } }
    );

    res.json({ success: true, listing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /list/:listingId — ยกเลิกรายการขาย
// ---------------------------------------------------------------------------
router.delete('/list/:listingId', verifyToken, async (req, res) => {
  try {
    const listing = await Listing.findOneAndUpdate(
      { listingId: req.params.listingId, sellerId: req.user.steamId },
      { status: 'removed' },
      { new: true }
    );
    if (!listing) return res.status(404).json({ error: 'ไม่พบรายการ' });

    await User.findOneAndUpdate(
      { steamId: req.user.steamId, 'inventory.listingId': req.params.listingId },
      { $set: { 'inventory.$.listed': false, 'inventory.$.listingId': null } }
    );

    res.json({ success: true, message: 'ถอนรายการสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /buy/:listingId — ซื้อไอเทม (Atomic Transaction)
// ---------------------------------------------------------------------------
router.post('/buy/:listingId', verifyToken, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const listing = await Listing.findOne({
      listingId: req.params.listingId,
      status: 'active',
    }).session(session);

    if (!listing) throw new Error('ไม่พบรายการหรือถูกขายไปแล้ว');

    if (listing.sellerId === req.user.steamId) {
      throw new Error('ไม่สามารถซื้อไอเทมของตัวเองได้');
    }

    const buyer = await User.findOne({ steamId: req.user.steamId }).session(session);
    if (!buyer || buyer.balance < listing.price) {
      throw new Error('ยอดเงินของคุณไม่เพียงพอ');
    }

    // หักเงินผู้ซื้อ
    buyer.balance -= listing.price;
    await buyer.save({ session });

    // เปลี่ยนสถานะไอเทม
    listing.status = 'sold';
    listing.soldAt = new Date();
    await listing.save({ session });

    // สร้าง Order
    const order = new Order({
      orderId:      `ORD-${Date.now()}`,
      listingId:    listing.listingId,
      buyerId:      buyer.steamId,
      buyerName:    buyer.displayName || 'Unknown Buyer',
      sellerId:     listing.sellerId,
      sellerName:   listing.sellerName || 'Unknown Seller',
      item:         listing.item,
      price:        listing.price,
      fee:          listing.fee,
      sellerReceive: listing.sellerReceive,
      status:       'pending',
    });
    await order.save({ session });

    // บันทึก Transaction ของผู้ซื้อ
    const buyerTransaction = new Transaction({
      steamId:     buyer.steamId,
      type:        'buy',
      amount:      -listing.price,
      status:      'completed',
      referenceId: order._id,
    });
    await buyerTransaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    // แจ้งเตือน Socket (นอก Transaction)
    if (io && io.getIO) {
      try {
        io.getIO().to(listing.sellerId).emit('tradeNotification', {
          type:    'NEW_ORDER',
          title:   '🎉 ขายออกแล้ว!',
          message: `คุณ ${buyer.displayName} ได้สั่งซื้อ ${listing.item.weapon} | ${listing.item.skin} ของคุณแล้ว!`,
          orderId: order.orderId,
          price:   listing.price,
        });
      } catch (e) {
        console.log('Socket error ignored');
      }
    }

    res.json({ success: true, message: 'สั่งซื้อสำเร็จ กรุณารอผู้ขายส่งไอเทม', order });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('❌ Buy Error:', err.message);
    res.status(400).json({ error: err.message || 'เกิดข้อผิดพลาดในการสั่งซื้อ' });
  }
});

// ---------------------------------------------------------------------------
// POST /confirm-trade/:orderId — ผู้ขายยืนยันส่ง Trade Offer
// ---------------------------------------------------------------------------
router.post('/confirm-trade/:orderId', verifyToken, async (req, res) => {
  const { tradeOfferId } = req.body;
  if (!tradeOfferId) {
    return res.status(400).json({ error: 'กรุณาระบุ Trade Offer ID จาก Steam' });
  }

  try {
    const order = await Order.findOne({
      orderId:  req.params.orderId,
      sellerId: req.user.steamId,
      status:   'pending',
    });
    if (!order) {
      return res.status(404).json({ error: 'ไม่พบออเดอร์ หรือออเดอร์ไม่ได้อยู่ในสถานะรอส่งของ' });
    }

    order.tradeOfferId = tradeOfferId;
    order.status = 'verifying';
    await order.save();

    res.json({ success: true, message: 'บันทึก Trade ID สำเร็จ ระบบกำลังตรวจสอบการส่งมอบ', order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /complete-trade/:orderId — ระบบ/แอดมิน ยืนยันการซื้อขายสมบูรณ์
// (ไม่มี verifyToken เพราะเรียกจาก internal/admin เท่านั้น — เพิ่ม adminAuth ได้ภายหลัง)
// ---------------------------------------------------------------------------
router.post('/complete-trade/:orderId', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId, status: 'verifying' });
    if (!order) return res.status(404).json({ error: 'ไม่พบออเดอร์ที่รอการตรวจสอบ' });

    await User.findOneAndUpdate(
      { steamId: order.sellerId },
      {
        $inc:  { balance: order.sellerReceive },
        $pull: { inventory: { listingId: order.listingId } },
      }
    );

    await User.findOneAndUpdate(
      { steamId: order.buyerId },
      {
        $push: {
          inventory: {
            assetId:     order.item.assetId,
            name:        order.item.name,
            weapon:      order.item.weapon,
            skin:        order.item.skin,
            rarity:      order.item.rarity,
            rarityColor: order.item.rarityColor,
            wear:        order.item.wear,
            float:       order.item.float,
            image:       order.item.image,
            stattrak:    order.item.stattrak,
            souvenir:    order.item.souvenir,
            acquiredAt:  new Date(),
          },
        },
      }
    );

    order.status = 'completed';
    await order.save();

    res.json({ success: true, message: 'ตรวจสอบสำเร็จ! โอนเงินและไอเทมเรียบร้อยแล้ว' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /balance — ดูยอดเงิน
// ---------------------------------------------------------------------------
router.get('/balance', verifyToken, async (req, res) => {
  try {
    const dbUser = await User.findOne({ steamId: req.user.steamId });
    res.json({ success: true, balance: dbUser?.balance || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /deposit — เติมเงิน
// ---------------------------------------------------------------------------
router.post('/deposit', verifyToken, async (req, res) => {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'จำนวนเงินไม่ถูกต้อง' });
  }

  try {
    const dbUser = await User.findOneAndUpdate(
      { steamId: req.user.steamId },
      { $inc: { balance: amount } },
      { new: true, upsert: true }
    );

    const newTransaction = new Transaction({
      steamId: req.user.steamId,
      type:    'deposit',
      amount:  amount,
      status:  'completed',
    });
    await newTransaction.save();

    res.json({
      success: true,
      message: 'เติมเงินสำเร็จ',
      newBalance:  dbUser.balance,
      transaction: newTransaction,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /withdraw — ถอนเงิน
// ---------------------------------------------------------------------------
router.post('/withdraw', verifyToken, async (req, res) => {
  const { amount, bankName, accountNumber, accountName } = req.body;
  const withdrawAmount = Number(amount);

  if (!withdrawAmount || withdrawAmount < 100) {
    return res.status(400).json({ error: 'ขั้นต่ำการถอนคือ 100 บาท' });
  }

  try {
    const dbUser = await User.findOne({ steamId: req.user.steamId });
    if (!dbUser || dbUser.balance < withdrawAmount) {
      return res.status(400).json({ error: 'ยอดเงินคงเหลือไม่เพียงพอ' });
    }

    dbUser.balance -= withdrawAmount;
    await dbUser.save();

    const withdrawal = new Withdrawal({
      steamId:       req.user.steamId,
      amount:        withdrawAmount,
      bankName,
      accountNumber,
      accountName,
      status:        'pending',
    });
    await withdrawal.save();

    const transaction = new Transaction({
      steamId:     req.user.steamId,
      type:        'withdraw',
      amount:      -withdrawAmount,
      status:      'pending',
      referenceId: withdrawal._id,
    });
    await transaction.save();

    res.json({ success: true, message: 'ส่งคำขอถอนเงินเรียบร้อย รอแอดมินดำเนินการ', withdrawal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /orders/buy — ประวัติการซื้อของฉัน
// ---------------------------------------------------------------------------
router.get('/orders/buy', verifyToken, async (req, res) => {
  try {
    const orders = await Order.find({ buyerId: req.user.steamId }).sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /orders/sell — ประวัติการขายของฉัน
// ---------------------------------------------------------------------------
router.get('/orders/sell', verifyToken, async (req, res) => {
  try {
    const orders = await Order.find({ sellerId: req.user.steamId }).sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /trends — เทรนด์ตลาด (ไม่ต้อง Login)
// ---------------------------------------------------------------------------
router.get('/trends', async (req, res) => {
  try {
    const trends = await PriceHistory.aggregate([
      { $sort: { recordedAt: -1 } },
      {
        $group: {
          _id:    '$itemName',
          prices: { $push: '$price' },
        },
      },
      { $limit: 10 },
      {
        $project: {
          name:         '$_id',
          currentPrice: { $arrayElemAt: ['$prices', 0] },
          previousPrice: {
            $cond: {
              if:   { $gte: [{ $size: '$prices' }, 2] },
              then: { $arrayElemAt: ['$prices', 1] },
              else: { $arrayElemAt: ['$prices', 0] },
            },
          },
        },
      },
      {
        $lookup: {
          from: 'listings',
          let:  { itemName: '$name' },
          pipeline: [
            { $match: { $expr: { $eq: ['$item.name', '$$itemName'] } } },
            { $limit: 1 },
            { $project: { 'item.weapon': 1, 'item.skin': 1, 'item.image': 1, 'item.rarityColor': 1 } },
          ],
          as: 'listingInfo',
        },
      },
      {
        $unwind: {
          path: '$listingInfo',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id:    0,
          id:     '$name',
          name:   '$name',
          weapon: { $ifNull: ['$listingInfo.item.weapon', { $arrayElemAt: [{ $split: ['$name', ' | '] }, 0] }] },
          skin:   { $ifNull: ['$listingInfo.item.skin',   { $arrayElemAt: [{ $split: ['$name', ' | '] }, 1] }] },
          price:  '$currentPrice',
          trendValue: {
            $cond: {
              if: { $gt: ['$previousPrice', 0] },
              then: {
                $multiply: [
                  { $divide: [{ $subtract: ['$currentPrice', '$previousPrice'] }, '$previousPrice'] },
                  100,
                ],
              },
              else: 0,
            },
          },
          image:       { $ifNull: ['$listingInfo.item.image',       'https://community.cloudflare.steamstatic.com/economy/image/fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEYOwEUVmKFSz-wL5KFqC0bCGXvtCREfmBs_XYAA2JajjQGODeKz-asMiUmF-2wNygVPLQqgYMm0oV79HH0zbtxMpVW/360fx360f'] },
          rarityColor: { $ifNull: ['$listingInfo.item.rarityColor', '#4B69FF'] },
        },
      },
    ]);

    const formattedTrends = trends.map(t => ({
      ...t,
      trend:      t.trendValue.toFixed(2),
      isUp:       t.trendValue >= 0,
      trendValue: undefined,
    }));

    res.json({ success: true, trends: formattedTrends });
  } catch (err) {
    console.error('❌ Trends API Error:', err);
    res.status(500).json({ success: false, error: 'ไม่สามารถดึงข้อมูลเทรนด์ตลาดได้' });
  }
});

module.exports = router;