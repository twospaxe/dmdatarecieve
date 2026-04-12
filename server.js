const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const axios = require("axios");
const WebSocket = require("ws");
const zlib = require("zlib");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

// Force IPv4 for axios requests (important for Render)
const agent = new https.Agent({
  family: 4
});

// DMData API key
const API_KEY = process.env.ACCESS_TOKEN;

let latestEEW = null;

// Start DMData WebSocket
async function startSocket() {
  try {
    console.log("🔌 Starting WebSocket...");

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
        timeout: 15000,
        headers: {
          Authorization: `Basic ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    const { websocket } = response.data;

    console.log("🌐 Connecting to DMData WebSocket...");
    const ws = new WebSocket(websocket.url, ["dmdata.v2"]);

    ws.on("open", () => {
      console.log("✅ WebSocket connected");
    });

    ws.on("message", (data) => {
      try {
        const json = JSON.parse(data);

        // Handle ping
        if (json.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", pingId: json.pingId }));
          return;
        }

        // Handle compressed EEW data
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
              if (content.trim().startsWith("{") || content.trim().startsWith("[")) {
                content = JSON.parse(content);
              }
            } catch {
              console.warn("⚠️ Decompressed body not valid JSON");
            }

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

    ws.on("close", () => {
      console.warn("⚠️ WebSocket closed. Reconnecting in 3 seconds...");
      setTimeout(startSocket, 3000);
    });

    ws.on("error", (err) => {
      console.error("❌ WebSocket error:", err.message);
    });

  } catch (err) {
    console.error("❌ Failed to start socket FULL DEBUG:");
    console.error("code:", err.code);
    console.error("message:", err.message);
    console.error("errno:", err.errno);
    console.error("syscall:", err.syscall);
    console.error("address:", err.address);

    setTimeout(startSocket, 5000);
}
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startSocket();
});
