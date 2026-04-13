const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  steamId: { type: String, required: true, index: true },
  amount: { type: Number, required: true },
  bankName: { type: String, required: true }, // เช่น กสิกร, PromptPay
  accountNumber: { type: String, required: true },
  accountName: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'processing', 'completed', 'rejected'], 
    default: 'pending' 
  },
  adminNote: { type: String, default: null }, // เผื่อแอดมินใส่เหตุผลที่ปฏิเสธ
}, { timestamps: true });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);