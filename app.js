// ============================================================================
// app.js - Servidor Express + MQTT + WebSocket
// Comentários adicionados para explicar cada parte do fluxo.
// ============================================================================

// Carrega variáveis de ambiente a partir do arquivo `dados.env` (dotenv)
require('dotenv').config({ path: 'dados.env' });
const path = require('path');
const express = require('express');         // Framework web
const mqtt = require('mqtt');               // Cliente MQTT para receber dados de sensores
const http = require('http');
const WebSocket = require('ws');           // WebSocket para enviar dados em tempo real ao frontend

// Inicializa Express e servidor HTTP (WebSocket usará o mesmo servidor)
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;      // Porta padrão

// Estrutura em memória para armazenar o estado atual dos sensores e histórico
let sensorData = {
  gas: 0,                                   // leitura do sensor de gás (inteiro)
  ppm: 0.0,                                 // leitura de PPM (float)
  status: 'AGUARDANDO',                     // status textual enviado via MQTT
  timestamp: new Date().toISOString(),      // timestamp da última atualização
  history: []                               // array com histórico recente de leituras
};

const MAX_HISTORY = 200;                     // tamanho máximo do histórico em memória
let mqttClient = null;                       // referência para o cliente MQTT (inicializada depois)

// Envia uma mensagem JSON para todos os clientes WebSocket conectados
function broadcast(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

// Função que cria/conecta o cliente MQTT e configura os handlers
function connectMQTT() {
  // Broker e porta podem vir do arquivo .env
  const broker = process.env.MQTT_BROKER || 'localhost';
  const port = process.env.MQTT_PORT || '1883';
  const url = 'mqtt://' + broker + ':' + port;

  console.log('\nConectando MQTT em: ' + url);

  // Cria cliente MQTT com clientId aleatório e opções de reconexão
  mqttClient = mqtt.connect(url, {
    clientId: 'dashboard_' + Math.random().toString(16).slice(2, 8),
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 5000
  });

  // Ao conectar, subscreve os tópicos configurados via variáveis de ambiente
  mqttClient.on('connect', () => {
    console.log('MQTT conectado');

    // Tópicos possíveis (puxados do .env). Filtra valores "falsy" caso não existam.
    const topics = [
      process.env.MQTT_TOPIC_GAS,
      process.env.MQTT_TOPIC_PPM,
      process.env.MQTT_TOPIC_STATUS
    ].filter(Boolean);

    // Se houver tópicos, inscreve-se neles
    if (topics.length) {
      mqttClient.subscribe(topics, (err) => {
        if (err) console.log('Erro ao subscrever tópicos:', err.message || err);
        else console.log('Inscrito em tópicos:', topics.join(', '));
      });
    }

    // Avisa os clientes WebSocket que o MQTT está conectado
    broadcast({ type: 'mqtt', status: 'connected' });
  });

  // Ao receber mensagens MQTT, processa conforme o tópico
  mqttClient.on('message', (topic, payload) => {
    const value = payload.toString();
    const now = new Date();

    // Decide qual campo atualizar com base no tópico recebido
    if (topic === process.env.MQTT_TOPIC_GAS) sensorData.gas = parseInt(value) || 0;
    else if (topic === process.env.MQTT_TOPIC_PPM) sensorData.ppm = parseFloat(value) || 0.0;
    else if (topic === process.env.MQTT_TOPIC_STATUS) sensorData.status = value;

    // Atualiza timestamp e adiciona ao histórico
    sensorData.timestamp = now.toISOString();
    sensorData.history.push({ gas: sensorData.gas, ppm: sensorData.ppm, status: sensorData.status, timestamp: sensorData.timestamp });

    // Mantém apenas os últimos MAX_HISTORY itens para evitar crescimento ilimitado
    if (sensorData.history.length > MAX_HISTORY) sensorData.history.shift();

    // Log simples no servidor e envio em tempo real para frontends conectados
    console.log('Dados:', sensorData.gas, sensorData.ppm, sensorData.status);
    broadcast({ type: 'data', data: sensorData });
  });

  // Handlers básicos de erro/fechamento
  mqttClient.on('error', (err) => console.log('MQTT erro:', err && err.message ? err.message : err));
  mqttClient.on('close', () => { console.log('MQTT desconectado'); broadcast({ type: 'mqtt', status: 'disconnected' }); });
}

// Inicia a conexão MQTT
connectMQTT();

// Quando um cliente WebSocket se conecta, enviamos o estado inicial
wss.on('connection', (ws) => {
  console.log('Cliente WS conectado (total: ' + wss.clients.size + ')');
  ws.send(JSON.stringify({ type: 'init', data: sensorData }));
});

// --- Endpoints HTTP simples para o frontend consumir ---
app.use(express.json());

// Retorna o estado atual dos sensores
app.get('/api/current', (req, res) => res.json(sensorData));

// Retorna o histórico armazenado em memória
app.get('/api/history', (req, res) => res.json(sensorData.history));

// Limpa o histórico (útil para depuração/controle)
app.post('/api/clear', (req, res) => { sensorData.history = []; broadcast({ type: 'cleared' }); res.json({ success: true }); });

// Serve os arquivos estáticos do frontend na pasta /public
app.use(express.static(path.join(__dirname, 'public')));

// Inicia servidor HTTP + WebSocket
server.listen(PORT, () => {
  console.log('\nServidor iniciado: http://localhost:' + PORT);
});