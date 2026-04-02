const express = require("express");
const router = express.Router();
const passport = require("passport");
const SteamStrategy = require("passport-steam").Strategy;
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "defuse_th_jwt_2024";
const pendingRedirects = new Map(); // state → redirectUri
// ── Passport Steam Strategy ────────────────────────────
passport.use(
  new SteamStrategy(
    {
      returnURL: `${process.env.SERVER_URL}/auth/steam/return`,
      realm: `${process.env.SERVER_URL}/`,
      apiKey: process.env.STEAM_API_KEY,
    },
    async (identifier, profile, done) => {
      try {
        const steamId = profile.id;
        await User.findOneAndUpdate(
          { steamId },
          {
            steamId,
            displayName: profile.displayName,
            avatar:
              profile.photos?.[2]?.value || profile.photos?.[0]?.value || "",
            profileUrl: profile._json?.profileurl || "",
            lastLogin: new Date(),
          },
          { upsert: true, returnDocument: "after" },
        );
        return done(null, profile);
      } catch (err) {
        return done(err, null);
      }
    },
  ),
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ── GET /auth/steam ────────────────────────────────────
router.get("/steam", (req, res, next) => {
  // ✅ รับ redirect จาก Frontend แล้วเก็บไว้ก่อน
  const redirectUri = req.query.redirect || "myapp://auth/callback";
  const state = Date.now().toString(); // unique key
  pendingRedirects.set(state, redirectUri);

  // ล้าง Map ไม่ให้ leak (หลัง 5 นาที)
  setTimeout(() => pendingRedirects.delete(state), 5 * 60 * 1000);

  passport.authenticate("steam", { session: false, state })(req, res, next);
});

// ── GET /auth/steam/return ─────────────────────────────
router.get(
  "/steam/return",
  passport.authenticate("steam", {
    failureRedirect: "/auth/failed",
    session: false,
  }),
  async (req, res) => {
    try {
      const steamUser = req.user;
      console.log("🔍 req.query:", req.query);
      // ✅ ดึง redirectUri ที่เก็บไว้
      const state = req.query.state;
      const redirectUri =
        pendingRedirects.get(state) || "myapp://auth/callback";
      pendingRedirects.delete(state); // ใช้แล้วลบทิ้ง

      const token = jwt.sign(
        {
          steamId: steamUser.id,
          displayName: steamUser.displayName,
          avatar: steamUser.photos?.[2]?.value || "",
        },
        JWT_SECRET,
        { expiresIn: "7d" },
      );

      // ✅ redirect ไปยัง URI ที่ Frontend ส่งมา (Deep Link หรือ Expo Proxy)
      const appUrl = `${redirectUri}?token=${token}&steamId=${steamUser.id}&name=${encodeURIComponent(steamUser.displayName)}`;

      console.log("✅ Redirecting to:", appUrl);
      res.redirect(appUrl);
    } catch (err) {
      console.error("Steam callback error:", err);
      res.redirect("myapp://auth/callback?error=server_error");
    }
  },
);

// ── GET /auth/failed ───────────────────────────────────
router.get("/failed", (req, res) => {
  res.redirect("myapp://auth/callback?error=login_failed");
});

// ── POST /auth/mock-login ──────────────────────────────
router.post("/mock-login", async (req, res) => {
  try {
    const { steamId, displayName } = req.body;

    const mockSteamId = steamId || "76561198283624115";
    const mockName = displayName || "TestUser";

    await User.findOneAndUpdate(
      { steamId: mockSteamId },
      {
        steamId: mockSteamId,
        displayName: mockName,
        avatar: "",
        lastLogin: new Date(),
      },
      { upsert: true, returnDocument: "after" },
    );

    const token = jwt.sign(
      { steamId: mockSteamId, displayName: mockName, avatar: "" },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({
      success: true,
      token,
      steamId: mockSteamId,
      displayName: mockName,
    });
  } catch (err) {
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
