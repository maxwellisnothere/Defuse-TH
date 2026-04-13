const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderId:      { type: String, required: true, unique: true },
  listingId:    { type: String, required: true },
  buyerId:      { type: String, required: true },
  buyerName:    { type: String, required: true },
  sellerId:     { type: String, required: true },
  sellerName:   { type: String, required: true },
  item: {
    assetId:    String,
    name:       String,
    weapon:     String,
    skin:       String,
    rarity:     String,
    rarityColor: String,
    wear:       String,
    float:      Number,
    image:      String,
    stattrak:   Boolean,
    souvenir:   Boolean,
  },
  price:         { type: Number, required: true },
  fee:           { type: Number, default: 0 },
  sellerReceive: { type: Number, default: 0 },
  
  // [เพิ่มใหม่] สำหรับเก็บ ID การเทรดบน Steam
  tradeOfferId:  { type: String, default: null }, 
  
  status: {
    type: String,
    // pending = รอผู้ขายส่งของ, verifying = รอ Steam ยืนยัน, completed = จบงาน, cancelled = ยกเลิก/คืนเงิน
    enum: ['completed', 'cancelled', 'pending', 'verifying'],
    default: 'pending',
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Order', orderSchema);