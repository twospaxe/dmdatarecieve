const express = require("express");
const axios = require("axios");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

// Your DMData API key (use .env in production)
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
    classifications: ["telegram.earthquake"],
    types: ["VXSE45"],
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
    console.log(response.data)
    const ws = new WebSocket(websocket.url, ['dmdata.v2']);

    ws.on("open", () => {
      console.log("✅ WebSocket connected.");
    });

ws.on("message", (data) => {
  console.log("📨 WebSocket message received:");
  console.log(data.toString()); // Log raw message for debugging

  try {
    const json = JSON.parse(data);

    // Respond to ping
    if (json.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", pingId: json.pingId }));
    }

    // Handle EEW telegrams
    else if (json.type === "data" && json.classification === "telegram.earthquake") {
      latestEEW = json;
      console.log("📡 EEW update received:");
      console.dir(json, { depth: null, colors: true }); // Log structured data nicely
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

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startSocket();
});
