const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  steamId: { 
    type: String, 
    required: true,
    index: true // ทำ Index ไว้ให้ค้นหาประวัติของคนนี้ได้เร็วๆ
  },
  type: { 
    type: String, 
    enum: ['deposit', 'withdraw', 'buy', 'sell', 'fee'], // กำหนดประเภทธุรกรรม
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['pending', 'completed', 'failed', 'cancelled'], 
    default: 'completed' 
  },
  referenceId: { 
    type: String, 
    default: null // เผื่ออนาคตคุณต่อระบบแนบสลิป หรือ API ธนาคาร เอาไว้เก็บเลขที่อ้างอิงครับ
  }
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);