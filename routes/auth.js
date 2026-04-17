const express = require("express");
const router = express.Router();
const passport = require("passport");
const SteamStrategy = require("passport-steam").Strategy;
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "defuse_th_jwt_2024";

// ✅ ใช้ URL จริงของ Server (สำคัญมากสำหรับการทำ Redirect)
const BASE_URL = process.env.BASE_URL || "http://10.0.2.2:3000";

// ── Passport Steam Strategy ────────────────────────────
passport.use(
  new SteamStrategy(
    {
      returnURL: `${BASE_URL}/auth/steam/return`,
      realm: `${BASE_URL}/`,
      apiKey: process.env.STEAM_API_KEY,
    },
    async (identifier, profile, done) => {
      try {
        const steamId = profile.id;
        
        // 🌟 ดึงรูปภาพขนาดใหญ่ที่สุด (avatarfull) จากก้อนข้อมูลดิบ (_json)
        const avatarUrl = profile._json?.avatarfull || 
                          profile.photos?.[2]?.value || 
                          profile.photos?.[0]?.value || "";

        // อัปเดตข้อมูลผู้ใช้ หรือสร้างใหม่ถ้ายังไม่มี (Upsert)
        const result = await User.findOneAndUpdate(
          { steamId },
          {
            $set: {
              displayName: profile.displayName,
              avatar: avatarUrl,
              profileUrl: profile._json?.profileurl || "",
              lastLogin: new Date(),
            },
            $setOnInsert: {
              steamId,
              balance: 0,
              inventory: [],
            },
          },
          { upsert: true, new: true } // ใช้ new: true เพื่อคืนค่าข้อมูลที่อัปเดตแล้ว
        );

        console.log("✅ User DB Updated:", result?.steamId);
        return done(null, profile);
      } catch (err) {
        console.error("❌ DB error:", err.message);
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ── GET /auth/steam (ทางเข้าการ Login) ──────────────────
router.get("/steam", (req, res, next) => {
  // รับค่า redirect แฝงมาเพื่อส่งต่อกลับไปยังแอป
  const redirectUri = req.query.redirect || "myapp://auth/callback";
  
  // encode redirect ไปใน state ของ OpenID
  const state = Buffer.from(redirectUri).toString("base64");

  passport.authenticate("steam", {
    session: false,
    state,
  })(req, res, next);
});

// ── GET /auth/steam/return (ขากลับจาก Steam) ──────────────
router.get(
  "/steam/return",
  passport.authenticate("steam", {
    failureRedirect: `${BASE_URL}/auth/failed`,
    session: false,
  }),
  async (req, res) => {
    try {
      const steamUser = req.user;
      const avatarUrl = steamUser._json?.avatarfull || ""; // ดึงรูปภาพขนาดเต็ม

      // ค่าเริ่มต้นสำหรับ Redirect กลับไปที่มือถือ
      let redirectUri = "myapp://auth/callback";

      // decode state เพื่อดูว่าต้องยิงกลับไปที่ URL ไหน
      if (req.query.state) {
        try {
          redirectUri = Buffer.from(req.query.state, "base64").toString("utf-8");
        } catch (e) {
          console.log("❌ decode state error:", e);
        }
      }

      // 🌟 สร้าง JWT Token โดยแนบข้อมูลสำคัญลงไปด้วย
      const token = jwt.sign(
        {
          steamId: steamUser.id,
          displayName: steamUser.displayName,
          avatar: avatarUrl, 
        },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      // 🌟 ประกอบ URL สำหรับ Deep Link กลับเข้าแอป
      // แนบข้อมูลไปใน Query Params เพื่อให้ Frontend เก็บลง AsyncStorage ได้ทันที
      const appUrl =
        `${redirectUri}` +
        `?token=${token}` +
        `&steamId=${steamUser.id}` +
        `&name=${encodeURIComponent(steamUser.displayName)}` +
        `&avatar=${encodeURIComponent(avatarUrl)}`; 

      console.log("✅ Redirecting with Auth Data:", appUrl);
      return res.redirect(appUrl);
    } catch (err) {
      console.error("❌ ERROR:", err);
      return res.status(500).send("Server Error");
    }
  }
);

// ── GET /auth/failed ───────────────────────────────────
router.get("/failed", (req, res) => {
  console.log("❌ Steam login failed");
  res.redirect("myapp://auth/callback?error=login_failed");
});

// ── POST /auth/mock-login (สำหรับทดสอบ) ──────────────────
router.post("/mock-login", async (req, res) => {
  try {
    const { steamId, displayName } = req.body;
    const mockSteamId = steamId || "76561198283624115";
    const mockName = displayName || "TestUser";
    const mockAvatar = "https://avatars.akamai.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg";

    await User.findOneAndUpdate(
      { steamId: mockSteamId },
      {
        $set: {
          displayName: mockName,
          avatar: mockAvatar,
          lastLogin: new Date(),
        },
        $setOnInsert: {
          steamId: mockSteamId,
          balance: 0,
          inventory: [],
        },
      },
      { upsert: true, new: true }
    );

    const token = jwt.sign(
      { steamId: mockSteamId, displayName: mockName, avatar: mockAvatar },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
      steamId: mockSteamId,
      displayName: mockName,
      avatar: mockAvatar
    });
  } catch (err) {
    console.error("❌ mock-login error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /auth/verify ───────────────────────────────────
router.get("/verify", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "No token" });

  try {
    const user = jwt.verify(auth.replace("Bearer ", ""), JWT_SECRET);
    res.json({ success: true, user });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

// ── GET /auth/user/:steamId ────────────────────────────
router.get("/user/:steamId", async (req, res) => {
  try {
    const user = await User.findOne({ steamId: req.params.steamId });
    if (!user) return res.status(404).json({ error: "ไม่พบ User" });
    res.json({ success: true, user });
  } catch (err) {
    console.error("❌ user fetch error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;