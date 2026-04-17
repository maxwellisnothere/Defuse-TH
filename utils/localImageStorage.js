const axios = require('axios');
const fs = require('fs');
const path = require('path');

const downloadImage = async (url, filename) => {
  // 1. กำหนดโฟลเดอร์เก็บรูป
  const uploadDir = path.join(__dirname, '../public/uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const filePath = path.join(uploadDir, `${filename}.png`);
  const publicPath = `/uploads/${filename}.png`;

  // 2. ถ้ามีรูปอยู่แล้ว ไม่ต้องโหลดซ้ำ (ประหยัดเน็ต Server)
  if (fs.existsSync(filePath)) return publicPath;

  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
    });

    // 3. เขียนไฟล์ลงเครื่อง
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(publicPath));
      writer.on('error', reject);
    });
  } catch (error) {
    console.error(`❌ Download failed: ${filename}`, error.message);
    return url; // ถ้าโหลดไม่เข้าจริงๆ ให้ใช้ลิงก์เดิมแก้ขัดไปก่อน
  }
};

module.exports = { downloadImage };