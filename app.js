// ============================================================================
// app.js - Versão limpa e funcional
// ============================================================================

require('dotenv').config({ path: 'dados.env' });
const path = require('path');
const express = require('express');
const mqtt = require('mqtt');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// Dados em memória
let sensorData = {
  gas: 0,
  ppm: 0.0,
  status: 'AGUARDANDO',
  timestamp: new Date().toISOString(),
  history: []
};

const MAX_HISTORY = 200;
let mqttClient = null;

function broadcast(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

function connectMQTT() {
  const broker = process.env.MQTT_BROKER || 'localhost';
  const port = process.env.MQTT_PORT || '1883';
  const url = 'mqtt://' + broker + ':' + port;

  console.log('\nConectando MQTT em: ' + url);

  mqttClient = mqtt.connect(url, {
    clientId: 'dashboard_' + Math.random().toString(16).slice(2, 8),
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 5000
  });

  mqttClient.on('connect', () => {
    console.log('MQTT conectado');

    const topics = [
      process.env.MQTT_TOPIC_GAS,
      process.env.MQTT_TOPIC_PPM,
      process.env.MQTT_TOPIC_STATUS
    ].filter(Boolean);

    if (topics.length) {
      mqttClient.subscribe(topics, (err) => {
        if (err) console.log('Erro ao subscrever tópicos:', err.message || err);
        else console.log('Inscrito em tópicos:', topics.join(', '));
      });
    }

    broadcast({ type: 'mqtt', status: 'connected' });
  });

  mqttClient.on('message', (topic, payload) => {
    const value = payload.toString();
    const now = new Date();

    if (topic === process.env.MQTT_TOPIC_GAS) sensorData.gas = parseInt(value) || 0;
    else if (topic === process.env.MQTT_TOPIC_PPM) sensorData.ppm = parseFloat(value) || 0.0;
    else if (topic === process.env.MQTT_TOPIC_STATUS) sensorData.status = value;

    sensorData.timestamp = now.toISOString();
    sensorData.history.push({ gas: sensorData.gas, ppm: sensorData.ppm, status: sensorData.status, timestamp: sensorData.timestamp });
    if (sensorData.history.length > MAX_HISTORY) sensorData.history.shift();

    console.log('Dados:', sensorData.gas, sensorData.ppm, sensorData.status);
    broadcast({ type: 'data', data: sensorData });
  });

  mqttClient.on('error', (err) => console.log('MQTT erro:', err && err.message ? err.message : err));
  mqttClient.on('close', () => { console.log('MQTT desconectado'); broadcast({ type: 'mqtt', status: 'disconnected' }); });
}

connectMQTT();

// WebSocket
wss.on('connection', (ws) => {
  console.log('Cliente WS conectado (total: ' + wss.clients.size + ')');
  ws.send(JSON.stringify({ type: 'init', data: sensorData }));
});

// API
app.use(express.json());
app.get('/api/current', (req, res) => res.json(sensorData));
app.get('/api/history', (req, res) => res.json(sensorData.history));
app.post('/api/clear', (req, res) => { sensorData.history = []; broadcast({ type: 'cleared' }); res.json({ success: true }); });

// Serve frontend static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Start server
server.listen(PORT, () => {
  console.log('\nServidor iniciado: http://localhost:' + PORT);
});