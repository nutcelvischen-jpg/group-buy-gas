const LINE_PROP_KEYS = {
  CHANNEL_ACCESS_TOKEN: 'LINE_CHANNEL_ACCESS_TOKEN',
  TARGET_ID: 'LINE_TARGET_ID'
};

const LINE_ENDPOINTS = {
  PUSH: 'https://api.line.me/v2/bot/message/push',
  REPLY: 'https://api.line.me/v2/bot/message/reply'
};

/**
 * 透過試算表彈窗設定 LINE Channel Access Token 與接收通知的 User/Group ID
 */
function configureLineSecrets() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  const currentToken = props.getProperty(LINE_PROP_KEYS.CHANNEL_ACCESS_TOKEN) || '';
  const maskedToken = currentToken ? `（目前已設定，尾碼 ...${currentToken.slice(-6)}）` : '（尚未設定）';

  const tokenResp = ui.prompt(
    '步驟 1/2：設定 LINE Channel Access Token',
    `請貼上 LINE Developers > Messaging API 的 Channel access token ${maskedToken}\n（留空直接按確定可保留原設定）`,
    ui.ButtonSet.OK_CANCEL
  );
  if (tokenResp.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  const newToken = tokenResp.getResponseText().trim();
  if (newToken) {
    props.setProperty(LINE_PROP_KEYS.CHANNEL_ACCESS_TOKEN, newToken);
  }

  const currentTarget = props.getProperty(LINE_PROP_KEYS.TARGET_ID) || '';
  const targetResp = ui.prompt(
    '步驟 2/2：設定接收通知的 LINE ID',
    `請輸入您的 User ID（U開頭）或群組 Group ID（C開頭）\n目前設定：${currentTarget || '尚未設定'}\n（提示：若不知 ID，可先部署 Web App 並綁定 Webhook 後，傳訊「綁定」給官方帳號取得）`,
    ui.ButtonSet.OK_CANCEL
  );
  if (targetResp.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  const newTarget = targetResp.getResponseText().trim();
  if (newTarget) {
    props.setProperty(LINE_PROP_KEYS.TARGET_ID, newTarget);
  }

  ui.alert('LINE 設定已儲存至 ScriptProperties！建議接著執行「3. 發送 LINE 測試通知」。');
}

/**
 * 供 Google Sheets 選單呼叫的測試推播函式
 */
function runLineTestFromMenu() {
  const ui = SpreadsheetApp.getUi();
  try {
    testLinePush();
    ui.alert('測試通知發送成功！請檢查您的 LINE 是否已收到測試訂單卡片。');
  } catch (err) {
    ui.alert(`發送失敗：${err.message}`);
  }
}

/**
 * 在 GAS 編輯器或選單執行的 LINE 推播測試
 */
function testLinePush() {
  const sampleOrder = {
    orderId: `TEST-${Utilities.formatDate(new Date(), 'Asia/Taipei', 'HHmmss')}`,
    createdAt: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'),
    buyerName: '測試買家（王小明）',
    buyerPhone: '0912345678',
    buyerLineName: 'Ming',
    pickupLocation: '台北捷運忠孝復興站 2 號出口',
    pickupTimeNote: '週五下班 18:30（此為測試通知）',
    items: [
      { name: 'Calbee 卡樂比淡鹽厚切洋芋片', qty: 2, price: 39, subtotal: 78, expiryDate: formatOffsetDate_(5) },
      { name: '明治 Meiji 72% 黑巧克力盒裝', qty: 1, price: 79, subtotal: 79, expiryDate: formatOffsetDate_(18) }
    ],
    totalAmount: 157
  };

  sendOrderLineNotification(sampleOrder);
  return 'OK';
}

/**
 * 發送新訂單 LINE 通知（優先使用 Flex Message，失敗時降級為純文字訊息）
 * @param {Object} order
 */
function sendOrderLineNotification(order) {
  const { token, targetId } = getLineCredentials_();
  const flexMessage = buildOrderFlexMessage_(order);

  try {
    callLineApi_(LINE_ENDPOINTS.PUSH, token, {
      to: targetId,
      messages: [flexMessage]
    });
  } catch (flexErr) {
    console.warn('Flex Message 推播失敗，改用純文字重試:', flexErr.message);
    const fallbackText = buildOrderPlainText_(order);
    callLineApi_(LINE_ENDPOINTS.PUSH, token, {
      to: targetId,
      messages: [{ type: 'text', text: fallbackText }]
    });
  }
}

/**
 * 使用 LINE Reply API 回覆 Webhook 訊息
 * @param {string} replyToken
 * @param {string} text
 */
function replyLineMessage(replyToken, text) {
  const token = PropertiesService.getScriptProperties().getProperty(LINE_PROP_KEYS.CHANNEL_ACCESS_TOKEN);
  if (!token || !replyToken) {
    return;
  }
  callLineApi_(LINE_ENDPOINTS.REPLY, token, {
    replyToken: replyToken,
    messages: [{ type: 'text', text: text }]
  });
}

/**
 * 讀取並驗證 LINE 憑證
 */
function getLineCredentials_() {
  const props = PropertiesService.getScriptProperties();
  const token = (props.getProperty(LINE_PROP_KEYS.CHANNEL_ACCESS_TOKEN) || '').trim();
  const targetId = (props.getProperty(LINE_PROP_KEYS.TARGET_ID) || '').trim();

  if (!token || !targetId) {
    throw new Error('尚未設定 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_TARGET_ID，請先於試算表選單完成設定。');
  }
  return { token, targetId };
}

/**
 * 共用 LINE Messaging API HTTP POST 呼叫
 */
function callLineApi_(url, token, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${token}`
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error(`LINE API 回應錯誤 (${code}): ${body}`);
  }
  return body;
}

/**
 * 組合訂單通知 Flex Message 卡片
 */
function buildOrderFlexMessage_(order) {
  const itemRows = order.items.map(item => ({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    contents: [
      {
        type: 'text',
        text: `${item.name} ×${item.qty}`,
        size: 'sm',
        color: '#334155',
        wrap: true,
        flex: 4
      },
      {
        type: 'text',
        text: `$${item.subtotal}`,
        size: 'sm',
        color: '#0F172A',
        weight: 'bold',
        align: 'end',
        flex: 1
      }
    ]
  }));

  const infoRow = (label, value) => ({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'xs', color: '#64748B', flex: 2 },
      { type: 'text', text: String(value || '未填寫'), size: 'xs', color: '#1E293B', wrap: true, flex: 5 }
    ]
  });

  return {
    type: 'flex',
    altText: `🍪 新團購訂單 #${order.orderId}｜${order.buyerName}｜$${order.totalAmount}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#F97316',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: '🍪 收到新的團購訂單！',
            color: '#FFFFFF',
            weight: 'bold',
            size: 'md'
          },
          {
            type: 'text',
            text: `訂單編號：${order.orderId}`,
            color: '#FFEDD5',
            size: 'xs',
            margin: 'xs'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '16px',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            contents: [
              infoRow('訂購人', order.buyerName),
              infoRow('聯絡電話', order.buyerPhone),
              infoRow('LINE 名稱', order.buyerLineName || '未填寫'),
              infoRow('面交地點', order.pickupLocation),
              infoRow('取貨備註', order.pickupTimeNote || '無')
            ]
          },
          { type: 'separator', color: '#E2E8F0' },
          {
            type: 'text',
            text: '訂購品項明細',
            size: 'xs',
            weight: 'bold',
            color: '#64748B'
          },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            contents: itemRows
          },
          { type: 'separator', color: '#E2E8F0' },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '應收總金額', size: 'md', weight: 'bold', color: '#0F172A' },
              { type: 'text', text: `NT$ ${order.totalAmount}`, size: 'lg', weight: 'bold', color: '#EA580C', align: 'end' }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingTop: '0px',
        paddingBottom: '12px',
        contents: [
          {
            type: 'text',
            text: `下單時間：${order.createdAt}`,
            size: 'xxs',
            color: '#94A3B8',
            align: 'center'
          }
        ]
      }
    }
  };
}

/**
 * 純文字降級通知格式
 */
function buildOrderPlainText_(order) {
  const lines = [
    `🍪 新團購訂單通知`,
    `訂單編號：${order.orderId}`,
    `訂購人：${order.buyerName}`,
    `電話：${order.buyerPhone}`,
    `LINE名稱：${order.buyerLineName || '未填寫'}`,
    `面交地點：${order.pickupLocation}`,
    `備註：${order.pickupTimeNote || '無'}`,
    `--- 品項明細 ---`
  ];
  order.items.forEach(item => {
    lines.push(`• ${item.name} x${item.qty} = $${item.subtotal}`);
  });
  lines.push(`----------------`);
  lines.push(`總金額：NT$ ${order.totalAmount}`);
  lines.push(`下單時間：${order.createdAt}`);
  return lines.join('\n');
}
