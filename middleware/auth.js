const jwt = require('jsonwebtoken');

// ใช้ Secret เดียวกับที่คุณตั้งไว้ในระบบ
const JWT_SECRET = process.env.JWT_SECRET || 'defuse_th_jwt_2024';

const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'กรุณา Login ก่อน' });
  }

  try {
    // ตัดคำว่า 'Bearer ' ออกเพื่อเอาแค่ตัว Token
    const token = authHeader.replace('Bearer ', '');
    
    // ถอดรหัส Token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // ฝากข้อมูล user ที่แกะได้ไว้ใน req.user เพื่อให้ Route เอาไปใช้ต่อ
    req.user = decoded; 
    
    // ส่งไม้ต่อให้ Route ถัดไปทำงาน
    next(); 
  } catch (err) {
    return res.status(401).json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
};

module.exports = verifyToken;