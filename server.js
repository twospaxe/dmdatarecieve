const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
const crypto = require("crypto");
const express = require("express");
const compression = require("compression");
const axios = require("axios");
const WebSocket = require("ws");
const zlib = require("zlib");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

// Force IPv4 for HTTPS (Render stability)
const agent = new https.Agent({ family: 4 });

const API_KEY = process.env.ACCESS_TOKEN;

let latestEEW = null;
let latestEtag = null;      // hash of the current payload, used for 304 responses
let latestJson = null;      // pre-serialized JSON string, computed once per update
let reconnectTimer = null;
let reconnectDelay = 5000;  // starts at 5s, backs off on repeated failures
const MAX_RECONNECT_DELAY = 60000;

// --- SSE (push) support: avoids clients needing to poll at all ---
const sseClients = new Set();

function broadcastSSE() {
  if (!latestJson) return;
  const payload = `data: ${latestJson}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

function setLatestEEW(obj) {
  latestEEW = obj;
  latestJson = JSON.stringify(obj);
  latestEtag = crypto.createHash("sha1").update(latestJson).digest("hex");

  const lite = buildLitePayload(obj);
  liteJson = JSON.stringify(lite);
  liteEtag = crypto.createHash("sha1").update(liteJson).digest("hex");

  broadcastSSE();
}

// --- Express setup ---
app.use(compression()); // gzip all HTTP responses (biggest win for repeated JSON polling)

async function startSocket() {
  try {
    console.log("Starting WebSocket...");
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
      throw new Error("Invalid DMData response: " + JSON.stringify(response.data));
    }

    const { websocket } = response.data;
    console.log("WS URL:", websocket.url);

    // perMessageDeflate compresses WS frame overhead/control messages.
    // The EEW body itself is already gzip-compressed by DMData at the app
    // layer, so this mainly helps framing/ping overhead, not the payload.
    const ws = new WebSocket(websocket.url, {
      headers: { "User-Agent": "EEWMonitor" },
      perMessageDeflate: true
    });

    ws.on("open", () => {
      console.log("WebSocket connected");
      reconnectDelay = 5000; // reset backoff on a clean connect
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
              console.error("Decompression error:", err);
              return;
            }
            let content = decompressedBuffer.toString("utf8");
            try {
              if (content.trim().startsWith("{") || content.trim().startsWith("[")) {
                content = JSON.parse(content);
              }
            } catch {}

            const { body, compression: _c, encoding, ...rest } = json;
            setLatestEEW({ ...rest, parsedBody: content });
            console.log("EEW update received");
          });
        }
      } catch (err) {
        console.error("Message parse error:", err);
      }
    });

    ws.on("close", (code, reason) => {
      console.warn("WebSocket closed:", code, reason?.toString());
      for (const res of sseClients) res.end();
      sseClients.clear();
      scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err.message);
    });
  } catch (err) {
    console.error("Failed to start socket:", err.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startSocket();
  }, reconnectDelay);
  console.log(`Reconnecting in ${reconnectDelay / 1000}s...`);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

// --- Polling endpoint, now bandwidth-aware ---
// Clients that send `If-None-Match` with the previous ETag get a 304 with
// an empty body instead of re-downloading the full (unchanged) JSON.
app.get("/eew", (req, res) => {
  if (!latestEEW) {
    return res.json({ status: "waiting", message: "No EEW data yet" });
  }

  res.set("Cache-Control", "no-cache");
  res.set("ETag", latestEtag);

  if (req.headers["if-none-match"] === latestEtag) {
    return res.status(304).end();
  }

  res.type("application/json").send(latestJson);
});

// --- Lightweight endpoint for frequent polling (e.g. from Roblox) ---
// Returns only the fields you actually need in-game instead of the full
// raw parsedBody, so each successful (non-304) fetch is much smaller.
// Falls back to sending everything if the expected fields aren't present,
// so this degrades safely if DMData's payload shape changes.
let liteEtag = null;
let liteJson = null;

function buildLitePayload(full) {
  const b = full.parsedBody;
  if (!b || typeof b !== "object") return full;

  const lite = {
    reportTime: b.reportTime ?? full.head?.time ?? null,
    originTime: b.originTime ?? null,
    hypocenter: b.earthquake?.hypocenter?.name ?? null,
    magnitude: b.earthquake?.hypocenter?.magnitude?.value ?? null,
    depth: b.earthquake?.hypocenter?.depth?.value ?? null,
    maxIntensity: b.intensity?.forecastMaxInt?.from ?? null,
    isFinal: b.isFinal ?? full.head?.type === "VXSE45" ?? null,
    isCanceled: b.isCanceled ?? false
  };

  // If none of the expected fields resolved, this schema guess didn't
  // match — send the full object instead of a payload of nulls.
  const hasAnyField = Object.values(lite).some((v) => v !== null && v !== false);
  return hasAnyField ? lite : full;
}

app.get("/eew/lite", (req, res) => {
  if (!latestEEW) {
    return res.json({ status: "waiting", message: "No EEW data yet" });
  }

  res.set("Cache-Control", "no-cache");
  res.set("ETag", liteEtag);

  if (req.headers["if-none-match"] === liteEtag) {
    return res.status(304).end();
  }

  res.type("application/json").send(liteJson);
});

// --- Push endpoint: avoids polling entirely for clients that support SSE ---
app.get("/eew/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.flushHeaders();

  // send current state immediately on connect
  if (latestJson) {
    res.write(`data: ${latestJson}\n\n`);
  }

  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startSocket();
});
