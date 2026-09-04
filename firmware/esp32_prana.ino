/**
 * esp32_prana.ino
 *
 * PRANA field scanning device firmware.
 *
 * Samples on-board gas sensors (H2S, O2), an ultrasonic depth transducer,
 * and the battery level. Readings are signed with HMAC-SHA256 using the
 * device secret provisioned in the backend and POSTed to the scan_logs
 * ingestion endpoint. While Wi-Fi is unavailable the signed payloads are
 * retained in an in-RAM ring buffer and flushed on the next connection.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <mbedtls/md.h>

// ---------------------------------------------------------------------------
// Compile-time / runtime configuration.
// Override via build flags or environment variables before flashing.
// ---------------------------------------------------------------------------

#ifndef WIFI_SSID
#define WIFI_SSID "prana-wifi"
#endif

#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "prana-wifi-pass"
#endif

#ifndef API_BASE_URL
#define API_BASE_URL "https://api.prana.example.com"
#endif

#ifndef DEVICE_SECRET
#define DEVICE_SECRET "super-secret-device-key"
#endif

#ifndef DEVICE_SERIAL
#define DEVICE_SERIAL "PRH-0001"
#endif

// Hardware pin assignments (adjust to board wiring).
#define H2S_SENSOR_PIN       34      // Analog gas sensor (H2S)
#define O2_SENSOR_PIN          35      // Analog gas sensor (O2)
#define BATTERY_MONITOR_PIN    32      // Voltage divider -> ADC
#define ULTRASONIC_TRIGGER_PIN 18
#define ULTRASONIC_ECHO_PIN    19

// ADC characteristics for the ESP32 (12-bit, 0..3.3V, attenuation set by pin).
#define ADC_BITS               12
#define ADC_MAX                4095.0f
#define ADC_REF_VOLTAGE        3.3f
#define BATTERY_DIVIDER_RATIO  2.0f   // R1+R2 / R2 for the voltage divider

// Timing constants.
#define HEARTBEAT_INTERVAL_MS    30000      // 30s heartbeat
#define SAMPLING_INTERVAL_MS     10000      // 10s between full sample cycles
#define WIFI_CONNECT_TIMEOUT_MS  15000      // max time to wait for Wi-Fi
#define RING_BUFFER_SIZE         64         // offline cache slots

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

static const char* ssid       = WIFI_SSID;
static const char* wifiPassword = WIFI_PASSWORD;
static const char* apiBaseUrl  = API_BASE_URL;

// Device identity provisioned by the backend. In production these would come
// from efused/secure storage; here we use build defaults.
static const char* deviceSecret = DEVICE_SECRET;
static const char* deviceSerial = DEVICE_SERIAL;

static unsigned long lastHeartbeat = 0;
static unsigned long lastSample = 0;

// ---------------------------------------------------------------------------
// Offline ring buffer for signed payloads.
// ---------------------------------------------------------------------------

typedef struct {
  char payload[512];
  bool occupied;
} RingSlot;

static RingSlot ringBuffer[RING_BUFFER_SIZE];
static size_t ringHead = 0;
static size_t ringTail = 0;
static size_t ringCount = 0;

// ---------------------------------------------------------------------------
// Utility: base64 helper for signatures (avoids a heavy dependency).
// ---------------------------------------------------------------------------

static const char* b64Table =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static String base64Encode(const uint8_t* data, size_t len) {
  String out;
  out.reserve(((len + 2) / 3) * 4);
  for (size_t i = 0; i < len; i += 3) {
    uint32_t v = (uint32_t)data[i] << 16;
    int rem = 1;
    if (i + 1 < len) { v |= (uint32_t)data[i + 1] << 8; rem = 2; }
    if (i + 2 < len) { v |= (uint32_t)data[i + 2]; rem = 3; }
    out += b64Table[(v >> 18) & 0x3F];
    out += b64Table[(v >> 12) & 0x3F];
    out += (rem > 1) ? b64Table[(v >> 6) & 0x3F] : '=';
    out += (rem > 2) ? b64Table[v & 0x3F] : '=';
  }
  return out;
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 signing using mbedtls.
// ---------------------------------------------------------------------------

static String hmacSha256(const char* key, const char* message) {
  const size_t keyLen = strlen(key);
  const size_t msgLen = strlen(message);

  uint8_t digest[32];
  const mbedtls_md_info_t* mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (mdInfo == nullptr) {
    return "";
  }

  int ret = mbedtls_md_hmac(mdInfo,
                            (const unsigned char*)key, keyLen,
                            (const unsigned char*)message, msgLen,
                            digest);
  if (ret != 0) {
    return "";
  }

  return base64Encode(digest, sizeof(digest));
}

// ---------------------------------------------------------------------------
// Sensor sampling
// ---------------------------------------------------------------------------

static float readBatteryVoltage() {
  uint16_t raw = analogRead(BATTERY_MONITOR_PIN);
  float voltage = ((float)raw / ADC_MAX) * ADC_REF_VOLTAGE * BATTERY_DIVIDER_RATIO;
  return voltage;
}

static float readAnalogSensorVoltage(int pin) {
  uint32_t sum = 0;
  // Simple 16-sample moving average to reduce sensor noise.
  for (int i = 0; i < 16; i++) {
    sum += analogRead(pin);
    delay(2);
  }
  uint16_t avg = sum / 16;
  float voltage = ((float)avg / ADC_MAX) * ADC_REF_VOLTAGE;
  return voltage;
}

// H2S ppm estimate. The common discrete H2S sensors (e.g. MQ-137) output a
// voltage proportional to gas concentration. This maps voltage -> ppm using a
// reference slope. Replace with your sensor's characteristic curve as needed.
static float sampleH2SPPM() {
  float v = readAnalogSensorVoltage(H2S_SENSOR_PIN);
  // Rough 0.18V baseline -> 0 ppm, 0.36V -> 10 ppm, etc.
  float ppm = (v - 0.18f) * 50.0f;
  if (ppm < 0) ppm = 0;
  return ppm;
}

// O2 % estimate. The O2 sensor (e.g. MQ135 variant) reads ~0.3V at 0% and
// ~2.0V at 21% O2; linear interpolation applied here.
static float sampleO2Percent() {
  float v = readAnalogSensorVoltage(O2_SENSOR_PIN);
  float percent = ((v - 0.3f) / (2.0f - 0.3f)) * 21.0f;
  if (percent < 0) percent = 0;
  if (percent > 25) percent = 25;
  return percent;
}

// Ultrasonic depth in centimeters. Measures distance to the fluid surface;
// caller interprets against tank geometry for true "depth".
static float sampleUltrasonicDepthCM() {
  digitalWrite(ULTRASONIC_TRIGGER_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(ULTRASONIC_TRIGGER_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(ULTRASONIC_TRIGGER_PIN, LOW);

  long duration = pulseIn(ULTRASONIC_ECHO_PIN, HIGH, 30000L);
  // Sound speed ~343 m/s -> 29.1 us/cm round-trip.
  float distanceCM = duration / 58.2f;
  if (duration == 0) {
    return -1.0f; // no echo detected
  }
  return distanceCM;
}

// ---------------------------------------------------------------------------
// Payload construction + HMAC signing.
// ---------------------------------------------------------------------------

static String buildAndSignPayload(float h2sPPM, float o2Percent,
                                  float depthCM, float batteryV,
                                  unsigned long ts) {
  // Build the JSON readings payload first, then sign it.
  StaticJsonDocument<384> doc;
  doc["device_serial"] = deviceSerial;
  doc["timestamp"] = (uint64_t)ts;
  doc["readings"]["h2s_ppm"] = h2sPPM;
  doc["readings"]["o2_percent"] = o2Percent;
  doc["readings"]["depth_cm"] = depthCM;
  doc["readings"]["battery_v"] = batteryV;

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  String signature = hmacSha256(deviceSecret, jsonPayload.c_str());

  // Final transmission body: payload + signature.
  StaticJsonDocument<512> out;
  out["payload"] = jsonPayload;
  out["signature"] = signature;

  String output;
  serializeJson(out, output);
  return output;
}

// ---------------------------------------------------------------------------
// Ring buffer management for offline caching.
// ---------------------------------------------------------------------------

static bool ringBufferPush(const String& signedPayload) {
  if (signedPayload.length() >= sizeof(RingSlot::payload)) {
    return false;
  }
  if (ringCount >= RING_BUFFER_SIZE) {
    return false; // buffer full, drop oldest implicitly by overwriting tail
  }
  size_t idx = ringHead;
  ringBuffer[idx].occupied = true;
  signedPayload.toCharArray(ringBuffer[idx].payload, sizeof(RingSlot::payload));
  ringHead = (ringHead + 1) % RING_BUFFER_SIZE;
  ringCount++;
  return true;
}

static bool ringBufferPop(String& out) {
  if (ringCount == 0) {
    return false;
  }
  size_t idx = ringTail;
  out = String(ringBuffer[idx].payload);
  ringBuffer[idx].occupied = false;
  ringTail = (ringTail + 1) % RING_BUFFER_SIZE;
  ringCount--;
  return true;
}

static void ringBufferClear() {
  for (size_t i = 0; i < RING_BUFFER_SIZE; i++) {
    ringBuffer[i].occupied = false;
    ringBuffer[i].payload[0] = '\0';
  }
  ringHead = ringTail = ringCount = 0;
}

// ---------------------------------------------------------------------------
// Wi-Fi + HTTP
// ---------------------------------------------------------------------------

static bool connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, wifiPassword);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > WIFI_CONNECT_TIMEOUT_MS) {
      return false;
    }
    delay(500);
  }
  return true;
}

static bool postScanLog(const String& body) {
  HTTPClient http;
  String url = String(apiBaseUrl) + "/scan_logs";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setReuse(true);

  int code = http.POST(body);
  http.end();

  return (code >= 200 && code < 300);
}

// ---------------------------------------------------------------------------
// Heartbeat: small presence beacon proving the device is alive.
// ---------------------------------------------------------------------------

static void sendHeartbeat() {
  StaticJsonDocument<128> doc;
  doc["device_serial"] = deviceSerial;
  doc["event"] = "heartbeat";
  doc["timestamp"] = (uint64_t)millis();
  String payload;
  serializeJson(doc, payload);

  String body = String("{\"payload\":") + payload +
                ",\"signature\":\"" + hmacSha256(deviceSecret, payload.c_str()) + "\"}";

  postScanLog(body);
}

// ---------------------------------------------------------------------------
// Offline flush: push everything cached while Wi-Fi was down.
// ---------------------------------------------------------------------------

static void flushRingBuffer() {
  String cached;
  while (ringBufferPop(cached)) {
    if (postScanLog(cached)) {
      // successfully transmitted, continue draining.
    } else {
      // Still failing, put it back and stop. Re-wi-fi will retry later.
      ringBufferPush(cached);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Arduino setup / loop
// ---------------------------------------------------------------------------

void setup() {
  // ADC configuration.
  analogReadResolution(ADC_BITS);
  analogSetAttenuation(ADC_11db); // allow up to ~3.6V on ADC pins

  // Sensor pins.
  pinMode(H2S_SENSOR_PIN, INPUT);
  pinMode(O2_SENSOR_PIN, INPUT);
  pinMode(BATTERY_MONITOR_PIN, INPUT);
  pinMode(ULTRASONIC_TRIGGER_PIN, OUTPUT);
  pinMode(ULTRASONIC_ECHO_PIN, INPUT);
  digitalWrite(ULTRASONIC_TRIGGER_PIN, LOW);

  // Initialize ring buffer memory.
  ringBufferClear();

  Serial.begin(115200);
  while (!Serial) { delay(10); }
  Serial.println("\n[PRANA] firmware starting");

  if (!connectWiFi()) {
    Serial.println("[PRANA] Wi-Fi connect failed; samples will be cached");
  }
}

void loop() {
  unsigned long now = millis();

  // --- Heartbeat -------------------------------------------------------
  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeat = now;
    if (WiFi.status() == WL_CONNECTED) {
      sendHeartbeat();
      Serial.println("[PRANA] heartbeat sent");
    } else if (connectWiFi()) {
      sendHeartbeat();
      Serial.println("[PRANA] heartbeat sent (after reconnect)");
    } else {
      Serial.println("[PRANA] heartbeat deferred (offline)");
    }
  }

  // --- Sampling loop ---------------------------------------------------
  if (now - lastSample >= SAMPLING_INTERVAL_MS) {
    lastSample = now;

    float h2s    = sampleH2SPPM();
    float o2     = sampleO2Percent();
    float depth  = sampleUltrasonicDepthCM();
    float batt   = readBatteryVoltage();

    Serial.printf("[PRANA] H2S=%.2f ppm  O2=%.2f%%  depth=%.1f cm  battery=%.2f V\n",
                  h2s, o2, depth, batt);

    String body = buildAndSignPayload(h2s, o2, depth, batt, now);

    if (WiFi.status() == WL_CONNECTED) {
      if (postScanLog(body)) {
        Serial.println("[PRANA] sample POSTed");
        // After a successful send, flush any previously cached payloads.
        if (ringCount > 0) {
          flushRingBuffer();
        }
      } else {
        Serial.println("[PRANA] POST failed; caching payload");
        ringBufferPush(body);
      }
    } else {
      // No network: cache locally for later.
      if (!ringBufferPush(body)) {
        Serial.println("[PRANA] ring buffer full; payload dropped");
      } else {
        Serial.printf("[PRANA] payload cached (ringCount=%u)\n", ringCount);
      }
    }
  }

  // Yield to the RTOS Wi-Fi task.
  delay(100);
}
