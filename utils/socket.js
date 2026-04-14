let io;

module.exports = {
    // ฟังก์ชันนี้จะถูกเรียกตอนเปิดเซิร์ฟเวอร์ครั้งแรก
    init: (server) => {
        const { Server } = require('socket.io');
        io = new Server(server, {
            cors: {
                origin: "*", // อนุญาตให้ทุกหน้าเว็บเชื่อมต่อได้
                methods: ["GET", "POST"]
            }
        });
        return io;
    },
    // ฟังก์ชันนี้ไว้เรียกใช้ตามไฟล์ Routes ต่างๆ เพื่อส่งข้อความ
    getIO: () => {
        if (!io) {
            throw new Error('Socket.io ยังไม่ถูก Initialized!');
        }
        return io;
    }
};