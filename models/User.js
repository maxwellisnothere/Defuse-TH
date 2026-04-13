const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  steamId:     { type: String, required: true, unique: true },
  displayName: { type: String, required: true },
  avatar:      { type: String, default: null },
  profileUrl:  { type: String, default: null },
  balance:     { type: Number, default: 0 },
  inventory: [{
    assetId:    String,
    name:       String,
    weapon:     String,
    skin:       String,
    rarity:     String,
    rarityColor: String,
    wear:       String,
    float:      Number,
    image:      String,
    category:   String,
    stattrak:   { type: Boolean, default: false },
    souvenir:   { type: Boolean, default: false },
    tradeLock:  { type: Boolean, default: false },
    listed:     { type: Boolean, default: false },
    listingId:  { type: String, default: null },
    acquiredAt: { type: Date, default: Date.now },
    inspectLink: { type: String, default: null }, // ตัดมาจากinventory.js
    stickers: [{ type: String }], // ตัดมาจากinventory.js
    collectionName: { type: String, default: null }, // เปลี่ยนชื่อนิดนึงกันชนคำสงวน
    marketPriceUSD: { type: Number, default: 0 }, //เพิ่ม
    marketPriceTHB: { type: Number, default: 0 }, //เพิ่มทำไมไม่รู้ว
  }],
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);