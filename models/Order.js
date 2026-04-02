const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderId:    { type: String, required: true, unique: true },
  listingId:  { type: String, required: true },
  buyerId:    { type: String, required: true },
  buyerName:  { type: String, required: true },
  sellerId:   { type: String, required: true },
  sellerName: { type: String, required: true },
  item: {
    name:       String,
    weapon:     String,
    skin:       String,
    rarity:     String,
    rarityColor: String,
    wear:       String,
    float:      Number,
    image:      String,
    stattrak:   Boolean,
  },
  price:         { type: Number, required: true },
  fee:           { type: Number, default: 0 },
  sellerReceive: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['completed', 'cancelled', 'pending'],
    default: 'completed',
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Order', orderSchema);