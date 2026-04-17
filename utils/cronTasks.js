// utils/cronTasks.js
const cron = require('node-cron');
const axios = require('axios');
const PriceHistory = require('../models/PriceHistory');

// รายชื่อไอเทมที่เราต้องการโชว์ในหน้า "เทรนด์ตลาด" (ชื่อต้องเป๊ะตาม Steam)
const TRENDING_ITEMS = [
  "AK-47 | Redline (Field-Tested)",
  "AWP | Asiimov (Well-Worn)",
  "M4A1-S | Printstream (Minimal Wear)"
];

// ฟังก์ชันสำหรับดึงราคาจาก Steam แบบหน่วงเวลา
const fetchSteamPrices = async () => {
  console.log("⏳ [CRON] กำลังอัปเดตราคาเทรนด์ตลาด...");
  
  for (const itemName of TRENDING_ITEMS) {
    try {
      // ใช้ URL ของ Steam Community Market
      const encodedName = encodeURIComponent(itemName);
      const url = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=34&market_hash_name=${encodedName}`;
      
      const response = await axios.get(url);
      
      if (response.data && response.data.success) {
        // Steam ส่งราคามาเป็นข้อความเช่น "฿ 550.00" เราต้องตัดสัญลักษณ์ออกให้เหลือแต่ตัวเลข
        const rawPrice = response.data.lowest_price;
        const numericPrice = parseFloat(rawPrice.replace(/[^0-9.-]+/g, ""));
        
        // บันทึกลง Database เรา
        await PriceHistory.create({
          itemName: itemName,
          price: numericPrice
        });
        
        console.log(`✅ อัปเดตราคา: ${itemName} = ฿${numericPrice}`);
      }
    } catch (error) {
      console.log(`❌ ดึงราคาล้มเหลว [${itemName}]:`, error.message);
    }

    // 🔴 โคตรสำคัญ: ต้องสั่งให้ระบบหยุดรอ 3-5 วินาทีก่อนดึงชิ้นต่อไป เพื่อกันโดน Steam แบน IP
    await new Promise(resolve => setTimeout(resolve, 4000));
  }
  
  console.log("✨ [CRON] อัปเดตเทรนด์ตลาดเสร็จสิ้น!");
};

// สั่งให้ทำงานทุกๆ 1 ชั่วโมง (นาทีที่ 0 ของทุกชั่วโมง)
const initCronJobs = () => {
  cron.schedule('0 * * * *', () => {
    fetchSteamPrices();
  });
  
  // (Optional) เปิดคอมเมนต์ด้านล่างนี้ ถ้าอยากให้มันลองดึงราคาทันที 1 รอบตอนรันเซิร์ฟเวอร์
  // fetchSteamPrices(); 
};

module.exports = { initCronJobs };