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
    
    const priceInfo = Object.entries(product.prices || {})
        .map(([days, price]) => `${days} gün: ${price}₺`)
        .join('\n') || 'Fiyat yok';
    
    const text = `📦 **${product.name}**

📁 Kategori: ${product.category} / ${product.subcategory}
🔵 Bakım: ${product.maintenance ? 'Evet' : 'Hayır'}

💰 **Fiyatlar:**
${priceInfo}`;
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "💰 Fiyatları Düzenle", callback_data: `admin_price_${productKey}` }],
                [{ text: "📝 Açıklamayı Düzenle", callback_data: `admin_desc_${productKey}` }],
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

function handleApproval(chatId, userId) {
    // userId string olarak geliyor, integer'a çevir
    const userIdInt = parseInt(userId);
    const sel = userState[userIdInt];
    if (!sel) {
        console.log(`userState bulunamadı: ${userId}, mevcut keys:`, Object.keys(userState));
        return bot.sendMessage(chatId, "Kullanıcı bilgisi bulunamadı. Müşteri tekrar sipariş vermeli.");
    }
    
    adminState[chatId] = { action: 'send_key', targetUserId: userIdInt, ...sel };
    bot.sendMessage(chatId, `✅ **Sipariş Onayı**

📦 Ürün: ${sel.productName}
⏱ Süre: ${sel.days} gün
💰 Fiyat: ${sel.price}₺

📝 **Format:** \`anahtar süre\`
📌 **Örnek:** \`the_best1 30\`

Lütfen anahtarı ve süreyi yazın:`, { parse_mode: 'Markdown' });
}

function handleRejection(chatId, userId) {
    const userIdInt = parseInt(userId);
    const sel = userState[userIdInt];
    const productName = sel?.productName || 'Bilinmeyen';
    
    bot.sendMessage(userIdInt, `❌ **Ödemeniz Reddedildi**

📦 Ürün: **${productName}**

Dekontunuz geçersiz veya hatalı bulundu.

📌 Lütfen doğru dekontu gönderin veya destek için iletişime geçin.`, { parse_mode: 'Markdown' });
    
    bot.sendMessage(chatId, `❌ **Sipariş Reddedildi**\n\n👤 Kullanıcı: \`${userIdInt}\`\n📦 Ürün: **${productName}**\n\n⚠️ Müşteriye bildirim gönderildi.`, { parse_mode: 'Markdown' });
    delete userState[userIdInt];
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
            
            // Müşteriye mesaj gönder
            bot.sendMessage(userId, `✅ **Ödemeniz Onaylandı!**

🔑 **Ürün Anahtarınız:**
\`${key}\`

📦 **Ürün:** ${state.productName}
📅 **Geçerlilik:** ${days} gün (${expiryDate} tarihine kadar)

━━━━━━━━━━━━━━━━━━━━

📥 **Kurulum Dosyaları İçin:**
Satın aldığınız anahtar ile ${GROUP_LINK} botuna gidip anahtarınızı girerek kurulum dosyalarını indirebilirsiniz.

🙏 Bizi tercih ettiğiniz için teşekkür ederiz!`, { parse_mode: 'Markdown' })
            .then(() => {
                console.log(`✅ Müşteriye mesaj gönderildi: ${userId}`);
            })
            .catch((err) => {
                console.log(`❌ Müşteriye mesaj gönderilemedi: ${userId}`, err.message);
                bot.sendMessage(chatId, `⚠️ Müşteriye mesaj gönderilemedi! Hata: ${err.message}`);
            });
            
            // Admin'e onay mesajı
            bot.sendMessage(chatId, `✅ **Anahtar Gönderildi!**

👤 Kullanıcı: \`${userId}\`
📦 Ürün: **${state.productName}**
🔑 Anahtar: \`${key}\`
📅 Süre: **${days} gün**

✨ Müşteriye bildirim gönderildi.`, { parse_mode: 'Markdown' });
            
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
            bot.sendMessage(ADMIN_ID, `🛒 **Yeni Sipariş Bildirimi**

👤 Kullanıcı: \`${chatId}\`
📦 Ürün: **${sel.productName}**
⏱ Süre: **${sel.days} gün**
💰 Fiyat: **${sel.price}₺**

📋 Dekont yukarıda. Kontrol edip onaylıyor musunuz?`, {
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
        
        bot.sendMessage(chatId, `📤 **Dekontunuz Alındı!**

✅ Kontrol edildikten ve admin onayından sonra ürününüz teslim edilecektir.

⏳ Yoğunluğa göre süre uzayabilir.
🙏 Lütfen bekleyiniz. Teşekkür ederiz.`, { parse_mode: "Markdown" });
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

    // Ürün eşleştirme: Shop bot ürün adı -> Files bot menü adları (array)
    let productMapping = {};

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
            setTimeout(() => {
                filesBot.deleteMessage(chatId, sent.message_id).catch(() => {});
            }, FILES_DELETE_DELAY_MS);
        }).catch(() => {});
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
                    [{ text: '🔑 Anahtarları Yönet', callback_data: 'files_keys' }],
                ],
            },
        });
    });

    // FILES BOT: Callback handler
    filesBot.on('callback_query', (query) => {
        const chatId = query.from.id;
        const data = query.data;
        try { filesBot.answerCallbackQuery(query.id).catch(()=>{}); } catch (e) {}

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
                        [{ text: '🔑 Anahtarları Yönet', callback_data: 'files_keys' }],
                    ],
                },
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
            const accessibleMenus = session.accessibleMenus || [];
            
            if (!accessibleMenus.includes(text)) {
                filesSendAndDelete('sendMessage', chatId, `⚠️ Bu ürüne erişim yetkiniz yok.`, { parse_mode: 'Markdown' });
                return;
            }
            
            if (filesProductUploads.has(text)) {
                const product = filesProductUploads.get(text);

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
            }
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

    console.log('Files bot handlers registered.');
}
