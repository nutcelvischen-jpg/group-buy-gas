/**
 * Google Sheets 資料表名稱與欄位定義
 */
const SHEET_NAMES = {
  PRODUCTS: '商品管理',
  ORDERS: '訂單紀錄',
  SETTINGS: '系統設定'
};

const PRODUCT_HEADERS = [
  'product_id',
  'name',
  'category',
  'spec',
  'original_price',
  'group_price',
  'expiry_date',
  'stock',
  'image_url',
  'status',
  'description',
  'sort_order'
];

const ORDER_HEADERS = [
  'order_id',
  'created_at',
  'buyer_name',
  'buyer_phone',
  'buyer_line_name',
  'pickup_location',
  'pickup_time_note',
  'items_json',
  'items_summary',
  'total_amount',
  'payment_status',
  'order_status'
];

const SETTINGS_HEADERS = ['key', 'value', 'description'];

/**
 * 試算表開啟時自動建立「團購系統管理」自訂選單
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🍱 團購系統管理')
    .addItem('1. 初始化資料表（含範例即期零食）', 'initSpreadsheet')
    .addItem('2. 設定 LINE Token 與接收通知 ID', 'configureLineSecrets')
    .addItem('3. 發送 LINE 測試通知', 'runLineTestFromMenu')
    .addToUi();
}

/**
 * 初始化 Google Sheets 工作表、表頭、格式與範例資料
 * 若工作表已有資料則保留原資料，僅補齊缺少的工作表。
 */
function initSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const createdSheets = [];

  // 1. 商品管理
  const productSheet = getOrCreateSheet_(ss, SHEET_NAMES.PRODUCTS, PRODUCT_HEADERS);
  if (productSheet.getLastRow() <= 1) {
    const sampleProducts = buildSampleProducts_();
    productSheet.getRange(2, 1, sampleProducts.length, PRODUCT_HEADERS.length).setValues(sampleProducts);
    // 強制將效期欄位設為純文字 yyyy-mm-dd 格式
    productSheet.getRange(2, 7, sampleProducts.length, 1).setNumberFormat('yyyy-mm-dd');
    createdSheets.push(SHEET_NAMES.PRODUCTS);
  }
  styleSheetHeader_(productSheet, PRODUCT_HEADERS.length, '#F97316');

  // 2. 訂單紀錄
  const orderSheet = getOrCreateSheet_(ss, SHEET_NAMES.ORDERS, ORDER_HEADERS);
  // 確保電話欄 (第 4 欄) 整欄預設為純文字格式，避免開頭 0 被吃掉
  orderSheet.getRange('D:D').setNumberFormat('@');
  styleSheetHeader_(orderSheet, ORDER_HEADERS.length, '#0F766E');
  if (orderSheet.getLastRow() === 1) {
    createdSheets.push(SHEET_NAMES.ORDERS);
  }

  // 3. 系統設定
  const settingsSheet = getOrCreateSheet_(ss, SHEET_NAMES.SETTINGS, SETTINGS_HEADERS);
  if (settingsSheet.getLastRow() <= 1) {
    const deadlineDate = formatOffsetDate_(14);
    const defaultSettings = [
      ['shop_name', '甜心即期零食挖寶團', '前台顯示的團購站名稱'],
      ['announcement', '即期良品限量搶購！下單後請於指定面交時段取貨並現場付款，售完不補～', '首頁公告欄文字'],
      ['group_buy_deadline', `${deadlineDate} 22:00`, '本團結單時間（顯示於前台）'],
      ['pickup_locations', '台北捷運忠孝復興站 2 號出口,板橋捷運新埔站 1 號出口,公司一樓大廳面交點', '面交/自取地點清單（請用半形逗號 , 分隔）'],
      ['contact_info', '團主小美（LINE 官方帳號回覆最快）', '取貨聯絡說明']
    ];
    settingsSheet.getRange(2, 1, defaultSettings.length, SETTINGS_HEADERS.length).setValues(defaultSettings);
    createdSheets.push(SHEET_NAMES.SETTINGS);
  }
  styleSheetHeader_(settingsSheet, SETTINGS_HEADERS.length, '#475569');

  const msg = createdSheets.length > 0
    ? `初始化完成！已建立工作表：${createdSheets.join('、')}`
    : '資料表皆已存在，未覆蓋現有資料。';

  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    Logger.log(msg);
  }
  return msg;
}

/**
 * 取得或建立工作表並寫入表頭
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} name
 * @param {string[]} headers
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

/**
 * 美化表頭並凍結第一列
 */
function styleSheetHeader_(sheet, colCount, bgColor) {
  const headerRange = sheet.getRange(1, 1, 1, colCount);
  headerRange
    .setBackground(bgColor)
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
}

/**
 * 讀取系統設定並轉成 Key-Value 物件
 * @return {Object<string, string>}
 */
function getConfigMap_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  const defaults = {
    shop_name: '即期品零食團購站',
    announcement: '限量即期零食搶購中，下單後將由團主通知面交！',
    group_buy_deadline: '',
    pickup_locations: '預設面交點',
    contact_info: ''
  };
  if (!sheet || sheet.getLastRow() <= 1) {
    return defaults;
  }

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  rows.forEach(([key, value]) => {
    const cleanKey = String(key || '').trim();
    if (cleanKey) {
      defaults[cleanKey] = value instanceof Date
        ? Utilities.formatDate(value, 'Asia/Taipei', 'yyyy-MM-dd HH:mm')
        : String(value || '').trim();
    }
  });
  return defaults;
}

/**
 * 產生範例即期零食商品（效期動態以今天往後推算，方便測試不同倒數標籤）
 */
function buildSampleProducts_() {
  return [
    [
      'SNK001',
      'Calbee 卡樂比淡鹽厚切洋芋片',
      '鹹食餅乾',
      '120g / 包',
      89,
      39,
      formatOffsetDate_(5),
      12,
      'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=600&q=80',
      '上架',
      '日本原裝進口，短效期出清特價！',
      1
    ],
    [
      'SNK002',
      '明治 Meiji 72% 黑巧克力盒裝',
      '巧克力甜食',
      '26 枚入 / 盒',
      149,
      79,
      formatOffsetDate_(18),
      8,
      'https://images.unsplash.com/photo-1549007994-cb92caebd54b?auto=format&fit=crop&w=600&q=80',
      '上架',
      '濃郁不甜膩，辦公室下午茶必囤。',
      2
    ],
    [
      'SNK003',
      '韓國海苔脆片（原味芝麻）',
      '海苔堅果',
      '40g x 3 包組',
      165,
      95,
      formatOffsetDate_(45),
      20,
      'https://images.unsplash.com/photo-1599490659213-e2b9527bd087?auto=format&fit=crop&w=600&q=80',
      '上架',
      '酥脆爽口，單吃或配飯都超讚。',
      3
    ],
    [
      'SNK004',
      '義美小泡芙經典牛奶家庭號',
      '餅乾點心',
      '3 入組',
      115,
      65,
      formatOffsetDate_(12),
      4,
      'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=600&q=80',
      '上架',
      '僅剩最後幾組，手慢就沒囉！',
      4
    ]
  ];
}

/**
 * 取得距離今日 N 天的日期字串 (yyyy-MM-dd, Asia/Taipei)
 * @param {number} offsetDays
 * @return {string}
 */
function formatOffsetDate_(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return Utilities.formatDate(date, 'Asia/Taipei', 'yyyy-MM-dd');
}
