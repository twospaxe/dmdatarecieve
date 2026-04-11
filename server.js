const dns = require("dns");
// 🔥 Force IPv4 globally (extra safety)
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const axios = require("axios");
const WebSocket = require("ws");
const zlib = require("zlib");

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.ACCESS_TOKEN;

let latestEEW = null;

async function startSocket() {
  try {
    console.log("🔌 Starting socket...");

    const token = Buffer.from(`${API_KEY}:`).toString("base64");

    const response = await axios.post(
      "https://api.dmdata.jp/v2/socket",
      {
        classifications: ["eew.forecast"],
        types: ["VXSE45", "VXSE42"],
        test: "no",
        appName: "EEWMonitor",
        formatMode: "json"
      },
      {
        timeout: 10000,
        headers: {
          Authorization: `Basic ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    const { websocket } = response.data;

    console.log("✅ WS URL:", websocket.url);

    // 🔥 IPv4-safe WebSocket connection (IMPORTANT FIX)
    const ws = new WebSocket(websocket.url, ["dmdata.v2"], {
      handshakeTimeout: 10000,

      lookup: (hostname, options, callback) => {
        return dns.lookup(hostname, { family: 4 }, callback);
      }
    });

    ws.on("open", () => {
      console.log("✅ WebSocket connected.");
    });

    ws.on("message", (data) => {
      try {
        const json = JSON.parse(data);

        if (json.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", pingId: json.pingId }));
        }

        else if (
          json.type === "data" &&
          json.body &&
          json.encoding === "base64" &&
          json.compression === "gzip"
        ) {
          const buffer = Buffer.from(json.body, "base64");

          zlib.gunzip(buffer, (err, decompressed) => {
            if (err) {
              console.error("❌ Decompress error:", err);
              return;
            }

            let text = decompressed.toString("utf-8");

            try {
              text = JSON.parse(text);
            } catch {}

            const { body, compression, encoding, ...rest } = json;

            latestEEW = {
              ...rest,
              parsedBody: text
            };

            console.log("📡 EEW:");
            console.dir(latestEEW, { depth: null });
          });
        }

      } catch (err) {
        console.error("❌ Message parse error:", err);
      }
    });

    ws.on("close", () => {
      console.warn("⚠️ WebSocket closed. Reconnecting...");
      setTimeout(startSocket, 5000);
    });

    ws.on("error", (err) => {
      console.error("❌ WebSocket error:", err);
    });

  } catch (err) {
    console.error("❌ Failed to start socket:");
    console.error("message:", err.message);
    console.error("code:", err.code);
    console.error("stack:", err.stack);

    if (err.response) {
      console.error("status:", err.response.status);
      console.error("data:", err.response.data);
    }

    setTimeout(startSocket, 5000);
  }
}

// API endpoint
app.get("/eew", (req, res) => {
  res.json(latestEEW || { status: "waiting" });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startSocket();

  // keep-alive
  setInterval(() => {
    axios.get(`http://127.0.0.1:${PORT}/eew`)
      .catch(() => {});
  }, 240000);
});
