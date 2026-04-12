const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const axios = require("axios");
const WebSocket = require("ws");
const zlib = require("zlib");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

// Force IPv4 for HTTPS (Render stability)
const agent = new https.Agent({
  family: 4
});

const API_KEY = process.env.ACCESS_TOKEN;

let latestEEW = null;
let reconnectTimer = null;

async function startSocket() {
  try {
    console.log("🔌 Starting WebSocket...");

    if (!API_KEY) {
      throw new Error("Missing ACCESS_TOKEN env variable");
    }

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
        httpsAgent: agent,
        timeout: 20000,
        headers: {
          Authorization: `Basic ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    if (!response.data || !response.data.websocket) {
      throw new Error(
        "Invalid DMData response: " + JSON.stringify(response.data)
      );
    }

    const { websocket } = response.data;

    console.log("🌐 WS URL:", websocket.url);

    const ws = new WebSocket(websocket.url, {
      headers: {
        "User-Agent": "EEWMonitor"
      }
    });

    ws.on("open", () => {
      console.log("✅ WebSocket connected");
    });

    ws.on("message", (data) => {
      try {
        const json = JSON.parse(data);

        if (json.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", pingId: json.pingId }));
          return;
        }

        if (
          json.type === "data" &&
          json.body &&
          json.encoding === "base64" &&
          json.compression === "gzip"
        ) {
          const compressedBuffer = Buffer.from(json.body, "base64");

          zlib.gunzip(compressedBuffer, (err, decompressedBuffer) => {
            if (err) {
              console.error("❌ Decompression error:", err);
              return;
            }

            let content = decompressedBuffer.toString("utf8");

            try {
              if (
                content.trim().startsWith("{") ||
                content.trim().startsWith("[")
              ) {
                content = JSON.parse(content);
              }
            } catch {}

            const { body, compression, encoding, ...rest } = json;

            latestEEW = {
              ...rest,
              parsedBody: content
            };

            console.log("📡 EEW update received");
          });
        }
      } catch (err) {
        console.error("❌ Message parse error:", err);
      }
    });

    ws.on("close", (code, reason) => {
      console.warn("⚠️ WebSocket closed");
      console.warn("code:", code);
      console.warn("reason:", reason?.toString());

      scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.error("❌ WebSocket error FULL:", err);
    });

  } catch (err) {
    console.error("❌ Failed to start socket FULL DEBUG:");
    console.error("code:", err.code);
    console.error("message:", err.message);
    console.error("errno:", err.errno);
    console.error("syscall:", err.syscall);
    console.error("address:", err.address);

    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startSocket();
  }, 5000);

  console.log("🔁 Reconnecting in 5 seconds...");
}

// API endpoint
app.get("/eew", (req, res) => {
  if (latestEEW) {
    res.json(latestEEW);
  } else {
    res.json({
      status: "waiting",
      message: "No EEW data yet"
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startSocket();
});
