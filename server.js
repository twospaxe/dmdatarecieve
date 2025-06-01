const axios = require("axios");
const express = require("express");
const WebSocket = require("ws");

const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
let latestEEW = null;

const app = express();
const PORT = process.env.PORT || 3000;

async function connectWebSocket() {
  try {
    console.log("Starting socket...");

    const res = await axios.post(
      "https://api.dmdata.jp/v2/socket/start",
      {},
      {
        headers: {
          "x-access-token": ACCESS_TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    const { websocketUrl, socketId } = res.data;

    const ws = new WebSocket(websocketUrl);

    ws.on("open", () => {
      console.log("Connected to DM-DSS WebSocket");
    });

    ws.on("message", (data) => {
      try {
        const json = JSON.parse(data);
        if (json.type === "eew") {
          latestEEW = json;
          console.log("Received EEW:", json);
        }
      } catch (err) {
        console.error("Error parsing message:", err);
      }
    });

    ws.on("close", () => {
      console.warn("WebSocket closed, reconnecting in 5s...");
      setTimeout(connectWebSocket, 5000);
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
    });
  } catch (err) {
    console.error("Failed to start socket:", err.response?.data || err.message);
    setTimeout(connectWebSocket, 5000);
  }
}

app.get("/eew", (req, res) => {
  if (latestEEW) {
    res.json(latestEEW);
  } else {
    res.status(204).send(); // No data yet
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  connectWebSocket();
});
