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
        const hasStock = (product.stock?.[dur.days]?.length || 0) > 0;
        const stockText = hasStock ? '' : ' (Stok Yok)';
        return [{
            text: `${dur.label} - ${price}${symbol} Satın Al${stockText}`,
            callback_data: hasStock ? `buy_${productKey}_${dur.days}` : `nostock_${productKey}_${dur.days}`
        }];
    });
    
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
        message = `💸 **IBAN ile Ödeme Bilgileri**

┌─────────────────────────────┐
│  🏦 **IBAN:**
│  \`${paymentSettings.iban}\`
│
│  📝 **Açıklama:**
│  \`${paymentSettings.iban_aciklama}\`
│
│  👤 **Alıcı Adı:**
│  \`${paymentSettings.iban_alici}\`
└─────────────────────────────┘

📦 **Ürün:** ${sel.productName}
⏱ **Süre:** ${sel.days} Gün
💰 **Tutar:** ${sel.price}₺

⚠️ **ÖNEMLİ:** Açıklamaya \`${paymentSettings.iban_aciklama}\` yazmayı unutmayın!

📤 **Ödeme yaptıktan sonra** dekontu buraya gönderin.`;
    } else if (method === "papara") {
        message = `🏦 **Papara ile Ödeme Bilgileri**

┌─────────────────────────────┐
│  📱 **Papara:**
│  \`${paymentSettings.papara}\`
└─────────────────────────────┘

📦 **Ürün:** ${sel.productName}
⏱ **Süre:** ${sel.days} Gün
💰 **Tutar:** ${sel.price}₺

📤 **Ödeme yaptıktan sonra** dekontu buraya gönderin.`;
    } else if (method === "binance") {
        message = `💰 **Binance (USDT) ile Ödeme**

┌─────────────────────────────┐
│  🔗 **USDT (TRC20) Adresi:**
│  \`${paymentSettings.binance}\`
└─────────────────────────────┘

📦 **Ürün:** ${sel.productName}
⏱ **Süre:** ${sel.days} Gün
💰 **Tutar:** ${sel.price}₺

⚠️ Sadece **Tron TRC20** ağı kullanın!

📤 **Ödeme yaptıktan sonra** dekontu buraya gönderin.`;
    }
    
    sel.step = 'waiting_receipt';
    bot.sendMessage(chatId, message, { 
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [[{ text: "🔙 Ana Menü", callback_data: "back_main" }]]
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
    
    // Stok yok
    if (data.startsWith("nostock_")) {
        return bot.answerCallbackQuery(query.id, { text: "❌ Bu süre için stok bulunmamaktadır.", show_alert: true });
    }
    
    // Satın al - ödeme yöntemi seçimine git
    if (data.startsWith("buy_")) {
        const parts = data.substring(4).split("_");
        const days = parseInt(parts.pop());
        const productKey = parts.join("_");
        return showPaymentMethods(chatId, productKey, days, messageId);
    }
    
    // Ödeme yöntemi seçimi
    if (data === "pay_iban") return showPaymentDetails(chatId, "iban");
    if (data === "pay_papara") return showPaymentDetails(chatId, "papara");
    if (data === "pay_binance") return showPaymentDetails(chatId, "binance");
    
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
    
    // Admin - stok ekle
    if (data.startsWith("admin_stock_")) {
        const productKey = data.substring(12);
        adminState[chatId] = { action: 'add_stock', productKey };
        return bot.sendMessage(chatId, `Stok eklemek için şu formatta girin:\n\n\`süre:anahtar1,anahtar2\`\n\nÖrnek: \`7:key1,key2,key3\`\n\n(7 günlük stoka key1, key2, key3 ekler)`, { parse_mode: 'Markdown' });
    }
    
    // Admin - süre ekle
    if (data === "admin_add_duration") {
        adminState[chatId] = { action: 'add_duration' };
        return bot.sendMessage(chatId, "Yeni süre seçeneği girin (gün sayısı):\n\nÖrnek: `90`", { parse_mode: 'Markdown' });
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
        const userId = data.split("_")[1];
        return handleApproval(chatId, userId);
    }
    
    if (data.startsWith("reject_")) {
        const userId = data.split("_")[1];
        return handleRejection(chatId, userId);
    }
});

// ============== ADMİN FONKSİYONLARI ==============

function showAdminCategories(chatId, messageId = null) {
    const data = loadProducts();
    const categories = data.categories || {};
    
    let text = `📁 **Kategori Yönetimi**\n\n`;
    
    for (const catKey in categories) {
        const cat = categories[catKey];
        text += `${cat.icon || '📁'} **${cat.name}**\n`;
        for (const subKey in cat.subcategories || {}) {
            const sub = cat.subcategories[subKey];
            text += `  └ ${sub.icon || '📦'} ${sub.name}\n`;
        }
        text += '\n';
    }
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "➕ Kategori Ekle", callback_data: "admin_add_cat" }],
                [{ text: "➕ Alt Kategori Ekle", callback_data: "admin_add_subcat" }],
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
    
    const buttons = Object.entries(products).map(([key, prod]) => [{
        text: `${prod.icon || '📦'} ${prod.name}${prod.maintenance ? ' (🔵)' : ''}`,
        callback_data: `admin_edit_${key}`
    }]);
    
    buttons.push([{ text: "🔙 Geri", callback_data: "admin_back" }]);
    
    const text = `📦 **Ürün Yönetimi**\n\nDüzenlemek istediğiniz ürünü seçin:`;
    
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
    
    const stockInfo = Object.entries(product.stock || {})
        .map(([days, arr]) => `${days} gün: ${arr.length} adet`)
        .join('\n') || 'Stok yok';
    
    const priceInfo = Object.entries(product.prices || {})
        .map(([days, price]) => `${days} gün: ${price}₺`)
        .join('\n') || 'Fiyat yok';
    
    const text = `📦 **${product.name}**

📁 Kategori: ${product.category} / ${product.subcategory}
🔵 Bakım: ${product.maintenance ? 'Evet' : 'Hayır'}

💰 **Fiyatlar:**
${priceInfo}

📦 **Stok:**
${stockInfo}`;
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "💰 Fiyatları Düzenle", callback_data: `admin_price_${productKey}` }],
                [{ text: "📝 Açıklamayı Düzenle", callback_data: `admin_desc_${productKey}` }],
                [{ text: "📦 Stok Ekle", callback_data: `admin_stock_${productKey}` }],
                [{ text: product.maintenance ? "✅ Bakımdan Çıkar" : "🔵 Bakıma Al", callback_data: `admin_maint_${productKey}` }],
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
    
    const buttons = durations.map(d => [{
        text: `🗑 ${d.label} Sil`,
        callback_data: `admin_del_dur_${d.days}`
    }]);
    
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

function handleApproval(chatId, userId) {
    const sel = userState[userId];
    if (!sel) return bot.sendMessage(chatId, "Kullanıcı bilgisi bulunamadı.");
    
    adminState[chatId] = { action: 'send_key', targetUserId: userId, ...sel };
    bot.sendMessage(chatId, `✅ **Sipariş Onayı**

📦 Ürün: ${sel.productName}
⏱ Süre: ${sel.days} gün
💰 Fiyat: ${sel.price}₺

Lütfen anahtarı gönderin:`, { parse_mode: 'Markdown' });
}

function handleRejection(chatId, userId) {
    bot.sendMessage(userId, `❌ **Ödemeniz reddedildi.**\n\nDekontunuz geçersiz bulundu. Lütfen doğru dekontu gönderin.`, { parse_mode: 'Markdown' });
    bot.sendMessage(chatId, `❌ Kullanıcı ${userId} için sipariş reddedildi.`);
    delete userState[userId];
}

// ============== MESSAGE HANDLER ==============
bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    
    // Admin state işlemleri
    if (adminState[chatId]) {
        const state = adminState[chatId];
        const text = (msg.text || '').trim();
        
        // Anahtar gönderimi
        if (state.action === 'send_key') {
            const userId = state.targetUserId;
            const key = text;
            const days = state.days;
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
            bot.sendMessage(userId, `✅ **Ödemeniz onaylandı!**

🔑 **Anahtarınız:**
\`${key}\`

📦 **Ürün:** ${state.productName}
📅 **Geçerlilik:** ${days} gün (${expiryDate})

📥 Kurulum dosyaları için: ${GROUP_LINK}`, { parse_mode: 'Markdown' });
            
            bot.sendMessage(chatId, `✅ Anahtar gönderildi!\n\n👤 Kullanıcı: ${userId}\n🔑 Anahtar: \`${key}\``, { parse_mode: 'Markdown' });
            delete adminState[chatId];
            delete userState[userId];
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
        
        // Stok ekleme
        if (state.action === 'add_stock') {
            const data = loadProducts();
            const [days, keys] = text.split(':');
            if (days && keys && data.products[state.productKey]) {
                const keyList = keys.split(',').map(k => k.trim()).filter(k => k);
                if (!data.products[state.productKey].stock) {
                    data.products[state.productKey].stock = {};
                }
                if (!data.products[state.productKey].stock[days]) {
                    data.products[state.productKey].stock[days] = [];
                }
                data.products[state.productKey].stock[days].push(...keyList);
                saveProducts(data);
                bot.sendMessage(chatId, `✅ ${keyList.length} adet anahtar ${days} günlük stoka eklendi.`);
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
        
        // Ödeme ayarı düzenleme
        if (state.action === 'edit_payment') {
            paymentSettings[state.field] = text;
            savePaymentSettings(paymentSettings);
            bot.sendMessage(chatId, `✅ ${state.field} güncellendi.`);
            delete adminState[chatId];
            return showAdminPayment(chatId);
        }
        
        // Ürün ekleme wizard
        if (state.action === 'add_product') {
            if (state.step === 2) {
                // Ürün adı
                state.productName = text;
                state.step = 3;
                return bot.sendMessage(chatId, "Ürün açıklamasını girin:");
            }
            if (state.step === 3) {
                // Açıklama
                state.description = text;
                state.step = 4;
                return bot.sendMessage(chatId, "Ürün ikonunu girin (emoji):\n\nÖrnek: 🎯");
            }
            if (state.step === 4) {
                // İkon
                state.icon = text;
                state.step = 5;
                return bot.sendMessage(chatId, "Fiyatları girin:\n\n`7:400 30:725 60:1200`", { parse_mode: 'Markdown' });
            }
            if (state.step === 5) {
                // Fiyatlar
                const prices = {};
                text.split(/\s+/).forEach(p => {
                    const [d, price] = p.split(':');
                    if (d && price) prices[d] = parseInt(price);
                });
                
                const productKey = state.productName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
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
                
                saveProducts(data);
                bot.sendMessage(chatId, `✅ **${state.productName}** başarıyla eklendi!`, { parse_mode: 'Markdown' });
                delete adminState[chatId];
                return showAdminProductList(chatId);
            }
        }
    }
    
    // Kullanıcı dekont gönderimi
    const sel = userState[chatId];
    if ((msg.document || msg.photo) && sel && sel.step === 'waiting_receipt') {
        bot.forwardMessage(ADMIN_ID, chatId, msg.message_id).then((fwd) => {
            bot.sendMessage(ADMIN_ID, `🛒 **Yeni Sipariş**

👤 Kullanıcı: ${chatId}
📦 Ürün: ${sel.productName}
⏱ Süre: ${sel.days} gün
💰 Fiyat: ${sel.price}₺`, {
                parse_mode: "Markdown",
                reply_to_message_id: fwd.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "✅ Onayla", callback_data: `approve_${chatId}` },
                            { text: "❌ Reddet", callback_data: `reject_${chatId}` }
                        ]
                    ]
                }
            });
        }).catch(() => {});
        
        bot.sendMessage(chatId, "📤 **Dekontunuz alındı!**\n\nOnay sonrası ürününüz teslim edilecektir.", { parse_mode: "Markdown" });
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
            bot.sendMessage(entry.chatId, `⚠️ **Hatırlatma**\n\nAnahtarınız yarın sona erecek.\n\n🔑 \`${entry.key}\`\n📦 ${prods.join(', ')}`, { parse_mode: 'Markdown' }).catch(() => {});
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
