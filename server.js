// server.js
const WebSocket = require('ws');
const express = require('express');

const TOKEN = 'YOUR_ACCESS_TOKEN'; // From DM-DSS
let latestEEW = null;

const ws = new WebSocket('wss://api.dmdata.jp/v2/websocket');

ws.on('open', () => {
  console.log('Connected to DM-DSS');

  ws.send(JSON.stringify({
    type: "authenticate",
    accessToken: TOKEN
  }));

  // After auth, subscribe to EEW
  ws.send(JSON.stringify({
    type: "ping"
  }));
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data);

    if (msg.type === 'eew') {
      latestEEW = msg;
      console.log('Received EEW:', msg);
    }
  } catch (e) {
    console.error('Error parsing:', e);
  }
});

// Express server to let Roblox fetch the EEW
const app = express();

app.get('/eew', (req, res) => {
  if (latestEEW) {
    res.json(latestEEW);
  } else {
    res.status(204).send(); // No data yet
  }
});

app.listen(3000, () => {
  console.log('Listening on port 3000');
});
