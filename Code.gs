/**
 * Web App 進入點：回傳團購前台頁面
 */
function doGet() {
  const config = getConfigMap_();
  const template = HtmlService.createTemplateFromFile('Index');
  template.shopName = config.shop_name || '即期品零食團購站';

  return template
    .evaluate()
    .setTitle(template.shopName)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * HTML 模板引用輔助函式（用於載入 Styles / Scripts）
 * @param {string} filename
 * @return {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * LINE Messaging API Webhook 進入點
 * 用於驗證 Webhook 以及讓團主傳訊息快速查詢自己的 User ID / Group ID
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ status: 'ok' });
    }

    const body = JSON.parse(e.postData.contents);
    const events = Array.isArray(body.events) ? body.events : [];

    events.forEach(event => {
      handleLineWebhookEvent_(event);
    });
  } catch (err) {
    console.error('doPost Webhook 處理錯誤:', err);
  }

  // LINE Verify 按鈕要求固定回傳 200 OK
  return jsonResponse_({ status: 'ok' });
}

/**
 * 處理單筆 LINE Webhook 事件
 */
function handleLineWebhookEvent_(event) {
  if (!event || !event.replyToken) {
    return;
  }

  const source = event.source || {};
  const sourceType = source.type;
  const targetId = source.groupId || source.roomId || source.userId || '';
  if (!targetId) {
    return;
  }

  // 當機器人被邀請加入群組時，主動告知群組 ID
  if (event.type === 'join') {
    replyLineMessage(
      event.replyToken,
      `🍪 團購通知機器人已加入！\n本群組 ID 為：\n${targetId}\n\n請複製上方 ID 貼到 Google 試算表「🍱 團購系統管理 > 設定 LINE Token 與接收通知 ID」即可接收下單通知。`
    );
    return;
  }

  if (event.type === 'message' && event.message && event.message.type === 'text') {
    const text = String(event.message.text || '').trim().toLowerCase();
    const isLookupCommand = text === '綁定' || text === '查詢id' || text === 'id';

    // 個人聊天室任何訊息或群組輸入關鍵字時回覆 ID
    if (sourceType === 'user' || isLookupCommand) {
      const label = sourceType === 'group' ? '群組 Group ID' : sourceType === 'room' ? '聊天室 Room ID' : '個人 User ID';
      replyLineMessage(
        event.replyToken,
        `您的 ${label} 為：\n${targetId}\n\n請將此 ID 填入「🍱 團購系統管理 > 設定 LINE Token 與接收通知 ID」。`
      );
    }
  }
}

/**
 * 取得前台所需的商店設定與上架商品清單
 */
function getStorefrontData() {
  const config = getConfigMap_();
  const rawProducts = readAllProducts_();

  const products = rawProducts
    .filter(p => p.status === '上架' && p.daysLeft !== null && p.daysLeft >= 0)
    .sort((a, b) => (a.sortOrder - b.sortOrder) || (a.daysLeft - b.daysLeft));

  const pickupLocations = String(config.pickup_locations || '')
    .split(/[,，、\n]+/)
    .map(s => s.trim())
    .filter(Boolean);

  return {
    settings: {
      shopName: config.shop_name,
      announcement: config.announcement,
      groupBuyDeadline: config.group_buy_deadline,
      contactInfo: config.contact_info,
      pickupLocations: pickupLocations.length > 0 ? pickupLocations : ['預設面交地點']
    },
    products: products
  };
}

/**
 * 送出團購訂單（使用 LockService 確保搶購即期品不超賣）
 * @param {Object} payload
 */
function submitOrder(payload) {
  const validated = validateOrderPayload_(payload);
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);
  } catch (lockErr) {
    throw new Error('目前搶購人數較多，系統忙碌中，請稍後幾秒再試一次。');
  }

  let orderRecord;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const productSheet = ss.getSheetByName(SHEET_NAMES.PRODUCTS);
    const orderSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
    if (!productSheet || !orderSheet) {
      throw new Error('系統尚未完成初始化，請聯絡團主。');
    }

    const products = readAllProducts_();
    const productMap = {};
    products.forEach(p => {
      productMap[p.productId] = p;
    });

    const verifiedItems = [];
    let totalAmount = 0;

    // 核對商品狀態、效期與庫存
    validated.items.forEach(reqItem => {
      const product = productMap[reqItem.productId];
      if (!product || product.status !== '上架') {
        throw new Error(`商品「${reqItem.productId}」已下架或不存在，請重新整理頁面。`);
      }
      if (product.daysLeft === null || product.daysLeft < 0) {
        throw new Error(`「${product.name}」已超過有效期限，無法購買。`);
      }
      if (product.stock < reqItem.qty) {
        if (product.stock <= 0) {
          throw new Error(`「${product.name}」已被搶購一空！`);
        }
        throw new Error(`「${product.name}」庫存僅剩 ${product.stock} 份，請調整數量。`);
      }

      const subtotal = product.groupPrice * reqItem.qty;
      totalAmount += subtotal;
      verifiedItems.push({
        productId: product.productId,
        name: product.name,
        spec: product.spec,
        price: product.groupPrice,
        qty: reqItem.qty,
        subtotal: subtotal,
        expiryDate: product.expiryDate,
        rowIndex: product.rowIndex,
        newStock: product.stock - reqItem.qty
      });
    });

    // 扣減商品庫存（第 8 欄為 stock）
    const STOCK_COL = 8;
    verifiedItems.forEach(item => {
      productSheet.getRange(item.rowIndex, STOCK_COL).setValue(item.newStock);
    });

    const now = new Date();
    const createdAt = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
    const orderId = generateOrderId_(orderSheet, now);
    const itemsSummary = verifiedItems.map(i => `${i.name} x${i.qty}`).join('、');

    const newRow = [
      orderId,
      createdAt,
      sanitizeCellText_(validated.buyerName),
      validated.buyerPhone,
      sanitizeCellText_(validated.buyerLineName),
      sanitizeCellText_(validated.pickupLocation),
      sanitizeCellText_(validated.pickupTimeNote),
      JSON.stringify(verifiedItems.map(({ rowIndex, newStock, ...rest }) => rest)),
      sanitizeCellText_(itemsSummary),
      totalAmount,
      '待付款（取貨付款）',
      '新訂單'
    ];

    const targetRow = orderSheet.getLastRow() + 1;
    // 先確保電話欄位為純文字格式，保留開頭 0
    orderSheet.getRange(targetRow, 4).setNumberFormat('@');
    orderSheet.getRange(targetRow, 1, 1, ORDER_HEADERS.length).setValues([newRow]);
    SpreadsheetApp.flush();

    orderRecord = {
      orderId: orderId,
      createdAt: createdAt,
      buyerName: validated.buyerName,
      buyerPhone: validated.buyerPhone,
      buyerLineName: validated.buyerLineName,
      pickupLocation: validated.pickupLocation,
      pickupTimeNote: validated.pickupTimeNote,
      items: verifiedItems,
      itemsSummary: itemsSummary,
      totalAmount: totalAmount
    };
  } finally {
    lock.releaseLock();
  }

  // 鎖定釋放後再推播 LINE，避免外部 API 等待時間影響其他買家結帳
  let lineNotified = true;
  let lineError = '';
  try {
    sendOrderLineNotification(orderRecord);
  } catch (err) {
    lineNotified = false;
    lineError = err.message;
    console.error(`訂單 ${orderRecord.orderId} LINE 通知失敗:`, err);
  }

  return {
    success: true,
    orderId: orderRecord.orderId,
    createdAt: orderRecord.createdAt,
    pickupLocation: orderRecord.pickupLocation,
    totalAmount: orderRecord.totalAmount,
    items: orderRecord.items.map(({ rowIndex, newStock, ...rest }) => rest),
    lineNotified: lineNotified,
    lineError: lineError
  };
}

/**
 * 讀取商品管理工作表並轉換為前端結構
 */
function readAllProducts_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PRODUCTS);
  if (!sheet || sheet.getLastRow() <= 1) {
    return [];
  }

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, PRODUCT_HEADERS.length).getValues();
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');

  return values
    .map((row, idx) => {
      const productId = String(row[0] || '').trim();
      const name = String(row[1] || '').trim();
      if (!productId || !name) {
        return null;
      }

      const originalPrice = Number(row[4]) || 0;
      const groupPrice = Number(row[5]) || 0;
      const expiryDate = normalizeDateString_(row[6]);
      const daysLeft = expiryDate ? calcDaysDiff_(todayStr, expiryDate) : null;
      const stock = Math.max(0, Math.floor(Number(row[7]) || 0));
      const discountRate = (originalPrice > 0 && groupPrice > 0 && groupPrice < originalPrice)
        ? Number(((groupPrice / originalPrice) * 10).toFixed(1))
        : null;

      return {
        rowIndex: idx + 2,
        productId: productId,
        name: name,
        category: String(row[2] || '其他零食').trim(),
        spec: String(row[3] || '').trim(),
        originalPrice: originalPrice,
        groupPrice: groupPrice,
        expiryDate: expiryDate,
        daysLeft: daysLeft,
        stock: stock,
        imageUrl: String(row[8] || '').trim(),
        status: String(row[9] || '下架').trim(),
        description: String(row[10] || '').trim(),
        sortOrder: Number(row[11]) || 999,
        discountRate: discountRate
      };
    })
    .filter(Boolean);
}

/**
 * 驗證買家下單欄位與購買品項
 */
function validateOrderPayload_(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('訂單資料格式不正確。');
  }

  const buyerName = String(payload.buyerName || '').trim();
  const buyerPhone = String(payload.buyerPhone || '').trim();
  const buyerLineName = String(payload.buyerLineName || '').trim();
  const pickupLocation = String(payload.pickupLocation || '').trim();
  const pickupTimeNote = String(payload.pickupTimeNote || '').trim();
  const rawItems = Array.isArray(payload.items) ? payload.items : [];

  if (!buyerName) {
    throw new Error('請填寫訂購人姓名或暱稱。');
  }
  if (!/^09\d{8}$|^\d{8,12}$/.test(buyerPhone.replace(/[-\s]/g, ''))) {
    throw new Error('請輸入正確的聯絡手機號碼（例如 0912345678）。');
  }
  if (!pickupLocation) {
    throw new Error('請選擇面交或自取地點。');
  }
  if (rawItems.length === 0) {
    throw new Error('購物車是空的，請先選購商品。');
  }

  // 合併重複的 productId 並驗證數量為正整數
  const mergedMap = {};
  rawItems.forEach(item => {
    const productId = String((item && item.productId) || '').trim();
    const qty = Number(item && item.qty);
    if (!productId || !Number.isInteger(qty) || qty <= 0) {
      throw new Error('商品數量必須為正整數。');
    }
    mergedMap[productId] = (mergedMap[productId] || 0) + qty;
  });

  const items = Object.keys(mergedMap).map(productId => ({
    productId: productId,
    qty: mergedMap[productId]
  }));

  return {
    buyerName,
    buyerPhone: buyerPhone.replace(/[-\s]/g, ''),
    buyerLineName,
    pickupLocation,
    pickupTimeNote,
    items
  };
}

/**
 * 產生當日流水訂單編號，例如 GB20261117-001
 */
function generateOrderId_(orderSheet, dateObj) {
  const datePart = Utilities.formatDate(dateObj, 'Asia/Taipei', 'yyyyMMdd');
  const prefix = `GB${datePart}-`;
  let maxSeq = 0;

  const lastRow = orderSheet.getLastRow();
  if (lastRow > 1) {
    const ids = orderSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    ids.forEach(([id]) => {
      const str = String(id || '');
      if (str.startsWith(prefix)) {
        const seq = parseInt(str.slice(prefix.length), 10);
        if (!isNaN(seq) && seq > maxSeq) {
          maxSeq = seq;
        }
      }
    });
  }

  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
}

/**
 * 將試算表儲存格的日期轉成 yyyy-MM-dd 字串
 */
function normalizeDateString_(val) {
  if (!val) {
    return '';
  }
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, 'Asia/Taipei', 'yyyy-MM-dd');
  }
  const str = String(val).trim().replace(/\//g, '-');
  const match = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) {
    return '';
  }
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

/**
 * 計算兩個 yyyy-MM-dd 日期的天數差 (target - base)
 */
function calcDaysDiff_(baseStr, targetStr) {
  const toUtcMs = s => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtcMs(targetStr) - toUtcMs(baseStr)) / 86400000);
}

/**
 * 防止 Google Sheets 公式注入 (=, +, -, @ 開頭)
 */
function sanitizeCellText_(text) {
  const str = String(text || '');
  return /^[=+\-@]/.test(str) ? `'${str}` : str;
}

/**
 * JSON 回應封裝
 */
function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
