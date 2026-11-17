# 常見問題與除錯指南 (Troubleshooting)

本文件整理學生實作本專案時最常遇到的 6 個問題與正確解法。

---

## 1. 試算表上方看不到「🍱 團購系統管理」選單
- **原因**：在 Apps Script 貼上 `SheetSetup.gs` 之前，試算表分頁就已經開著，`onOpen()` 尚未觸發。
- **解法**：
  1. 確認 Apps Script 中已儲存 `SheetSetup.gs`。
  2. 回到 Google 試算表按 **`F5` 重新整理**，等待 3–5 秒，選單列最右側「說明 (Help)」旁就會出現 `🍱 團購系統管理`。

---

## 2. LINE 測試報錯 `400: {"message":"The property, 'to', in the request body is invalid"}`
- **原因**：`LINE_TARGET_ID` 欄位填錯格式。常見誤填包括：
  - 填成機器人的 **Bot Basic ID**（例如 `@xxxxxx`）
  - 填成自己的手機號碼或個人自訂 LINE ID
  - 複製時多複製到中文提示文字或換行空白
- **解法**：
  - Push API 的 `to` 欄位必須是 **33 碼的 `U` 開頭 User ID**（如 `Uxxxxxxxx...`）或 **`C` 開頭 Group ID**。
  - 請至 LINE Developers Console 的 **Basic settings** 分頁最下方查看 **Your user ID**，或透過 Webhook 傳「`綁定`」取得純 ID 字串後重新填入。

---

## 3. LINE Developers 點擊 Webhook「Verify」顯示 `302 Found`
- **原因**：Google Apps Script 的 `/exec` 端點收到 `POST` 請求時，Google 伺服器架構固定會先回傳 `HTTP 302 Found` 重新導向至 `script.googleusercontent.com`，而 LINE 的 Verify 按鈕不會自動追蹤 302。
- **檢查重點**：
  1. 確認部署權限「**誰可以存取**」確實為 **`所有人`**（若設為「僅限我自己」，會被導向 Google 登入頁而真正失敗）。
  2. 忽略 Verify 的 `302` 警告，確認 **Use webhook** 已開啟，直接用手機傳訊「`綁定`」給官方帳號測試，並至 Apps Script 左側「**執行項目 (Executions)**」檢查是否有收到 `doPost` 紀錄。

---

## 4. 修改了 `.gs` 或 `.html`，但網頁還是舊畫面
- **原因**：在 Google Apps Script 只按 `Ctrl + S` 儲存，只會更新測試版（`Head`），不會更新已發布的 `/exec` 正式網址。
- **解法**：點擊右上角 **「部署 > 管理部署作業」** > 點擊鉛筆圖示 **編輯** > 版本下拉選單選擇 **「建立新版本」** > 點擊 **部署**。

---

## 5. 買家下單送出時顯示「請輸入正確的聯絡手機號碼」
- **原因**：後端 `validateOrderPayload_()` 驗證規則為台灣手機 `09\d{8}` 或 8–12 碼純數字（會自動移除 `-` 與空白）。
- **解法**：提醒測試時輸入有效格式（例如 `0912345678`），勿輸入英文或少於 8 碼的測試字串。

---

## 6. 官方帳號一直跳出「感謝您的訊息...」罐頭自動回覆
- **原因**：LINE Official Account Manager 預設開啟了「自動回應訊息」。
- **解法**：前往 [LINE Official Account Manager](https://manager.line.biz/) > 進入該帳號 > **設定 > 回應設定**：
  - 關閉 **自動回應訊息**
  - 開啟 **Webhook**
  - 若要讓機器人進入群組推播通知，同步開啟 **允許加入群組或多人聊天室**。
