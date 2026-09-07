/**
 * esp32_prana.ino
 *
 * PRANA field scanning device firmware.
 *
 * Physical sensors actually present on this prototype: MQ-2, MQ-135, a UV
 * sensor, an HC-SR04 ultrasonic depth transducer, and an active buzzer.
 * There is no dedicated O2 sensor, no CH4 sensor, no GPS module, and no
 * battery ADC circuit — see the readings-derivation notes below for how
 * each required API field is produced from what's actually wired up.
 *
 * Readings are signed with HMAC-SHA256 and POSTed to the
 * /api/telemetry/ingest endpoint, matching the payload contract in
 * src/app/api/telemetry/ingest/route.ts exactly:
 *
 *   { device_id, work_order_id, timestamp (ms epoch), readings, signature }
 *
 * signature = hex(HMAC-SHA256(canonical_json({device_id, readings,
 *   timestamp, work_order_id}), key = DEVICE_SECRET))
 * where canonical_json sorts object keys alphabetically at every level,
 * mirroring src/lib/canonicalize.ts on the server.
 *
 * While Wi-Fi is unavailable, signed payloads are retained in an in-RAM
 * FIFO ring buffer and flushed in order on the next connection, without
 * ever regenerating their original signed timestamp.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>
#include <mbedtls/md.h>

// ---------------------------------------------------------------------------
// Compile-time / runtime configuration.
// Fill these in per-device before flashing (see provisioning script output).
// ---------------------------------------------------------------------------

#ifndef WIFI_SSID
#define WIFI_SSID "prana-wifi"
#endif

#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "prana-wifi-pass"
#endif

// Must be reachable over the internet from this device (NTP + HTTPS both
// need it). A phone hotspot is fine for testing.
#ifndef API_BASE_URL
#define API_BASE_URL "https://prana-steel-one.vercel.app"
#endif

// Must exactly match the `secret_hash` column value for this device's row
// in the `devices` table (see scripts/provision-device.ts).
#ifndef DEVICE_SECRET
#define DEVICE_SECRET "REPLACE_WITH_PROVISIONED_DEVICE_SECRET"
#endif

// UUID of this device's row in `devices`.
#ifndef DEVICE_ID
#define DEVICE_ID "REPLACE_WITH_DEVICE_UUID"
#endif

// UUID of the active `work_orders` row this device reports against.
#ifndef WORK_ORDER_ID
#define WORK_ORDER_ID "REPLACE_WITH_WORK_ORDER_UUID"
#endif

// This probe has no GPS module. It is a fixed installation at the
// workzone's target coordinates, so we report the target location as our
// own position. Replace with the actual workzones.target_lat/target_lon
// for this device's workzone.
#ifndef PROBE_LAT
#define PROBE_LAT 28.6139
#endif
#ifndef PROBE_LON
#define PROBE_LON 77.2090
#endif

// Hardware pin assignments — do not move these without updating this
// comment and confirming with whoever owns the physical wiring.
#define MQ2_SENSOR_PIN         34      // MQ-2: source for both h2s_ppm and ch4_ppm
#define MQ135_SENSOR_PIN       35      // MQ-135: source for o2_percent (placeholder, not real O2 sensing)
#define UV_SENSOR_PIN          33      // UV sensor: display-only, not part of any safety gate
#define ULTRASONIC_TRIGGER_PIN 5
#define ULTRASONIC_ECHO_PIN    18
#define BUZZER_PIN             19      // Local advisory failsafe only — never authoritative

// ADC characteristics for the ESP32 (12-bit, 0..3.3V, attenuation set by pin).
#define ADC_BITS               12
#define ADC_MAX                4095.0f
#define ADC_REF_VOLTAGE        3.3f

// No battery ADC circuit exists on this prototype. Sending a fabricated
// voltage-derived percentage would misrepresent nonexistent hardware, so we
// send an honest fixed placeholder instead. Replace with a real circuit
// (and real conversion) once one is added.
#define BATTERY_PERCENT_PLACEHOLDER 100.0f

// Timing constants.
#define HEARTBEAT_INTERVAL_MS    30000      // 30s heartbeat (serial log only)
#define SAMPLING_INTERVAL_MS     10000      // 10s between full sample cycles
#define WIFI_CONNECT_TIMEOUT_MS  15000      // max time to wait for Wi-Fi
#define NTP_SYNC_TIMEOUT_MS      15000      // max time to wait for NTP
#define WARMUP_DURATION_MS       60000      // sensors report is_warming_up=true for this long after boot
#define RING_BUFFER_SIZE         64         // offline cache slots
#define BUZZER_BEEP_ON_MS        200        // intermittent-beep on-time
#define BUZZER_BEEP_OFF_MS       800        // intermittent-beep off-time

// ---------------------------------------------------------------------------
// Local advisory safety thresholds.
//
// These mirror src/lib/complianceEngine.ts's numeric thresholds so the
// buzzer gives a sane local indication while offline. This is NOT a second
// source of authorization — the server remains the sole authority for
// permits and lockouts. If the two ever disagree (e.g. after a server-side
// threshold change), the server wins; this only drives a local sound.
// ---------------------------------------------------------------------------

#define LOCAL_H2S_WARN_PPM   10.0f
#define LOCAL_H2S_CRIT_PPM   15.0f
#define LOCAL_O2_LOW_CRIT    18.5f
#define LOCAL_O2_LOW_WARN    19.5f
#define LOCAL_O2_HIGH_WARN   23.5f
#define LOCAL_O2_HIGH_CRIT   24.0f
#define LOCAL_DEPTH_TOLERANCE_M 0.5f

typedef enum {
  LOCAL_SAFE,
  LOCAL_WARMING,
  LOCAL_WARNING,
  LOCAL_LOCKOUT,
  LOCAL_UNKNOWN
} LocalSafetyState;

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

static const char* ssid         = WIFI_SSID;
static const char* wifiPassword = WIFI_PASSWORD;
static const char* apiBaseUrl   = API_BASE_URL;
static const char* deviceSecret = DEVICE_SECRET;
static const char* deviceId     = DEVICE_ID;
static const char* workOrderId  = WORK_ORDER_ID;

static unsigned long bootMillis = 0;
static unsigned long lastHeartbeat = 0;
static unsigned long lastSample = 0;
static bool timeSynced = false;

// Last known-good ultrasonic reading, used if a sample fails (no echo).
static float lastGoodDepthCM = -1.0f;

// Target depth for this workzone, used only for the local advisory depth
// check that feeds the buzzer. Matches the workzone row for WORK_ORDER_ID.
#ifndef TARGET_DEPTH_METERS
#define TARGET_DEPTH_METERS 3.0f
#endif

// Buzzer pattern state (non-blocking). currentLocalState persists between
// sample cycles so the intermittent beep pattern keeps ticking every loop().
static unsigned long buzzerPatternStart = 0;
static bool buzzerOn = false;
static LocalSafetyState currentLocalState = LOCAL_UNKNOWN;

// ---------------------------------------------------------------------------
// Offline ring buffer for signed request bodies.
// ---------------------------------------------------------------------------

typedef struct {
  char body[768];
  bool occupied;
} RingSlot;

static RingSlot ringBuffer[RING_BUFFER_SIZE];
static size_t ringHead = 0;
static size_t ringTail = 0;
static size_t ringCount = 0;

static bool ringBufferPush(const String& body) {
  if (body.length() >= sizeof(RingSlot::body)) {
    return false;
  }
  if (ringCount >= RING_BUFFER_SIZE) {
    return false;
  }
  size_t idx = ringHead;
  ringBuffer[idx].occupied = true;
  body.toCharArray(ringBuffer[idx].body, sizeof(RingSlot::body));
  ringHead = (ringHead + 1) % RING_BUFFER_SIZE;
  ringCount++;
  return true;
}

static bool ringBufferPop(String& out) {
  if (ringCount == 0) {
    return false;
  }
  size_t idx = ringTail;
  out = String(ringBuffer[idx].body);
  ringBuffer[idx].occupied = false;
  ringTail = (ringTail + 1) % RING_BUFFER_SIZE;
  ringCount--;
  return true;
}

static void ringBufferClear() {
  for (size_t i = 0; i < RING_BUFFER_SIZE; i++) {
    ringBuffer[i].occupied = false;
    ringBuffer[i].body[0] = '\0';
  }
  ringHead = ringTail = ringCount = 0;
}

// ---------------------------------------------------------------------------
// Canonical JSON number formatting.
//
// The server verifies signatures by re-parsing our JSON into JS numbers and
// re-serializing them with JSON.stringify, which prints the *shortest*
// decimal string that round-trips to the same double (no trailing zeros, no
// unnecessary decimal point for whole numbers). We replicate that here so
// our locally-computed HMAC matches what the server recomputes.
// ---------------------------------------------------------------------------

static String canonicalNumber(double value) {
  if (value == (long long)value && fabs(value) < 1e15) {
    char buf[32];
    snprintf(buf, sizeof(buf), "%lld", (long long)value);
    return String(buf);
  }
  char buf[40];
  for (int precision = 1; precision <= 9; precision++) {
    snprintf(buf, sizeof(buf), "%.*f", precision, value);
    if (strtod(buf, nullptr) == value) {
      String s(buf);
      int dot = s.indexOf('.');
      if (dot >= 0) {
        int end = s.length();
        while (end > dot + 2 && s[end - 1] == '0') end--;
        s = s.substring(0, end);
      }
      return s;
    }
  }
  snprintf(buf, sizeof(buf), "%.9f", value);
  return String(buf);
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 (hex output) using mbedtls.
// ---------------------------------------------------------------------------

static String hmacSha256Hex(const char* key, const String& message) {
  uint8_t digest[32];
  const mbedtls_md_info_t* mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (mdInfo == nullptr) {
    return "";
  }
  int ret = mbedtls_md_hmac(
    mdInfo,
    (const unsigned char*)key, strlen(key),
    (const unsigned char*)message.c_str(), message.length(),
    digest
  );
  if (ret != 0) {
    return "";
  }
  static const char* hex = "0123456789abcdef";
  String out;
  out.reserve(64);
  for (int i = 0; i < 32; i++) {
    out += hex[(digest[i] >> 4) & 0xF];
    out += hex[digest[i] & 0xF];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sensor sampling
// ---------------------------------------------------------------------------

static float readAnalogSensorVoltage(int pin) {
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) {
    sum += analogRead(pin);
    delay(2);
  }
  uint16_t avg = sum / 16;
  return ((float)avg / ADC_MAX) * ADC_REF_VOLTAGE;
}

// H2S ppm estimate from MQ-2. Prototype-grade curve, not a certified
// measurement — MQ-2 is not a true H2S-specific sensor.
static float sampleH2SPPM(float mq2Voltage) {
  float ppm = (mq2Voltage - 0.18f) * 50.0f;
  if (ppm < 0) ppm = 0;
  return ppm;
}

// CH4 ppm estimate, derived from the SAME MQ-2 reading as H2S above (no
// dedicated CH4 sensor exists on this prototype). MQ-2's datasheet is
// actually more sensitive to combustible gases like methane/LPG than H2S,
// so this uses a separate, steeper curve applied to the same voltage.
// Display-only: not evaluated by the compliance engine.
static float sampleCH4PPM(float mq2Voltage) {
  float ppm = (mq2Voltage - 0.2f) * 400.0f;
  if (ppm < 0) ppm = 0;
  return ppm;
}

// O2 % placeholder derived from MQ-135. MQ-135 is not an O2 sensor; this is
// the agreed prototype placeholder pending real electrochemical O2 hardware.
static float sampleO2Percent() {
  float v = readAnalogSensorVoltage(MQ135_SENSOR_PIN);
  float percent = ((v - 0.3f) / (2.0f - 0.3f)) * 21.0f;
  if (percent < 0) percent = 0;
  if (percent > 25) percent = 25;
  return percent;
}

// UV index estimate (e.g. ML8511-style sensor). Extra, non-authoritative
// field — not part of the required API contract, sent for display/logging
// only. Calibrate against your specific sensor's datasheet.
static float sampleUVIndex() {
  float v = readAnalogSensorVoltage(UV_SENSOR_PIN);
  float index = (v - 1.0f) * 3.0f;
  if (index < 0) index = 0;
  return index;
}

// Ultrasonic depth in centimeters. Returns -1 if no echo detected.
static float sampleUltrasonicDepthCM() {
  digitalWrite(ULTRASONIC_TRIGGER_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(ULTRASONIC_TRIGGER_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(ULTRASONIC_TRIGGER_PIN, LOW);

  long duration = pulseIn(ULTRASONIC_ECHO_PIN, HIGH, 30000L);
  if (duration == 0) {
    return -1.0f;
  }
  return duration / 58.2f; // ~343 m/s speed of sound -> 29.1 us/cm round-trip
}

// ---------------------------------------------------------------------------
// Local advisory safety state (buzzer only — never gates permits).
// ---------------------------------------------------------------------------

static LocalSafetyState computeLocalState(float h2s, float o2, float depthMeters,
                                          bool isWarmingUp) {
  if (!isfinite(h2s) || !isfinite(o2) || !isfinite(depthMeters)) {
    return LOCAL_UNKNOWN;
  }

  float depthDelta = fabs(depthMeters - TARGET_DEPTH_METERS);

  if (depthDelta > LOCAL_DEPTH_TOLERANCE_M) return LOCAL_LOCKOUT;
  if (h2s > LOCAL_H2S_CRIT_PPM) return LOCAL_LOCKOUT;
  if (o2 < LOCAL_O2_LOW_CRIT || o2 > LOCAL_O2_HIGH_CRIT) return LOCAL_LOCKOUT;

  if (h2s > LOCAL_H2S_WARN_PPM) return LOCAL_WARNING;
  if ((o2 >= LOCAL_O2_LOW_CRIT && o2 < LOCAL_O2_LOW_WARN) ||
      (o2 > LOCAL_O2_HIGH_WARN && o2 <= LOCAL_O2_HIGH_CRIT)) {
    return LOCAL_WARNING;
  }

  if (isWarmingUp) return LOCAL_WARMING;
  return LOCAL_SAFE;
}

// Non-blocking buzzer driver: SAFE=off, LOCKOUT=continuous on,
// WARNING/WARMING/UNKNOWN=intermittent beep.
static void driveBuzzer(LocalSafetyState state) {
  unsigned long now = millis();

  switch (state) {
    case LOCAL_SAFE:
      digitalWrite(BUZZER_PIN, LOW);
      buzzerOn = false;
      return;
    case LOCAL_LOCKOUT:
      digitalWrite(BUZZER_PIN, HIGH);
      buzzerOn = true;
      return;
    case LOCAL_WARNING:
    case LOCAL_WARMING:
    case LOCAL_UNKNOWN:
    default: {
      unsigned long elapsed = now - buzzerPatternStart;
      unsigned long cycle = BUZZER_BEEP_ON_MS + BUZZER_BEEP_OFF_MS;
      bool shouldBeOn = (elapsed % cycle) < BUZZER_BEEP_ON_MS;
      if (shouldBeOn != buzzerOn) {
        digitalWrite(BUZZER_PIN, shouldBeOn ? HIGH : LOW);
        buzzerOn = shouldBeOn;
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Payload construction + signing.
// ---------------------------------------------------------------------------

// Builds the canonical `readings` object body (keys pre-sorted alphabetically
// to match src/lib/canonicalize.ts): battery_percent, ch4_ppm, depth_meters,
// h2s_ppm, is_warming_up, o2_percent, user_lat, user_lon, uv_index.
static String buildCanonicalReadings(float h2sPPM, float o2Percent, float ch4PPM,
                                     float depthMeters, float batteryPercent,
                                     bool isWarmingUp, float uvIndex) {
  String s = "{";
  s += "\"battery_percent\":" + canonicalNumber(batteryPercent) + ",";
  s += "\"ch4_ppm\":" + canonicalNumber(ch4PPM) + ",";
  s += "\"depth_meters\":" + canonicalNumber(depthMeters) + ",";
  s += "\"h2s_ppm\":" + canonicalNumber(h2sPPM) + ",";
  s += "\"is_warming_up\":" + String(isWarmingUp ? "true" : "false") + ",";
  s += "\"o2_percent\":" + canonicalNumber(o2Percent) + ",";
  s += "\"user_lat\":" + canonicalNumber(PROBE_LAT) + ",";
  s += "\"user_lon\":" + canonicalNumber(PROBE_LON) + ",";
  s += "\"uv_index\":" + canonicalNumber(uvIndex);
  s += "}";
  return s;
}

// Builds the canonical top-level signed object (keys pre-sorted
// alphabetically): device_id, readings, timestamp, work_order_id.
static String buildCanonicalSignedPayload(const String& readingsJson, uint64_t timestampMs) {
  String s = "{";
  s += "\"device_id\":\"" + String(deviceId) + "\",";
  s += "\"readings\":" + readingsJson + ",";
  s += "\"timestamp\":" + canonicalNumber((double)timestampMs) + ",";
  s += "\"work_order_id\":\"" + String(workOrderId) + "\"";
  s += "}";
  return s;
}

// Builds the final HTTP request body: the canonical signed object plus the
// signature field appended (signature itself is not part of the signed
// content).
static String buildRequestBody(const String& canonicalSignedPayload, const String& signatureHex) {
  String body = canonicalSignedPayload.substring(0, canonicalSignedPayload.length() - 1);
  body += ",\"signature\":\"" + signatureHex + "\"}";
  return body;
}

// ---------------------------------------------------------------------------
// Wi-Fi + NTP + HTTP
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

// The backend rejects any reading whose timestamp is more than 30s from
// real wall-clock time, so we need real epoch time via NTP. Requires the
// Wi-Fi network to have outbound internet access.
static bool syncTimeViaNTP() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  time_t now = time(nullptr);
  unsigned long start = millis();
  while (now < 8 * 3600 * 2) { // wait until clock looks like a real 2024+ epoch
    if (millis() - start > NTP_SYNC_TIMEOUT_MS) {
      return false;
    }
    delay(250);
    now = time(nullptr);
  }
  return true;
}

static uint64_t currentEpochMillis() {
  time_t now = time(nullptr);
  return (uint64_t)now * 1000ULL;
}

static bool postIngest(const String& body) {
  HTTPClient http;
  String url = String(apiBaseUrl) + "/api/telemetry/ingest";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setReuse(true);

  int code = http.POST(body);
  if (code < 200 || code >= 300) {
    Serial.printf("[PRANA] ingest rejected: HTTP %d body=%s\n", code, http.getString().c_str());
  }
  http.end();

  return (code >= 200 && code < 300);
}

// ---------------------------------------------------------------------------
// Offline flush: push everything cached while Wi-Fi/NTP was down.
// FIFO order preserved; original signed timestamps are never regenerated.
// ---------------------------------------------------------------------------

static void flushRingBuffer() {
  String cached;
  while (ringBufferPop(cached)) {
    if (postIngest(cached)) {
      // successfully transmitted, continue draining oldest-first.
    } else {
      ringBufferPush(cached); // retain and retry later; do not drop or resign.
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Arduino setup / loop
// ---------------------------------------------------------------------------

void setup() {
  analogReadResolution(ADC_BITS);
  analogSetAttenuation(ADC_11db); // allow up to ~3.6V on ADC pins

  pinMode(MQ2_SENSOR_PIN, INPUT);
  pinMode(MQ135_SENSOR_PIN, INPUT);
  pinMode(UV_SENSOR_PIN, INPUT);
  pinMode(ULTRASONIC_TRIGGER_PIN, OUTPUT);
  pinMode(ULTRASONIC_ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(ULTRASONIC_TRIGGER_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  ringBufferClear();
  bootMillis = millis();
  buzzerPatternStart = millis();

  Serial.begin(115200);
  while (!Serial) { delay(10); }
  Serial.println("\n[PRANA] firmware starting");

  if (connectWiFi()) {
    Serial.println("[PRANA] Wi-Fi connected");
    timeSynced = syncTimeViaNTP();
    Serial.println(timeSynced ? "[PRANA] NTP time synced" : "[PRANA] NTP sync FAILED — samples will be dropped until synced");
  } else {
    Serial.println("[PRANA] Wi-Fi connect failed; will retry in loop()");
  }
}

void loop() {
  unsigned long now = millis();
  bool isWarmingUp = (now - bootMillis) < WARMUP_DURATION_MS;

  // --- Connectivity maintenance ------------------------------------------
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }
  if (WiFi.status() == WL_CONNECTED && !timeSynced) {
    timeSynced = syncTimeViaNTP();
  }

  // --- Sampling loop -------------------------------------------------------
  if (now - lastSample >= SAMPLING_INTERVAL_MS) {
    lastSample = now;

    float mq2Voltage = readAnalogSensorVoltage(MQ2_SENSOR_PIN);
    float h2s  = sampleH2SPPM(mq2Voltage);
    float ch4  = sampleCH4PPM(mq2Voltage);
    float o2   = sampleO2Percent();
    float uv   = sampleUVIndex();
    float depthCM = sampleUltrasonicDepthCM();
    if (depthCM < 0) {
      depthCM = (lastGoodDepthCM >= 0) ? lastGoodDepthCM : 0;
    } else {
      lastGoodDepthCM = depthCM;
    }
    float depthMeters = depthCM / 100.0f;
    float battPct = BATTERY_PERCENT_PLACEHOLDER;

    Serial.printf("[PRANA] H2S=%.2f ppm  O2=%.2f%%  CH4=%.2f ppm  UV=%.2f  depth=%.2f m  battery=%.1f%% (placeholder)  warming=%d\n",
                  h2s, o2, ch4, uv, depthMeters, battPct, isWarmingUp);

    // Local advisory state drives the buzzer only. The server is always the
    // sole authority for permits/lockouts — this never gates anything.
    // currentLocalState is applied every loop() tick below, not just here,
    // so the intermittent beep pattern actually toggles between samples.
    currentLocalState = computeLocalState(h2s, o2, depthMeters, isWarmingUp);

    if (!timeSynced) {
      Serial.println("[PRANA] time not synced yet; dropping sample (would fail freshness check)");
    } else {
      uint64_t ts = currentEpochMillis();
      String readingsJson = buildCanonicalReadings(h2s, o2, ch4, depthMeters, battPct, isWarmingUp, uv);
      String canonicalPayload = buildCanonicalSignedPayload(readingsJson, ts);
      String signature = hmacSha256Hex(deviceSecret, canonicalPayload);
      String body = buildRequestBody(canonicalPayload, signature);

      if (WiFi.status() == WL_CONNECTED) {
        if (postIngest(body)) {
          Serial.println("[PRANA] sample POSTed");
          if (ringCount > 0) flushRingBuffer();
        } else {
          Serial.println("[PRANA] POST failed; caching payload");
          ringBufferPush(body);
        }
      } else {
        if (!ringBufferPush(body)) {
          Serial.println("[PRANA] ring buffer full; payload dropped");
        } else {
          Serial.printf("[PRANA] payload cached (ringCount=%u)\n", ringCount);
        }
      }
    }
  }

  // Drive the buzzer every loop() tick (not just at sample time) so the
  // intermittent beep pattern for WARNING/WARMING/UNKNOWN actually toggles.
  driveBuzzer(currentLocalState);

  // --- Heartbeat (serial log only, not transmitted) -----------------------
  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeat = now;
    Serial.printf("[PRANA] heartbeat: wifi=%s time_synced=%s ring=%u\n",
                  WiFi.status() == WL_CONNECTED ? "up" : "down",
                  timeSynced ? "yes" : "no",
                  (unsigned)ringCount);
  }

  delay(50);
}
