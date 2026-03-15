#include "esp_camera.h"
#include <WiFi.h>
#include "driver/i2s.h"
#include "soc/soc.h" // For Brownout
#include "soc/rtc_cntl_reg.h"

// ESP32-CAM + Camera OV5640 + Microphone INMP441

// --- WIFI & SERVER ---
const char* ssid = "AN NAU";
const char* password = "01277571096";
const char* host = "192.168.2.236"; // Update this if server IP changes
const uint16_t portCam = 3001;
const uint16_t portAudio = 3002;

// --- CAMERA PIN MAP ---
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// --- I2S CONFIG ---
#define I2S_WS 2
#define I2S_SCK 14
#define I2S_SD 15
#define I2S_PORT I2S_NUM_1
#define SAMPLE_RATE 16000
#define BUFFER_LEN 1024

// --- PERFORMANCE: Static send buffer avoids per-frame malloc/free ---
// Max JPEG at UXGA high-quality can be ~200KB. 250KB covers all cases.
#define MAX_FRAME_BUF (250 * 1024)
static uint8_t* frameSendBuf = NULL;

WiFiClient clientCam;
WiFiClient clientAudio;

// Global camera config for runtime reinit
camera_config_t camConfig;
const uint32_t xclkFreqs[] = {6000000, 8000000, 12000000, 16000000, 24000000};
uint8_t currentXclkIdx = 2; // default 12MHz

// Serial output throttle
unsigned long lastSerialMs = 0;
uint32_t framesSinceLog = 0;

void sendSettings() {
  sensor_t * s = esp_camera_sensor_get();
  // Payload: [0xBE][0xEF][id1][val1][id2][val2]...
  uint8_t payload[2 + 21 * 2];
  payload[0] = 0xBE;
  payload[1] = 0xEF;
  int idx = 2;
  #define ADD(i, v) payload[idx++] = (i); payload[idx++] = (uint8_t)(v);
  ADD(1,  s->status.quality);
  ADD(2,  s->status.framesize);
  ADD(3,  (uint8_t)s->status.brightness);
  ADD(4,  (uint8_t)s->status.contrast);
  ADD(5,  (uint8_t)s->status.saturation);
  ADD(6,  s->status.awb);
  ADD(7,  s->status.aec);
  ADD(8,  s->status.agc);
  ADD(9,  s->status.aec2);
  ADD(10, (uint8_t)s->status.ae_level);
  ADD(11, s->status.gainceiling);
  ADD(12, s->status.bpc);
  ADD(13, s->status.wpc);
  ADD(14, s->status.raw_gma);
  ADD(15, s->status.lenc);
  ADD(16, s->status.hmirror);
  ADD(17, s->status.vflip);
  ADD(18, s->status.dcw);
  ADD(19, s->status.colorbar);
  ADD(20, currentXclkIdx);
  ADD(21, camConfig.fb_count);
  #undef ADD

  uint32_t payloadLen = idx;
  // Use static buffer for settings too (small enough, always fits)
  memcpy(frameSendBuf, &payloadLen, 4);
  memcpy(frameSendBuf + 4, payload, payloadLen);
  clientCam.write(frameSendBuf, 4 + payloadLen);
  Serial.println("Settings sent");
}

void resetDefaults() {
  sensor_t * s = esp_camera_sensor_get();
  s->set_quality(s, 20);
  s->set_framesize(s, FRAMESIZE_QVGA);
  s->set_brightness(s, 0);
  s->set_contrast(s, 0);
  s->set_saturation(s, 0);
  s->set_whitebal(s, 1);
  s->set_exposure_ctrl(s, 1);
  s->set_gain_ctrl(s, 1);
  s->set_aec2(s, 1);
  s->set_ae_level(s, 0);
  s->set_gainceiling(s, (gainceiling_t)0);
  s->set_bpc(s, 1);
  s->set_wpc(s, 1);
  s->set_raw_gma(s, 1);
  s->set_lenc(s, 1);
  s->set_hmirror(s, 0);
  s->set_vflip(s, 0);
  s->set_dcw(s, 1);
  s->set_colorbar(s, 0);

  if (currentXclkIdx != 2) {
    esp_camera_deinit();
    camConfig.xclk_freq_hz = xclkFreqs[2];
    currentXclkIdx = 2;
    camConfig.fb_count = 2;
    esp_camera_init(&camConfig);
  }

  sendSettings();
  Serial.println("Reset to defaults");
}

void initCamera() {
  camConfig.ledc_channel = LEDC_CHANNEL_0;
  camConfig.ledc_timer = LEDC_TIMER_0;
  camConfig.pin_d0 = Y2_GPIO_NUM;
  camConfig.pin_d1 = Y3_GPIO_NUM;
  camConfig.pin_d2 = Y4_GPIO_NUM;
  camConfig.pin_d3 = Y5_GPIO_NUM;
  camConfig.pin_d4 = Y6_GPIO_NUM;
  camConfig.pin_d5 = Y7_GPIO_NUM;
  camConfig.pin_d6 = Y8_GPIO_NUM;
  camConfig.pin_d7 = Y9_GPIO_NUM;
  camConfig.pin_xclk = XCLK_GPIO_NUM;
  camConfig.pin_pclk = PCLK_GPIO_NUM;
  camConfig.pin_vsync = VSYNC_GPIO_NUM;
  camConfig.pin_href = HREF_GPIO_NUM;
  camConfig.pin_sccb_sda = SIOD_GPIO_NUM;
  camConfig.pin_sccb_scl = SIOC_GPIO_NUM;
  camConfig.pin_pwdn = PWDN_GPIO_NUM;
  camConfig.pin_reset = RESET_GPIO_NUM;
  camConfig.xclk_freq_hz = xclkFreqs[currentXclkIdx];
  camConfig.pixel_format = PIXFORMAT_JPEG;

  camConfig.frame_size = FRAMESIZE_QVGA;
  camConfig.jpeg_quality = 20;
  camConfig.fb_count = 2;
  camConfig.grab_mode = CAMERA_GRAB_LATEST;

  esp_camera_init(&camConfig);
}

void audioTask(void * parameter) {
  // Audio setup
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 16,   // 8 -> 16: deeper DMA queue reduces underruns
    .dma_buf_len = BUFFER_LEN,
  };
  i2s_pin_config_t pin_config = {
    .bck_io_num = I2S_SCK,
    .ws_io_num = I2S_WS,
    .data_out_num = -1,
    .data_in_num = I2S_SD
  };
  i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_PORT, &pin_config);

  int32_t raw_samples[BUFFER_LEN];
  int16_t pcm_samples[BUFFER_LEN];
  size_t bytes_read;

  while(true) {
    if (!clientAudio.connected()) {
      Serial.println("Connecting Audio TCP...");
      if (!clientAudio.connect(host, portAudio)) {
        vTaskDelay(1000 / portTICK_PERIOD_MS);
        continue;
      }
      clientAudio.setNoDelay(true);
      // Increase TCP send buffer for audio throughput
      clientAudio.setTimeout(5);
    }

    // Read I2S
    i2s_read(I2S_PORT, raw_samples, sizeof(raw_samples), &bytes_read, portMAX_DELAY);
    int samples_read = bytes_read / 4;

    // Process & Send
    if (samples_read > 0) {
      for (int i=0; i<samples_read; i++) {
        int32_t val = raw_samples[i] >> 14;
        if (val > 32767) val = 32767;
        if (val < -32768) val = -32768;
        pcm_samples[i] = (int16_t)val;
      }
      clientAudio.write((const uint8_t*)pcm_samples, samples_read * 2);
    }
  }
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Disable brownout detector
  Serial.begin(115200);

  WiFi.begin(ssid, password);
  WiFi.setSleep(false);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  Serial.println("WiFi Connected");

  // Allocate static frame buffer once — avoids per-frame malloc/free
  frameSendBuf = (uint8_t*)ps_malloc(MAX_FRAME_BUF);
  if (!frameSendBuf) {
    // Fallback to regular heap if no PSRAM
    frameSendBuf = (uint8_t*)malloc(MAX_FRAME_BUF);
  }
  if (!frameSendBuf) {
    Serial.println("FATAL: Cannot allocate frame buffer");
    while(1) delay(1000);
  }
  Serial.printf("Frame buffer allocated: %d bytes\n", MAX_FRAME_BUF);

  initCamera();

  // Start Audio Task on Core 0 — 16KB stack (was 10KB, tight with large local arrays)
  xTaskCreatePinnedToCore(audioTask, "audioTask", 16384, NULL, 5, NULL, 0);
}

void loop() {
  if (!clientCam.connected()) {
    Serial.println("Connecting Camera TCP...");
    if (!clientCam.connect(host, portCam)) {
      delay(1000);
      return;
    }
    clientCam.setNoDelay(true);
    clientCam.setTimeout(5);
  }

  // --- CHECK FOR COMMANDS ---
  while(clientCam.available() >= 3) {
    if (clientCam.read() != 0xA5) continue;

    uint8_t id = clientCam.read();
    uint8_t val = clientCam.read();

    sensor_t * s = esp_camera_sensor_get();
    int8_t sval = (int8_t)val;
    switch(id) {
      case 1:  s->set_quality(s, val); break;
      case 2:  s->set_framesize(s, (framesize_t)val); break;
      case 3:  s->set_brightness(s, sval); break;
      case 4:  s->set_contrast(s, sval); break;
      case 5:  s->set_saturation(s, sval); break;
      case 6:  s->set_whitebal(s, val); break;
      case 7:  s->set_exposure_ctrl(s, val); break;
      case 8:  s->set_gain_ctrl(s, val); break;
      case 9:  s->set_aec2(s, val); break;
      case 10: s->set_ae_level(s, sval); break;
      case 11: s->set_gainceiling(s, (gainceiling_t)val); break;
      case 12: s->set_bpc(s, val); break;
      case 13: s->set_wpc(s, val); break;
      case 14: s->set_raw_gma(s, val); break;
      case 15: s->set_lenc(s, val); break;
      case 16: s->set_hmirror(s, val); break;
      case 17: s->set_vflip(s, val); break;
      case 18: s->set_dcw(s, val); break;
      case 19: s->set_colorbar(s, val); break;
      case 20: // XCLK frequency change — requires camera reinit
        if (val < sizeof(xclkFreqs)/sizeof(xclkFreqs[0])) {
          esp_camera_deinit();
          camConfig.xclk_freq_hz = xclkFreqs[val];
          currentXclkIdx = val;
          esp_camera_init(&camConfig);
          Serial.printf("XCLK -> %luHz\n", xclkFreqs[val]);
        }
        break;
      case 21: // fb_count change — requires camera reinit
        if (val >= 1 && val <= 4) {
          esp_camera_deinit();
          camConfig.fb_count = val;
          esp_camera_init(&camConfig);
          Serial.printf("fb_count -> %d\n", val);
        }
        break;
      case 254: // Reset to defaults
        resetDefaults();
        break;
      case 255: // Get current settings
        sendSettings();
        break;
    }
    Serial.printf("CMD id=%d val=%d\n", id, sval);
  }

  // --- CAPTURE & SEND FRAME ---
  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) return;

  uint32_t len = fb->len;

  if (len + 4 <= MAX_FRAME_BUF) {
    // Single memcpy into pre-allocated buffer — no malloc, no fragmentation
    memcpy(frameSendBuf, &len, 4);
    memcpy(frameSendBuf + 4, fb->buf, len);
    clientCam.write(frameSendBuf, 4 + len);
  }
  // else: frame too large for buffer, skip silently

  esp_camera_fb_return(fb);

  // Throttled serial logging — once per second instead of every frame
  framesSinceLog++;
  unsigned long now = millis();
  if (now - lastSerialMs >= 1000) {
    Serial.printf("fps=%u size=%uB\n", framesSinceLog, len);
    framesSinceLog = 0;
    lastSerialMs = now;
  }
}
