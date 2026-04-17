// models/PriceHistory.js
const mongoose = require('mongoose');

const priceHistorySchema = new mongoose.Schema({
  // ชื่อไอเทม เช่น "AK-47 | Redline (Field-Tested)"
  itemName: { 
    type: String, 
    required: true,
    index: true // ใส่ index เพื่อให้ค้นหาข้อมูลได้เร็วขึ้น
  },
  // ราคากลางที่ดึงมาจาก Steam ณ เวลานั้น
  price: { 
    type: Number, 
    required: true 
  },
  // วันและเวลาที่ทำการบันทึกข้อมูล
  recordedAt: { 
    type: Date, 
    default: Date.now,
    expires: 86400 * 7 // (Optional) ลบข้อมูลอัตโนมัติเมื่อเก่าเกิน 7 วัน เพื่อไม่ให้ Database เต็ม
  }
});

module.exports = mongoose.model('PriceHistory', priceHistorySchema);