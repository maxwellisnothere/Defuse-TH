const express = require("express");
const router = express.Router();
const passport = require("passport");
const SteamStrategy = require("passport-steam").Strategy;
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "defuse_th_jwt_2024";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

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
        const avatarUrl = profile._json?.avatarfull || profile.photos?.[2]?.value || "";

        // 🟢 ใช้ return เพื่อให้จบฟังก์ชันแน่นอนหลังเรียก done
        const result = await User.findOneAndUpdate(
          { steamId }, 
          {
            $set: {
              displayName: profile.displayName,
              avatar: avatarUrl,
              profileUrl: profile._json?.profileurl || "",
              lastLogin: new Date(),
            },
            $setOnInsert: { steamId, balance: 0, inventory: [] },
          },
          { upsert: true, new: true }
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

// ── GET /auth/steam ──────────────────
router.get("/steam", (req, res, next) => {
  const redirectUri = req.query.redirect || "myapp://auth/callback";
  const state = Buffer.from(redirectUri).toString("base64");

  // 🟢 Passport-Steam ต้องการ session ในการทำงานของ OpenID 
  // แม้เราจะใช้ JWT เราก็ควรปล่อยให้ Passport ใช้ session ชั่วคราวไปก่อน
  passport.authenticate("steam", { state })(req, res, next);
});

// ── GET /auth/steam/return ──────────────
router.get(
  "/steam/return",
  // 🟢 ถอด failureRedirect ออกจาก middleware เพื่อมาจัดการเองข้างล่างให้ชัวร์กว่า
  (req, res, next) => {
    passport.authenticate("steam", (err, user, info) => {
      if (err || !user) {
        console.error("❌ Steam Auth Failed:", err || "No user found");
        return res.redirect(`${BASE_URL}/auth/failed`);
      }

      // 🟢 ทำงานต่อในรูปแบบ async 
      (async () => {
        try {
          const steamUser = user;
          const avatarUrl = steamUser._json?.avatarfull || "";
          let redirectUri = "myapp://auth/callback";

          if (req.query.state) {
            try {
              redirectUri = Buffer.from(req.query.state, "base64").toString("utf-8");
            } catch (e) {
              console.log("❌ decode state error:", e);
            }
          }

          const token = jwt.sign(
            { steamId: steamUser.id, displayName: steamUser.displayName, avatar: avatarUrl },
            JWT_SECRET,
            { expiresIn: "7d" }
          );

          const appUrl = `${redirectUri}?token=${token}&steamId=${steamUser.id}&name=${encodeURIComponent(steamUser.displayName)}&avatar=${encodeURIComponent(avatarUrl)}`;

          console.log("✅ Auth Success, Redirecting...");
          
          // 🟢 ตรวจสอบว่าหัวข้อมูลยังไม่ถูกส่งไปก่อนหน้านี้
          if (!res.headersSent) {
            return res.redirect(appUrl);
          }
        } catch (err) {
          console.error("❌ Error in Return Route:", err);
          if (!res.headersSent) {
            return res.status(500).send("Internal Server Error");
          }
        }
      })();
    })(req, res, next);
  }
);

// ── GET /auth/failed ──────────────────
router.get("/failed", (req, res) => {
  if (!res.headersSent) {
    return res.redirect("myapp://auth/callback?error=login_failed");
  }
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