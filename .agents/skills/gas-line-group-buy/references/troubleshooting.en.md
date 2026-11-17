# Troubleshooting Guide (English)

Common issues students encounter when deploying the GAS + Google Sheets + LINE Messaging API group-buy system, and how to fix them.

---

## 1. Custom Menu `🍱 團購系統管理` Does Not Appear in Google Sheets
- **Cause**: The Google Sheet tab was already open before `SheetSetup.gs` was pasted and saved, so `onOpen()` has not fired yet.
- **Fix**:
  1. Verify `SheetSetup.gs` is saved in Apps Script.
  2. Switch to the Google Sheet tab and **press `F5` to reload**, then wait 3–5 seconds. `🍱 團購系統管理` will appear right next to `Help`.

---

## 2. LINE Test Error `400: {"message":"The property, 'to', in the request body is invalid"}`
- **Cause**: Invalid ID stored in `LINE_TARGET_ID`. Common mistakes include entering:
  - The Bot Basic ID (e.g., `@xxxxxx`) instead of your User ID
  - Your personal phone number or custom LINE ID
  - Extra Chinese prompt text or whitespace around the ID
- **Fix**:
  - Push API requires a **33-character User ID starting with `U`** (or a `Group ID` starting with `C`).
  - Copy **Your user ID** from the bottom of **Basic settings** in LINE Developers Console, or message `綁定` to your bot via Webhook and paste only the `U...` string.

---

## 3. Clicking "Verify" on LINE Webhook Shows `302 Found`
- **Cause**: Google Apps Script Web Apps respond to `POST /exec` requests with an initial `HTTP 302 Found` redirect to `script.googleusercontent.com`. LINE's Verify button does not follow `302` redirects.
- **Checks**:
  1. Ensure your GAS deployment has **Who has access** set to **`Anyone`** (not `Only myself`, which redirects to Google login).
  2. Ignore the Verify `302` warning, ensure **Use webhook** is ON, send `綁定` from LINE to the bot, and check **Executions** in Apps Script to confirm `doPost` ran.

---

## 4. Code Changes in `.gs` or `.html` Do Not Show Up on the Web App URL
- **Cause**: Pressing `Ctrl + S` only saves the `Head` draft, not the published `/exec` deployment version.
- **Fix**: Click **Deploy > Manage deployments > Edit (pencil icon) > Version: New version > Deploy**.

---

## 5. Checkout Error: `請輸入正確的聯絡手機號碼（例如 0912345678）`
- **Cause**: `validateOrderPayload_()` validates Taiwan mobile format (`09\d{8}`) or 8–12 digits (after stripping `-` and spaces).
- **Fix**: Enter a valid test phone number such as `0912345678`.

---

## 6. Bot Keeps Replying with Default Auto-Reply Messages
- **Cause**: Auto-reply is enabled by default in LINE Official Account Manager.
- **Fix**: Visit [LINE Official Account Manager](https://manager.line.biz/) > select your account > **Settings > Response settings**:
  - Disable **Auto-response messages**
  - Enable **Webhooks**
  - Optionally enable **Allow account to join group chats** if pushing order alerts to a LINE group.
