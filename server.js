const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/**
 * 🔥 Endpoint: ดึง price history จาก Steam
 * ใช้: /price-history?name=AK-47 | Redline (Field-Tested)
 */
app.get("/price-history", async (req, res) => {
  try {
    const { name } = req.query;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Missing name parameter",
      });
    }

    const url = `https://steamcommunity.com/market/pricehistory/?appid=730&market_hash_name=${encodeURIComponent(
      name
    )}`;

    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!response.data || !response.data.success) {
      return res.status(500).json({
        success: false,
        error: "Steam API failed",
        data: response.data,
      });
    }

    return res.json({
      success: true,
      prices: response.data.prices,
    });
  } catch (error) {
    console.error("Error fetching price history:", error.message);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 🔥 Health check (ไว้เช็คว่า server รันอยู่)
 */
app.get("/", (req, res) => {
  res.send("API is running 🚀");
});

/**
 * 🚀 Start server
 */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
