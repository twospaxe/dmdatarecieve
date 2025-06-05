const express = require("express");
const axios = require("axios");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

// DMData API key (set this in your hosting platform's environment variables)
const API_KEY = process.env.ACCESS_TOKEN;

let latestEEW = null;

// Start the DMData WebSocket connection
async function startSocket() {
  try {
    console.log("Starting socket...");

    const token = Buffer.from(`${API_KEY}:`).toString("base64");

    const response = await axios.post(
      "https://api.dmdata.jp/v2/socket",
      {
        classifications: ["eew.forecast"],
        types: ["VXSE45"], ["VXSE42"],
        test: "no",
        appName: "EEWMonitor",
        formatMode: "json"
      },
      {
        headers: {
          "Authorization": `Basic ${token}`,
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

        // Save EEW telegrams
        else if (json._schema && json._schema.type) {
          latestEEW = json;
          console.log("📡 EEW update received:");
          console.dir(json, { depth: null, colors: true });
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

// Serve the latest EEW data at /eew
app.get("/eew", (req, res) => {
  if (latestEEW) {
    res.json(latestEEW);
  } else {
    res.status(200).json({ status: "waiting", message: "No EEW data yet" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startSocket();

  // 🔁 Self-ping every 4 minutes to prevent sleeping
  setInterval(() => {
    axios.get(`http://localhost:${PORT}/eew`)
      .then(() => console.log("🔁 Self-ping successful"))
      .catch(err => console.warn("⚠️ Self-ping failed:", err.message));
  }, 1000 * 60 * 4); // Every 4 minutes
});
