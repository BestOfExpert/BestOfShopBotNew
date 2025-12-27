const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");

// Load local `.env` when running locally
try { require('dotenv').config(); } catch (e) {}

// ============== BOT TOKEN ==============
const shopToken = process.env.SHOP_BOT_TOKEN || process.env.BOT_TOKEN;
if (!shopToken) {
    console.error('FATAL: SHOP_BOT_TOKEN environment variable is not set.');
    process.exit(1);
}
const bot = new TelegramBot(shopToken, { polling: true });

// ============== FILES BOT ==============
const filesToken = process.env.FILES_BOT_TOKEN;
let filesBot = null;
if (filesToken) {
    filesBot = new TelegramBot(filesToken, { polling: true });
    console.log('Files bot initialized.');
} else {
    console.log('FILES_BOT_TOKEN not set. Files bot disabled.');
}

const ADMIN_ID = 1447919062;
const GROUP_LINK = "@BestOfShopFiles_Bot";

// ============== HELPER FUNCTIONS ==============
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============== DATA FILES ==============
const PRODUCTS_FILE = path.join(__dirname, 'products_new.json');
const PAYMENT_FILE = path.join(__dirname, 'payment_settings.json');
const KEYS_FILE = path.join(__dirname, 'keys.json');

// ============== ÖDEME AYARLARI ==============
const DEFAULT_PAYMENT_SETTINGS = {
    iban: "TR230010300000000014365322",
    iban_alici: "Moka United Ödeme ve Elektronik Para Kuruluşu A.Ş.",
    iban_aciklama: "88295280440",
    papara: "papara ödeme yöntemi şuanda kullanımda değildir",
    binance: "TWdjyffvtyhbwuQzrNdh3A215EG6cNPWVL"
};

function loadPaymentSettings() {
    try {
        if (fs.existsSync(PAYMENT_FILE)) {
            return JSON.parse(fs.readFileSync(PAYMENT_FILE, 'utf-8'));
        }
    } catch (e) {}
    return { ...DEFAULT_PAYMENT_SETTINGS };
}

function savePaymentSettings(settings) {
    fs.writeFileSync(PAYMENT_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

let paymentSettings = loadPaymentSettings();

// ============== ÜRÜN YÖNETİMİ ==============
function loadProducts() {
    try {
        if (fs.existsSync(PRODUCTS_FILE)) {
            return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
        }
    } catch (e) {}
    return { categories: {}, products: {}, settings: { durations: [], currency: "TL", currency_symbol: "₺" } };
}

function saveProducts(data) {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ============== ANAHTAR YÖNETİMİ ==============
function loadKeys() {
    try {
        if (fs.existsSync(KEYS_FILE)) {
            return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
        }
    } catch (e) {}
    return {};
}

function saveKeys(keys) {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), 'utf-8');
}

let activeKeys = loadKeys();

// ============== USER SESSION ==============
const userState = {};
const adminState = {};

// Bekleyen siparişler (dekont gönderilmiş, onay bekleyen)
// { oderId: { chatId, productName, days, price, timestamp } }
const pendingOrders = {};

// Callback map for long data
const callbackMap = {};
function makeRef(obj) {
    const id = Math.random().toString(36).slice(2, 9);
    callbackMap[id] = obj;
    return `ref_${id}`;
}
function getRef(data) {
    if (!data || !data.startsWith('ref_')) return null;
    return callbackMap[data.slice(4)] || null;
}

// ============== MENÜ OLUŞTURMA ==============

// Ana menü - Mobil ve PC seçimi
function showMainMenu(chatId, messageId = null) {
    const data = loadProducts();
    const categories = data.categories || {};
    
    const buttons = [];
    for (const catKey in categories) {
        const cat = categories[catKey];
        buttons.push([{ 
            text: cat.name, 
            callback_data: `main_${catKey}` 
        }]);
    }
    
    // Resmi Telegram Kanallarımız butonu
    buttons.push([{ text: "📢 Resmi Telegram Kanallarımız", callback_data: "channels_menu" }]);
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
    };
    
    const text = `🛒 **BestOfShop'a Hoş Geldiniz!**

Lütfen ürün kategorisini seçin:`;
    
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

// Alt kategori menüsü (Android/iOS veya Windows/Emülatör)
function showSubcategoryMenu(chatId, categoryKey, messageId = null) {
    const data = loadProducts();
    const category = data.categories[categoryKey];
    if (!category) return showMainMenu(chatId, messageId);
    
    const buttons = [];
    const subcats = category.subcategories || {};
    
    for (const subKey in subcats) {
        const sub = subcats[subKey];
        buttons.push([{
            text: sub.name,
            callback_data: `subcat_${categoryKey}_${subKey}`
        }]);
    }
    
    buttons.push([{ text: "🔙 Geri", callback_data: "back_main" }]);
    
    const questionText = categoryKey === 'mobile' 
        ? "📱 **Cihazınız hangi işletim sistemiyle uyumlu?**"
        : "💻 **Platform seçin:**";
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
    };
    
    if (messageId) {
        bot.editMessageText(questionText, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, questionText, opts);
        });
    } else {
        bot.sendMessage(chatId, questionText, opts);
    }
}

// Ürün listesi menüsü
function showProductList(chatId, categoryKey, subcategoryKey, messageId = null) {
    const data = loadProducts();
    const products = data.products || {};
    
    // Bu kategoriye ait ürünleri filtrele
    const filteredProducts = Object.entries(products).filter(([key, prod]) => 
        prod.category === categoryKey && prod.subcategory === subcategoryKey
    );
    
    const buttons = filteredProducts.map(([key, prod]) => {
        const icon = prod.icon || '📦';
        const status = prod.maintenance ? ' (🔵 Bakımda)' : '';
        return [{
            text: `${icon} ${prod.name}${status}`,
            callback_data: `prod_${key}`
        }];
    });
    
    buttons.push([{ text: "🔙 Geri", callback_data: `back_subcat_${categoryKey}` }]);
    
    const category = data.categories[categoryKey];
    const subcategory = category?.subcategories?.[subcategoryKey];
    
    const text = `${subcategory?.icon || '📦'} **${subcategory?.name || 'Ürünler'}**

Lütfen bir ürün seçin:`;
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
    };
    
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

// Ürün detay ve süre seçimi
function showProductDetail(chatId, productKey, messageId = null) {
    const data = loadProducts();
    const product = data.products[productKey];
    if (!product) return showMainMenu(chatId, messageId);
    
    if (product.maintenance) {
        const text = `🔵 **${product.name}**

Bu ürün şu anda bakımdadır. Lütfen daha sonra tekrar deneyin.`;
        
        const opts = {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [[{ text: "🔙 Geri", callback_data: `back_products_${product.category}_${product.subcategory}` }]]
            }
        };
        
        if (messageId) {
            bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {});
        } else {
            bot.sendMessage(chatId, text, opts);
        }
        return;
    }
    
    // Açıklamayı descriptions klasöründen al veya product.description kullan
    let description = product.description || "Açıklama bulunamadı.";
    const descPath = path.join(__dirname, 'descriptions', `${product.name}.txt`);
    if (fs.existsSync(descPath)) {
        description = fs.readFileSync(descPath, 'utf-8');
    }
    
    const settings = data.settings || {};
    const durations = settings.durations || [
        { days: 7, label: "7 Gün" },
        { days: 30, label: "30 Gün" },
        { days: 60, label: "60 Gün" }
    ];
    const symbol = settings.currency_symbol || "₺";
    
    const buttons = durations.map(dur => {
        const price = product.prices?.[dur.days] || 0;
        // Fiyat 0 veya tanımsızsa bu süreyi gösterme
        if (!price || price <= 0) return null;
        return [{
            text: `${dur.label} - ${price}${symbol} Satın Al`,
            callback_data: `buy_${productKey}_${dur.days}`
        }];
    }).filter(btn => btn !== null);
    
    buttons.push([{ text: "🔙 Geri", callback_data: `back_products_${product.category}_${product.subcategory}` }]);
    
    const text = `${product.icon || '📦'} **${product.name}**

📋 **Ürün Özellikleri:**

${description}

💰 **Fiyatlar:**
${durations.map(d => `• ${d.label}: ${product.prices?.[d.days] || 0}${symbol}`).join('\n')}

Satın almak istediğiniz süreyi seçin:`;
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
    };
    
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

// Ödeme yöntemi seçimi
function showPaymentMethods(chatId, productKey, days, messageId = null) {
    const data = loadProducts();
    const product = data.products[productKey];
    if (!product) return showMainMenu(chatId, messageId);
    
    const price = product.prices?.[days] || 0;
    const symbol = data.settings?.currency_symbol || "₺";
    
    // Kullanıcı bilgisini kaydet
    userState[chatId] = {
        productKey,
        productName: product.name,
        days,
        price,
        step: 'payment_selection'
    };
    
    const text = `💳 **Ödeme Yöntemi Seçin**

📦 **Ürün:** ${product.name}
⏱ **Süre:** ${days} Gün
💰 **Fiyat:** ${price}${symbol}

Hangi ödeme yöntemini kullanmak istiyorsunuz?`;
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "💸 IBAN ile Öde", callback_data: "pay_iban" }],
                [{ text: "🏦 Papara ile Öde", callback_data: "pay_papara" }],
                [{ text: "💰 Binance (USDT) ile Öde", callback_data: "pay_binance" }],
                [{ text: "🔙 Geri", callback_data: `prod_${productKey}` }]
            ]
        }
    };
    
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

// Ödeme bilgilerini göster
function showPaymentDetails(chatId, method) {
    const sel = userState[chatId];
    if (!sel) return bot.sendMessage(chatId, "⚠️ Oturum zaman aşımına uğradı. /start yazın.");
    
    let message = "";
    if (method === "iban") {
        message = `💸 <b>İBAN İLE ÖDEME BİLGİLERİ</b>

┌─────────────────────────────┐
│  🏦 <b>IBAN:</b>
│  <code>${paymentSettings.iban}</code>
│
│  📝 <b>Açıklama:</b>
│  <code>${paymentSettings.iban_aciklama}</code>
│
│  👤 <b>Alıcı Adı:</b>
│  <code>${paymentSettings.iban_alici}</code>
└─────────────────────────────┘

📦 <b>Ürün:</b> ${sel.productName}
⏱ <b>Süre:</b> ${sel.days} Gün
💰 <b>Tutar:</b> ${sel.price}₺

⚠️ <b>ÖNEMLİ:</b> Açıklamaya <code>${paymentSettings.iban_aciklama}</code> yazmayı unutmayın!

━━━━━━━━━━━━━━━━━━━━
📤 <b>ÖDEME YAPTIKTAN SONRA</b>
Dekontu (ekran görüntüsü veya PDF) aşağıdaki butona basarak veya doğrudan bu sohbete gönderin.
━━━━━━━━━━━━━━━━━━━━`;
    } else if (method === "papara") {
        message = `🏦 <b>PAPARA İLE ÖDEME BİLGİLERİ</b>

┌─────────────────────────────┐
│  📱 <b>Papara:</b>
│  <code>${paymentSettings.papara}</code>
└─────────────────────────────┘

📦 <b>Ürün:</b> ${sel.productName}
⏱ <b>Süre:</b> ${sel.days} Gün
💰 <b>Tutar:</b> ${sel.price}₺

━━━━━━━━━━━━━━━━━━━━
📤 <b>ÖDEME YAPTIKTAN SONRA</b>
Dekontu (ekran görüntüsü veya PDF) aşağıdaki butona basarak veya doğrudan bu sohbete gönderin.
━━━━━━━━━━━━━━━━━━━━`;
    } else if (method === "binance") {
        message = `💰 <b>BİNANCE (USDT) İLE ÖDEME</b>

┌─────────────────────────────┐
│  🔗 <b>USDT (TRC20) Adresi:</b>
│  <code>${paymentSettings.binance}</code>
└─────────────────────────────┘

📦 <b>Ürün:</b> ${sel.productName}
⏱ <b>Süre:</b> ${sel.days} Gün
💰 <b>Tutar:</b> ${sel.price}₺

⚠️ <b>ÖNEMLİ:</b> Sadece <b>Tron TRC20</b> ağı kullanın!

━━━━━━━━━━━━━━━━━━━━
📤 <b>ÖDEME YAPTIKTAN SONRA</b>
Dekontu (ekran görüntüsü veya PDF) aşağıdaki butona basarak veya doğrudan bu sohbete gönderin.
━━━━━━━━━━━━━━━━━━━━`;
    }
    
    sel.step = 'waiting_receipt';
    bot.sendMessage(chatId, message, { 
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [
                [{ text: "✅ Ödeme Yaptım - Dekont Gönder", callback_data: "send_receipt" }],
                [{ text: "🔙 Ana Menü", callback_data: "back_main" }]
            ]
        }
    });
}

// ============== /START KOMUTU ==============
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    userState[chatId] = null;
    showMainMenu(chatId);
});

// ============== /ADMIN KOMUTU ==============
bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "❌ Yetkisiz erişim.");
    }
    showAdminPanel(chatId);
});

function showAdminPanel(chatId, messageId = null) {
    const text = `🔧 **Admin Paneli**

Yapmak istediğiniz işlemi seçin:`;
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "📁 Kategorileri Yönet", callback_data: "admin_categories" }],
                [{ text: "📦 Ürünleri Yönet", callback_data: "admin_products" }],
                [{ text: "➕ Yeni Ürün Ekle", callback_data: "admin_add_product" }],
                [{ text: "⏱ Süre Seçenekleri", callback_data: "admin_durations" }],
                [{ text: "💳 Ödeme Ayarları", callback_data: "admin_payment" }],
                [{ text: "🔑 Anahtarlar", callback_data: "admin_keys" }]
            ]
        }
    };
    
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

// ============== CALLBACK QUERY HANDLER ==============
bot.on("callback_query", (query) => {
    const chatId = query.from.id;
    const messageId = query.message?.message_id;
    const data = query.data;
    
    bot.answerCallbackQuery(query.id).catch(() => {});
    
    // === KULLANICI MENÜ NAVİGASYONU ===
    
    // Ana menüye dön
    if (data === "back_main") {
        userState[chatId] = null;
        return showMainMenu(chatId, messageId);
    }
    
    // Resmi Telegram Kanalları menüsü
    if (data === "channels_menu") {
        const text = `📢 **Resmi Telegram Kanallarımız**

Güncel haberler, duyurular ve kataloglar için kanallarımıza katılın!`;
        
        const opts = {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🌟 Genel Mod Kanalımız", url: "https://t.me/cyraxturkey" }],
                    [{ text: "🎱 8 Ball Pool Kanalımız", url: "https://t.me/BallPoolOfficialTurkiye" }],
                    [{ text: "🔙 Ana Menü", callback_data: "back_main" }]
                ]
            }
        };
        
        return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    }
    
    // Ana kategori seçimi (Mobil/PC)
    if (data.startsWith("main_")) {
        const categoryKey = data.substring(5);
        return showSubcategoryMenu(chatId, categoryKey, messageId);
    }
    
    // Alt kategori menüsüne dön
    if (data.startsWith("back_subcat_")) {
        const categoryKey = data.substring(12);
        return showSubcategoryMenu(chatId, categoryKey, messageId);
    }
    
    // Alt kategori seçimi (Android/iOS)
    if (data.startsWith("subcat_")) {
        const parts = data.substring(7).split("_");
        const categoryKey = parts[0];
        const subcategoryKey = parts.slice(1).join("_");
        return showProductList(chatId, categoryKey, subcategoryKey, messageId);
    }
    
    // Ürün listesine dön
    if (data.startsWith("back_products_")) {
        const parts = data.substring(14).split("_");
        const categoryKey = parts[0];
        const subcategoryKey = parts.slice(1).join("_");
        return showProductList(chatId, categoryKey, subcategoryKey, messageId);
    }
    
    // Ürün detay
    if (data.startsWith("prod_")) {
        const productKey = data.substring(5);
        return showProductDetail(chatId, productKey, messageId);
    }
    
    // Satın al - ödeme yöntemi seçimine git
    if (data.startsWith("buy_")) {
        const parts = data.substring(4).split("_");
        const days = parseInt(parts.pop());
        const productKey = parts.join("_");
        return showPaymentMethods(chatId, productKey, days, messageId);
    }
    
    // Ödeme yöntemi seçimi - zaman aşımı kontrolü
    if (data === "pay_iban" || data === "pay_papara" || data === "pay_binance") {
        const sel = userState[chatId];
        if (!sel || !sel.productName) {
            return bot.sendMessage(chatId, `⚠️ <b>Oturum zaman aşımına uğradı</b>\n\nBotu başlatmak için /start yazın.`, { parse_mode: 'HTML' });
        }
        if (data === "pay_iban") return showPaymentDetails(chatId, "iban");
        if (data === "pay_papara") return showPaymentDetails(chatId, "papara");
        if (data === "pay_binance") return showPaymentDetails(chatId, "binance");
    }
    
    // Dekont gönderme butonu
    if (data === "send_receipt") {
        const message = `📤 <b>DEKONT GÖNDERME</b>

━━━━━━━━━━━━━━━━━━━━
📎 Şimdi dekontu (ekran görüntüsü veya PDF) bu sohbete gönderin.

⏳ Ödemeniz en kısa sürede kontrol edilecektir.
━━━━━━━━━━━━━━━━━━━━`;
        
        return bot.sendMessage(chatId, message, {
            parse_mode: 'HTML'
        });
    }
    
    // === ADMİN İŞLEMLERİ ===
    if (chatId !== ADMIN_ID) return;
    
    // Admin panele dön
    if (data === "admin_back") {
        adminState[chatId] = null;
        return showAdminPanel(chatId, messageId);
    }
    
    // Kategori yönetimi
    if (data === "admin_categories") {
        return showAdminCategories(chatId, messageId);
    }
    
    // Ürün yönetimi
    if (data === "admin_products") {
        return showAdminProductList(chatId, messageId);
    }
    
    // Yeni ürün ekle
    if (data === "admin_add_product") {
        return startAddProduct(chatId);
    }
    
    // Süre seçenekleri
    if (data === "admin_durations") {
        return showAdminDurations(chatId, messageId);
    }
    
    // Ödeme ayarları
    if (data === "admin_payment") {
        return showAdminPayment(chatId, messageId);
    }
    
    // Anahtar yönetimi
    if (data === "admin_keys") {
        return showAdminKeys(chatId, messageId);
    }
    
    // Admin - ürün düzenleme
    if (data.startsWith("admin_edit_")) {
        const productKey = data.substring(11);
        return showAdminProductEdit(chatId, productKey, messageId);
    }
    
    // Admin - ürün sil
    if (data.startsWith("admin_delete_")) {
        const productKey = data.substring(13);
        return deleteProduct(chatId, productKey, messageId);
    }
    
    // Admin - bakım modu
    if (data.startsWith("admin_maint_")) {
        const productKey = data.substring(12);
        return toggleMaintenance(chatId, productKey, messageId);
    }
    
    // Admin - fiyat düzenle
    if (data.startsWith("admin_price_")) {
        const productKey = data.substring(12);
        adminState[chatId] = { action: 'edit_price', productKey };
        return bot.sendMessage(chatId, `Lütfen yeni fiyatları şu formatta girin:\n\n\`7:400 30:725 60:1200\`\n\n(7 gün: 400₺, 30 gün: 725₺, 60 gün: 1200₺)`, { parse_mode: 'Markdown' });
    }
    
    // Admin - açıklama düzenle
    if (data.startsWith("admin_desc_")) {
        const productKey = data.substring(11);
        adminState[chatId] = { action: 'edit_desc', productKey };
        return bot.sendMessage(chatId, "Lütfen yeni açıklamayı gönderin:");
    }
    
    // ========== KATEGORİ YÖNETİMİ ==========
    
    // Kategori ekle
    if (data === "admin_add_cat") {
        adminState[chatId] = { action: 'add_category', step: 'name' };
        return bot.sendMessage(chatId, `➕ **Yeni Kategori Ekleme**\n\nKategori adını yazın:\n\nÖrnek: \`📱 Mobil Modlar\``, { parse_mode: 'Markdown' });
    }
    
    // Alt kategori ekle - önce ana kategori seç
    if (data === "admin_add_subcat") {
        const prodData = loadProducts();
        const categories = prodData.categories || {};
        const catKeys = Object.keys(categories);
        
        if (catKeys.length === 0) {
            return bot.sendMessage(chatId, "❌ Önce ana kategori eklemeniz gerekiyor.");
        }
        
        const buttons = catKeys.map(key => [{
            text: `${categories[key].icon || '📁'} ${categories[key].name}`,
            callback_data: `admin_subcat_select_${key}`
        }]);
        buttons.push([{ text: "🔙 Geri", callback_data: "admin_categories" }]);
        
        return bot.sendMessage(chatId, "Alt kategori eklenecek ana kategoriyi seçin:", {
            reply_markup: { inline_keyboard: buttons }
        });
    }
    
    // Alt kategori için ana kategori seçildi
    if (data.startsWith("admin_subcat_select_")) {
        const catKey = data.substring(20);
        adminState[chatId] = { action: 'add_subcategory', step: 'name', categoryKey: catKey };
        return bot.sendMessage(chatId, `➕ **Yeni Alt Kategori Ekleme**\n\nAlt kategori adını yazın:\n\nÖrnek: \`🤖 Android\``, { parse_mode: 'Markdown' });
    }
    
    // Kategori düzenleme menüsü
    if (data === "admin_edit_cat_menu") {
        const prodData = loadProducts();
        const categories = prodData.categories || {};
        const catKeys = Object.keys(categories);
        
        if (catKeys.length === 0) {
            return bot.sendMessage(chatId, "❌ Henüz kategori yok.");
        }
        
        const buttons = catKeys.map(key => [{
            text: `${categories[key].icon || '📁'} ${categories[key].name}`,
            callback_data: `admin_cat_edit_${key}`
        }]);
        buttons.push([{ text: "🔙 Geri", callback_data: "admin_categories" }]);
        
        return bot.sendMessage(chatId, "Düzenlenecek kategoriyi seçin:", {
            reply_markup: { inline_keyboard: buttons }
        });
    }
    
    // Kategori düzenleme detay
    if (data.startsWith("admin_cat_edit_")) {
        const catKey = data.substring(15);
        const prodData = loadProducts();
        const cat = prodData.categories[catKey];
        if (!cat) return bot.sendMessage(chatId, "❌ Kategori bulunamadı.");
        
        const subKeys = Object.keys(cat.subcategories || {});
        const subList = subKeys.map(sk => `  └ ${cat.subcategories[sk].icon || '📦'} ${cat.subcategories[sk].name}`).join('\n') || '  (Alt kategori yok)';
        
        return bot.sendMessage(chatId, `📁 **${cat.name}**\n\n**Alt Kategoriler:**\n${subList}`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✏️ Adı Değiştir", callback_data: `admin_cat_rename_${catKey}` }],
                    [{ text: "🎨 İkon Değiştir", callback_data: `admin_cat_icon_${catKey}` }],
                    [{ text: "🗑 Kategoriyi Sil", callback_data: `admin_cat_delete_${catKey}` }],
                    [{ text: "🔙 Geri", callback_data: "admin_edit_cat_menu" }]
                ]
            }
        });
    }
    
    // Kategori adını değiştir
    if (data.startsWith("admin_cat_rename_")) {
        const catKey = data.substring(17);
        adminState[chatId] = { action: 'rename_category', categoryKey: catKey };
        return bot.sendMessage(chatId, "Yeni kategori adını yazın:");
    }
    
    // Kategori ikonu değiştir
    if (data.startsWith("admin_cat_icon_")) {
        const catKey = data.substring(15);
        adminState[chatId] = { action: 'change_cat_icon', categoryKey: catKey };
        return bot.sendMessage(chatId, "Yeni kategori ikonunu yazın (emoji):\n\nÖrnek: 📱 veya 💻", { parse_mode: 'Markdown' });
    }
    
    // Kategori sil
    if (data.startsWith("admin_cat_delete_")) {
        const catKey = data.substring(17);
        const prodData = loadProducts();
        
        // Kategorideki ürünleri kontrol et
        const hasProducts = Object.values(prodData.products || {}).some(p => p.category === catKey);
        if (hasProducts) {
            return bot.sendMessage(chatId, "❌ Bu kategoride ürün var! Önce ürünleri başka kategoriye taşıyın veya silin.");
        }
        
        delete prodData.categories[catKey];
        saveProducts(prodData);
        bot.sendMessage(chatId, "✅ Kategori silindi.");
        return showAdminCategories(chatId);
    }
    
    // ========== ÜRÜN DURUM DEĞİŞTİRME ==========
    
    // Ürünü aktif yap
    if (data.startsWith("admin_status_active_")) {
        const productKey = data.substring(20);
        const prodData = loadProducts();
        if (prodData.products[productKey]) {
            prodData.products[productKey].maintenance = false;
            saveProducts(prodData);
            bot.sendMessage(chatId, "✅ Ürün aktif duruma alındı.");
        }
        return showAdminProductEdit(chatId, productKey);
    }
    
    // Ürünü bakıma al
    if (data.startsWith("admin_status_maint_")) {
        const productKey = data.substring(19);
        const prodData = loadProducts();
        if (prodData.products[productKey]) {
            prodData.products[productKey].maintenance = true;
            saveProducts(prodData);
            bot.sendMessage(chatId, "🔵 Ürün bakıma alındı.");
        }
        return showAdminProductEdit(chatId, productKey);
    }
    
    // Ürünü stok yok olarak işaretle (bakıma al + stokları sıfırla)
    if (data.startsWith("admin_status_nostock_")) {
        const productKey = data.substring(21);
        const prodData = loadProducts();
        if (prodData.products[productKey]) {
            prodData.products[productKey].maintenance = true;
            // Stokları sıfırla
            for (const days in prodData.products[productKey].stock) {
                prodData.products[productKey].stock[days] = [];
            }
            saveProducts(prodData);
            bot.sendMessage(chatId, "🔴 Ürün stok yok olarak işaretlendi ve bakıma alındı.");
        }
        return showAdminProductEdit(chatId, productKey);
    }
    
    // Ürün ikonu değiştir
    if (data.startsWith("admin_icon_")) {
        const productKey = data.substring(11);
        adminState[chatId] = { action: 'change_icon', productKey };
        return bot.sendMessage(chatId, "Yeni ürün ikonunu yazın (emoji):\n\nÖrnek: 🎯 veya ⭐ veya 🔥", { parse_mode: 'Markdown' });
    }
    
    // Ürün kategorisi değiştir
    if (data.startsWith("admin_change_cat_")) {
        const productKey = data.substring(17);
        const prodData = loadProducts();
        const categories = prodData.categories || {};
        
        const buttons = [];
        for (const catKey in categories) {
            const cat = categories[catKey];
            for (const subKey in cat.subcategories || {}) {
                const sub = cat.subcategories[subKey];
                buttons.push([{
                    text: `${cat.icon} ${cat.name} → ${sub.icon} ${sub.name}`,
                    callback_data: `admin_setcat_${productKey}_${catKey}_${subKey}`
                }]);
            }
        }
        buttons.push([{ text: "🔙 Geri", callback_data: `admin_edit_${productKey}` }]);
        
        return bot.sendMessage(chatId, "Yeni kategori seçin:", {
            reply_markup: { inline_keyboard: buttons }
        });
    }
    
    // Ürün kategorisi ayarla
    if (data.startsWith("admin_setcat_")) {
        const parts = data.substring(13).split("_");
        const productKey = parts[0];
        const catKey = parts[1];
        const subKey = parts.slice(2).join("_");
        
        const prodData = loadProducts();
        if (prodData.products[productKey]) {
            prodData.products[productKey].category = catKey;
            prodData.products[productKey].subcategory = subKey;
            saveProducts(prodData);
            bot.sendMessage(chatId, "✅ Ürün kategorisi değiştirildi.");
        }
        return showAdminProductEdit(chatId, productKey);
    }
    
    // Ürün sırası değiştir
    if (data.startsWith("admin_order_")) {
        const productKey = data.substring(12);
        const prodData = loadProducts();
        const products = prodData.products || {};
        const keys = Object.keys(products);
        const currentIdx = keys.indexOf(productKey);
        
        return bot.sendMessage(chatId, `🔢 **Sıra Değiştir**\n\nMevcut sıra: ${currentIdx + 1}/${keys.length}\n\nYeni sıra numarasını yazın (1-${keys.length}):`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "⬆️ Yukarı", callback_data: `admin_move_up_${productKey}` },
                        { text: "⬇️ Aşağı", callback_data: `admin_move_down_${productKey}` }
                    ],
                    [{ text: "🔙 Geri", callback_data: `admin_edit_${productKey}` }]
                ]
            }
        });
    }
    
    // Ürünü yukarı taşı
    if (data.startsWith("admin_move_up_")) {
        const productKey = data.substring(14);
        const prodData = loadProducts();
        const keys = Object.keys(prodData.products);
        const idx = keys.indexOf(productKey);
        
        if (idx > 0) {
            // Sırayı değiştir
            const newProducts = {};
            keys.forEach((k, i) => {
                if (i === idx - 1) newProducts[productKey] = prodData.products[productKey];
                else if (i === idx) newProducts[keys[idx - 1]] = prodData.products[keys[idx - 1]];
                else newProducts[k] = prodData.products[k];
            });
            prodData.products = newProducts;
            saveProducts(prodData);
            bot.sendMessage(chatId, "⬆️ Ürün yukarı taşındı.");
        }
        return showAdminProductList(chatId);
    }
    
    // Ürünü aşağı taşı
    if (data.startsWith("admin_move_down_")) {
        const productKey = data.substring(16);
        const prodData = loadProducts();
        const keys = Object.keys(prodData.products);
        const idx = keys.indexOf(productKey);
        
        if (idx < keys.length - 1) {
            // Sırayı değiştir
            const newProducts = {};
            keys.forEach((k, i) => {
                if (i === idx) newProducts[keys[idx + 1]] = prodData.products[keys[idx + 1]];
                else if (i === idx + 1) newProducts[productKey] = prodData.products[productKey];
                else newProducts[k] = prodData.products[k];
            });
            prodData.products = newProducts;
            saveProducts(prodData);
            bot.sendMessage(chatId, "⬇️ Ürün aşağı taşındı.");
        }
        return showAdminProductList(chatId);
    }
    
    // ========== YENİ ÜRÜN EKLEME ==========
    
    // Yeni ürün ekle
    if (data === "admin_add_product") {
        adminState[chatId] = { action: 'add_product', step: 'name' };
        return bot.sendMessage(chatId, `➕ **Yeni Ürün Ekleme**\n\nÜrün adını yazın:\n\nÖrnek: \`Cyrax Mod\``, { parse_mode: 'Markdown' });
    }
    
    // Yeni ürün kategori seçimi
    if (data.startsWith("admin_newprod_cat_")) {
        const parts = data.substring(18).split("_");
        const catKey = parts[0];
        const subKey = parts.slice(1).join("_");
        
        const state = adminState[chatId];
        if (state && state.action === 'add_product') {
            state.category = catKey;
            state.subcategory = subKey;
            state.step = 'description';
            return bot.sendMessage(chatId, "📝 Ürün açıklamasını yazın:");
        }
    }

    // Admin - süre ekle
    if (data === "admin_add_duration") {
        adminState[chatId] = { action: 'add_duration' };
        return bot.sendMessage(chatId, "Yeni süre seçeneği girin (gün sayısı):\n\nÖrnek: `90`", { parse_mode: 'Markdown' });
    }
    
    // Admin - süre düzenle
    if (data.startsWith("admin_edit_dur_")) {
        const days = parseInt(data.substring(15));
        adminState[chatId] = { action: 'edit_duration_label', days };
        const d = loadProducts().settings?.durations?.find(x => x.days === days);
        return bot.sendMessage(chatId, `**${d?.label || days + ' Gün'}** için yeni etiket girin:\n\nÖrnek: \`7 Gün\` veya \`Haftalık\` veya \`1 Hafta\``, { parse_mode: 'Markdown' });
    }
    
    // Admin - süre sil
    if (data.startsWith("admin_del_dur_")) {
        const days = parseInt(data.substring(14));
        return deleteDuration(chatId, days, messageId);
    }
    
    // Admin - ödeme düzenle
    if (data.startsWith("admin_pay_")) {
        const field = data.substring(10);
        adminState[chatId] = { action: 'edit_payment', field };
        const fieldNames = { iban: 'IBAN', iban_alici: 'Alıcı Adı', iban_aciklama: 'Açıklama', papara: 'Papara', binance: 'Binance' };
        return bot.sendMessage(chatId, `Yeni ${fieldNames[field] || field} değerini girin:`);
    }
    
    // Admin - sipariş onay/red
    if (data.startsWith("approve_")) {
        const orderId = data.substring(8);
        return handleApproval(chatId, orderId);
    }
    
    if (data.startsWith("reject_")) {
        const orderId = data.substring(7);
        return handleRejection(chatId, orderId);
    }
});

// ============== ADMİN FONKSİYONLARI ==============

function showAdminCategories(chatId, messageId = null) {
    const data = loadProducts();
    const categories = data.categories || {};
    
    let text = `📁 **Kategori Yönetimi**\n\n`;
    
    const catKeys = Object.keys(categories);
    catKeys.forEach((catKey, idx) => {
        const cat = categories[catKey];
        text += `${cat.icon || '📁'} **${cat.name}**\n`;
        const subKeys = Object.keys(cat.subcategories || {});
        subKeys.forEach((subKey, subIdx) => {
            const sub = cat.subcategories[subKey];
            text += `  └ ${sub.icon || '📦'} ${sub.name}\n`;
        });
        text += '\n';
    });
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "➕ Kategori Ekle", callback_data: "admin_add_cat" }],
                [{ text: "➕ Alt Kategori Ekle", callback_data: "admin_add_subcat" }],
                [{ text: "✏️ Kategori Düzenle", callback_data: "admin_edit_cat_menu" }],
                [{ text: "🔙 Geri", callback_data: "admin_back" }]
            ]
        }
    };
    
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

function showAdminProductList(chatId, messageId = null) {
    const data = loadProducts();
    const products = data.products || {};
    
    const buttons = Object.entries(products).map(([key, prod]) => {
        // Durum ikonu: 🟢 aktif, 🔵 bakımda, 🔴 stok yok
        let statusIcon = '🟢';
        if (prod.maintenance) statusIcon = '🔵';
        else {
            const hasStock = Object.values(prod.stock || {}).some(arr => arr && arr.length > 0);
            if (!hasStock) statusIcon = '🔴';
        }
        return [{
            text: `${statusIcon} ${prod.icon || '📦'} ${prod.name}`,
            callback_data: `admin_edit_${key}`
        }];
    });
    
    buttons.push([{ text: "➕ Yeni Ürün Ekle", callback_data: "admin_add_product" }]);
    buttons.push([{ text: "🔙 Geri", callback_data: "admin_back" }]);
    
    const text = `📦 **Ürün Yönetimi**

🟢 Aktif | 🔵 Bakımda | 🔴 Stok Yok

Düzenlemek istediğiniz ürünü seçin:`;
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
    };
    
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

function showAdminProductEdit(chatId, productKey, messageId = null) {
    const data = loadProducts();
    const product = data.products[productKey];
    if (!product) return bot.sendMessage(chatId, "Ürün bulunamadı.");
    
    const priceInfo = Object.entries(product.prices || {})
        .map(([days, price]) => `${days} gün: ${price}₺`)
        .join('\n') || 'Fiyat yok';
    
    // Durum ikonu
    let statusIcon = '🟢 Aktif';
    if (product.maintenance) statusIcon = '🔵 Bakımda';
    else {
        const hasStock = Object.values(product.stock || {}).some(arr => arr && arr.length > 0);
        if (!hasStock) statusIcon = '🔴 Stok Yok';
    }
    
    const text = `📦 **${product.name}**

📁 Kategori: ${product.category} / ${product.subcategory}
📊 Durum: ${statusIcon}
🎨 İkon: ${product.icon || '📦'}

📝 **Açıklama:**
${product.description || 'Açıklama yok'}

💰 **Fiyatlar:**
${priceInfo}`;
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "🟢 Aktif", callback_data: `admin_status_active_${productKey}` },
                    { text: "🔵 Bakım", callback_data: `admin_status_maint_${productKey}` },
                    { text: "🔴 Stok Yok", callback_data: `admin_status_nostock_${productKey}` }
                ],
                [{ text: "💰 Fiyatları Düzenle", callback_data: `admin_price_${productKey}` }],
                [{ text: "📝 Açıklamayı Düzenle", callback_data: `admin_desc_${productKey}` }],
                [{ text: "🎨 İkon Değiştir", callback_data: `admin_icon_${productKey}` }],
                [{ text: "📁 Kategori Değiştir", callback_data: `admin_change_cat_${productKey}` }],
                [{ text: "🔢 Sıra Değiştir", callback_data: `admin_order_${productKey}` }],
                [{ text: "🗑 Ürünü Sil", callback_data: `admin_delete_${productKey}` }],
                [{ text: "🔙 Geri", callback_data: "admin_products" }]
            ]
        }
    };
    
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

function showAdminDurations(chatId, messageId = null) {
    const data = loadProducts();
    const durations = data.settings?.durations || [];
    
    let text = `⏱ **Süre Seçenekleri**\n\nMevcut süreler:\n`;
    durations.forEach(d => {
        text += `• ${d.label} (${d.days} gün)\n`;
    });
    
    const buttons = [];
    durations.forEach(d => {
        buttons.push([
            { text: `✏️ ${d.label} Düzenle`, callback_data: `admin_edit_dur_${d.days}` },
            { text: `🗑 Sil`, callback_data: `admin_del_dur_${d.days}` }
        ]);
    });
    
    buttons.push([{ text: "➕ Süre Ekle", callback_data: "admin_add_duration" }]);
    buttons.push([{ text: "🔙 Geri", callback_data: "admin_back" }]);
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
    };
    
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

function showAdminPayment(chatId, messageId = null) {
    const text = `💳 **Ödeme Ayarları**

🏦 **IBAN:** \`${paymentSettings.iban}\`
👤 **Alıcı:** \`${paymentSettings.iban_alici}\`
📝 **Açıklama:** \`${paymentSettings.iban_aciklama}\`
📱 **Papara:** \`${paymentSettings.papara}\`
🔗 **Binance:** \`${paymentSettings.binance}\``;
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "🏦 IBAN", callback_data: "admin_pay_iban" }],
                [{ text: "👤 Alıcı Adı", callback_data: "admin_pay_iban_alici" }],
                [{ text: "📝 Açıklama", callback_data: "admin_pay_iban_aciklama" }],
                [{ text: "📱 Papara", callback_data: "admin_pay_papara" }],
                [{ text: "🔗 Binance", callback_data: "admin_pay_binance" }],
                [{ text: "🔙 Geri", callback_data: "admin_back" }]
            ]
        }
    };
    
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

function showAdminKeys(chatId, messageId = null) {
    const keyCount = Object.keys(activeKeys).length;
    
    const text = `🔑 **Anahtar Yönetimi**\n\nToplam aktif anahtar: ${keyCount}`;
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "📋 Listele", callback_data: "admin_keys_list" }],
                [{ text: "➕ Manuel Ekle", callback_data: "admin_keys_add" }],
                [{ text: "🔙 Geri", callback_data: "admin_back" }]
            ]
        }
    };
    
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

function startAddProduct(chatId) {
    adminState[chatId] = { action: 'add_product', step: 1 };
    
    const data = loadProducts();
    const categories = data.categories || {};
    
    const buttons = [];
    for (const catKey in categories) {
        const cat = categories[catKey];
        for (const subKey in cat.subcategories || {}) {
            const sub = cat.subcategories[subKey];
            buttons.push([{
                text: `${cat.icon} ${cat.name} > ${sub.icon} ${sub.name}`,
                callback_data: makeRef({ type: 'add_prod_cat', category: catKey, subcategory: subKey })
            }]);
        }
    }
    
    buttons.push([{ text: "🔙 İptal", callback_data: "admin_back" }]);
    
    bot.sendMessage(chatId, "➕ **Yeni Ürün Ekle**\n\nÜrünün ekleneceği kategoriyi seçin:", {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
    });
}

function deleteProduct(chatId, productKey, messageId) {
    const data = loadProducts();
    if (data.products[productKey]) {
        const name = data.products[productKey].name;
        delete data.products[productKey];
        saveProducts(data);
        bot.sendMessage(chatId, `✅ **${name}** silindi.`, { parse_mode: 'Markdown' });
    }
    showAdminProductList(chatId);
}

function toggleMaintenance(chatId, productKey, messageId) {
    const data = loadProducts();
    if (data.products[productKey]) {
        data.products[productKey].maintenance = !data.products[productKey].maintenance;
        saveProducts(data);
        const status = data.products[productKey].maintenance ? 'bakıma alındı 🔵' : 'bakımdan çıkarıldı ✅';
        bot.sendMessage(chatId, `**${data.products[productKey].name}** ${status}`, { parse_mode: 'Markdown' });
    }
    showAdminProductEdit(chatId, productKey);
}

function deleteDuration(chatId, days, messageId) {
    const data = loadProducts();
    if (data.settings?.durations) {
        data.settings.durations = data.settings.durations.filter(d => d.days !== days);
        saveProducts(data);
        bot.sendMessage(chatId, `✅ ${days} günlük süre seçeneği silindi.`);
    }
    showAdminDurations(chatId);
}

function handleApproval(chatId, orderId) {
    // pendingOrders'dan sipariş bilgisini al
    const order = pendingOrders[orderId];
    if (!order) {
        console.log(`pendingOrders bulunamadı: ${orderId}`);
        return bot.sendMessage(chatId, "Sipariş bilgisi bulunamadı. Sipariş zaten işlenmiş olabilir.");
    }
    
    const userId = order.chatId;
    
    adminState[chatId] = { action: 'send_key', orderId: orderId, targetUserId: userId, ...order };
    bot.sendMessage(chatId, `✅ **Sipariş Onayı**

📦 Ürün: ${order.productName}
⏱ Süre: ${order.days} gün
💰 Fiyat: ${order.price}₺

📝 **Format:** \`anahtar süre\`
📌 **Örnek:** \`the_best1 30\`

Lütfen anahtarı ve süreyi yazın:`, { parse_mode: 'Markdown' });
}

function handleRejection(chatId, orderId) {
    const order = pendingOrders[orderId];
    if (!order) {
        return bot.sendMessage(chatId, "Sipariş bilgisi bulunamadı.");
    }
    
    const userId = order.chatId;
    const productName = order.productName || 'Bilinmeyen';
    
    bot.sendMessage(userId, `❌ **Ödemeniz Reddedildi**

📦 Ürün: **${productName}**

Dekontunuz geçersiz veya hatalı bulundu.

📌 Lütfen doğru dekontu gönderin veya destek için iletişime geçin.`, { parse_mode: 'Markdown' });
    
    bot.sendMessage(chatId, `❌ **Sipariş Reddedildi**\n\n👤 Kullanıcı: \`${userId}\`\n📦 Ürün: **${productName}**\n\n⚠️ Müşteriye bildirim gönderildi.`, { parse_mode: 'Markdown' });
    
    // Siparişi sil
    delete pendingOrders[orderId];
}

// ============== MESSAGE HANDLER ==============
bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    
    // Admin state işlemleri - EN ÖNCE KONTROL ET
    if (adminState[chatId] && text && !text.startsWith('/')) {
        const state = adminState[chatId];
        console.log(`Admin state aktif: ${state.action}, text: ${text}`);
        
        // Anahtar gönderimi - format: anahtar süre (örn: the_best1 30)
        if (state.action === 'send_key') {
            const userId = state.targetUserId;
            const parts = text.split(/\s+/);
            
            if (parts.length < 2) {
                return bot.sendMessage(chatId, `⚠️ Hatalı format!\n\n📝 **Format:** \`anahtar süre\`\n📌 **Örnek:** \`the_best1 30\`\n\nTekrar deneyin:`, { parse_mode: 'Markdown' });
            }
            
            const key = parts[0];
            const days = parseInt(parts[1]);
            
            if (isNaN(days) || days <= 0) {
                return bot.sendMessage(chatId, `⚠️ Geçersiz süre! Süre pozitif bir sayı olmalı.\n\n📝 **Format:** \`anahtar süre\`\n📌 **Örnek:** \`the_best1 7\``, { parse_mode: 'Markdown' });
            }
            
            const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
            const orderId = `${userId}_${Date.now()}`;
            
            activeKeys[orderId] = {
                oderId: orderId,
                chatId: parseInt(userId),
                products: [state.productName],
                key: key,
                expiresAt: expiresAt,
                notified: false
            };
            saveKeys(activeKeys);
            
            const expiryDate = new Date(expiresAt).toLocaleDateString('tr-TR');
            
            // Müşteriye mesaj gönder (HTML format - Markdown sorunlarını önler)
            bot.sendMessage(userId, `✅ <b>ÖDEMENİZ ONAYLANDI!</b>

━━━━━━━━━━━━━━━━━━━━

🔑 <b>ÜRÜN ANAHTARINIZ:</b>
<code>${key}</code>

📦 <b>Ürün:</b> ${state.productName}
📅 <b>Geçerlilik Süresi:</b> ${days} Gün
📆 <b>Bitiş Tarihi:</b> ${expiryDate}

━━━━━━━━━━━━━━━━━━━━

📥 <b>KURULUM DOSYALARI</b>

Satın aldığınız anahtar ile @BestOfModFiles_bot botuna gidip anahtarınızı girerek kurulum dosyalarına ulaşabilirsiniz.

🔔 <b>BİLDİRİM</b>
Ürününüzde güncelleme olduğu zaman tarafımızdan size bildirim gönderilecektir.

━━━━━━━━━━━━━━━━━━━━

🙏 <b>Bizi tercih ettiğiniz için teşekkür ederiz!</b>`, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📥 Kurulum Dosyalarına Git", url: "https://t.me/BestOfModFiles_bot" }],
                        [{ text: "🏠 Ana Menüye Dön", callback_data: "back_main" }]
                    ]
                }
            })
            .then(() => {
                console.log(`✅ Müşteriye mesaj gönderildi: ${userId}`);
            })
            .catch((err) => {
                console.log(`❌ Müşteriye mesaj gönderilemedi: ${userId}`, err.message);
                bot.sendMessage(chatId, `⚠️ Müşteriye mesaj gönderilemedi! Hata: ${err.message}`);
            });
            
            // Admin'e onay mesajı
            bot.sendMessage(chatId, `✅ <b>Anahtar Gönderildi!</b>

👤 Kullanıcı: <code>${userId}</code>
📦 Ürün: <b>${state.productName}</b>
🔑 Anahtar: <code>${key}</code>
📅 Süre: <b>${days} gün</b>

✨ Müşteriye bildirim gönderildi.`, { parse_mode: 'HTML' });
            
            // Siparişi pendingOrders'dan sil
            if (state.orderId) {
                delete pendingOrders[state.orderId];
            }
            
            delete adminState[chatId];
            return;
        }
        
        // Fiyat düzenleme
        if (state.action === 'edit_price') {
            const data = loadProducts();
            const prices = {};
            const parts = text.split(/\s+/);
            parts.forEach(p => {
                const [d, price] = p.split(':');
                if (d && price) prices[d] = parseInt(price);
            });
            
            if (data.products[state.productKey]) {
                data.products[state.productKey].prices = prices;
                saveProducts(data);
                bot.sendMessage(chatId, "✅ Fiyatlar güncellendi.");
            }
            delete adminState[chatId];
            return showAdminProductEdit(chatId, state.productKey);
        }
        
        // Açıklama düzenleme
        if (state.action === 'edit_desc') {
            const data = loadProducts();
            if (data.products[state.productKey]) {
                data.products[state.productKey].description = text;
                // Ayrıca descriptions klasörüne de kaydet
                const prodName = data.products[state.productKey].name;
                const descPath = path.join(__dirname, 'descriptions', `${prodName}.txt`);
                fs.writeFileSync(descPath, text, 'utf-8');
                saveProducts(data);
                bot.sendMessage(chatId, "✅ Açıklama güncellendi.");
            }
            delete adminState[chatId];
            return showAdminProductEdit(chatId, state.productKey);
        }
        
        // Süre ekleme
        if (state.action === 'add_duration') {
            const days = parseInt(text);
            if (!isNaN(days) && days > 0) {
                const data = loadProducts();
                if (!data.settings) data.settings = {};
                if (!data.settings.durations) data.settings.durations = [];
                if (!data.settings.durations.find(d => d.days === days)) {
                    data.settings.durations.push({ days, label: `${days} Gün` });
                    data.settings.durations.sort((a, b) => a.days - b.days);
                    saveProducts(data);
                    bot.sendMessage(chatId, `✅ ${days} günlük süre seçeneği eklendi.`);
                }
            }
            delete adminState[chatId];
            return showAdminDurations(chatId);
        }
        
        // Süre etiketi düzenleme
        if (state.action === 'edit_duration_label') {
            const newLabel = text.trim();
            if (newLabel) {
                const data = loadProducts();
                const dur = data.settings?.durations?.find(d => d.days === state.days);
                if (dur) {
                    dur.label = newLabel;
                    saveProducts(data);
                    bot.sendMessage(chatId, `✅ Süre etiketi "${newLabel}" olarak güncellendi.`);
                }
            }
            delete adminState[chatId];
            return showAdminDurations(chatId);
        }
        
        // Ödeme ayarı düzenleme
        if (state.action === 'edit_payment') {
            paymentSettings[state.field] = text;
            savePaymentSettings(paymentSettings);
            bot.sendMessage(chatId, `✅ ${state.field} güncellendi.`);
            delete adminState[chatId];
            return showAdminPayment(chatId);
        }
        
        // ========== KATEGORİ İŞLEMLERİ ==========
        
        // Kategori ekleme
        if (state.action === 'add_category') {
            if (state.step === 'name') {
                // İkon ve ad parse et
                const firstChar = text.charAt(0);
                const isEmoji = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(firstChar);
                
                let icon = '📁';
                let name = text;
                if (isEmoji) {
                    icon = text.split(' ')[0];
                    name = text.split(' ').slice(1).join(' ') || text;
                }
                
                const catKey = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                const data = loadProducts();
                if (!data.categories) data.categories = {};
                
                data.categories[catKey] = {
                    name: text,
                    icon: icon,
                    subcategories: {}
                };
                saveProducts(data);
                
                bot.sendMessage(chatId, `✅ "${text}" kategorisi eklendi.`);
                delete adminState[chatId];
                return showAdminCategories(chatId);
            }
        }
        
        // Alt kategori ekleme
        if (state.action === 'add_subcategory') {
            if (state.step === 'name') {
                // İkon ve ad parse et
                const firstChar = text.charAt(0);
                const isEmoji = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(firstChar);
                
                let icon = '📦';
                let name = text;
                if (isEmoji) {
                    icon = text.split(' ')[0];
                    name = text.split(' ').slice(1).join(' ') || text;
                }
                
                const subKey = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                const data = loadProducts();
                
                if (data.categories[state.categoryKey]) {
                    if (!data.categories[state.categoryKey].subcategories) {
                        data.categories[state.categoryKey].subcategories = {};
                    }
                    data.categories[state.categoryKey].subcategories[subKey] = {
                        name: text,
                        icon: icon
                    };
                    saveProducts(data);
                    bot.sendMessage(chatId, `✅ "${text}" alt kategorisi eklendi.`);
                }
                
                delete adminState[chatId];
                return showAdminCategories(chatId);
            }
        }
        
        // Kategori adı değiştirme
        if (state.action === 'rename_category') {
            const data = loadProducts();
            if (data.categories[state.categoryKey]) {
                data.categories[state.categoryKey].name = text;
                saveProducts(data);
                bot.sendMessage(chatId, `✅ Kategori adı "${text}" olarak güncellendi.`);
            }
            delete adminState[chatId];
            return showAdminCategories(chatId);
        }
        
        // Kategori ikonu değiştirme
        if (state.action === 'change_cat_icon') {
            const data = loadProducts();
            if (data.categories[state.categoryKey]) {
                data.categories[state.categoryKey].icon = text.trim();
                saveProducts(data);
                bot.sendMessage(chatId, `✅ Kategori ikonu güncellendi.`);
            }
            delete adminState[chatId];
            return showAdminCategories(chatId);
        }
        
        // ========== ÜRÜN İŞLEMLERİ ==========
        
        // Ürün ikonu değiştirme
        if (state.action === 'change_icon') {
            const data = loadProducts();
            if (data.products[state.productKey]) {
                data.products[state.productKey].icon = text.trim();
                saveProducts(data);
                bot.sendMessage(chatId, `✅ Ürün ikonu güncellendi.`);
            }
            delete adminState[chatId];
            return showAdminProductEdit(chatId, state.productKey);
        }
        
        // Yeni ürün ekleme wizard
        if (state.action === 'add_product') {
            if (state.step === 'name') {
                state.productName = text.trim();
                state.step = 'category';
                
                // Kategori seçimi göster
                const data = loadProducts();
                const categories = data.categories || {};
                
                const buttons = [];
                for (const catKey in categories) {
                    const cat = categories[catKey];
                    for (const subKey in cat.subcategories || {}) {
                        const sub = cat.subcategories[subKey];
                        buttons.push([{
                            text: `${cat.icon} ${cat.name} → ${sub.icon} ${sub.name}`,
                            callback_data: `admin_newprod_cat_${catKey}_${subKey}`
                        }]);
                    }
                }
                
                if (buttons.length === 0) {
                    delete adminState[chatId];
                    return bot.sendMessage(chatId, "❌ Önce kategori ve alt kategori eklemelisiniz!");
                }
                
                return bot.sendMessage(chatId, `📁 **${state.productName}** için kategori seçin:`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: buttons }
                });
            }
            
            if (state.step === 'description') {
                state.description = text.trim();
                state.step = 'icon';
                return bot.sendMessage(chatId, "🎨 Ürün ikonunu yazın (emoji):\n\nÖrnek: 🎯 veya ⭐ veya 🔥", { parse_mode: 'Markdown' });
            }
            
            if (state.step === 'icon') {
                state.icon = text.trim() || '📦';
                state.step = 'prices';
                return bot.sendMessage(chatId, "💰 Fiyatları şu formatta yazın:\n\n`7:400 30:725 60:1200`\n\n(7 gün: 400₺, 30 gün: 725₺, 60 gün: 1200₺)", { parse_mode: 'Markdown' });
            }
            
            if (state.step === 'prices') {
                const prices = {};
                const parts = text.split(/\s+/);
                parts.forEach(p => {
                    const [d, price] = p.split(':');
                    if (d && price) prices[d] = parseInt(price);
                });
                
                if (Object.keys(prices).length === 0) {
                    return bot.sendMessage(chatId, "❌ Geçersiz fiyat formatı! Tekrar deneyin:\n\n`7:400 30:725 60:1200`", { parse_mode: 'Markdown' });
                }
                
                // Ürünü kaydet
                const productKey = state.productName.toLowerCase().replace(/[^a-z0-9]/g, '_');
                const data = loadProducts();
                
                data.products[productKey] = {
                    name: state.productName,
                    description: state.description,
                    category: state.category,
                    subcategory: state.subcategory,
                    prices: prices,
                    stock: {},
                    maintenance: false,
                    icon: state.icon
                };
                
                // Stok dizilerini oluştur
                for (const days in prices) {
                    data.products[productKey].stock[days] = [];
                }
                
                saveProducts(data);
                
                // Açıklama dosyasını da oluştur
                const descPath = path.join(__dirname, 'descriptions', `${state.productName}.txt`);
                fs.writeFileSync(descPath, state.description, 'utf-8');
                
                bot.sendMessage(chatId, `✅ **${state.productName}** ürünü başarıyla eklendi!`, { parse_mode: 'Markdown' });
                delete adminState[chatId];
                return showAdminProductList(chatId);
            }
        }
        
        // Ürün ekleme wizard (eski format - uyumluluk için) - artık kullanılmıyor, yeni wizard yukarıda
    }
    
    // Kullanıcı dekont gönderimi
    const sel = userState[chatId];
    // Kullanıcının aktif siparişi varsa (ürün seçili ise) dekont admin'e iletilsin
    // İster butona tıklasın ister direkt göndersin
    if ((msg.document || msg.photo) && sel && sel.productName) {
        // Sipariş bilgilerini pendingOrders'a kaydet (kullanıcı Ana Menü'ye dönse bile kaybolmasın)
        const orderId = `order_${chatId}_${Date.now()}`;
        pendingOrders[orderId] = {
            chatId: chatId,
            productName: sel.productName,
            days: sel.days,
            price: sel.price,
            timestamp: Date.now()
        };
        
        bot.forwardMessage(ADMIN_ID, chatId, msg.message_id).then((fwd) => {
            bot.sendMessage(ADMIN_ID, `🛒 <b>Yeni Sipariş Bildirimi</b>

👤 Kullanıcı: <code>${chatId}</code>
📦 Ürün: <b>${sel.productName}</b>
⏱ Süre: <b>${sel.days} gün</b>
💰 Fiyat: <b>${sel.price}₺</b>

📋 Dekont yukarıda. Kontrol edip onaylıyor musunuz?`, {
                parse_mode: "HTML",
                reply_to_message_id: fwd.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "✅ Onayla", callback_data: `approve_${orderId}` },
                            { text: "❌ Reddet", callback_data: `reject_${orderId}` }
                        ]
                    ]
                }
            });
        }).catch(() => {});
        
        bot.sendMessage(chatId, `📤 <b>Dekontunuz Alındı!</b>

✅ Kontrol edildikten ve admin onayından sonra ürününüz teslim edilecektir.

⏳ Yoğunluğa göre süre uzayabilir.
🙏 Lütfen bekleyiniz. Teşekkür ederiz.`, { 
            parse_mode: "HTML"
        });
        return;
    }
    
    // Kullanıcı metin yazdı ama aktif oturumu yok ve admin değil - /start yönlendir
    if (text && !text.startsWith('/') && chatId !== ADMIN_ID && !adminState[chatId]) {
        // Bekleyen siparişi kontrol et
        const hasPendingOrder = Object.values(pendingOrders).some(o => o.chatId === chatId);
        if (!hasPendingOrder && !sel) {
            return bot.sendMessage(chatId, `⚠️ <b>Oturum bulunamadı</b>\n\nBotu başlatmak için /start yazın.`, { parse_mode: 'HTML' });
        }
    }
});

// Ref callback handler (ürün ekleme kategorisi seçimi için)
bot.on("callback_query", (query) => {
    const chatId = query.from.id;
    const data = query.data;
    
    if (chatId !== ADMIN_ID) return;
    
    const ref = getRef(data);
    if (!ref) return;
    
    if (ref.type === 'add_prod_cat') {
        adminState[chatId] = {
            action: 'add_product',
            step: 2,
            category: ref.category,
            subcategory: ref.subcategory
        };
        bot.sendMessage(chatId, "Ürün adını girin:");
    }
});

// Anahtar süre kontrolü
function checkExpiringKeys() {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    let changed = false;
    
    for (const orderId in activeKeys) {
        const entry = activeKeys[orderId];
        const timeLeft = entry.expiresAt - now;
        
        if (timeLeft > 0 && timeLeft <= oneDayMs && !entry.notified) {
            const prods = entry.products || [];
            const productList = prods.length > 0 ? prods.join(', ') : 'Ürününüz';
            
            bot.sendMessage(entry.chatId, `⚠️ **Süre Hatırlatması**

🔑 Anahtarınız: \`${entry.key}\`
📦 Ürün: ${productList}

⏰ **Süreniz yarın bitiyor!**

Tekrar almak isterseniz /start yazarak uzatabilirsiniz. 🛒`, { parse_mode: 'Markdown' }).catch(() => {});
            entry.notified = true;
            changed = true;
        }
        
        if (timeLeft < -7 * oneDayMs) {
            delete activeKeys[orderId];
            changed = true;
        }
    }
    
    if (changed) saveKeys(activeKeys);
}

setInterval(checkExpiringKeys, 60 * 60 * 1000);
setTimeout(checkExpiringKeys, 5000);

console.log('Shop Bot başlatıldı!');

// ============================================================
// =================== FILES BOT ENTEGRASYONU =================
// ============================================================

if (filesBot) {
    const FILES_DELETE_DELAY_MS = 30 * 60 * 1000; // 30 dakika sonra sil
    const filesUserSessions = new Map();
    const filesProductUploads = new Map();
    const FILES_PRODUCTS_FILE = path.join(__dirname, 'files_products.json');
    const PRODUCT_MAPPING_FILE = path.join(__dirname, 'product_mapping.json');
    const UDID_MAPPING_FILE = path.join(__dirname, 'udid_mapping.json');
    const PENDING_FCODE_FILE = path.join(__dirname, 'pending_fcode.json');

    // Ürün eşleştirme: Shop bot ürün adı -> Files bot menü adları (array)
    let productMapping = {};
    
    // UDID/Fcode eşleştirme: Files menü adı -> UDID butonlu mu? (true/false)
    let udidMapping = {};
    
    // Bekleyen Fcode talepleri: { oderId: { chatId, menuName, fcode, timestamp } }
    let pendingFcodes = {};

    function loadProductMapping() {
        try {
            if (fs.existsSync(PRODUCT_MAPPING_FILE)) {
                productMapping = JSON.parse(fs.readFileSync(PRODUCT_MAPPING_FILE, 'utf-8'));
            }
        } catch (e) {}
    }
    loadProductMapping();

    function saveProductMapping() {
        fs.writeFileSync(PRODUCT_MAPPING_FILE, JSON.stringify(productMapping, null, 2), 'utf-8');
    }
    
    // UDID Mapping load/save
    function loadUdidMapping() {
        try {
            if (fs.existsSync(UDID_MAPPING_FILE)) {
                udidMapping = JSON.parse(fs.readFileSync(UDID_MAPPING_FILE, 'utf-8'));
            }
        } catch (e) {}
    }
    loadUdidMapping();
    
    function saveUdidMapping() {
        fs.writeFileSync(UDID_MAPPING_FILE, JSON.stringify(udidMapping, null, 2), 'utf-8');
    }
    
    // Pending Fcode load/save
    function loadPendingFcodes() {
        try {
            if (fs.existsSync(PENDING_FCODE_FILE)) {
                pendingFcodes = JSON.parse(fs.readFileSync(PENDING_FCODE_FILE, 'utf-8'));
            }
        } catch (e) {}
    }
    loadPendingFcodes();
    
    function savePendingFcodes() {
        fs.writeFileSync(PENDING_FCODE_FILE, JSON.stringify(pendingFcodes, null, 2), 'utf-8');
    }
    
    // Kullanıcıya gönderilen mesajları takip et (süre bitince silmek için)
    // { chatId: [{ messageId, timestamp }] }
    const userMessages = new Map();

    function getFilesMenusForShopProduct(shopProductName) {
        return productMapping[shopProductName] || [];
    }

    function loadFilesProducts() {
        try {
            if (fs.existsSync(FILES_PRODUCTS_FILE)) {
                const data = JSON.parse(fs.readFileSync(FILES_PRODUCTS_FILE, 'utf-8'));
                for (const [name, product] of Object.entries(data)) {
                    filesProductUploads.set(name, product);
                }
            }
        } catch (e) {}
    }
    loadFilesProducts();

    function saveFilesProducts() {
        const obj = {};
        for (const [name, product] of filesProductUploads.entries()) {
            obj[name] = product;
        }
        fs.writeFileSync(FILES_PRODUCTS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    }

    function filesSendAndDelete(method, chatId, payload, options = {}) {
        filesBot[method](chatId, payload, options).then(sent => {
            // Mesajı kullanıcının listesine ekle
            if (!userMessages.has(chatId)) {
                userMessages.set(chatId, []);
            }
            userMessages.get(chatId).push({ messageId: sent.message_id, timestamp: Date.now() });
            
            setTimeout(() => {
                filesBot.deleteMessage(chatId, sent.message_id).catch(() => {});
                // Listeden de kaldır
                const msgs = userMessages.get(chatId);
                if (msgs) {
                    const idx = msgs.findIndex(m => m.messageId === sent.message_id);
                    if (idx > -1) msgs.splice(idx, 1);
                }
            }, FILES_DELETE_DELAY_MS);
        }).catch(() => {});
    }
    
    // Kullanıcının tüm mesajlarını sil (süre bittiğinde)
    function deleteAllUserMessages(chatId) {
        const msgs = userMessages.get(chatId);
        if (msgs && msgs.length > 0) {
            msgs.forEach(m => {
                filesBot.deleteMessage(chatId, m.messageId).catch(() => {});
            });
            userMessages.delete(chatId);
        }
    }

    function isValidFilesKey(key) {
        for (const orderId in activeKeys) {
            const entry = activeKeys[orderId];
            if (entry.key === key && entry.expiresAt > Date.now()) {
                return true;
            }
        }
        return false;
    }

    function getKeyInfo(key) {
        for (const orderId in activeKeys) {
            const entry = activeKeys[orderId];
            if (entry.key === key && entry.expiresAt > Date.now()) {
                if (entry.product && !entry.products) {
                    entry.products = [entry.product];
                }
                return entry;
            }
        }
        return null;
    }

    function findOrderIdByKey(key) {
        for (const orderId in activeKeys) {
            if (activeKeys[orderId].key === key) {
                return orderId;
            }
        }
        return null;
    }

    function addProductToKey(orderId, productName) {
        if (!activeKeys[orderId]) return false;
        if (!activeKeys[orderId].products) {
            activeKeys[orderId].products = activeKeys[orderId].product ? [activeKeys[orderId].product] : [];
        }
        if (!activeKeys[orderId].products.includes(productName)) {
            activeKeys[orderId].products.push(productName);
            saveKeys(activeKeys);
            return true;
        }
        return false;
    }

    function removeProductFromKey(orderId, productName) {
        if (!activeKeys[orderId] || !activeKeys[orderId].products) return false;
        const idx = activeKeys[orderId].products.indexOf(productName);
        if (idx > -1) {
            activeKeys[orderId].products.splice(idx, 1);
            saveKeys(activeKeys);
            return true;
        }
        return false;
    }

    function getShopProductsForFilesMenu(filesMenuName) {
        const shopProducts = [];
        for (const shopProd in productMapping) {
            if (productMapping[shopProd].includes(filesMenuName)) {
                shopProducts.push(shopProd);
            }
        }
        return shopProducts;
    }

    function getUsersForProduct(filesMenuName) {
        const users = [];
        const addedChatIds = new Set();
        const shopProducts = getShopProductsForFilesMenu(filesMenuName);
        
        for (const orderId in activeKeys) {
            const entry = activeKeys[orderId];
            if (entry.expiresAt <= Date.now()) continue;
            
            const userProducts = entry.products || (entry.product ? [entry.product] : []);
            const hasAccess = shopProducts.some(sp => userProducts.includes(sp)) || 
                              userProducts.includes(filesMenuName);
            
            if (hasAccess && !addedChatIds.has(entry.chatId)) {
                users.push({
                    chatId: entry.chatId,
                    key: entry.key,
                    expiresAt: entry.expiresAt
                });
                addedChatIds.add(entry.chatId);
            }
        }
        return users;
    }

    async function notifyProductUpdate(productName) {
        const usersToNotify = getUsersForProduct(productName);
        if (usersToNotify.length === 0) return 0;

        let sentCount = 0;
        for (const user of usersToNotify) {
            try {
                const daysLeft = Math.ceil((user.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
                const message = `🔔 **Ürün Güncelleme Bildirimi**\n\n📦 **${productName}** ürünü güncellendi!\n\n✨ Yeni dosyalar ve içerikler eklendi.\n\n🔑 Anahtarınızı girerek güncel dosyalara ulaşabilirsiniz.\n📅 Kalan süreniz: **${daysLeft} gün**\n\n👇 Hemen erişmek için /start yazın.`;
                
                await filesBot.sendMessage(user.chatId, message, { parse_mode: 'Markdown' });
                sentCount++;
            } catch (e) {
                console.log(`Bildirim gönderilemedi: ${user.chatId}`);
            }
        }
        return sentCount;
    }

    // FILES BOT: /start
    filesBot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        filesUserSessions.set(chatId, { step: 'awaiting_key' });
        filesSendAndDelete('sendMessage', chatId, '🔐 Lütfen ürün anahtarınızı girin:');
    });

    const filesAdminState = {};

    // FILES BOT: /admin paneli
    filesBot.onText(/\/admin/, (msg) => {
        const chatId = msg.chat.id;
        if (chatId !== ADMIN_ID) return filesBot.sendMessage(chatId, "Yetkisiz.");

        const productCount = filesProductUploads.size;
        const mappingCount = Object.keys(productMapping).length;
        filesBot.sendMessage(chatId, `**📁 Files Bot Admin Paneli**\n\nToplam menü: ${productCount}\nEşleştirme: ${mappingCount}`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📦 Ürünleri Yönet', callback_data: 'files_products' }],
                    [{ text: '➕ Yeni Ürün Ekle', callback_data: 'files_add_product' }],
                    [{ text: '🔗 Ürün Eşleştir', callback_data: 'files_mapping' }],
                    [{ text: '� UDID Aldırma', callback_data: 'files_udid_menu' }],
                    [{ text: '�🔑 Anahtarları Yönet', callback_data: 'files_keys' }],
                ],
            },
        });
    });

    // FILES BOT: Callback handler
    filesBot.on('callback_query', (query) => {
        const chatId = query.from.id;
        const data = query.data;
        try { filesBot.answerCallbackQuery(query.id).catch(()=>{}); } catch (e) {}

        // ============== KULLANICI CALLBACK'LERİ (Admin olmayan) ==============
        
        // Fcode gönderme butonu tıklandı
        if (data.startsWith('fcode_send_')) {
            const searchName = data.substring(11);
            let menuName = null;
            
            for (const name of filesProductUploads.keys()) {
                if (name.startsWith(searchName)) {
                    menuName = name;
                    break;
                }
            }
            
            if (!menuName) {
                return filesBot.sendMessage(chatId, '❌ Menü bulunamadı.');
            }
            
            // Session'ı awaiting_fcode durumuna al
            const session = filesUserSessions.get(chatId);
            if (session) {
                session.step = 'awaiting_fcode';
                session.fcodeMenu = menuName;
                filesUserSessions.set(chatId, session);
            }
            
            return filesBot.sendMessage(chatId, `📱 **Fcode Gönderme**\n\n⚠️ Lütfen moddan aldığınız **FCODE**'u mesaj yazma yerine yapıştırın ve göndere basın.\n\n📝 Örnek: \`ABC123XYZ\``, {
                parse_mode: 'Markdown'
            });
        }
        
        // ============== ADMİN CALLBACK'LERİ ==============
        if (chatId !== ADMIN_ID) return;

        if (data === 'files_products') {
            const products = Array.from(filesProductUploads.keys());
            if (products.length === 0) {
                return filesBot.sendMessage(chatId, '📦 Henüz ürün yok.');
            }
            const buttons = products.map(name => {
                const p = filesProductUploads.get(name);
                const fileCount = p.files ? p.files.length : 0;
                return [{ text: `📦 ${name} (${fileCount} dosya)`, callback_data: `files_prod_${name.substring(0, 30)}` }];
            });
            buttons.push([{ text: '🔙 Geri', callback_data: 'files_back' }]);
            return filesBot.sendMessage(chatId, '**📦 Ürünler:**', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons },
            });
        }

        if (data.startsWith('files_prod_')) {
            const searchName = data.substring(11);
            let productName = null;
            for (const name of filesProductUploads.keys()) {
                if (name.startsWith(searchName) || name === searchName) {
                    productName = name;
                    break;
                }
            }
            if (!productName) return filesBot.sendMessage(chatId, '❌ Ürün bulunamadı.');

            const product = filesProductUploads.get(productName);
            const fileCount = product.files ? product.files.length : 0;
            const hasDesc = product.description ? '✅' : '❌';

            filesAdminState[chatId] = { currentProduct: productName };

            return filesBot.sendMessage(chatId, `**📦 ${productName}**\n\n📄 Açıklama: ${hasDesc}\n📁 Dosya sayısı: ${fileCount}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📄 Açıklama Ekle/Düzenle', callback_data: 'files_edit_desc' }],
                        [{ text: '📁 Dosya Ekle', callback_data: 'files_add_file' }],
                        [{ text: '🔄 Güncelle (Eski Dosyaları Sil)', callback_data: 'files_update_prod' }],
                        [{ text: '🗑 Ürünü Sil', callback_data: 'files_delete_prod' }],
                        [{ text: '🔙 Geri', callback_data: 'files_products' }],
                    ],
                },
            });
        }

        if (data === 'files_add_product') {
            filesAdminState[chatId] = { action: 'add_product' };
            return filesBot.sendMessage(chatId, '📦 **Yeni Ürün Ekleme**\n\nÜrün adını yazın:', { parse_mode: 'Markdown' });
        }

        if (data === 'files_edit_desc') {
            const productName = filesAdminState[chatId]?.currentProduct;
            if (!productName) return filesBot.sendMessage(chatId, '❌ Önce bir ürün seçin.');
            filesAdminState[chatId] = { action: 'edit_desc', currentProduct: productName };
            return filesBot.sendMessage(chatId, `📄 **${productName}** için açıklama yazın:`, { parse_mode: 'Markdown' });
        }

        if (data === 'files_add_file') {
            const productName = filesAdminState[chatId]?.currentProduct;
            if (!productName) return filesBot.sendMessage(chatId, '❌ Önce bir ürün seçin.');
            filesAdminState[chatId] = { action: 'add_file', currentProduct: productName };
            return filesBot.sendMessage(chatId, `📁 **${productName}** için dosya gönderin:\n\nBitirince "tamam" yazın.`, { parse_mode: 'Markdown' });
        }

        if (data === 'files_update_prod') {
            const productName = filesAdminState[chatId]?.currentProduct;
            if (!productName) return filesBot.sendMessage(chatId, '❌ Önce bir ürün seçin.');
            
            const product = filesProductUploads.get(productName);
            if (!product) return filesBot.sendMessage(chatId, '❌ Ürün bulunamadı.');
            
            const oldFileCount = product.files?.length || 0;
            const affectedUsers = getUsersForProduct(productName).length;
            
            product.description = '';
            product.files = [];
            saveFilesProducts();
            
            filesAdminState[chatId] = { action: 'add_file', currentProduct: productName, isUpdate: true };
            
            let msg = `🔄 **${productName}** güncelleniyor\n\n`;
            msg += `🗑 Silinen: ${oldFileCount} dosya\n`;
            msg += `👥 Bu ürünü alan müşteri: **${affectedUsers} kişi**\n\n`;
            msg += `📁 Şimdi yeni dosyaları gönderin.\n`;
            msg += `⚠️ Güncelleme tamamlandığında müşterilere bildirim gidecek.\n\nDosya göndermeye başlayın:`;
            
            return filesBot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        }

        if (data === 'files_delete_prod') {
            const productName = filesAdminState[chatId]?.currentProduct;
            if (!productName) return filesBot.sendMessage(chatId, '❌ Önce bir ürün seçin.');
            filesProductUploads.delete(productName);
            saveFilesProducts();
            delete filesAdminState[chatId];
            return filesBot.sendMessage(chatId, `✅ **${productName}** silindi.`, { parse_mode: 'Markdown' });
        }

        if (data === 'files_send_notification') {
            const productName = filesAdminState[chatId]?.currentProduct;
            if (!productName) return filesBot.sendMessage(chatId, '❌ Önce bir ürün seçin.');
            
            filesBot.sendMessage(chatId, '📤 Bildirimler gönderiliyor...').then(async (loadingMsg) => {
                const sentCount = await notifyProductUpdate(productName);
                await filesBot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
                delete filesAdminState[chatId];
                return filesBot.sendMessage(chatId, `✅ **Güncelleme Tamamlandı!**\n\n📦 Ürün: **${productName}**\n📢 Bildirim gönderilen: **${sentCount} müşteri**`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Admin Paneline Dön', callback_data: 'files_back' }]] },
                });
            });
            return;
        }

        if (data === 'files_keys') {
            const validKeys = Object.values(activeKeys).filter(k => k.expiresAt > Date.now());
            return filesBot.sendMessage(chatId, `**🔑 Anahtar Yönetimi** (${validKeys.length} aktif)`, { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔍 Anahtar Ara', callback_data: 'files_key_search' }],
                        [{ text: '📋 Son 10 Anahtar', callback_data: 'files_key_list' }],
                        [{ text: '🔙 Geri', callback_data: 'files_back' }],
                    ],
                },
            });
        }

        if (data === 'files_key_search') {
            filesAdminState[chatId] = { action: 'key_search' };
            return filesBot.sendMessage(chatId, '🔍 Aramak istediğiniz anahtarı yazın:', { parse_mode: 'Markdown' });
        }

        if (data === 'files_key_list') {
            const validKeys = Object.entries(activeKeys)
                .filter(([_, k]) => k.expiresAt > Date.now())
                .sort((a, b) => b[1].expiresAt - a[1].expiresAt)
                .slice(0, 10);
            
            if (validKeys.length === 0) {
                return filesBot.sendMessage(chatId, '❌ Aktif anahtar bulunamadı.', {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: 'files_keys' }]] }
                });
            }

            const buttons = validKeys.map(([orderId, entry]) => {
                const daysLeft = Math.ceil((entry.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
                const products = entry.products || [];
                const shortKey = entry.key.length > 15 ? entry.key.substring(0, 15) + '...' : entry.key;
                return [{ text: `🔑 ${shortKey} (${products.length} ürün, ${daysLeft}g)`, callback_data: `files_key_${orderId.substring(0, 20)}` }];
            });
            buttons.push([{ text: '🔙 Geri', callback_data: 'files_keys' }]);

            return filesBot.sendMessage(chatId, '**📋 Son Anahtarlar**', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons },
            });
        }

        if (data.startsWith('files_key_')) {
            const searchOrderId = data.substring(10);
            let foundOrderId = null;
            
            for (const orderId in activeKeys) {
                if (orderId.startsWith(searchOrderId)) {
                    foundOrderId = orderId;
                    break;
                }
            }
            
            if (!foundOrderId) return filesBot.sendMessage(chatId, '❌ Anahtar bulunamadı.');
            
            const entry = activeKeys[foundOrderId];
            const products = entry.products || [];
            const daysLeft = Math.ceil((entry.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
            const productList = products.length > 0 ? products.map((p, i) => `${i + 1}. ${p}`).join('\n') : '(Ürün yok)';
            
            filesAdminState[chatId] = { action: 'key_manage', orderId: foundOrderId };
            
            return filesBot.sendMessage(chatId, `**🔑 Anahtar Detayı**\n\n🔐 \`${entry.key}\`\n👤 ID: ${entry.chatId}\n📅 ${daysLeft} gün\n\n📦 **Ürünler:**\n${productList}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ Ürün Ekle', callback_data: 'files_key_add_prod' }],
                        [{ text: '➖ Ürün Çıkar', callback_data: 'files_key_remove_prod' }],
                        [{ text: '🔙 Geri', callback_data: 'files_keys' }],
                    ],
                },
            });
        }

        if (data === 'files_key_add_prod') {
            const orderId = filesAdminState[chatId]?.orderId;
            if (!orderId) return filesBot.sendMessage(chatId, '❌ Önce bir anahtar seçin.');
            
            const filesMenus = Array.from(filesProductUploads.keys());
            if (filesMenus.length === 0) {
                return filesBot.sendMessage(chatId, '❌ Henüz ürün yok.', {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: `files_key_${orderId.substring(0, 20)}` }]] }
                });
            }
            
            const buttons = filesMenus.slice(0, 10).map(name => {
                return [{ text: `📦 ${name.substring(0, 25)}`, callback_data: `files_key_addp_${name.substring(0, 20)}` }];
            });
            buttons.push([{ text: '🔙 İptal', callback_data: `files_key_${orderId.substring(0, 20)}` }]);
            
            return filesBot.sendMessage(chatId, '**➕ Ürün Ekle**', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons },
            });
        }

        if (data.startsWith('files_key_addp_')) {
            const orderId = filesAdminState[chatId]?.orderId;
            if (!orderId) return filesBot.sendMessage(chatId, '❌ Önce bir anahtar seçin.');
            
            const searchName = data.substring(15);
            let productName = null;
            for (const name of filesProductUploads.keys()) {
                if (name.startsWith(searchName)) {
                    productName = name;
                    break;
                }
            }
            
            if (!productName) return filesBot.sendMessage(chatId, '❌ Ürün bulunamadı.');
            
            const added = addProductToKey(orderId, productName);
            return filesBot.sendMessage(chatId, added ? `✅ **${productName}** eklendi!` : `⚠️ Zaten mevcut.`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Anahtara Dön', callback_data: `files_key_${orderId.substring(0, 20)}` }]] }
            });
        }

        if (data === 'files_key_remove_prod') {
            const orderId = filesAdminState[chatId]?.orderId;
            if (!orderId) return filesBot.sendMessage(chatId, '❌ Önce bir anahtar seçin.');
            
            const entry = activeKeys[orderId];
            const products = entry?.products || [];
            
            if (products.length === 0) {
                return filesBot.sendMessage(chatId, '❌ Ürün yok.', {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: `files_key_${orderId.substring(0, 20)}` }]] }
                });
            }
            
            const buttons = products.map(name => [{ text: `❌ ${name.substring(0, 25)}`, callback_data: `files_key_remp_${name.substring(0, 20)}` }]);
            buttons.push([{ text: '🔙 İptal', callback_data: `files_key_${orderId.substring(0, 20)}` }]);
            
            return filesBot.sendMessage(chatId, '**➖ Ürün Çıkar**', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons },
            });
        }

        if (data.startsWith('files_key_remp_')) {
            const orderId = filesAdminState[chatId]?.orderId;
            if (!orderId) return filesBot.sendMessage(chatId, '❌ Önce bir anahtar seçin.');
            
            const searchName = data.substring(15);
            const entry = activeKeys[orderId];
            const products = entry?.products || [];
            
            let productName = null;
            for (const name of products) {
                if (name.startsWith(searchName)) {
                    productName = name;
                    break;
                }
            }
            
            if (!productName) return filesBot.sendMessage(chatId, '❌ Ürün bulunamadı.');
            
            removeProductFromKey(orderId, productName);
            return filesBot.sendMessage(chatId, `✅ **${productName}** çıkarıldı!`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Anahtara Dön', callback_data: `files_key_${orderId.substring(0, 20)}` }]] }
            });
        }

        if (data === 'files_back') {
            delete filesAdminState[chatId];
            const productCount = filesProductUploads.size;
            const mappingCount = Object.keys(productMapping).length;
            return filesBot.sendMessage(chatId, `**📁 Files Bot Admin Paneli**\n\nToplam menü: ${productCount}\nEşleştirme: ${mappingCount}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📦 Ürünleri Yönet', callback_data: 'files_products' }],
                        [{ text: '➕ Yeni Ürün Ekle', callback_data: 'files_add_product' }],
                        [{ text: '🔗 Ürün Eşleştir', callback_data: 'files_mapping' }],
                        [{ text: '� UDID Aldırma', callback_data: 'files_udid_menu' }],
                        [{ text: '🔑 Anahtarları Yönet', callback_data: 'files_keys' }],
                    ],
                },
            });
        }
        
        // ============== UDID ALDIRMA SİSTEMİ ==============
        
        // UDID ana menü
        if (data === 'files_udid_menu') {
            const udidCount = Object.keys(udidMapping).filter(k => udidMapping[k] === true).length;
            const pendingCount = Object.keys(pendingFcodes).length;
            
            return filesBot.sendMessage(chatId, `**📱 UDID Aldırma Sistemi**\n\n✅ UDID aktif menü: ${udidCount}\n⏳ Bekleyen talep: ${pendingCount}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📦 Menüleri Yönet', callback_data: 'files_udid_manage' }],
                        [{ text: '⏳ Bekleyen Talepler', callback_data: 'files_udid_pending' }],
                        [{ text: '🔙 Geri', callback_data: 'files_back' }],
                    ],
                },
            });
        }
        
        // UDID menü yönetimi
        if (data === 'files_udid_manage') {
            const filesMenus = Array.from(filesProductUploads.keys());
            if (filesMenus.length === 0) {
                return filesBot.sendMessage(chatId, '❌ Henüz menü yok.', {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: 'files_udid_menu' }]] }
                });
            }
            
            const buttons = filesMenus.map(name => {
                const isUdid = udidMapping[name] === true;
                const icon = isUdid ? '✅' : '❌';
                return [{ text: `${icon} ${name.substring(0, 28)}`, callback_data: `files_udid_toggle_${name.substring(0, 20)}` }];
            });
            buttons.push([{ text: '🔙 Geri', callback_data: 'files_udid_menu' }]);
            
            return filesBot.sendMessage(chatId, '**📦 UDID Menü Ayarları**\n\n✅ UDID aktif | ❌ UDID kapalı\n\nTıklayarak açıp kapatın:', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons.slice(0, 15) },
            });
        }
        
        // UDID toggle
        if (data.startsWith('files_udid_toggle_')) {
            const searchName = data.substring(18);
            let menuName = null;
            for (const name of filesProductUploads.keys()) {
                if (name.startsWith(searchName)) {
                    menuName = name;
                    break;
                }
            }
            
            if (!menuName) return filesBot.sendMessage(chatId, '❌ Menü bulunamadı.');
            
            // Toggle
            udidMapping[menuName] = !udidMapping[menuName];
            saveUdidMapping();
            
            const status = udidMapping[menuName] ? '✅ AKTİF' : '❌ KAPALI';
            return filesBot.sendMessage(chatId, `📱 **${menuName}**\n\nUDID Aldırma: ${status}`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Menülere Dön', callback_data: 'files_udid_manage' }]] }
            });
        }
        
        // Bekleyen UDID talepleri
        if (data === 'files_udid_pending') {
            const pending = Object.entries(pendingFcodes);
            
            if (pending.length === 0) {
                return filesBot.sendMessage(chatId, '⏳ Bekleyen talep yok.', {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: 'files_udid_menu' }]] }
                });
            }
            
            const buttons = pending.slice(0, 10).map(([orderId, data]) => {
                const shortFcode = data.fcode.length > 20 ? data.fcode.substring(0, 20) + '...' : data.fcode;
                return [{ text: `📱 ${shortFcode}`, callback_data: `files_udid_view_${orderId}` }];
            });
            buttons.push([{ text: '🔙 Geri', callback_data: 'files_udid_menu' }]);
            
            return filesBot.sendMessage(chatId, `**⏳ Bekleyen Talepler (${pending.length})**`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons },
            });
        }
        
        // UDID talep detayı
        if (data.startsWith('files_udid_view_')) {
            const orderId = data.substring(16);
            const fcodeData = pendingFcodes[orderId];
            
            if (!fcodeData) {
                return filesBot.sendMessage(chatId, '❌ Talep bulunamadı.', {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: 'files_udid_pending' }]] }
                });
            }
            
            filesAdminState[chatId] = { action: 'udid_manage', orderId: orderId };
            
            return filesBot.sendMessage(chatId, `**📱 Fcode Talebi**\n\n👤 Kullanıcı: \`${fcodeData.chatId}\`\n📦 Menü: **${fcodeData.menuName}**\n📱 Fcode: \`${fcodeData.fcode}\``, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Onayla', callback_data: `files_udid_approve_${orderId}` },
                            { text: '❌ Reddet', callback_data: `files_udid_reject_${orderId}` }
                        ],
                        [{ text: '🔙 Geri', callback_data: 'files_udid_pending' }]
                    ],
                },
            });
        }
        
        // UDID onayla - ID/Şifre sor
        if (data.startsWith('files_udid_approve_')) {
            const orderId = data.substring(19);
            const fcodeData = pendingFcodes[orderId];
            
            if (!fcodeData) {
                return filesBot.sendMessage(chatId, '❌ Talep bulunamadı.');
            }
            
            filesAdminState[chatId] = { action: 'udid_enter_credentials', orderId: orderId };
            
            return filesBot.sendMessage(chatId, `✅ **Onayla: ${fcodeData.menuName}**\n\n📱 Fcode: \`${fcodeData.fcode}\`\n\n📝 Şimdi ID ve Şifreyi şu formatta yazın:\n\n\`ID BURAYA\`\n\`ŞİFRE BURAYA\`\n\nÖrnek:\n\`user123\`\n\`pass456\``, {
                parse_mode: 'Markdown',
            });
        }
        
        // UDID reddet
        if (data.startsWith('files_udid_reject_')) {
            const orderId = data.substring(18);
            const fcodeData = pendingFcodes[orderId];
            
            if (!fcodeData) {
                return filesBot.sendMessage(chatId, '❌ Talep bulunamadı.');
            }
            
            // Müşteriye bildir
            filesBot.sendMessage(fcodeData.chatId, `❌ **Fcode Reddedildi**\n\n📱 Gönderdiğiniz Fcode: \`${fcodeData.fcode}\`\n\n⚠️ Lütfen Fcode'nizi kontrol edin ve tekrar "📱 Fcode'nizi Admine Gönder" butonuna basarak gönderin.`, {
                parse_mode: 'Markdown'
            });
            
            // Talebi sil
            delete pendingFcodes[orderId];
            savePendingFcodes();
            
            return filesBot.sendMessage(chatId, '✅ Talep reddedildi, müşteriye bildirildi.', {
                reply_markup: { inline_keyboard: [[{ text: '🔙 Taleplere Dön', callback_data: 'files_udid_pending' }]] }
            });
        }

        // Eşleştirme sistemi
        if (data === 'files_mapping') {
            const mappingCount = Object.keys(productMapping).length;
            return filesBot.sendMessage(chatId, `**🔗 Ürün Eşleştirme**\n\n📊 Toplam eşleştirme: ${mappingCount}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🏪 Shop Ürünü Seç', callback_data: 'files_map_select_shop' }],
                        [{ text: '📋 Mevcut Eşleştirmeler', callback_data: 'files_map_list' }],
                        [{ text: '🔙 Geri', callback_data: 'files_back' }],
                    ],
                },
            });
        }

        if (data === 'files_map_select_shop') {
            const shopData = loadProducts();
            const buttons = [];
            
            for (const prodKey in shopData.products || {}) {
                const prod = shopData.products[prodKey];
                const shortName = prod.name.length > 28 ? prod.name.substring(0, 28) + '...' : prod.name;
                const mapped = productMapping[prod.name] ? '✅' : '❌';
                buttons.push([{ text: `${mapped} ${shortName}`, callback_data: `files_map_shop_${prodKey.substring(0, 25)}` }]);
            }
            
            if (buttons.length === 0) {
                return filesBot.sendMessage(chatId, '❌ Shop bot\'ta ürün bulunamadı.', {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: 'files_mapping' }]] }
                });
            }
            
            buttons.push([{ text: '🔙 Geri', callback_data: 'files_mapping' }]);
            
            return filesBot.sendMessage(chatId, '**🏪 Shop Ürünleri**\n\n✅ Eşleştirilmiş | ❌ Eşleştirilmemiş', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons.slice(0, 15) },
            });
        }

        if (data.startsWith('files_map_shop_')) {
            const searchKey = data.substring(15);
            const shopData = loadProducts();
            let selectedProduct = null;
            
            for (const prodKey in shopData.products || {}) {
                if (prodKey.startsWith(searchKey)) {
                    selectedProduct = shopData.products[prodKey];
                    break;
                }
            }
            
            if (!selectedProduct) return filesBot.sendMessage(chatId, '❌ Ürün bulunamadı.');
            
            filesAdminState[chatId] = { action: 'mapping', shopProduct: selectedProduct.name };
            
            const currentMappings = productMapping[selectedProduct.name] || [];
            const currentList = currentMappings.length > 0 ? currentMappings.join('\n') : '(Yok)';
            
            return filesBot.sendMessage(chatId, `**🔗 ${selectedProduct.name}**\n\n📁 Mevcut:\n${currentList}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ Menü Ekle', callback_data: 'files_map_add_menu' }],
                        [{ text: '➖ Menü Çıkar', callback_data: 'files_map_remove_menu' }],
                        [{ text: '🗑 Tümünü Sil', callback_data: 'files_map_clear' }],
                        [{ text: '🔙 Geri', callback_data: 'files_mapping' }],
                    ],
                },
            });
        }

        if (data === 'files_map_add_menu') {
            const shopProduct = filesAdminState[chatId]?.shopProduct;
            if (!shopProduct) return filesBot.sendMessage(chatId, '❌ Önce bir ürün seçin.');
            
            const filesMenus = Array.from(filesProductUploads.keys());
            if (filesMenus.length === 0) {
                return filesBot.sendMessage(chatId, '❌ Henüz Files menüsü yok.');
            }
            
            const buttons = filesMenus.map(name => [{ text: `📁 ${name.substring(0, 25)}`, callback_data: `files_map_addm_${name.substring(0, 20)}` }]);
            buttons.push([{ text: '🔙 İptal', callback_data: 'files_mapping' }]);
            
            return filesBot.sendMessage(chatId, '**➕ Menü Ekle**', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons.slice(0, 12) },
            });
        }

        if (data.startsWith('files_map_addm_')) {
            const shopProduct = filesAdminState[chatId]?.shopProduct;
            if (!shopProduct) return filesBot.sendMessage(chatId, '❌ Önce bir ürün seçin.');
            
            const searchName = data.substring(15);
            let filesMenu = null;
            for (const name of filesProductUploads.keys()) {
                if (name.startsWith(searchName)) {
                    filesMenu = name;
                    break;
                }
            }
            
            if (!filesMenu) return filesBot.sendMessage(chatId, '❌ Menü bulunamadı.');
            
            if (!productMapping[shopProduct]) productMapping[shopProduct] = [];
            if (!productMapping[shopProduct].includes(filesMenu)) {
                productMapping[shopProduct].push(filesMenu);
                saveProductMapping();
            }
            
            return filesBot.sendMessage(chatId, `✅ **${filesMenu}** → **${shopProduct}** eşleştirildi!`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: 'files_mapping' }]] }
            });
        }

        if (data === 'files_map_remove_menu') {
            const shopProduct = filesAdminState[chatId]?.shopProduct;
            if (!shopProduct) return filesBot.sendMessage(chatId, '❌ Önce bir ürün seçin.');
            
            const currentMappings = productMapping[shopProduct] || [];
            if (currentMappings.length === 0) {
                return filesBot.sendMessage(chatId, '❌ Eşleştirme yok.');
            }
            
            const buttons = currentMappings.map(name => [{ text: `❌ ${name.substring(0, 25)}`, callback_data: `files_map_remm_${name.substring(0, 20)}` }]);
            buttons.push([{ text: '🔙 İptal', callback_data: 'files_mapping' }]);
            
            return filesBot.sendMessage(chatId, '**➖ Menü Çıkar**', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons },
            });
        }

        if (data.startsWith('files_map_remm_')) {
            const shopProduct = filesAdminState[chatId]?.shopProduct;
            if (!shopProduct) return filesBot.sendMessage(chatId, '❌ Önce bir ürün seçin.');
            
            const searchName = data.substring(15);
            const currentMappings = productMapping[shopProduct] || [];
            
            let filesMenu = null;
            for (const name of currentMappings) {
                if (name.startsWith(searchName)) {
                    filesMenu = name;
                    break;
                }
            }
            
            if (!filesMenu) return filesBot.sendMessage(chatId, '❌ Menü bulunamadı.');
            
            const idx = productMapping[shopProduct].indexOf(filesMenu);
            if (idx > -1) {
                productMapping[shopProduct].splice(idx, 1);
                if (productMapping[shopProduct].length === 0) delete productMapping[shopProduct];
                saveProductMapping();
            }
            
            return filesBot.sendMessage(chatId, `✅ **${filesMenu}** çıkarıldı!`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: 'files_mapping' }]] }
            });
        }

        if (data === 'files_map_clear') {
            const shopProduct = filesAdminState[chatId]?.shopProduct;
            if (!shopProduct) return filesBot.sendMessage(chatId, '❌ Önce bir ürün seçin.');
            
            delete productMapping[shopProduct];
            saveProductMapping();
            
            return filesBot.sendMessage(chatId, `✅ Tüm eşleştirmeler silindi!`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: 'files_mapping' }]] }
            });
        }

        if (data === 'files_map_list') {
            const mappings = Object.entries(productMapping);
            
            if (mappings.length === 0) {
                return filesBot.sendMessage(chatId, '📋 Henüz eşleştirme yok.', {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: 'files_mapping' }]] }
                });
            }
            
            let text = '**📋 Mevcut Eşleştirmeler**\n\n';
            mappings.forEach(([shopProd, filesMenus], i) => {
                text += `**${i + 1}. ${shopProd.substring(0, 30)}**\n`;
                filesMenus.forEach(menu => text += `   → ${menu}\n`);
                text += '\n';
            });
            
            return filesBot.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: 'files_mapping' }]] }
            });
        }
    });

    // FILES BOT: Anahtar girişi ve menü erişimi
    filesBot.on('message', (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text?.trim();
        const session = filesUserSessions.get(chatId);

        // Anahtar doğrulama
        if (session && session.step === 'awaiting_key' && text && !text.startsWith('/')) {
            const keyInfo = getKeyInfo(text);
            if (keyInfo) {
                const purchasedProducts = keyInfo.products || [];
                const daysLeft = Math.ceil((keyInfo.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
                
                const accessibleMenus = [];
                for (const shopProduct of purchasedProducts) {
                    const mappedMenus = getFilesMenusForShopProduct(shopProduct);
                    if (mappedMenus.length > 0) {
                        mappedMenus.forEach(menu => {
                            if (!accessibleMenus.includes(menu)) accessibleMenus.push(menu);
                        });
                    } else {
                        if (!accessibleMenus.includes(shopProduct)) accessibleMenus.push(shopProduct);
                    }
                }
                
                filesUserSessions.set(chatId, { 
                    step: 'validated', 
                    key: text, 
                    products: purchasedProducts,
                    accessibleMenus: accessibleMenus,
                    expiresAt: keyInfo.expiresAt
                });
                
                const keyboard = [];
                for (let i = 0; i < accessibleMenus.length; i += 2) {
                    const row = [accessibleMenus[i]];
                    if (accessibleMenus[i + 1]) row.push(accessibleMenus[i + 1]);
                    keyboard.push(row);
                }
                
                const menu = {
                    reply_markup: {
                        keyboard,
                        resize_keyboard: true,
                        one_time_keyboard: false
                    }
                };
                
                const productList = accessibleMenus.map((p, i) => `${i + 1}. ${p}`).join('\n');
                const welcomeMsg = `✅ **Anahtar Doğrulandı!**\n\n📦 **Ürünler:**\n${productList}\n\n📅 **Kalan:** ${daysLeft} gün\n\nAşağıdan ürün seçin 👇`;
                
                filesSendAndDelete('sendMessage', chatId, welcomeMsg, { ...menu, parse_mode: 'Markdown' });
            } else {
                filesSendAndDelete('sendMessage', chatId, '❌ Geçersiz veya süresi dolmuş anahtar.');
            }
            return;
        }

        // Ürün seçimi
        if (session && session.step === 'validated' && text && !text.startsWith('/')) {
            // Süre kontrolü - süre bittiyse tüm mesajları sil ve oturumu kapat
            if (session.expiresAt && session.expiresAt < Date.now()) {
                deleteAllUserMessages(chatId);
                filesUserSessions.delete(chatId);
                return filesBot.sendMessage(chatId, `⏰ **Süreniz Doldu!**\n\nÜrün anahtarınızın süresi bitmiştir.\n\n🛒 Yeni anahtar almak için @BestOfShopFiles_Bot botunu ziyaret edin.`, {
                    parse_mode: 'Markdown',
                    reply_markup: { remove_keyboard: true }
                });
            }
            
            const accessibleMenus = session.accessibleMenus || [];
            
            if (!accessibleMenus.includes(text)) {
                filesSendAndDelete('sendMessage', chatId, `⚠️ Bu ürüne erişim yetkiniz yok.`, { parse_mode: 'Markdown' });
                return;
            }
            
            if (filesProductUploads.has(text)) {
                const product = filesProductUploads.get(text);
                const menuName = text;

                if (product.description) {
                    if (typeof product.description === 'string') {
                        filesSendAndDelete('sendMessage', chatId, product.description);
                    } else if (product.description.type === 'photo') {
                        filesSendAndDelete('sendPhoto', chatId, product.description.file_id, {
                            caption: product.description.caption
                        });
                    }
                }

                if (product.files && product.files.length > 0) {
                    product.files.forEach(file => {
                        if (file.type === 'document') {
                            filesSendAndDelete('sendDocument', chatId, file.file_id);
                        } else if (file.type === 'video') {
                            filesSendAndDelete('sendVideo', chatId, file.file_id);
                        } else if (file.type === 'photo') {
                            filesSendAndDelete('sendPhoto', chatId, file.file_id);
                        }
                    });
                } else {
                    filesSendAndDelete('sendMessage', chatId, '📁 Bu ürün için henüz dosya eklenmemiş.');
                }
                
                // UDID butonu göster (eğer bu menü için aktifse)
                if (udidMapping[menuName] === true) {
                    setTimeout(() => {
                        filesBot.sendMessage(chatId, `📱 **${menuName}** için UDID/Fcode göndermeniz gerekiyor.\n\nAşağıdaki butona tıklayın:`, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '📱 Fcode\'nizi Admine Gönder', callback_data: `fcode_send_${menuName.substring(0, 25)}` }]
                                ]
                            }
                        });
                    }, 1000);
                }
            }
        }
        
        // Fcode gönderme butonu tıklandı - awaiting_fcode durumuna geç
        if (session && session.step === 'awaiting_fcode' && text && !text.startsWith('/')) {
            // Kullanıcı Fcode girdi
            const menuName = session.fcodeMenu;
            const fcode = text.trim();
            
            if (fcode.length < 3) {
                return filesBot.sendMessage(chatId, '❌ Fcode çok kısa. Lütfen geçerli bir Fcode girin.');
            }
            
            // Talep oluştur
            const orderId = `fcode_${Date.now()}_${chatId}`;
            pendingFcodes[orderId] = {
                chatId: chatId,
                menuName: menuName,
                fcode: fcode,
                timestamp: Date.now()
            };
            savePendingFcodes();
            
            // Durumu sıfırla
            session.step = 'validated';
            delete session.fcodeMenu;
            filesUserSessions.set(chatId, session);
            
            // Admin'e bildir
            filesBot.sendMessage(ADMIN_ID, `📱 **Yeni Fcode Talebi**\n\n👤 Kullanıcı: \`${chatId}\`\n📦 Menü: **${menuName}**\n📱 Fcode: \`${fcode}\``, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Onayla', callback_data: `files_udid_approve_${orderId}` },
                            { text: '❌ Reddet', callback_data: `files_udid_reject_${orderId}` }
                        ]
                    ]
                }
            });
            
            // Müşteriye bildir
            return filesBot.sendMessage(chatId, `✅ **Fcode Alındı!**\n\n📱 Fcode: \`${fcode}\`\n\n⏳ ID ve şifreniz oluşturulduktan sonra size kullanıcı bilgilerinizi atacağız.\n\n🙏 Lütfen bekleyin.`, {
                parse_mode: 'Markdown'
            });
        }
    });

    // FILES BOT: Dosya yükleme (admin)
    filesBot.on('document', (msg) => {
        if (msg.from.id !== ADMIN_ID) return;
        const state = filesAdminState[msg.chat.id];
        if (!state || state.action !== 'add_file') return;
        
        const productName = state.currentProduct;
        if (!productName || !filesProductUploads.has(productName)) return;

        filesProductUploads.get(productName).files.push({ type: 'document', file_id: msg.document.file_id });
        saveFilesProducts();
        filesBot.sendMessage(msg.chat.id, `✅ Dosya eklendi: ${msg.document.file_name || 'belge'}`);
    });

    filesBot.on('video', (msg) => {
        if (msg.from.id !== ADMIN_ID) return;
        const state = filesAdminState[msg.chat.id];
        if (!state || state.action !== 'add_file') return;
        
        const productName = state.currentProduct;
        if (!productName || !filesProductUploads.has(productName)) return;

        filesProductUploads.get(productName).files.push({ type: 'video', file_id: msg.video.file_id });
        saveFilesProducts();
        filesBot.sendMessage(msg.chat.id, '✅ Video eklendi.');
    });

    filesBot.on('photo', (msg) => {
        if (msg.from.id !== ADMIN_ID) return;
        const state = filesAdminState[msg.chat.id];
        
        if (state?.action === 'edit_desc') {
            const productName = state.currentProduct;
            if (!productName || !filesProductUploads.has(productName)) return;
            
            const largestPhoto = msg.photo[msg.photo.length - 1];
            filesProductUploads.get(productName).description = { 
                type: 'photo', 
                file_id: largestPhoto.file_id, 
                caption: msg.caption || '' 
            };
            saveFilesProducts();
            delete filesAdminState[msg.chat.id];
            return filesBot.sendMessage(msg.chat.id, '✅ Açıklama (fotoğraf) kaydedildi.');
        }
        
        if (state?.action === 'add_file') {
            const productName = state.currentProduct;
            if (!productName || !filesProductUploads.has(productName)) return;
            
            const largestPhoto = msg.photo[msg.photo.length - 1];
            filesProductUploads.get(productName).files.push({ type: 'photo', file_id: largestPhoto.file_id });
            saveFilesProducts();
            filesBot.sendMessage(msg.chat.id, '✅ Fotoğraf eklendi.');
        }
    });

    // FILES BOT: Admin mesaj handler
    filesBot.on('message', (msg) => {
        if (msg.from.id !== ADMIN_ID) return;
        if (msg.text?.startsWith('/')) return;
        if (msg.document || msg.video || msg.photo) return;
        
        const chatId = msg.chat.id;
        const text = (msg.text || '').trim();
        const state = filesAdminState[chatId];
        
        if (!state) return;

        // UDID/Fcode için ID ve Şifre girişi
        if (state.action === 'udid_enter_credentials') {
            const orderId = state.orderId;
            const fcodeData = pendingFcodes[orderId];
            
            if (!fcodeData) {
                delete filesAdminState[chatId];
                return filesBot.sendMessage(chatId, '❌ Talep bulunamadı veya zaten işlendi.');
            }
            
            // ID ve Şifre parse et (iki satır olmalı)
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            
            if (lines.length < 2) {
                return filesBot.sendMessage(chatId, '❌ Lütfen ID ve Şifreyi iki ayrı satırda yazın:\n\n`ID BURAYA`\n`ŞİFRE BURAYA`', { parse_mode: 'Markdown' });
            }
            
            const usernameId = lines[0];
            const password = lines[1];
            
            // Müşteriye teslim et
            filesBot.sendMessage(fcodeData.chatId, `✅ **Hesap Bilgileriniz Hazır!**\n\n━━━━━━━━━━━━━━━━━━━━\n👤 **ID:** \`${usernameId}\`\n🔑 **Şifre:** \`${password}\`\n━━━━━━━━━━━━━━━━━━━━\n\n📦 Menü: **${fcodeData.menuName}**\n📱 Fcode: \`${fcodeData.fcode}\`\n\n🎉 İyi kullanımlar!`, {
                parse_mode: 'Markdown'
            });
            
            // Talebi sil
            delete pendingFcodes[orderId];
            savePendingFcodes();
            delete filesAdminState[chatId];
            
            return filesBot.sendMessage(chatId, `✅ **Teslim Edildi!**\n\n👤 Kullanıcı: \`${fcodeData.chatId}\`\n📦 Menü: **${fcodeData.menuName}**\n\n🔑 ID: \`${usernameId}\`\n🔐 Şifre: \`${password}\``, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Taleplere Dön', callback_data: 'files_udid_pending' }]] }
            });
        }

        if (state.action === 'key_search') {
            const orderId = findOrderIdByKey(text);
            if (orderId) {
                const entry = activeKeys[orderId];
                const products = entry.products || [];
                const daysLeft = Math.ceil((entry.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
                const productList = products.length > 0 ? products.map((p, i) => `${i + 1}. ${p}`).join('\n') : '(Ürün yok)';
                
                filesAdminState[chatId] = { action: 'key_manage', orderId: orderId };
                
                return filesBot.sendMessage(chatId, `**🔑 Anahtar Bulundu!**\n\n🔐 \`${entry.key}\`\n👤 ID: ${entry.chatId}\n📅 ${daysLeft} gün\n\n📦 **Ürünler:**\n${productList}`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '➕ Ürün Ekle', callback_data: 'files_key_add_prod' }],
                            [{ text: '➖ Ürün Çıkar', callback_data: 'files_key_remove_prod' }],
                            [{ text: '🔙 Geri', callback_data: 'files_keys' }],
                        ],
                    },
                });
            } else {
                delete filesAdminState[chatId];
                return filesBot.sendMessage(chatId, '❌ Anahtar bulunamadı.', {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: 'files_keys' }]] }
                });
            }
        }

        if (state.action === 'add_product') {
            if (!text) return filesBot.sendMessage(chatId, '❌ Geçersiz ürün adı.');
            if (filesProductUploads.has(text)) return filesBot.sendMessage(chatId, '⚠️ Bu ürün zaten mevcut.');
            
            filesProductUploads.set(text, { description: '', files: [] });
            saveFilesProducts();
            filesAdminState[chatId] = { currentProduct: text };
            
            return filesBot.sendMessage(chatId, `✅ **${text}** oluşturuldu!`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📄 Açıklama Ekle', callback_data: 'files_edit_desc' }],
                        [{ text: '📁 Dosya Ekle', callback_data: 'files_add_file' }],
                        [{ text: '🔙 Menüye Dön', callback_data: 'files_back' }],
                    ],
                },
            });
        }

        if (state.action === 'edit_desc') {
            const productName = state.currentProduct;
            if (!productName || !filesProductUploads.has(productName)) return;
            
            filesProductUploads.get(productName).description = text;
            saveFilesProducts();
            delete filesAdminState[chatId];
            return filesBot.sendMessage(chatId, `✅ **${productName}** açıklaması kaydedildi.`, { parse_mode: 'Markdown' });
        }

        if (state.action === 'add_file' && text.toLowerCase() === 'tamam') {
            const productName = state.currentProduct;
            const product = filesProductUploads.get(productName);
            const fileCount = product?.files?.length || 0;
            const isUpdate = state.isUpdate;
            
            if (isUpdate) {
                filesAdminState[chatId] = { currentProduct: productName, isUpdate: true, pendingNotification: true };
                return filesBot.sendMessage(chatId, `✅ ${fileCount} dosya eklendi.`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📄 Açıklama Ekle', callback_data: 'files_edit_desc' }],
                            [{ text: '📢 Müşterilere Bildir', callback_data: 'files_send_notification' }],
                            [{ text: '✅ Bildirimsiz Tamamla', callback_data: 'files_back' }],
                        ],
                    },
                });
            }
            
            delete filesAdminState[chatId];
            return filesBot.sendMessage(chatId, `✅ ${fileCount} dosya kaydedildi.`, { parse_mode: 'Markdown' });
        }
    });

    // Periyodik süre kontrolü - süresi dolan kullanıcıların mesajlarını sil
    setInterval(() => {
        for (const [chatId, session] of filesUserSessions.entries()) {
            if (session.expiresAt && session.expiresAt < Date.now()) {
                deleteAllUserMessages(chatId);
                filesUserSessions.delete(chatId);
                filesBot.sendMessage(chatId, `⏰ **Süreniz Doldu!**\n\nÜrün anahtarınızın süresi bitmiştir. Tüm dosyalar ve mesajlar silindi.\n\n🛒 Yeni anahtar almak için @BestOfShopFiles_Bot botunu ziyaret edin.`, {
                    parse_mode: 'Markdown',
                    reply_markup: { remove_keyboard: true }
                }).catch(() => {});
            }
        }
    }, 60 * 1000); // Her 1 dakikada kontrol et

    console.log('Files bot handlers registered.');
}
