require("dotenv").config();
const axios = require("axios");
const express = require("express");
const WebSocket = require("ws");

const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PORT = process.env.PORT || 3000;

const app = express();
let latestEEW = null;

async function connectWebSocket() {
  try {
    console.log("🔌 Starting WebSocket connection to DM-DATA...");

    const response = await axios.post(
      "https://api.dmdata.jp/v2/socket/start",
      {},
      {
        headers: {
          "x-access-token": ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const { websocketUrl } = response.data;
    const ws = new WebSocket(websocketUrl);

    ws.on("open", () => {
      console.log("✅ Connected to DM-DATA WebSocket.");
    });

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data);

        if (message.type === "eew") {
          latestEEW = message;
          console.log("🌐 Received EEW update.");
        }
      } catch (err) {
        console.error("❌ Error parsing WebSocket message:", err.message);
      }
    });

    ws.on("close", () => {
      console.warn("⚠️ WebSocket closed. Reconnecting in 5 seconds...");
      setTimeout(connectWebSocket, 5000);
    });

    ws.on("error", (err) => {
      console.error("🚨 WebSocket error:", err.message);
    });

  } catch (err) {
    console.error("❌ Failed to start socket:", err.response?.data || err.message);
    setTimeout(connectWebSocket, 5000);
  }
}

app.get("/eew", (req, res) => {
  if (latestEEW) {
    res.json(latestEEW);
  } else {
    res.status(204).send(); // No EEW available yet
  }
});

app.get("/", (req, res) => {
  res.send("DMDATA EEW Server is running.");
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  connectWebSocket();
});
