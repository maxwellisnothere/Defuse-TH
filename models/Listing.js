const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema({
  listingId:  { type: String, required: true, unique: true },
  sellerId:   { type: String, required: true },
  sellerName: { type: String, required: true },
  sellerAvatar: { type: String, default: null },
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
  price:          { type: Number, required: true },
  priceUSD:       { type: Number, default: 0 },
  fee:            { type: Number, default: 0 },
  sellerReceive:  { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['active', 'sold', 'removed'],
    default: 'active',
  },
  views:     { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  soldAt:    { type: Date, default: null },
});

module.exports = mongoose.model('Listing', listingSchema);