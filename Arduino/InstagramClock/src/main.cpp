#include <Arduino.h>
#define LGFX_WT32_SC01
#include <LovyanGFX.hpp>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>

static LGFX lcd;

// MQTT用
WiFiClient espClient;
PubSubClient client(espClient);

const int capacity_response = JSON_OBJECT_SIZE(256);
StaticJsonDocument<capacity_response> json_response;

const char *wifi_ssid = "【WiFiアクセスポイントのSSID】";
const char *wifi_password = "【WiFiアクセスポイントのパスワード】";
const char *mqtt_server = "【MQTTブローカのホスト名】";
const uint16_t mqtt_port = 1883; // MQTTサーバのポート番号(TCP接続)

std::string topic_rcv = "calendar/notify"; // コマンド受信用
#define MQTT_CLIENT_NAME "InstagramClock"           // MQTTサーバ接続時のクライアント名
#define MQTT_BUFFER_SIZE 256                       // MQTT送受信のバッファサイズ

const char *background_url = "https://【Node.jsサーバのホスト名】/googlephotos-image";
const char *maxim_url = "https://meigen.doodlenote.net/api/json.php?c=1";
const char *calendar_url = "https://【Node.jsサーバのホスト名】/googlecalendar-list";

#define BACKGROUND_BUFFER_SIZE 70000
unsigned long background_buffer_length;
unsigned char background_buffer[BACKGROUND_BUFFER_SIZE];

#define UPDATE_CLOCK_INTERVAL   (10 * 1000UL)
#define FONT_COLOR TFT_WHITE

#define UPDATE_BACKGROUND_INTERVAL  (5 * 60 * 1000UL)

#define CLOCK_TYPE_NONE     0
#define CLOCK_TYPE_TIME     1
#define CLOCK_TYPE_DATETIME 2
unsigned char clock_type = CLOCK_TYPE_DATETIME;

#define CLOCK_ALIGN_CENTER        0
#define CLOCK_ALIGN_TOP_LEFT      1
#define CLOCK_ALIGN_BOTTOM_RIGHT  2
#define CLOCK_ALIGN_BOTTOM_CENTER 3
unsigned char clock_align = CLOCK_ALIGN_CENTER;

int last_minutes = -1;
int last_day = -1;
unsigned long last_background_update = 0;
unsigned long last_clock_update = 0;
unsigned short dashboard_height = 0;

//#define MEIGEN_ENABLE
#ifdef MEIGEN_ENABLE
const char *meigen;
#define MEIGEN_SCALE  1.0
#endif

#define CALENDAR_ENABLE
#ifdef CALENDAR_ENABLE
#define CALENDAR_SCALE 1.0
#endif

void wifi_connect(const char *ssid, const char *password);
long doHttpGet(String url, uint8_t *p_buffer, unsigned long *p_len);
long doHttpGetJson(String url, JsonDocument *p_output);
long doHttpPost(String url, JsonDocument *p_output);
void draw_clock(struct tm timeInfo);
float calc_scale(int target, int width);

void mqtt_callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("received ");

  if (length >= 1 && payload[0] == '1'){
    last_background_update = 0;
  }
}

void setup() {
  Serial.begin(115200);

  lcd.init();
  lcd.setRotation(1);

  Serial.printf("width=%d height=%d\n", lcd.width(), lcd.height());

  lcd.setBrightness(128);
  lcd.setColorDepth(16);
  lcd.setFont(&fonts::Font8);
  lcd.setTextColor(FONT_COLOR);

  wifi_connect(wifi_ssid, wifi_password);
  configTzTime("JST-9", "ntp.nict.jp", "ntp.jst.mfeed.ad.jp");

  // バッファサイズの変更
  client.setBufferSize(MQTT_BUFFER_SIZE);
  // MQTTコールバック関数の設定
  client.setCallback(mqtt_callback);
  // MQTTブローカに接続
  client.setServer(mqtt_server, mqtt_port);
}

void loop() {
  client.loop();
  // MQTT未接続の場合、再接続
  while(!client.connected() ){
    Serial.println("Mqtt Reconnecting");
    if( client.connect(MQTT_CLIENT_NAME) ){
      // MQTT Subscribe
      client.subscribe(topic_rcv.c_str());
      Serial.printf("Mqtt Connected and Subscribing, topic_rcv: %s\n", topic_rcv.c_str());
      break;
    }
    delay(1000);
  }

  bool background_updated = false;

  int32_t x, y;
  if (lcd.getTouch(&x, &y)){
    last_background_update = 0;
    if( y < dashboard_height ){

    }
  }

  unsigned long now = millis();

  if (last_background_update == 0 || now - last_background_update >= UPDATE_BACKGROUND_INTERVAL){
    background_buffer_length = BACKGROUND_BUFFER_SIZE;
    long ret = doHttpGet(background_url, background_buffer, &background_buffer_length);
    if (ret != 0){
      Serial.println("doHttpGet Error");
      delay(1000);
      return;
    }

#ifdef MEIGEN_ENABLE
    ret = doHttpGetJson(maxim_url, &json_response);
    if (ret != 0){
      Serial.println("doHttpGetJson Error");
      delay(1000);
      return;
    }
    meigen = json_response[0]["meigen"];
    Serial.println(meigen);
#endif

    ret = doHttpPost(calendar_url, &json_response);
    if (ret != 0){
      Serial.println("doHttpGetJson Error");
      delay(1000);
      return;
    }

    last_background_update = now;
    background_updated = true;
  }

  if (background_updated || now - last_clock_update >= UPDATE_CLOCK_INTERVAL ){
    last_clock_update = now;

    struct tm timeInfo;
    getLocalTime(&timeInfo);
    if (background_updated || last_minutes != timeInfo.tm_min){
      last_minutes = timeInfo.tm_min;

      lcd.drawJpg(background_buffer, background_buffer_length, 0, 0);

#ifdef CALENDAR_ENABLE
      JsonArray array = json_response["list"].as<JsonArray>();
      if( array.size() > 0 )
        clock_align = CLOCK_ALIGN_BOTTOM_CENTER;
      else
        clock_align = CLOCK_ALIGN_CENTER;
#endif

      draw_clock(timeInfo);

#ifdef MEIGEN_ENABLE
      lcd.setFont(&fonts::lgfxJapanGothic_24);
      lcd.setTextSize(MEIGEN_SCALE);
      lcd.setTextDatum(lgfx::top_left);
      lcd.setCursor(0, 0);
      lcd.print(meigen);
#endif
#ifdef CALENDAR_ENABLE
      lcd.setFont(&fonts::lgfxJapanGothic_24);
      lcd.setTextSize(CALENDAR_SCALE);
      lcd.setTextDatum(lgfx::top_left);
      lcd.setCursor(0, 0);
      for (int i = 0; i < array.size(); i++){
        const char *summary = array[i]["summary"];
        const char *type = array[i]["term"]["type"];
        if( strcmp(type, "date") == 0 ){
          lcd.printf("終日        %s\n", summary);
        }else{
          const char *time_str = array[i]["term"]["time_str"];
          lcd.printf("%s %s\n", time_str, summary);
        }
      }
      dashboard_height = lcd.getCursorY();
#endif
    }
  }

  delay(10);
}

void draw_clock(struct tm timeInfo){
  lcd.setFont(&fonts::Font8);

  int width = lcd.width();
  if (clock_align == CLOCK_ALIGN_TOP_LEFT || clock_align == CLOCK_ALIGN_BOTTOM_RIGHT){
    width /= 2;
  }

  char str[11];
  if (clock_type == CLOCK_TYPE_NONE){
    // no drawing
  }else
  if (clock_type == CLOCK_TYPE_TIME){
    sprintf(str, "%02d:%02d", timeInfo.tm_hour, timeInfo.tm_min);
    lcd.setTextSize(1);
    lcd.setTextSize(calc_scale(lcd.textWidth(str), width));

    if (clock_align == CLOCK_ALIGN_TOP_LEFT){
      lcd.setCursor(0, 0);
      lcd.setTextDatum(lgfx::top_left);
    }else
    if (clock_align == CLOCK_ALIGN_BOTTOM_RIGHT ){
      lcd.setCursor(width - lcd.textWidth(str), lcd.height());
      lcd.setTextDatum(lgfx::bottom_left);
    }else
    if (clock_align == CLOCK_ALIGN_BOTTOM_CENTER ){
      lcd.setCursor((width - lcd.textWidth(str)) / 2, lcd.height());
      lcd.setTextDatum(lgfx::bottom_left);
    }else{
      lcd.setCursor((width - lcd.textWidth(str)) / 2, lcd.height() / 2);
      lcd.setTextDatum(lgfx::middle_left);
    }
    lcd.printf(str);
  }else
  if (clock_type == CLOCK_TYPE_DATETIME){
    if (clock_align == CLOCK_ALIGN_TOP_LEFT){
      sprintf(str, "%02d:%02d", timeInfo.tm_hour, timeInfo.tm_min);
      lcd.setTextSize(1);
      lcd.setTextSize(calc_scale(lcd.textWidth(str), width));
      lcd.setCursor(0, 0);
      lcd.setTextDatum(lgfx::top_left);
      lcd.printf(str);
      int fontHeight_1st = lcd.fontHeight();

      sprintf(str, "%04d.%02d.%02d", timeInfo.tm_year + 1900, timeInfo.tm_mon + 1, timeInfo.tm_mday);
      lcd.setTextSize(1);
      lcd.setTextSize(calc_scale(lcd.textWidth(str), width));
      lcd.setCursor(0, fontHeight_1st);
      lcd.setTextDatum(lgfx::top_left);
      lcd.printf(str);
    }else
    if (clock_align == CLOCK_ALIGN_BOTTOM_RIGHT){
      sprintf(str, "%04d.%02d.%02d", timeInfo.tm_year + 1900, timeInfo.tm_mon + 1, timeInfo.tm_mday);
      lcd.setTextSize(1);
      lcd.setTextSize(calc_scale(lcd.textWidth(str), width));
      lcd.setCursor(lcd.width() - lcd.textWidth(str), lcd.height());
      lcd.setTextDatum(lgfx::bottom_left);
      lcd.printf(str);
      int fontHeight_1st = lcd.fontHeight();

      sprintf(str, "%02d:%02d", timeInfo.tm_hour, timeInfo.tm_min);
      lcd.setTextSize(1);
      lcd.setTextSize(calc_scale(lcd.textWidth(str), width));
      lcd.setCursor(lcd.width() - lcd.textWidth(str), lcd.height() - fontHeight_1st);
      lcd.setTextDatum(lgfx::bottom_left);
      lcd.printf(str);
    }else
    if (clock_align == CLOCK_ALIGN_BOTTOM_CENTER){
      sprintf(str, "%04d.%02d.%02d", timeInfo.tm_year + 1900, timeInfo.tm_mon + 1, timeInfo.tm_mday);
      lcd.setTextSize(1);
      lcd.setTextSize(calc_scale(lcd.textWidth(str), width));
      lcd.setCursor((width - lcd.textWidth(str)) / 2, lcd.height());
      lcd.setTextDatum(lgfx::bottom_left);
      lcd.printf(str);
      int fontHeight_1st = lcd.fontHeight();

      sprintf(str, "%02d:%02d", timeInfo.tm_hour, timeInfo.tm_min);
      lcd.setTextSize(1);
      lcd.setTextSize(calc_scale(lcd.textWidth(str), width));
      lcd.setCursor((lcd.width() - lcd.textWidth(str)) / 2, lcd.height() - fontHeight_1st);
      lcd.setTextDatum(lgfx::bottom_left);
      lcd.printf(str);
    }else{
      sprintf(str, "%02d:%02d", timeInfo.tm_hour, timeInfo.tm_min);
      lcd.setTextSize(1);
      lcd.setTextSize(calc_scale(lcd.textWidth(str), width));
      lcd.setCursor((lcd.width() - lcd.textWidth(str)) / 2, lcd.height() / 2);
      lcd.setTextDatum(lgfx::bottom_left);
      lcd.printf(str);

      sprintf(str, "%04d.%02d.%02d", timeInfo.tm_year + 1900, timeInfo.tm_mon + 1, timeInfo.tm_mday);
      lcd.setTextSize(1);
      lcd.setTextSize(calc_scale(lcd.textWidth(str), width));
      lcd.setCursor((width - lcd.textWidth(str)) / 2, lcd.height() / 2);
      lcd.setTextDatum(lgfx::top_left);
      lcd.printf(str);
    }
  }
}

float calc_scale(int target, int width){
  if( target > width ){
    int scale1 = ceil((float)target / width);
    return 1.0f / scale1;
  }else{
    return floor((float)width / target);
  }
}

void wifi_connect(const char *ssid, const char *password){
  Serial.println("");
  Serial.print("WiFi Connenting");

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED){
    Serial.print(".");
    delay(1000);
  }
  Serial.println("");
  Serial.print("Connected : ");
  Serial.println(WiFi.localIP());
}

long doHttpGet(String url, uint8_t *p_buffer, unsigned long *p_len){
  HTTPClient http;

  Serial.print("[HTTP] GET begin...\n");
  // configure traged server and url
  http.begin(url);

  Serial.print("[HTTP] GET...\n");
  // start connection and send HTTP header
  int httpCode = http.GET();
  unsigned long index = 0;

  // httpCode will be negative on error
  if (httpCode > 0){
    // HTTP header has been send and Server response header has been handled
    Serial.printf("[HTTP] GET... code: %d\n", httpCode);

    // file found at server
    if (httpCode == HTTP_CODE_OK){
      // get tcp stream
      WiFiClient *stream = http.getStreamPtr();

      // get lenght of document (is -1 when Server sends no Content-Length header)
      int len = http.getSize();
      Serial.printf("[HTTP] Content-Length=%d\n", len);
      if (len != -1 && len > *p_len){
        Serial.printf("[HTTP] buffer size over\n");
        http.end();
        return -1;
      }

      // read all data from server
      while (http.connected() && (len > 0 || len == -1)){
        // get available data size
        size_t size = stream->available();

        if (size > 0){
          // read up to 128 byte
          if ((index + size) > *p_len){
            Serial.printf("[HTTP] buffer size over\n");
            http.end();
            return -1;
          }
          int c = stream->readBytes(&p_buffer[index], size);

          index += c;
          if (len > 0){
            len -= c;
          }
        }
        delay(1);
      }
    }else{
      http.end();
      return -1;
    }
  }else{
    http.end();
    Serial.printf("[HTTP] GET... failed, error: %s\n", http.errorToString(httpCode).c_str());
    return -1;
  }

  http.end();
  *p_len = index;

  return 0;
}

long doHttpGetJson(String url, JsonDocument *p_output){
  HTTPClient http;

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int status_code = http.GET();
  if (status_code != 200){
    http.end();
    return status_code;
  }

  Stream *resp = http.getStreamPtr();

  DeserializationError err = deserializeJson(*p_output, *resp);
  if (err){
    Serial.println("Error: deserializeJson");
    Serial.println(err.f_str());
    http.end();
    return -1;
  }

  serializeJson(json_response, Serial);
  Serial.println("");
  http.end();

  return 0;
}

long doHttpPost(String url, JsonDocument *p_output){
  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  Serial.println("http.POST");
  int status_code = http.POST((uint8_t*)"{}", 2);
  Serial.printf("status_code=%d\r\n", status_code);
  if (status_code != 200){
    http.end();
    return status_code;
  }

  Stream *resp = http.getStreamPtr();
  DeserializationError err = deserializeJson(*p_output, *resp);
  http.end();

  if (err){
    Serial.println("Error: deserializeJson");
    Serial.println(err.f_str());
    return -1;
  }

  return 0;
}