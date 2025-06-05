const express = require("express");
const axios = require("axios");
const WebSocket = require("ws");
const zlib = require("zlib");

const app = express();
const PORT = process.env.PORT || 3000;

// DMData API key (from env variables)
const API_KEY = process.env.ACCESS_TOKEN;

let latestEEW = null;

// Start the DMData WebSocket connection
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
        headers: {
          Authorization: `Basic ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    const { websocket } = response.data;
    const ws = new WebSocket(websocket.url, ["dmdata.v2"]);

    ws.on("open", () => {
      console.log("✅ WebSocket connected.");
    });

    ws.on("message", (data) => {
      try {
        const json = JSON.parse(data);
console.log(json)
        // Respond to pings
        if (json.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", pingId: json.pingId }));
        }

        // Handle compressed EEW data
        else if (
          json.type === "data" &&
          json.body &&
          json.encoding === "base64" &&
          json.compression === "gzip"
        ) {
          const compressedBuffer = Buffer.from(json.body, "base64");

          zlib.gunzip(compressedBuffer, (err, decompressedBuffer) => {
            if (err) {
              console.error("❌ Decompression failed:", err);
              return;
            }

            let decompressedContent = decompressedBuffer.toString("utf-8");

            // Attempt JSON parsing if it's a JSON string
            try {
              if (
                decompressedContent.trim().startsWith("{") ||
                decompressedContent.trim().startsWith("[")
              ) {
                decompressedContent = JSON.parse(decompressedContent);
              }
            } catch {
              console.warn("⚠️ Decompressed body is not valid JSON.");
            }

            const { body, compression, encoding, ...rest } = json;

            latestEEW = {
              ...rest,
              parsedBody: decompressedContent
            };

            console.log("📡 EEW update received:");
            console.dir(latestEEW, { depth: null, colors: true });
          });
        }
      } catch (err) {
        console.error("❌ JSON parse error:", err);
      }
    });

    ws.on("close", () => {
      console.warn("⚠️ WebSocket closed. Reconnecting in 5s...");
      setTimeout(startSocket, 5000);
    });

    ws.on("error", (err) => {
      console.error("❌ WebSocket error:", err);
    });
  } catch (err) {
    console.error("❌ Failed to start socket:", err.response?.data || err.message);
    setTimeout(startSocket, 5000);
  }
}

// Serve the latest EEW data
app.get("/eew", (req, res) => {
  if (latestEEW) {
    res.json(latestEEW);
  } else {
    res.status(200).json({ status: "waiting", message: "No EEW data yet" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startSocket();

  // Keep-alive ping to prevent server sleep (useful on services like Replit)
  setInterval(() => {
    axios.get(`http://localhost:${PORT}/eew`)
      .then(() => console.log("🔁 Self-ping successful"))
      .catch(err => console.warn("⚠️ Self-ping failed:", err.message));
  }, 1000 * 60 * 4);
});
