// ============================================================================
// ESP32 + MQ2 + MQTT - VERSÃO SIMPLIFICADA
// Comentários em português adicionados para explicar cada bloco
// ============================================================================

// Bibliotecas principais
#include <WiFi.h>           // Conexão WiFi para ESP32
#include <PubSubClient.h>  // Cliente MQTT

// ---------------------------
// Configuração WiFi
// ---------------------------
// Ajuste `WIFI_SSID` e `WIFI_PASSWORD` para sua rede.
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASSWORD = ""; // rede aberta no exemplo Wokwi

// ---------------------------
// Configuração MQTT
// ---------------------------
// Endereço do broker MQTT e porta (p.ex. Mosquitto, EMQX, etc.)
const char* BROKER_MQTT = "44.223.43.74";
const int BROKER_PORT = 1883;
const char* ID_MQTT = "fiware_esp32_mq2_001"; // clientId utilizado na conexão

// Tópicos MQTT usados para publicar os valores
const char* TOPICO_GAS = "/TEF/device001/attrs/gas";
const char* TOPICO_PPM = "/TEF/device001/attrs/ppm";
const char* TOPICO_STATUS = "/TEF/device001/attrs/status";

// ---------------------------
// Pinos do sensor MQ2
// ---------------------------
// PIN_MQ2_ANALOG: entrada analógica (ADC) para leitura do valor bruto
// PIN_MQ2_DIGITAL: saída digital do módulo MQ2 (threshold configurável no módulo)
#define PIN_MQ2_ANALOG 35
#define PIN_MQ2_DIGITAL 4

// ---------------------------
// Constantes de calibração
// ---------------------------
// A curva do sensor MQ2 (aproximação) é definida por dois parâmetros A e B
// Valores exemplo; para medições precisas é necessário calibrar no seu ambiente.
#define MQ2_CURVE_A 116.6024
#define MQ2_CURVE_B -2.6268

// Variáveis globais usadas pelo programa
WiFiClient espClient;                 // cliente TCP para o PubSubClient
PubSubClient mqtt(espClient);        // cliente MQTT
unsigned long lastMsg = 0;           // timestamp da última publicação

// ============================================================================
// SETUP - executado uma vez na inicialização
// ============================================================================

void setup() {
  Serial.begin(115200); // inicializa saída serial para debug
  delay(1000);
  
  // Banner inicial (apenas informativo no Serial)
  Serial.println("\n\n╔════════════════════════════════════╗");
  Serial.println("║  ESP32 + MQ2 + MQTT (Simples)    ║");
  Serial.println("╚════════════════════════════════════╝\n");
  
  // Configura os pinos do sensor: digital e analógico
  pinMode(PIN_MQ2_DIGITAL, INPUT);
  pinMode(PIN_MQ2_ANALOG, INPUT);
  Serial.println("✓ Hardware OK\n");
  
  // Conecta à rede WiFi (função abaixo)
  conectarWiFi();
  
  // Configura o broker MQTT (não conecta aqui, apenas seta servidor)
  mqtt.setServer(BROKER_MQTT, BROKER_PORT);
  Serial.printf("✓ MQTT configurado: %s:%d\n\n", BROKER_MQTT, BROKER_PORT);
}

// ============================================================================
// LOOP - executado repetidamente
// ============================================================================

void loop() {
  // Garante que o WiFi esteja conectado; tenta reconectar se necessário
  if (WiFi.status() != WL_CONNECTED) {
    conectarWiFi();
  }
  
  // Garante que o MQTT esteja conectado; tenta reconectar se necessário
  if (!mqtt.connected()) {
    conectarMQTT();
  }
  
  // Mantém o loop do cliente MQTT (processa pings/keepalive e callbacks)
  mqtt.loop();
  
  // Publica leituras periodicamente (aqui a cada ~5 segundos)
  if (millis() - lastMsg > 5000) {
    lastMsg = millis();
    publicarDados();
  }
  
  // Pequeno delay para evitar loop apertado
  delay(100);
}

// ============================================================================
// Funções relacionadas ao WiFi
// ============================================================================

void conectarWiFi() {
  Serial.println("🔌 Conectando WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  // Aguarda até 10 segundos (20 * 500ms) pela conexão
  int tentativas = 0;
  while (WiFi.status() != WL_CONNECTED && tentativas < 20) {
    delay(500);
    Serial.print(".");
    tentativas++;
  }
  
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    // Imprime o IP obtido
    Serial.printf("✓ WiFi OK | IP: %s\n\n", WiFi.localIP().toString().c_str());
  } else {
    // Se falhar, o código continua — o loop principal tentará reconectar depois
    Serial.println("✗ WiFi falhou (continuando...)\n");
  }
}

// ============================================================================
// Funções relacionadas ao MQTT
// ============================================================================

void conectarMQTT() {
  // Tenta conectar ao broker com o clientId definido
  Serial.print("🔄 MQTT conectando... ");
  
  if (mqtt.connect(ID_MQTT)) {
    Serial.println("✓ OK\n");
  } else {
    // Se falhar, `mqtt.state()` retorna código de erro útil para debug
    Serial.printf("✗ Falha (rc=%d)\n", mqtt.state());
  }
}

// ============================================================================
// Leitura e processamento do sensor MQ2
// ============================================================================

// Lê o valor ADC bruto do pino analógico (0..4095 para ESP32 ADC 12-bit)
float lerADC() {
  return (float)analogRead(PIN_MQ2_ANALOG);
}

// Converte o valor analógico do MQ2 em PPM aproximado usando a curva empírica
// A relação usada é: ppm = A * (ratio ^ B), onde ratio = (Vrl / Vrl..)
float calcularPPM(float analogValue) {
  if (analogValue <= 0) return 0; // evita divisão por zero
  
  // Para o módulo MQ2 típico com divisor de tensão: ratio = (4095 - analog) / analog
  float ratio = (4095.0 - analogValue) / analogValue;
  float ppm = MQ2_CURVE_A * pow(ratio, MQ2_CURVE_B);
  
  // Garante que o valor não seja negativo
  return fmax(0.0f, ppm);
}

// Determina um status textual com base no valor de PPM calculado
String obterStatus(float ppm) {
  if (ppm > 1000) return "CRITICO"; // valor muito alto
  if (ppm > 300) return "AVISO";    // valor alto
  return "NORMAL";                 // valor dentro do esperado
}

// ============================================================================
// Publicação dos dados via MQTT
// ============================================================================

void publicarDados() {
  int analogValue = (int)lerADC();                     // leitura ADC inteira
  int digitalValue = digitalRead(PIN_MQ2_DIGITAL);     // leitura digital (threshold)
  float ppm = calcularPPM(analogValue);                // converte para PPM
  String status = obterStatus(ppm);                    // determina status textual
  
  // Saída de debug no Serial — útil durante desenvolvimento
  Serial.printf("📊 ADC: %d | Digital: %d | PPM: %.2f | Status: %s\n",
                analogValue, digitalValue, ppm, status.c_str());
  
  // Publica em tópicos MQTT configurados, se conectado
  if (mqtt.connected()) {
    mqtt.publish(TOPICO_GAS, String(analogValue).c_str());       // valor ADC bruto
    mqtt.publish(TOPICO_PPM, String(ppm, 2).c_str());            // PPM com 2 casas
    mqtt.publish(TOPICO_STATUS, status.c_str());                // status textual
    
    Serial.println("  ✓ Publicado em MQTT\n");
  } else {
    // Caso não esteja conectado, apenas registra localmente — reconexão será
    // tentada no loop principal
    Serial.println("  ⚠️  MQTT desconectado\n");
  }
}
