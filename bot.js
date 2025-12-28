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
const LOGS_FILE = path.join(__dirname, 'logs.json');
const VIP_FILE = path.join(__dirname, 'vip_customers.json');

// ============== LOG SİSTEMİ ==============
function loadLogs() {
    try {
        if (fs.existsSync(LOGS_FILE)) {
            return JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'));
        }
    } catch (e) {}
    return [];
}

function saveLogs(logs) {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2), 'utf-8');
}

function addLog(type, details) {
    const logs = loadLogs();
    logs.unshift({
        id: Date.now(),
        type: type, // 'sale', 'key_sent', 'renewal', 'vip_upgrade', 'admin_action', 'payment'
        details: details,
        timestamp: new Date().toISOString()
    });
    // Son 500 logu tut
    if (logs.length > 500) logs.length = 500;
    saveLogs(logs);
}

// ============== SADAKAT SİSTEMİ ==============
const LOYALTY_FILE = path.join(__dirname, 'loyalty_settings.json');

function loadLoyaltySettings() {
    try {
        if (fs.existsSync(LOYALTY_FILE)) {
            return JSON.parse(fs.readFileSync(LOYALTY_FILE, 'utf-8'));
        }
    } catch (e) {}
    return {
        pointRate: 4, // Alışveriş tutarının %4'ü kadar puan kazanılır
        enabled: true
    };
}

function saveLoyaltySettings(settings) {
    fs.writeFileSync(LOYALTY_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

let loyaltySettings = loadLoyaltySettings();

function loadVipCustomers() {
    try {
        if (fs.existsSync(VIP_FILE)) {
            return JSON.parse(fs.readFileSync(VIP_FILE, 'utf-8'));
        }
    } catch (e) {}
    return {};
}

function saveVipCustomers(data) {
    fs.writeFileSync(VIP_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

let vipCustomers = loadVipCustomers();

// Müşteri puanını getir
function getCustomerPoints(userId) {
    const customer = vipCustomers[userId];
    if (!customer) return 0;
    return customer.points || 0;
}

// Puan kullan
function useCustomerPoints(userId, pointsToUse) {
    const customer = vipCustomers[userId];
    if (!customer || (customer.points || 0) < pointsToUse) return false;
    
    customer.points = (customer.points || 0) - pointsToUse;
    customer.usedPoints = (customer.usedPoints || 0) + pointsToUse;
    saveVipCustomers(vipCustomers);
    return true;
}

// Sadakat puanı hesapla ve güncelle (alışveriş sonrası)
function addLoyaltyPoints(userId, chatId, spentAmount) {
    if (!vipCustomers[userId]) {
        vipCustomers[userId] = {
            chatId: chatId,
            purchases: 0,
            totalSpent: 0,
            points: 0,
            usedPoints: 0,
            joinDate: new Date().toISOString()
        };
    }
    
    const customer = vipCustomers[userId];
    customer.chatId = chatId;
    customer.purchases = (customer.purchases || 0) + 1;
    customer.totalSpent = (customer.totalSpent || 0) + spentAmount;
    customer.lastPurchase = Date.now();
    
    // Puan ekle (tutarın %4'ü kadar puan - 1 puan = 1 TL)
    const pointRate = loyaltySettings.pointRate || 4;
    const earnedPoints = Math.floor(spentAmount * pointRate / 100);
    customer.points = (customer.points || 0) + earnedPoints;
    
    saveVipCustomers(vipCustomers);
    return { earnedPoints, totalPoints: customer.points, purchases: customer.purchases };
}

function getVipInfo(userId) {
    return vipCustomers[userId] || null;
}

function getLoyaltyBadge(purchases) {
    if (purchases >= 10) return '🥇 VIP Gold';
    if (purchases >= 5) return '🥈 VIP Silver';
    if (purchases >= 3) return '🥉 VIP Bronze';
    if (purchases >= 1) return '⭐ Üye';
    return '👤 Yeni';
}

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
        // Mobil ve PC kategorisi için oyun menüsüne yönlendir
        if (catKey === 'mobile') {
            buttons.push([{ 
                text: cat.name, 
                callback_data: `games_menu` 
            }]);
        } else if (catKey === 'pc') {
            buttons.push([{ 
                text: cat.name, 
                callback_data: `pc_games_menu` 
            }]);
        } else {
            buttons.push([{ 
                text: cat.name, 
                callback_data: `main_${catKey}` 
            }]);
        }
    }
    
    // Resmi Telegram Kanallarımız butonu
    buttons.push([{ text: "📢 Resmi Telegram Kanallarımız", callback_data: "channels_menu" }]);
    
    // Sadakat Sistemi butonu
    buttons.push([{ text: "⭐ Sadakat Sistemi", callback_data: "loyalty_info" }]);
    
    // Politikalarımız ve Kurallarımız butonu
    buttons.push([{ text: "📜 Politikalarımız ve Kurallarımız", callback_data: "policies_rules" }]);
    
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

// Platform seçim menüsü (Android/iOS) - Mobil için
function showPlatformMenu(chatId, messageId = null) {
    const buttons = [
        [{ text: "🤖 Android", callback_data: "platform_android" }],
        [{ text: "🍎 Apple/iOS", callback_data: "platform_ios" }],
        [{ text: "🔙 Ana Menü", callback_data: "back_main" }]
    ];
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
    };
    
    const text = `📱 **Mobil Mod Ürünleri**

📲 Cihazınızın işletim sistemini seçin:`;
    
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

// Platform seçim menüsü (Windows/Emülatör) - PC için
function showPCPlatformMenu(chatId, messageId = null) {
    // Direkt Windows oyunlarını göster (emülatör kaldırıldı)
    return showGamesMenu(chatId, 'windows', messageId);
    
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

// Oyun listesi menüsü (Platform filtrelemeli)
function showGamesMenu(chatId, platform, messageId = null) {
    const data = loadProducts();
    const games = data.games || {};
    const products = data.products || {};
    
    // Bu platformda ürünü olan oyunları bul
    const gamesWithProducts = new Set();
    for (const [prodKey, prod] of Object.entries(products)) {
        if (prod.subcategory === platform && prod.game) {
            gamesWithProducts.add(prod.game);
        }
    }
    
    // Oyunları sırala ve filtrele
    const sortedGames = Object.entries(games)
        .filter(([gameKey, game]) => game.status === 'active' && gamesWithProducts.has(gameKey))
        .sort((a, b) => (a[1].order || 99) - (b[1].order || 99));
    
    const buttons = [];
    for (const [gameKey, game] of sortedGames) {
        buttons.push([{ 
            text: `${game.icon || '🎮'} ${game.name}`, 
            callback_data: `game_${platform}_${gameKey}` 
        }]);
    }
    
    // PC platformları için farklı geri butonu (direkt ana menüye)
    const isPCPlatform = platform === 'windows' || platform === 'emulator';
    buttons.push([{ text: "🔙 Geri", callback_data: isPCPlatform ? "back_main" : "games_menu" }]);
    buttons.push([{ text: "🏠 Ana Menü", callback_data: "back_main" }]);
    
    // Platform ismini belirle
    let platformName;
    switch (platform) {
        case 'android': platformName = '🤖 Android'; break;
        case 'ios': platformName = '🍎 Apple/iOS'; break;
        case 'windows': platformName = '🪟 Windows'; break;
        case 'emulator': platformName = '🎮 Emülatör'; break;
        default: platformName = platform;
    }
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
    };
    
    const categoryIcon = isPCPlatform ? '💻' : '📱';
    const text = `${categoryIcon} **${platformName} Oyunları**

🎮 Lütfen bir oyun seçin:`;
    
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

// Oyuna ait ürünleri göster (platform filtrelemeli)
function showGameProducts(chatId, gameKey, platform, messageId = null) {
    const data = loadProducts();
    const games = data.games || {};
    const products = data.products || {};
    
    const game = games[gameKey];
    if (!game) return showGamesMenu(chatId, platform, messageId);
    
    // Bu oyuna ve platforma ait ürünleri filtrele ve sırala
    const gameProducts = Object.entries(products)
        .filter(([_, prod]) => prod.game === gameKey && prod.subcategory === platform)
        .sort((a, b) => (a[1].order || 99) - (b[1].order || 99));
    
    const buttons = [];
    for (const [prodKey, prod] of gameProducts) {
        // Bakımda mı kontrol et
        const isMaintenance = prod.maintenance === true;
        const statusIcon = isMaintenance ? '🔵' : '🟢';
        
        // En düşük fiyatı bul
        const prices = prod.prices || {};
        const minPrice = Math.min(...Object.values(prices).filter(p => p > 0)) || 0;
        
        const buttonText = isMaintenance 
            ? `${statusIcon} ${prod.icon || ''} ${prod.name} - BAKIMDA`
            : `${statusIcon} ${prod.icon || ''} ${prod.name} - ${minPrice}₺'den`;
        
        buttons.push([{ 
            text: buttonText, 
            callback_data: isMaintenance ? `maintenance_${prodKey}` : `gprod_${platform}_${prodKey}` 
        }]);
    }
    
    buttons.push([{ text: "🔙 Oyunlar", callback_data: `platform_${platform}` }]);
    buttons.push([{ text: "🏠 Ana Menü", callback_data: "back_main" }]);
    
    // Platform ismini belirle
    let platformName;
    switch (platform) {
        case 'android': platformName = '🤖 Android'; break;
        case 'ios': platformName = '🍎 iOS'; break;
        case 'windows': platformName = '🪟 Windows'; break;
        case 'emulator': platformName = '🎮 Emülatör'; break;
        default: platformName = platform;
    }
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
    };
    
    const text = `${game.icon || '🎮'} **${game.name} - ${platformName}**

🟢 Aktif  🔵 Bakımda

Lütfen bir ürün seçin:`;
    
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {
            bot.sendMessage(chatId, text, opts);
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

// Oyun ürünü detayları - süre seçimi
function showGameProductDetails(chatId, prodKey, messageId = null) {
    const data = loadProducts();
    const products = data.products || {};
    const games = data.games || {};
    const durations = data.settings?.durations || [];
    
    const product = products[prodKey];
    if (!product) return showPlatformMenu(chatId, messageId);
    
    const game = games[product.game] || {};
    const platformText = product.subcategory === 'android' ? '🤖 Android' : product.subcategory === 'ios' ? '🍎 iOS' : '💻 PC';
    const platformKey = product.subcategory || 'android';
    
    // Açıklama dosyasını oku
    let description = product.description || '';
    try {
        const descFile = path.join(__dirname, 'descriptions', `${product.name}.txt`);
        if (fs.existsSync(descFile)) {
            description = fs.readFileSync(descFile, 'utf-8').trim();
        }
    } catch (e) {}
    
    // Süre butonları oluştur (stok gösterilmez - admin manuel key girer)
    const buttons = [];
    for (const dur of durations) {
        const price = product.prices?.[dur.days] || 0;
        if (price > 0) {
            buttons.push([{
                text: `⏱ ${dur.label} - ${price}₺`,
                callback_data: `gbuy_${prodKey}_${dur.days}`
            }]);
        }
    }
    
    // Geri butonu: oyuna geri dön (platform bilgisi ile)
    buttons.push([{ text: "🔙 Geri", callback_data: `game_${platformKey}_${product.game}` }]);
    buttons.push([{ text: "🏠 Ana Menü", callback_data: "back_main" }]);
    
    const text = `${product.icon || '🎮'} **${product.name}**

📱 **Platform:** ${platformText}
🎮 **Oyun:** ${game.name || 'Bilinmiyor'}

📝 **Açıklama:**
${description || 'Açıklama bulunmuyor.'}

⏱ **Süre seçin:**`;
    
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
    
    // Müşterinin sadakat puanını kontrol et
    const customerPoints = getCustomerPoints(chatId.toString());
    
    // Kullanıcı bilgisini kaydet
    userState[chatId] = {
        productKey,
        productName: product.name,
        days,
        price,
        originalPrice: price,
        usedPoints: 0,
        step: 'payment_selection'
    };
    
    let text = `💳 <b>Ödeme Yöntemi Seçin</b>

📦 <b>Ürün:</b> ${product.name}
⏱ <b>Süre:</b> ${days} Gün
💰 <b>Fiyat:</b> ${price}${symbol}`;
    
    // Sadakat puanı bilgisi
    const buttons = [];
    
    if (customerPoints > 0) {
        // Kullanılabilecek maksimum puan (fiyatı aşamaz)
        const maxUsablePoints = Math.min(customerPoints, price);
        text += `\n\n━━━━━━━━━━━━━━━━━━━━`;
        text += `\n⭐ <b>Sadakat Puanınız:</b> ${customerPoints} puan`;
        text += `\n💎 <b>Kullanılabilir:</b> ${maxUsablePoints} TL indirim`;
        
        buttons.push([{ text: `⭐ ${maxUsablePoints} Puan Kullan (-${maxUsablePoints}${symbol})`, callback_data: `use_points_${productKey}_${days}` }]);
    } else {
        text += `\n\n━━━━━━━━━━━━━━━━━━━━`;
        text += `\n⭐ <i>Sadakat puanınız bulunmuyor.</i>`;
        text += `\n<i>💡 Bu alışverişte ${Math.floor(price * (loyaltySettings.pointRate || 4) / 100)} puan kazanacaksınız!</i>`;
    }
    
    text += `\n━━━━━━━━━━━━━━━━━━━━`;
    text += `\n\nÖdeme yöntemi seçin:`;
    
    buttons.push([{ text: "💸 IBAN ile Öde", callback_data: "pay_iban" }]);
    buttons.push([{ text: "🏦 Papara ile Öde", callback_data: "pay_papara" }]);
    buttons.push([{ text: "💰 Binance (USDT) ile Öde", callback_data: "pay_binance" }]);
    buttons.push([{ text: "🔙 Geri", callback_data: `gprod_${productKey}` }]);
    
    const opts = {
        parse_mode: "HTML",
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

// ============== /PUAN KOMUTU ==============
bot.onText(/\/puan/, (msg) => {
    const chatId = msg.chat.id;
    const userId = chatId.toString();
    const customer = vipCustomers[userId];
    
    if (!customer || (customer.points || 0) === 0) {
        return bot.sendMessage(chatId, `⭐ <b>Sadakat Puanlarınız</b>

📊 Mevcut Puanınız: <b>0 puan</b>
💰 Kullanılabilir İndirim: <b>0 TL</b>

━━━━━━━━━━━━━━━━━━━━

<i>💡 Her alışverişte ödediğiniz tutarın %${loyaltySettings.pointRate || 4}'ü kadar puan kazanırsınız!</i>
<i>🎁 1 Puan = 1 TL indirim olarak kullanılabilir.</i>

Puan kazanmak için alışveriş yapın! 🛒`, { parse_mode: 'HTML' });
    }
    
    const points = customer.points || 0;
    const totalSpent = customer.totalSpent || 0;
    const purchases = customer.purchases || 0;
    const usedPoints = customer.usedPoints || 0;
    const badge = getLoyaltyBadge(purchases);
    
    return bot.sendMessage(chatId, `⭐ <b>Sadakat Puanlarınız</b>

${badge}

━━━━━━━━━━━━━━━━━━━━

💎 <b>Mevcut Puanınız:</b> <code>${points}</code> puan
💰 <b>Kullanılabilir İndirim:</b> <code>${points}</code> TL

━━━━━━━━━━━━━━━━━━━━

📊 <b>İstatistikler:</b>
📦 Toplam Alışveriş: ${purchases}
💵 Toplam Harcama: ${totalSpent.toLocaleString('tr-TR')} TL
🎁 Kullanılan Puan: ${usedPoints} puan

━━━━━━━━━━━━━━━━━━━━

<i>💡 Her alışverişte ödediğiniz tutarın %${loyaltySettings.pointRate || 4}'ü kadar puan kazanırsınız!</i>
<i>🎁 1 Puan = 1 TL indirim olarak kullanılabilir.</i>`, { 
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[{ text: "🛒 Alışverişe Başla", callback_data: "back_main" }]]
        }
    });
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
    const logs = loadLogs();
    const totalCustomers = Object.keys(vipCustomers).length;
    const loyaltyCustomers = Object.values(vipCustomers).filter(v => (v.purchases || 0) >= 1).length;
    
    const text = `🔧 **Admin Paneli**

📊 Müşteri: ${totalCustomers} | ⭐ Sadakat Üyesi: ${loyaltyCustomers}
🎁 Puan Oranı: %${loyaltySettings.pointRate || 4}
📋 Son işlem: ${logs.length > 0 ? new Date(logs[0].timestamp).toLocaleString('tr-TR') : 'Yok'}

Yapmak istediğiniz işlemi seçin:`;
    
    const opts = {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎮 Oyun Yönetimi", callback_data: "admin_games" }],
                [{ text: "📁 Kategorileri Yönet", callback_data: "admin_categories" }],
                [{ text: "📦 Ürünleri Yönet", callback_data: "admin_products" }],
                [{ text: "➕ Yeni Ürün Ekle", callback_data: "admin_add_product" }],
                [{ text: "⏱ Süre Seçenekleri", callback_data: "admin_durations" }],
                [{ text: "💳 Ödeme Ayarları", callback_data: "admin_payment" }],
                [{ text: "🔑 Anahtarlar", callback_data: "admin_keys" }],
                [{ text: "📢 Duyuru Gönder", callback_data: "admin_announce" }],
                [{ text: "⭐ Sadakat Sistemi", callback_data: "admin_loyalty" }],
                [{ text: "👥 Müşteri Listesi", callback_data: "admin_vip" }],
                [{ text: "📋 İşlem Logları", callback_data: "admin_logs" }]
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

// ============== ADMIN OYUN YÖNETİMİ FONKSİYONLARI ==============

// Oyun listesi - Admin
function showAdminGames(chatId, messageId = null) {
    const data = loadProducts();
    const games = data.games || {};
    
    const sortedGames = Object.entries(games).sort((a, b) => (a[1].order || 99) - (b[1].order || 99));
    
    let text = `🎮 <b>Oyun Yönetimi</b>\n\n`;
    text += `📊 Toplam ${sortedGames.length} oyun\n\n`;
    text += `🟢 Aktif  🔵 Bakımda\n\n`;
    
    const buttons = [];
    for (const [gameKey, game] of sortedGames) {
        const statusIcon = game.status === 'maintenance' ? '🔵' : '🟢';
        buttons.push([{ 
            text: `${statusIcon} ${game.icon || '🎮'} ${game.name}`, 
            callback_data: `admin_edit_game_${gameKey}` 
        }]);
    }
    
    buttons.push([{ text: "➕ Yeni Oyun Ekle", callback_data: "admin_add_game" }]);
    buttons.push([{ text: "🔙 Admin Panel", callback_data: "admin_back" }]);
    
    const opts = {
        parse_mode: "HTML",
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

// Oyun düzenleme
function showAdminGameEdit(chatId, gameKey, messageId = null) {
    const data = loadProducts();
    const game = data.games?.[gameKey];
    
    if (!game) return showAdminGames(chatId, messageId);
    
    const statusIcon = game.status === 'maintenance' ? '🔵 Bakımda' : '🟢 Aktif';
    const statusText = game.status === 'maintenance' ? 'Aktif Yap' : 'Bakıma Al';
    
    // Bu oyuna ait ürün sayısı ve platform dağılımı
    const gameProducts = Object.values(data.products || {}).filter(p => p.game === gameKey);
    const productCount = gameProducts.length;
    const platformCounts = {};
    gameProducts.forEach(p => {
        platformCounts[p.subcategory] = (platformCounts[p.subcategory] || 0) + 1;
    });
    const platformText = Object.entries(platformCounts).map(([k, v]) => `${k}: ${v}`).join(', ') || 'Yok';
    
    let text = `🎮 <b>Oyun Düzenle</b>\n\n`;
    text += `📛 <b>Ad:</b> ${game.name}\n`;
    text += `🎨 <b>İkon:</b> ${game.icon || '🎮'}\n`;
    text += `📊 <b>Durum:</b> ${statusIcon}\n`;
    text += `📦 <b>Ürün Sayısı:</b> ${productCount}\n`;
    text += `📱 <b>Platformlar:</b> ${platformText}\n`;
    text += `🔢 <b>Sıra:</b> ${game.order || 0}`;
    
    const buttons = [
        [{ text: "📛 Ad Değiştir", callback_data: `admin_game_name_${gameKey}` }],
        [{ text: "🎨 İkon Değiştir", callback_data: `admin_game_icon_${gameKey}` }],
        [{ text: `📊 ${statusText}`, callback_data: `admin_game_status_${gameKey}` }],
        [{ text: "📦 Ürünleri Yönet", callback_data: `admin_game_products_${gameKey}` }],
        [{ text: "➕ Bu Oyuna Ürün Ekle", callback_data: `admin_add_gprod_${gameKey}` }],
        [
            { text: "⬆️ Yukarı", callback_data: `admin_game_up_${gameKey}` },
            { text: "⬇️ Aşağı", callback_data: `admin_game_down_${gameKey}` }
        ],
        [{ text: "🗑 Oyunu Sil", callback_data: `admin_delete_game_${gameKey}` }],
        [{ text: "🔙 Geri", callback_data: "admin_games" }]
    ];
    
    const opts = {
        parse_mode: "HTML",
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

// Oyuna ait ürünler
function showAdminGameProducts(chatId, gameKey, messageId = null) {
    const data = loadProducts();
    const games = data.games || {};
    const products = data.products || {};
    
    const game = games[gameKey];
    if (!game) return showAdminGames(chatId, messageId);
    
    // Bu oyuna ait ürünleri filtrele ve sırala
    const gameProducts = Object.entries(products)
        .filter(([_, prod]) => prod.game === gameKey)
        .sort((a, b) => (a[1].order || 99) - (b[1].order || 99));
    
    let text = `📦 <b>${game.name} Ürünleri</b>\n\n`;
    text += `🟢 Aktif  🔵 Bakımda\n\n`;
    
    const buttons = [];
    for (const [prodKey, prod] of gameProducts) {
        const statusIcon = prod.maintenance ? '🔵' : '🟢';
        const platform = prod.subcategory === 'android' ? '🤖' : prod.subcategory === 'ios' ? '🍎' : '💻';
        buttons.push([{ 
            text: `${statusIcon} ${prod.icon || ''} ${prod.name} ${platform}`, 
            callback_data: `admin_edit_gprod_${prodKey}` 
        }]);
    }
    
    buttons.push([{ text: "🔙 Geri", callback_data: `admin_edit_game_${gameKey}` }]);
    
    const opts = {
        parse_mode: "HTML",
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

// Oyun sırasını değiştir
function moveGame(chatId, gameKey, direction, messageId) {
    const data = loadProducts();
    const games = data.games || {};
    
    const sortedGames = Object.entries(games).sort((a, b) => (a[1].order || 99) - (b[1].order || 99));
    const currentIndex = sortedGames.findIndex(([key]) => key === gameKey);
    
    if (currentIndex === -1) return;
    
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= sortedGames.length) return;
    
    // Sıraları değiştir
    const currentOrder = sortedGames[currentIndex][1].order || currentIndex;
    const targetOrder = sortedGames[newIndex][1].order || newIndex;
    
    games[sortedGames[currentIndex][0]].order = targetOrder;
    games[sortedGames[newIndex][0]].order = currentOrder;
    
    saveProducts(data);
    return showAdminGames(chatId, messageId);
}

// Ürün sırasını değiştir
function moveProduct(chatId, prodKey, direction, messageId) {
    const data = loadProducts();
    const products = data.products || {};
    const product = products[prodKey];
    
    if (!product) return;
    
    const gameKey = product.game;
    const gameProducts = Object.entries(products)
        .filter(([_, p]) => p.game === gameKey)
        .sort((a, b) => (a[1].order || 99) - (b[1].order || 99));
    
    const currentIndex = gameProducts.findIndex(([key]) => key === prodKey);
    if (currentIndex === -1) return;
    
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= gameProducts.length) return;
    
    // Sıraları değiştir
    const currentOrder = gameProducts[currentIndex][1].order || currentIndex;
    const targetOrder = gameProducts[newIndex][1].order || newIndex;
    
    products[gameProducts[currentIndex][0]].order = targetOrder;
    products[gameProducts[newIndex][0]].order = currentOrder;
    
    saveProducts(data);
    return showAdminGameProducts(chatId, gameKey, messageId);
}

// Ürün düzenleme sayfası
function showAdminProductEdit(chatId, prodKey, messageId = null) {
    const data = loadProducts();
    const product = data.products?.[prodKey];
    
    if (!product) return showAdminGames(chatId, messageId);
    
    const game = data.games?.[product.game] || {};
    const statusIcon = product.maintenance ? '🔵 Bakımda' : '🟢 Aktif';
    const statusText = product.maintenance ? 'Aktif Yap' : 'Bakıma Al';
    
    // Platform ismini belirle
    let platformName;
    switch (product.subcategory) {
        case 'android': platformName = '🤖 Android'; break;
        case 'ios': platformName = '🍎 iOS'; break;
        case 'windows': platformName = '🪟 Windows'; break;
        case 'emulator': platformName = '🎮 Emülatör'; break;
        default: platformName = product.subcategory || 'Bilinmiyor';
    }
    
    // Fiyatlar ve stoklar
    const prices = Object.entries(product.prices || {}).map(([d, p]) => `${d} gün: ${p}₺`).join('\n');
    const stocks = Object.entries(product.stock || {}).map(([d, s]) => `${d} gün: ${s.length} adet`).join('\n');
    
    // Açıklama
    let description = product.description || 'Açıklama yok';
    try {
        const descFile = path.join(__dirname, 'descriptions', `${product.name}.txt`);
        if (fs.existsSync(descFile)) {
            description = fs.readFileSync(descFile, 'utf-8').trim().substring(0, 100) + '...';
        }
    } catch (e) {}
    
    let text = `📦 <b>Ürün Düzenle</b>\n\n`;
    text += `📛 <b>Ad:</b> ${product.name}\n`;
    text += `🎨 <b>İkon:</b> ${product.icon || '📦'}\n`;
    text += `📊 <b>Durum:</b> ${statusIcon}\n`;
    text += `🎮 <b>Oyun:</b> ${game.name || 'Bilinmiyor'}\n`;
    text += `📱 <b>Platform:</b> ${platformName}\n`;
    text += `🔢 <b>Sıra:</b> ${product.order || 0}\n\n`;
    text += `💰 <b>Fiyatlar:</b>\n${prices || 'Fiyat yok'}\n\n`;
    text += `📦 <b>Stok:</b>\n${stocks || 'Stok yok'}\n\n`;
    text += `📝 <b>Açıklama:</b> ${description}`;
    
    const buttons = [
        [{ text: `📊 ${statusText}`, callback_data: `admin_prod_maint_${prodKey}` }],
        [{ text: "📛 Ad Değiştir", callback_data: `admin_prod_name_${prodKey}` }],
        [{ text: "💰 Fiyat Düzenle", callback_data: `admin_prod_price_${prodKey}` }],
        [{ text: "📝 Açıklama Düzenle", callback_data: `admin_prod_desc_${prodKey}` }],
        [{ text: "📦 Stok Yönet", callback_data: `admin_prod_stock_${prodKey}` }],
        [{ text: "🎨 İkon Değiştir", callback_data: `admin_prod_icon_${prodKey}` }],
        [{ text: "🎮 Oyun Değiştir", callback_data: `admin_prod_game_${prodKey}` }],
        [{ text: "📱 Platform Değiştir", callback_data: `admin_prod_platform_${prodKey}` }],
        [
            { text: "⬆️ Yukarı", callback_data: `admin_prod_up_${prodKey}` },
            { text: "⬇️ Aşağı", callback_data: `admin_prod_down_${prodKey}` }
        ],
        [{ text: "🗑 Ürünü Sil", callback_data: `admin_prod_delete_${prodKey}` }],
        [{ text: "🔙 Geri", callback_data: `admin_game_products_${product.game}` }]
    ];
    
    const opts = {
        parse_mode: "HTML",
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

// Stok yönetim menüsü
function showAdminStockMenu(chatId, prodKey, messageId = null) {
    const data = loadProducts();
    const product = data.products?.[prodKey];
    const durations = data.settings?.durations || [];
    
    if (!product) return showAdminGames(chatId, messageId);
    
    let text = `📦 <b>Stok Yönetimi</b>\n\n`;
    text += `📦 <b>Ürün:</b> ${product.name}\n\n`;
    text += `📊 <b>Mevcut Stoklar:</b>\n`;
    
    for (const dur of durations) {
        const stockCount = (product.stock?.[dur.days] || []).length;
        text += `⏱ ${dur.label}: ${stockCount} adet\n`;
    }
    
    const buttons = [];
    for (const dur of durations) {
        const stockCount = (product.stock?.[dur.days] || []).length;
        buttons.push([
            { text: `➕ ${dur.label} Ekle`, callback_data: `admin_stock_add_${prodKey}_${dur.days}` },
            { text: `📋 Listele (${stockCount})`, callback_data: `admin_stock_list_${prodKey}_${dur.days}` }
        ]);
    }
    
    buttons.push([{ text: "🔙 Geri", callback_data: `admin_edit_gprod_${prodKey}` }]);
    
    const opts = {
        parse_mode: "HTML",
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

// ============== CALLBACK QUERY HANDLER ==============
bot.on("callback_query", (query) => {
    const chatId = query.from.id;
    const messageId = query.message?.message_id;
    const data = query.data;
    
    bot.answerCallbackQuery(query.id).catch(() => {});
    
    // === KULLANICI MENÜ NAVİGASYONU ===
    // Menü navigasyonu için session kontrolü kaldırıldı - herkes menülere erişebilir
    // Session sadece ödeme işlemleri için gerekli
    
    // Ana menüye dön
    if (data === "back_main" || data === "main_menu") {
        userState[chatId] = null;
        return showMainMenu(chatId, messageId);
    }
    
    // Platform seçim menüsü (Mobile Mod'dan sonra)
    if (data === "games_menu") {
        return showPlatformMenu(chatId, messageId);
    }
    
    // PC Platform seçim menüsü
    if (data === "pc_games_menu") {
        return showPCPlatformMenu(chatId, messageId);
    }
    
    // Platform seçildi - oyunları göster (Mobil)
    if (data === "platform_android") {
        return showGamesMenu(chatId, 'android', messageId);
    }
    
    if (data === "platform_ios") {
        return showGamesMenu(chatId, 'ios', messageId);
    }
    
    // Platform seçildi - oyunları göster (PC)
    if (data === "platform_windows") {
        return showGamesMenu(chatId, 'windows', messageId);
    }
    
    // Oyun seçildi - ürünleri göster (platform bilgisi ile)
    if (data.startsWith("game_")) {
        const parts = data.substring(5).split("_");
        const platform = parts[0]; // android, ios, windows veya emulator
        const gameKey = parts.slice(1).join("_"); // oyun key'i
        return showGameProducts(chatId, gameKey, platform, messageId);
    }
    
    // Bakımdaki ürüne tıklandı
    if (data.startsWith("maintenance_")) {
        return bot.answerCallbackQuery(query.id, { text: "🔵 Bu ürün şu anda bakımdadır. Lütfen daha sonra tekrar deneyin.", show_alert: true });
    }
    
    // Oyun ürünü seçildi (platform bilgisi ile)
    if (data.startsWith("gprod_")) {
        const parts = data.substring(6).split("_");
        const platform = parts[0]; // android veya ios
        const prodKey = parts.slice(1).join("_"); // ürün key'i
        userState[chatId] = { ...userState[chatId], platform };
        return showGameProductDetails(chatId, prodKey, messageId);
    }
    
    // Oyun ürünü satın al - süre seçildi
    if (data.startsWith("gbuy_")) {
        const parts = data.substring(5).split("_");
        const days = parseInt(parts.pop()); // Son eleman süre
        const prodKey = parts.join("_"); // Geri kalanı ürün key'i
        return showPaymentMethods(chatId, prodKey, days, messageId);
    }
    
    // Stok yok uyarısı
    if (data.startsWith("nostock_")) {
        return bot.answerCallbackQuery(query.id, { text: "❌ Bu süre için stok bulunmuyor!", show_alert: true });
    }
    
    // Sadakat Sistemi Bilgi Sayfası
    if (data === "loyalty_info") {
        const text = `⭐ **Sadakat Puanı Sistemi**

🎁 **Nasıl Çalışır?**
Her alışverişinizde ödediğiniz tutarın **%4'ü** kadar puan kazanırsınız!

💰 **1 Puan = 1₺**
Kazandığınız her puan 1 TL değerindedir.

♾️ **Limit Yok!**
Puanlarınız sürekli birikir, herhangi bir limit yoktur. İstediğiniz zaman kullanabilirsiniz.

🆓 **Bedava Mod Alın!**
Biriken puanlarınız mod fiyatına ulaştığında, modu tamamen **bedava** alabilirsiniz Veya Puanınız Kadar Fiyattan İndirim Alabilirsiniz!

📊 **Puanlarınızı Görün**
/puan yazarak mevcut puan bakiyenizi ve alışveriş istatistiklerinizi görebilirsiniz.

━━━━━━━━━━━━━━━━━━━━
💡 _Örnek: 1000₺'lik alışverişte 40 puan kazanırsınız. 10 alışveriş sonra 400 puanınız olur ve 400₺ indirim yapabilirsiniz! İsterseniz 30 puanınız var 500 tl lık urun aldıgınızda puanı kullanıp 470 tl odeyerek alabılırsınız her alısverıste bu puan ustune eklenerek bırıkır kullandıgınızda sıfırlanır_`;
        
        return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔙 Ana Menü", callback_data: "main_menu" }]
                ]
            }
        }).catch(() => bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "🔙 Ana Menü", callback_data: "main_menu" }]] }}));
    }
    
    // Politikalarımız ve Kurallarımız Sayfası
    if (data === "policies_rules") {
        const text = `📜 <b>POLİTİKALARIMIZ VE KURALLARIMIZ</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>1.</b> Sistemimiz Mod ve Yardımcı Eklenti için kurulmuştur.

<b>2.</b> Aldığınız anahtar üretildikten sonra <b>değişim ve para iadesi söz konusu değildir.</b>

<b>3.</b> Hesap yasağı durumunda <b>değişim veya iade söz konusu değildir.</b>

<b>4.</b> Mod bakım zamanlarında güncelleme süresince geçen süreniz anahtarınıza eklenir.

<b>5.</b> Lisans anahtarı ve dosya paylaşımı <b>kesinlikle yasaktır!</b> Satın alan kişi yalnızca kendi kullanabilir. İkinci şahıslara dosya veya lisans anahtarı paylaşmak yasaktır.

<b>6.</b> Tüm modlar tek 1 cihaz için satın alınır ve kullanılır. Başka cihazda üyelik süreniz devam etse bile kullanılamamaktadır.

<b>7.</b> Tüm modların bilgi sayfalarında hangi işletim sisteminde çalıştığı yazmaktadır. Sistem uyumluluğunu kontrol etmek kullanıcıya aittir.

<b>8.</b> Android rootlu veya rootsuz mod alırken lütfen dikkat ediniz. Cihazınızın gerekli gereksinimleri karşıladığından emin olunuz. Sorumluluk size aittir.

<b>9.</b> Oyunlarda yasaklı ve riskli ürün aldığınızın farkında olarak alışveriş yapın. Tüm sorumluluk alan kişiye aittir.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️⚠️⚠️ <b>ÖNEMLİ</b> ⚠️⚠️⚠️

🔴 <b>10. SATIN ALIM YAPAN KİŞİ BÜTÜN BU MADDELERİ KABUL ETMİŞ VE ONAYLAMIŞ SAYILIR!</b> 🔴

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        
        return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔙 Ana Menü", callback_data: "main_menu" }]
                ]
            }
        }).catch(() => bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "🔙 Ana Menü", callback_data: "main_menu" }]] }}));
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
    
    // Sadakat puanı kullanma
    if (data.startsWith("use_points_")) {
        const parts = data.substring(11).split("_");
        const days = parseInt(parts.pop());
        const productKey = parts.join("_");
        
        const productsData = loadProducts();
        const product = productsData.products[productKey];
        if (!product) return showMainMenu(chatId, messageId);
        
        const price = product.prices?.[days] || 0;
        const customerPoints = getCustomerPoints(chatId.toString());
        const maxUsablePoints = Math.min(customerPoints, price);
        const newPrice = price - maxUsablePoints;
        const symbol = productsData.settings?.currency_symbol || "₺";
        
        const text = `⭐ <b>Sadakat Puanı Kullanımı</b>

📦 <b>Ürün:</b> ${product.name}
⏱ <b>Süre:</b> ${days} Gün

━━━━━━━━━━━━━━━━━━━━

💰 <b>Orijinal Fiyat:</b> ${price}${symbol}
⭐ <b>Kullanılacak Puan:</b> ${maxUsablePoints} puan
🎁 <b>İndirim:</b> -${maxUsablePoints}${symbol}

━━━━━━━━━━━━━━━━━━━━

✨ <b>Ödenecek Tutar:</b> <code>${newPrice}${symbol}</code>

━━━━━━━━━━━━━━━━━━━━

<b>${maxUsablePoints} puanınızı kullanarak ${maxUsablePoints}${symbol} indirim almak istiyor musunuz?</b>`;
        
        return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ Evet, Puanımı Kullan", callback_data: `confirm_points_${productKey}_${days}` }],
                    [{ text: "❌ Hayır, Normal Fiyat", callback_data: `buy_${productKey}_${days}` }],
                    [{ text: "🔙 Geri", callback_data: `prod_${productKey}` }]
                ]
            }
        });
    }
    
    // Puan kullanımını onayla
    if (data.startsWith("confirm_points_")) {
        const parts = data.substring(15).split("_");
        const days = parseInt(parts.pop());
        const productKey = parts.join("_");
        
        const productsData = loadProducts();
        const product = productsData.products[productKey];
        if (!product) return showMainMenu(chatId, messageId);
        
        const price = product.prices?.[days] || 0;
        const customerPoints = getCustomerPoints(chatId.toString());
        const usedPoints = Math.min(customerPoints, price);
        const newPrice = price - usedPoints;
        const symbol = productsData.settings?.currency_symbol || "₺";
        
        // Kullanıcı state'i güncelle
        userState[chatId] = {
            productKey,
            productName: product.name,
            days,
            price: newPrice,
            originalPrice: price,
            usedPoints: usedPoints,
            step: 'payment_selection'
        };
        
        let text = `💳 <b>Ödeme Yöntemi Seçin</b>

📦 <b>Ürün:</b> ${product.name}
⏱ <b>Süre:</b> ${days} Gün

━━━━━━━━━━━━━━━━━━━━
⭐ <b>Kullanılan Puan:</b> ${usedPoints} puan
🎁 <b>Puan İndirimi:</b> -${usedPoints}${symbol}
━━━━━━━━━━━━━━━━━━━━

💰 <b>Ödenecek Tutar:</b> <code>${newPrice}${symbol}</code>
<s>Orijinal: ${price}${symbol}</s>`;
        
        if (newPrice === 0) {
            text += `\n\n🎉 <b>Tüm tutarı puanlarınızla karşılıyorsunuz!</b>\n<i>Onay için admin'e bildirim gönderilecek.</i>`;
        }
        
        text += `\n\nÖdeme yöntemi seçin:`;
        
        const buttons = [
            [{ text: "💸 IBAN ile Öde", callback_data: "pay_iban" }],
            [{ text: "🏦 Papara ile Öde", callback_data: "pay_papara" }],
            [{ text: "💰 Binance (USDT) ile Öde", callback_data: "pay_binance" }],
            [{ text: "🔙 Geri", callback_data: `prod_${productKey}` }]
        ];
        
        return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buttons }
        });
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
    
    // ============== OYUN YÖNETİMİ ==============
    if (data === "admin_games") {
        if (chatId !== ADMIN_ID) return;
        return showAdminGames(chatId, messageId);
    }
    
    // Yeni oyun ekle
    if (data === "admin_add_game") {
        if (chatId !== ADMIN_ID) return;
        adminState[chatId] = { action: 'add_game' };
        return bot.sendMessage(chatId, `🎮 <b>Yeni Oyun Ekle</b>\n\nOyun adını yazın:`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🔙 İptal", callback_data: "admin_games" }]] }
        });
    }
    
    // Oyun düzenle
    if (data.startsWith("admin_edit_game_")) {
        if (chatId !== ADMIN_ID) return;
        const gameKey = data.substring(16);
        return showAdminGameEdit(chatId, gameKey, messageId);
    }
    
    // Oyun sil
    if (data.startsWith("admin_delete_game_")) {
        if (chatId !== ADMIN_ID) return;
        const gameKey = data.substring(18);
        const prodData = loadProducts();
        
        if (prodData.games && prodData.games[gameKey]) {
            delete prodData.games[gameKey];
            saveProducts(prodData);
            addLog('admin_action', `🎮 Oyun silindi: ${gameKey}`);
            return bot.answerCallbackQuery(query.id, { text: "✅ Oyun silindi!" }).then(() => showAdminGames(chatId, messageId));
        }
        return;
    }
    
    // Oyun yukarı taşı
    if (data.startsWith("admin_game_up_")) {
        if (chatId !== ADMIN_ID) return;
        const gameKey = data.substring(14);
        return moveGame(chatId, gameKey, 'up', messageId);
    }
    
    // Oyun aşağı taşı
    if (data.startsWith("admin_game_down_")) {
        if (chatId !== ADMIN_ID) return;
        const gameKey = data.substring(16);
        return moveGame(chatId, gameKey, 'down', messageId);
    }
    
    // Oyun bakım durumu değiştir
    if (data.startsWith("admin_game_status_")) {
        if (chatId !== ADMIN_ID) return;
        const gameKey = data.substring(18);
        const prodData = loadProducts();
        
        if (prodData.games && prodData.games[gameKey]) {
            prodData.games[gameKey].status = prodData.games[gameKey].status === 'active' ? 'maintenance' : 'active';
            saveProducts(prodData);
            const statusText = prodData.games[gameKey].status === 'active' ? 'Aktif' : 'Bakımda';
            addLog('admin_action', `🎮 Oyun durumu değişti: ${gameKey} -> ${statusText}`);
            return bot.answerCallbackQuery(query.id, { text: `✅ Oyun durumu: ${statusText}` }).then(() => showAdminGameEdit(chatId, gameKey, messageId));
        }
        return;
    }
    
    // Oyun ikonu değiştir
    if (data.startsWith("admin_game_icon_")) {
        if (chatId !== ADMIN_ID) return;
        const gameKey = data.substring(16);
        adminState[chatId] = { action: 'edit_game_icon', gameKey };
        return bot.sendMessage(chatId, `🎮 <b>Oyun İkonu Değiştir</b>\n\nYeni ikonu yazın (emoji):`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🔙 İptal", callback_data: `admin_edit_game_${gameKey}` }]] }
        });
    }
    
    // Oyun adı değiştir
    if (data.startsWith("admin_game_name_")) {
        if (chatId !== ADMIN_ID) return;
        const gameKey = data.substring(16);
        adminState[chatId] = { action: 'edit_game_name', gameKey };
        return bot.sendMessage(chatId, `🎮 <b>Oyun Adı Değiştir</b>\n\nYeni adı yazın:`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🔙 İptal", callback_data: `admin_edit_game_${gameKey}` }]] }
        });
    }
    
    // Oyuna ürün ekle menüsü
    if (data.startsWith("admin_game_products_")) {
        if (chatId !== ADMIN_ID) return;
        const gameKey = data.substring(20);
        return showAdminGameProducts(chatId, gameKey, messageId);
    }
    
    // Ürün bakım durumu değiştir
    if (data.startsWith("admin_prod_maint_")) {
        if (chatId !== ADMIN_ID) return;
        const prodKey = data.substring(17);
        const prodData = loadProducts();
        
        if (prodData.products && prodData.products[prodKey]) {
            prodData.products[prodKey].maintenance = !prodData.products[prodKey].maintenance;
            saveProducts(prodData);
            const statusText = prodData.products[prodKey].maintenance ? 'Bakımda' : 'Aktif';
            addLog('admin_action', `📦 Ürün durumu değişti: ${prodData.products[prodKey].name} -> ${statusText}`);
            return bot.answerCallbackQuery(query.id, { text: `✅ Ürün durumu: ${statusText}` }).then(() => showAdminGameProducts(chatId, prodData.products[prodKey].game, messageId));
        }
        return;
    }
    
    // Ürün yukarı taşı
    if (data.startsWith("admin_prod_up_")) {
        if (chatId !== ADMIN_ID) return;
        const prodKey = data.substring(14);
        return moveProduct(chatId, prodKey, 'up', messageId);
    }
    
    // Ürün aşağı taşı  
    if (data.startsWith("admin_prod_down_")) {
        if (chatId !== ADMIN_ID) return;
        const prodKey = data.substring(16);
        return moveProduct(chatId, prodKey, 'down', messageId);
    }
    
    // Ürün fiyat düzenle
    if (data.startsWith("admin_prod_price_")) {
        if (chatId !== ADMIN_ID) return;
        const prodKey = data.substring(17);
        adminState[chatId] = { action: 'edit_prod_price', prodKey };
        const prodData = loadProducts();
        const product = prodData.products[prodKey];
        const currentPrices = Object.entries(product.prices || {}).map(([d, p]) => `${d} gün: ${p}₺`).join(', ');
        return bot.sendMessage(chatId, `💰 <b>Fiyat Düzenle</b>\n\n📦 Ürün: ${product.name}\n💰 Mevcut: ${currentPrices}\n\nYeni fiyatları yazın:\n<code>7:400,30:750,60:1200</code>`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🔙 İptal", callback_data: `admin_game_products_${product.game}` }]] }
        });
    }
    
    // Ürün ikon düzenle
    if (data.startsWith("admin_prod_icon_")) {
        if (chatId !== ADMIN_ID) return;
        const prodKey = data.substring(16);
        adminState[chatId] = { action: 'edit_prod_icon', prodKey };
        return bot.sendMessage(chatId, `🎨 <b>Ürün İkonu Değiştir</b>\n\nYeni ikonu yazın (emoji):`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🔙 İptal", callback_data: `admin_edit_gprod_${prodKey}` }]] }
        });
    }
    
    // Ürün adı düzenle
    if (data.startsWith("admin_prod_name_")) {
        if (chatId !== ADMIN_ID) return;
        const prodKey = data.substring(16);
        const prodData = loadProducts();
        const product = prodData.products[prodKey];
        adminState[chatId] = { action: 'edit_prod_name', prodKey };
        return bot.sendMessage(chatId, `📛 <b>Ürün Adı Değiştir</b>\n\nMevcut: ${product.name}\n\nYeni adı yazın:`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🔙 İptal", callback_data: `admin_edit_gprod_${prodKey}` }]] }
        });
    }
    
    // Ürün açıklama düzenle
    if (data.startsWith("admin_prod_desc_")) {
        if (chatId !== ADMIN_ID) return;
        const prodKey = data.substring(16);
        const prodData = loadProducts();
        const product = prodData.products[prodKey];
        
        let currentDesc = product.description || '';
        try {
            const descFile = path.join(__dirname, 'descriptions', `${product.name}.txt`);
            if (fs.existsSync(descFile)) {
                currentDesc = fs.readFileSync(descFile, 'utf-8').trim();
            }
        } catch (e) {}
        
        adminState[chatId] = { action: 'edit_prod_desc', prodKey, productName: product.name };
        return bot.sendMessage(chatId, `📝 <b>Ürün Açıklaması Düzenle</b>\n\n📦 Ürün: ${product.name}\n\n📝 Mevcut:\n${currentDesc || 'Açıklama yok'}\n\n✏️ Yeni açıklamayı yazın:`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🔙 İptal", callback_data: `admin_edit_gprod_${prodKey}` }]] }
        });
    }
    
    // Ürün stok yönetimi
    if (data.startsWith("admin_prod_stock_")) {
        if (chatId !== ADMIN_ID) return;
        const prodKey = data.substring(17);
        return showAdminStockMenu(chatId, prodKey, messageId);
    }
    
    // Stok ekle
    if (data.startsWith("admin_stock_add_")) {
        if (chatId !== ADMIN_ID) return;
        const parts = data.substring(16).split("_");
        const prodKey = parts[0];
        const days = parts[1];
        const prodData = loadProducts();
        const product = prodData.products[prodKey];
        adminState[chatId] = { action: 'add_stock', prodKey, days };
        return bot.sendMessage(chatId, `📦 <b>Stok Ekle</b>\n\n📦 Ürün: ${product.name}\n⏱ Süre: ${days} gün\n\nEklemek istediğiniz stok kodlarını yazın (her satıra bir kod):`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🔙 İptal", callback_data: `admin_prod_stock_${prodKey}` }]] }
        });
    }
    
    // Stokları listele
    if (data.startsWith("admin_stock_list_")) {
        if (chatId !== ADMIN_ID) return;
        const parts = data.substring(17).split("_");
        const prodKey = parts[0];
        const days = parts[1];
        const prodData = loadProducts();
        const product = prodData.products[prodKey];
        const stocks = product.stock?.[days] || [];
        
        if (stocks.length === 0) {
            return bot.sendMessage(chatId, `📦 <b>${product.name}</b> - ${days} gün\n\n❌ Bu süre için stok yok.`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: "🔙 Geri", callback_data: `admin_prod_stock_${prodKey}` }]] }
            });
        }
        
        let text = `📦 <b>${product.name}</b> - ${days} gün\n\n📋 Stoklar (${stocks.length} adet):\n\n`;
        stocks.forEach((s, i) => {
            text += `${i + 1}. <code>${s}</code>\n`;
        });
        
        return bot.sendMessage(chatId, text, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [
                [{ text: "🗑 Tümünü Sil", callback_data: `admin_stock_clear_${prodKey}_${days}` }],
                [{ text: "🔙 Geri", callback_data: `admin_prod_stock_${prodKey}` }]
            ]}
        });
    }
    
    // Stokları temizle
    if (data.startsWith("admin_stock_clear_")) {
        if (chatId !== ADMIN_ID) return;
        const parts = data.substring(18).split("_");
        const prodKey = parts[0];
        const days = parts[1];
        const prodData = loadProducts();
        
        if (prodData.products[prodKey]) {
            prodData.products[prodKey].stock[days] = [];
            saveProducts(prodData);
            addLog('admin_action', `📦 Stok temizlendi: ${prodData.products[prodKey].name} - ${days} gün`);
        }
        
        return bot.answerCallbackQuery(query.id, { text: "✅ Stoklar temizlendi!" }).then(() => showAdminStockMenu(chatId, prodKey, messageId));
    }
    
    // Ürün oyun değiştir
    if (data.startsWith("admin_prod_game_")) {
        if (chatId !== ADMIN_ID) return;
        const prodKey = data.substring(16);
        const prodData = loadProducts();
        const games = prodData.games || {};
        
        const buttons = Object.entries(games)
            .sort((a, b) => (a[1].order || 99) - (b[1].order || 99))
            .map(([gameKey, game]) => [{
                text: `${game.icon || '🎮'} ${game.name}`,
                callback_data: `admin_set_prod_game_${prodKey}_${gameKey}`
            }]);
        buttons.push([{ text: "🔙 İptal", callback_data: `admin_edit_gprod_${prodKey}` }]);
        
        return bot.sendMessage(chatId, `🎮 <b>Oyun Seç</b>\n\nBu ürünün ait olacağı oyunu seçin:`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buttons }
        });
    }
    
    // Ürün oyun ata
    if (data.startsWith("admin_set_prod_game_")) {
        if (chatId !== ADMIN_ID) return;
        const parts = data.substring(20).split("_");
        const prodKey = parts[0];
        const gameKey = parts.slice(1).join("_");
        const prodData = loadProducts();
        
        if (prodData.products[prodKey]) {
            prodData.products[prodKey].game = gameKey;
            saveProducts(prodData);
            addLog('admin_action', `🎮 Ürün oyunu değişti: ${prodKey} -> ${gameKey}`);
        }
        
        return bot.answerCallbackQuery(query.id, { text: "✅ Oyun değiştirildi!" }).then(() => showAdminProductEdit(chatId, prodKey, messageId));
    }
    
    // Ürün platform değiştir
    if (data.startsWith("admin_prod_platform_")) {
        if (chatId !== ADMIN_ID) return;
        const prodKey = data.substring(20);
        
        const buttons = [
            [{ text: "🤖 Android", callback_data: `admin_set_prod_plat_${prodKey}_android` }],
            [{ text: "🍎 iOS", callback_data: `admin_set_prod_plat_${prodKey}_ios` }],
            [{ text: "🪟 Windows", callback_data: `admin_set_prod_plat_${prodKey}_windows` }],
            [{ text: "🎮 Emülatör", callback_data: `admin_set_prod_plat_${prodKey}_emulator` }],
            [{ text: "🔙 İptal", callback_data: `admin_edit_gprod_${prodKey}` }]
        ];
        
        return bot.sendMessage(chatId, `📱 <b>Platform Seç</b>\n\nBu ürünün platformunu seçin:`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buttons }
        });
    }
    
    // Ürün platform ata
    if (data.startsWith("admin_set_prod_plat_")) {
        if (chatId !== ADMIN_ID) return;
        const parts = data.substring(20).split("_");
        const prodKey = parts[0];
        const platform = parts[1];
        const prodData = loadProducts();
        
        if (prodData.products[prodKey]) {
            prodData.products[prodKey].subcategory = platform;
            // Category'yi de güncelle
            prodData.products[prodKey].category = (platform === 'windows' || platform === 'emulator') ? 'pc' : 'mobile';
            saveProducts(prodData);
            addLog('admin_action', `📱 Ürün platformu değişti: ${prodKey} -> ${platform}`);
        }
        
        return bot.answerCallbackQuery(query.id, { text: "✅ Platform değiştirildi!" }).then(() => showAdminProductEdit(chatId, prodKey, messageId));
    }
    
    // Ürün sil
    if (data.startsWith("admin_prod_delete_")) {
        if (chatId !== ADMIN_ID) return;
        const prodKey = data.substring(18);
        const prodData = loadProducts();
        const product = prodData.products[prodKey];
        
        if (!product) return;
        
        return bot.sendMessage(chatId, `🗑 <b>Ürün Sil</b>\n\n⚠️ <b>${product.name}</b> ürününü silmek istediğinize emin misiniz?\n\nBu işlem geri alınamaz!`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Evet, Sil", callback_data: `admin_confirm_del_prod_${prodKey}` }],
                [{ text: "❌ Hayır, İptal", callback_data: `admin_edit_gprod_${prodKey}` }]
            ]}
        });
    }
    
    // Ürün silme onay
    if (data.startsWith("admin_confirm_del_prod_")) {
        if (chatId !== ADMIN_ID) return;
        const prodKey = data.substring(23);
        const prodData = loadProducts();
        const product = prodData.products[prodKey];
        const gameKey = product?.game;
        
        if (product) {
            delete prodData.products[prodKey];
            saveProducts(prodData);
            addLog('admin_action', `🗑 Ürün silindi: ${product.name}`);
        }
        
        return bot.answerCallbackQuery(query.id, { text: "✅ Ürün silindi!" }).then(() => {
            if (gameKey) {
                showAdminGameProducts(chatId, gameKey, messageId);
            } else {
                showAdminGames(chatId, messageId);
            }
        });
    }
    
    // Oyuna yeni ürün ekle
    if (data.startsWith("admin_add_gprod_")) {
        if (chatId !== ADMIN_ID) return;
        const gameKey = data.substring(16);
        const prodData = loadProducts();
        const game = prodData.games?.[gameKey];
        
        adminState[chatId] = { action: 'add_game_product', gameKey, step: 'name' };
        return bot.sendMessage(chatId, `➕ <b>Yeni Ürün Ekle</b>\n\n🎮 Oyun: ${game?.name || gameKey}\n\n📛 Ürün adını yazın:`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🔙 İptal", callback_data: `admin_edit_game_${gameKey}` }]] }
        });
    }
    
    // Yeni ürün platform seçimi
    if (data.startsWith("admin_new_prod_plat_")) {
        if (chatId !== ADMIN_ID) return;
        const platform = data.substring(20);
        const state = adminState[chatId];
        
        if (state && state.action === 'add_game_product') {
            state.platform = platform;
            state.step = 'prices';
            adminState[chatId] = state;
            
            const prodData = loadProducts();
            const durations = prodData.settings?.durations || [{ days: 7 }, { days: 30 }, { days: 60 }];
            const examplePrices = durations.map(d => `${d.days}:0`).join(',');
            
            return bot.sendMessage(chatId, `➕ <b>Yeni Ürün Ekle</b>\n\n📛 Ad: ${state.productName}\n📱 Platform: ${platform}\n\n💰 Fiyatları yazın:\nFormat: <code>${examplePrices}</code>\n\nÖrnek: <code>7:400,30:750,60:1200</code>`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: "🔙 İptal", callback_data: `admin_edit_game_${state.gameKey}` }]] }
            });
        }
        return;
    }
    
    // Ürün detay düzenleme sayfası
    if (data.startsWith("admin_edit_gprod_")) {
        if (chatId !== ADMIN_ID) return;
        const prodKey = data.substring(17);
        return showAdminProductEdit(chatId, prodKey, messageId);
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
    
    // ========== DUYURU SİSTEMİ ==========
    
    // Duyuru menüsü
    if (data === "admin_announce") {
        const prodData = loadProducts();
        const products = prodData.products || {};
        const productKeys = Object.keys(products);
        
        if (productKeys.length === 0) {
            return bot.sendMessage(chatId, "❌ Henüz ürün bulunmuyor.");
        }
        
        const buttons = productKeys.map(key => [{
            text: `${products[key].icon || '📦'} ${products[key].name}`,
            callback_data: `announce_prod_${key}`
        }]);
        buttons.push([{ text: "📢 TÜM MÜŞTERİLERE", callback_data: "announce_all" }]);
        buttons.push([{ text: "🔙 Geri", callback_data: "admin_back" }]);
        
        return bot.sendMessage(chatId, "📢 <b>Duyuru Gönder</b>\n\nHangi ürünün müşterilerine duyuru göndermek istiyorsunuz?", {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buttons }
        });
    }
    
    // Ürün seçildi - duyuru mesajı iste
    if (data.startsWith("announce_prod_")) {
        const productKey = data.substring(14);
        const prodData = loadProducts();
        const product = prodData.products[productKey];
        
        if (!product) {
            return bot.sendMessage(chatId, "❌ Ürün bulunamadı.");
        }
        
        // Bu ürünü alan kullanıcı sayısını hesapla
        let userCount = 0;
        for (const orderId in activeKeys) {
            const entry = activeKeys[orderId];
            if (entry.products && entry.products.includes(product.name)) {
                userCount++;
            }
        }
        
        adminState[chatId] = { 
            action: 'send_announce', 
            productKey: productKey,
            productName: product.name,
            targetType: 'product'
        };
        
        return bot.sendMessage(chatId, `📢 <b>Duyuru Gönder</b>\n\n📦 Ürün: <b>${product.name}</b>\n👥 Hedef: <b>${userCount}</b> müşteri\n\n✏️ Duyuru mesajınızı yazın:`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: "🔙 İptal", callback_data: "admin_announce" }]]
            }
        });
    }
    
    // Tüm müşterilere duyuru
    if (data === "announce_all") {
        const userCount = Object.keys(activeKeys).length;
        
        adminState[chatId] = { 
            action: 'send_announce', 
            targetType: 'all'
        };
        
        return bot.sendMessage(chatId, `📢 <b>Genel Duyuru</b>\n\n👥 Hedef: <b>${userCount}</b> müşteri (tümü)\n\n✏️ Duyuru mesajınızı yazın:`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: "🔙 İptal", callback_data: "admin_announce" }]]
            }
        });
    }
    
    // ============== SADAKAT SİSTEMİ AYARLARI ==============
    if (data === "admin_loyalty") {
        if (chatId !== ADMIN_ID) return;
        
        const settings = loyaltySettings;
        const status = settings.enabled ? "✅ Aktif" : "❌ Pasif";
        
        const text = `⭐ <b>Sadakat Puanı Sistemi</b>\n\n📊 <b>Durum:</b> ${status}\n🎁 <b>Puan Kazanma Oranı:</b> %${settings.pointRate || 4}\n💰 <b>1 Puan = 1₺</b>\n\n<i>Müşteriler aldıkları tutarın %${settings.pointRate || 4}'ü kadar puan kazanır.\nBiriken puanları sonraki alışverişlerinde TL olarak kullanabilirler.</i>`;
        
        const keyboard = [
            [{ text: `${settings.enabled ? '❌ Pasif Yap' : '✅ Aktif Yap'}`, callback_data: "loyalty_toggle" }],
            [{ text: "📝 Puan Oranı Değiştir", callback_data: "loyalty_set_rate" }],
            [{ text: "🔙 Admin Panel", callback_data: "admin_panel" }]
        ];
        
        return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
        }).catch(() => bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard }}));
    }
    
    // Sadakat sistemi aç/kapat
    if (data === "loyalty_toggle") {
        if (chatId !== ADMIN_ID) return;
        
        loyaltySettings.enabled = !loyaltySettings.enabled;
        saveLoyaltySettings(loyaltySettings);
        addLog('admin_action', `⭐ Sadakat sistemi ${loyaltySettings.enabled ? 'aktif' : 'pasif'} yapıldı`);
        
        // Paneli yeniden göster
        return bot.answerCallbackQuery(query.id, { text: `Sadakat sistemi ${loyaltySettings.enabled ? 'aktif' : 'pasif'} edildi!` }).then(() => {
            const settings = loyaltySettings;
            const status = settings.enabled ? "✅ Aktif" : "❌ Pasif";
            
            const text = `⭐ <b>Sadakat Puanı Sistemi</b>\n\n📊 <b>Durum:</b> ${status}\n🎁 <b>Puan Kazanma Oranı:</b> %${settings.pointRate || 4}\n💰 <b>1 Puan = 1₺</b>`;
            
            const keyboard = [
                [{ text: `${settings.enabled ? '❌ Pasif Yap' : '✅ Aktif Yap'}`, callback_data: "loyalty_toggle" }],
                [{ text: "📝 Puan Oranı Değiştir", callback_data: "loyalty_set_rate" }],
                [{ text: "🔙 Admin Panel", callback_data: "admin_panel" }]
            ];
            
            return bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: keyboard }
            });
        }).catch(() => {});
    }
    
    // Puan oranı değiştir
    if (data === "loyalty_set_rate") {
        if (chatId !== ADMIN_ID) return;
        
        adminState[chatId] = { action: 'set_loyalty_rate' };
        
        return bot.sendMessage(chatId, `📝 <b>Puan Kazanma Oranı Değiştir</b>\n\nMevcut oran: <b>%${loyaltySettings.pointRate || 4}</b>\n\n1-50 arası bir değer girin (örn: 4 = alışverişin %4'ü kadar puan):`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: "🔙 İptal", callback_data: "admin_loyalty" }]]
            }
        });
    }
    
    // ============== MÜŞTERİ LİSTESİ PANELİ ==============
    if (data === "admin_vip") {
        if (chatId !== ADMIN_ID) return;
        
        const vipData = loadVipCustomers();
        const vipList = Object.entries(vipData);
        
        // İstatistikler
        const totalCustomers = vipList.length;
        const goldCount = vipList.filter(([_, v]) => (v.purchases || 0) >= 10).length;
        const silverCount = vipList.filter(([_, v]) => (v.purchases || 0) >= 5 && (v.purchases || 0) < 10).length;
        const bronzeCount = vipList.filter(([_, v]) => (v.purchases || 0) >= 3 && (v.purchases || 0) < 5).length;
        const memberCount = vipList.filter(([_, v]) => (v.purchases || 0) >= 1 && (v.purchases || 0) < 3).length;
        const totalSpent = vipList.reduce((sum, [_, v]) => sum + (v.totalSpent || 0), 0);
        const totalPoints = vipList.reduce((sum, [_, v]) => sum + (v.points || 0), 0);
        
        const text = `👥 <b>Müşteri Listesi</b>\n\n📊 <b>İstatistikler:</b>\n👥 Toplam Müşteri: <b>${totalCustomers}</b>\n🥇 Gold (10+ alım): <b>${goldCount}</b>\n🥈 Silver (5+ alım): <b>${silverCount}</b>\n🥉 Bronze (3+ alım): <b>${bronzeCount}</b>\n⭐ Üye (1+ alım): <b>${memberCount}</b>\n\n💰 Toplam Harcama: <b>${totalSpent.toLocaleString('tr-TR')} TL</b>\n⭐ Toplam Puan: <b>${totalPoints.toLocaleString('tr-TR')}</b>\n\n<i>Puan kazanma oranı: %${loyaltySettings.pointRate || 4} (1 puan = 1₺)</i>`;
        
        const keyboard = [
            [{ text: "🥇 Gold (10+ alım)", callback_data: "vip_list_gold" }],
            [{ text: "🥈 Silver (5+ alım)", callback_data: "vip_list_silver" }],
            [{ text: "🥉 Bronze (3+ alım)", callback_data: "vip_list_bronze" }],
            [{ text: "⭐ Tüm Üyeler", callback_data: "vip_list_all" }],
            [{ text: "🔙 Admin Panel", callback_data: "admin_panel" }]
        ];
        
        return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
        }).catch(() => bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard }}));
    }
    
    // Müşteri listesi görüntüle
    if (data.startsWith("vip_list_")) {
        if (chatId !== ADMIN_ID) return;
        
        const level = data.substring(9);
        const vipData = loadVipCustomers();
        let vipList = Object.entries(vipData);
        
        let title = "⭐ Tüm Üyeler";
        if (level === "gold") {
            vipList = vipList.filter(([_, v]) => (v.purchases || 0) >= 10);
            title = "🥇 Gold Müşteriler";
        } else if (level === "silver") {
            vipList = vipList.filter(([_, v]) => (v.purchases || 0) >= 5 && (v.purchases || 0) < 10);
            title = "🥈 Silver Müşteriler";
        } else if (level === "bronze") {
            vipList = vipList.filter(([_, v]) => (v.purchases || 0) >= 3 && (v.purchases || 0) < 5);
            title = "🥉 Bronze Müşteriler";
        }
        
        // Son alıma göre sırala
        vipList.sort((a, b) => (b[1].lastPurchase || 0) - (a[1].lastPurchase || 0));
        
        if (vipList.length === 0) {
            return bot.editMessageText(`${title}\n\n❌ Bu kategoride müşteri bulunmuyor.`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: "🔙 Müşteri Listesi", callback_data: "admin_vip" }]] }
            });
        }
        
        // İlk 15 müşteriyi göster
        const displayList = vipList.slice(0, 15);
        let text = `<b>${title}</b>\n\n`;
        
        displayList.forEach(([userId, data], i) => {
            const badge = getLoyaltyBadge(data.purchases || 0);
            const spent = (data.totalSpent || 0).toLocaleString('tr-TR');
            const points = (data.points || 0).toLocaleString('tr-TR');
            text += `${i + 1}. <code>${userId}</code> ${badge}\n   📦 ${data.purchases || 0} alım | 💰 ${spent} TL | ⭐ ${points} puan\n\n`;
        });
        
        if (vipList.length > 15) {
            text += `\n<i>...ve ${vipList.length - 15} müşteri daha</i>`;
        }
        
        return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🔙 Müşteri Listesi", callback_data: "admin_vip" }]] }
        });
    }
    
    // ============== İŞLEM LOGLARI PANELİ ==============
    if (data === "admin_logs") {
        if (chatId !== ADMIN_ID) return;
        
        const logs = loadLogs();
        
        // Log türlerini say
        const typeCounts = {};
        logs.forEach(log => {
            typeCounts[log.type] = (typeCounts[log.type] || 0) + 1;
        });
        
        const text = `📋 <b>İşlem Logları</b>\n\n📊 <b>Toplam:</b> ${logs.length} kayıt\n\n<b>Türlere Göre:</b>\n💰 Satış: ${typeCounts.sale || 0}\n🔑 Anahtar Gönderimi: ${typeCounts.key_sent || 0}\n🔄 Yenileme: ${typeCounts.renewal || 0}\n👑 VIP Yükseltme: ${typeCounts.vip_upgrade || 0}\n⚙️ Admin İşlemi: ${typeCounts.admin_action || 0}\n💳 Ödeme: ${typeCounts.payment || 0}`;
        
        const keyboard = [
            [{ text: "📜 Son 20 Log", callback_data: "logs_recent_20" }],
            [{ text: "💰 Satış Logları", callback_data: "logs_type_sale" }],
            [{ text: "🔑 Anahtar Logları", callback_data: "logs_type_key_sent" }],
            [{ text: "⚙️ Admin Logları", callback_data: "logs_type_admin_action" }],
            [{ text: "🔙 Admin Panel", callback_data: "admin_panel" }]
        ];
        
        return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
        }).catch(() => bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard }}));
    }
    
    // Log listesi görüntüle
    if (data.startsWith("logs_recent_") || data.startsWith("logs_type_")) {
        if (chatId !== ADMIN_ID) return;
        
        let logs = loadLogs();
        let title = "📜 Son İşlemler";
        
        if (data.startsWith("logs_recent_")) {
            const count = parseInt(data.substring(12));
            logs = logs.slice(0, count);
            title = `📜 Son ${count} İşlem`;
        } else if (data.startsWith("logs_type_")) {
            const type = data.substring(10);
            logs = logs.filter(l => l.type === type).slice(0, 20);
            const typeNames = { sale: "💰 Satış", key_sent: "🔑 Anahtar", renewal: "🔄 Yenileme", vip_upgrade: "👑 VIP", admin_action: "⚙️ Admin", payment: "💳 Ödeme" };
            title = `${typeNames[type] || type} Logları`;
        }
        
        if (logs.length === 0) {
            return bot.editMessageText(`${title}\n\n❌ Bu kategoride log bulunmuyor.`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: "🔙 Loglar", callback_data: "admin_logs" }]] }
            });
        }
        
        let text = `<b>${title}</b>\n\n`;
        
        logs.forEach((log, i) => {
            const date = new Date(log.timestamp).toLocaleString('tr-TR');
            const typeEmojis = { sale: "💰", key_sent: "🔑", renewal: "🔄", vip_upgrade: "👑", admin_action: "⚙️", payment: "💳" };
            const emoji = typeEmojis[log.type] || "📝";
            text += `${emoji} <code>${date}</code>\n${log.details}\n\n`;
        });
        
        return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🔙 Loglar", callback_data: "admin_logs" }]] }
        });
    }
    
    // Anahtar listele
    if (data === "admin_keys_list") {
        const keys = Object.entries(activeKeys);
        if (keys.length === 0) {
            return bot.sendMessage(chatId, "📋 Aktif anahtar bulunmuyor.", {
                reply_markup: {
                    inline_keyboard: [[{ text: "🔙 Geri", callback_data: "admin_keys" }]]
                }
            });
        }
        
        let text = "📋 <b>Aktif Anahtarlar</b>\n\n";
        const now = new Date();
        
        keys.slice(0, 20).forEach(([orderId, entry], i) => {
            const expiry = new Date(entry.expiresAt);
            const remaining = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
            const status = remaining > 0 ? `⏳ ${remaining} gün` : '❌ Süresi dolmuş';
            text += `${i + 1}. <code>${entry.key}</code>\n   👤 ${entry.userId} | ${status}\n\n`;
        });
        
        if (keys.length > 20) {
            text += `\n... ve ${keys.length - 20} anahtar daha`;
        }
        
        return bot.sendMessage(chatId, text, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: "🔙 Geri", callback_data: "admin_keys" }]]
            }
        });
    }
    
    // Manuel anahtar ekle
    if (data === "admin_keys_add") {
        adminState[chatId] = { action: 'add_manual_key', step: 'key' };
        return bot.sendMessage(chatId, "🔑 <b>Manuel Anahtar Ekleme</b>\n\nAnahtarı yazın (veya otomatik oluşturulsun yazın 'auto'):", {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: "🔙 İptal", callback_data: "admin_keys" }]]
            }
        });
    }
    
    // Manuel anahtar - gün seçimi
    if (data.startsWith("manual_key_days_")) {
        const days = parseInt(data.substring(16));
        const state = adminState[chatId];
        if (state && state.action === 'add_manual_key') {
            state.days = days;
            state.step = 'userId';
            return bot.sendMessage(chatId, `📅 Süre: ${days} gün\n\n👤 Kullanıcı ID yazın (veya boş bırakmak için 'skip' yazın):`, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: "⏭ Atla", callback_data: "manual_key_skip_user" }]]
                }
            });
        }
    }
    
    // Manuel anahtar - kullanıcı atla
    if (data === "manual_key_skip_user") {
        const state = adminState[chatId];
        if (state && state.action === 'add_manual_key') {
            const key = state.key;
            const days = state.days;
            
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + days);
            
            const orderId = 'MANUAL-' + Date.now();
            activeKeys[orderId] = {
                key: key,
                userId: 'MANUAL',
                expiresAt: expiresAt.toISOString(),
                products: [],
                createdAt: new Date().toISOString()
            };
            saveKeys(activeKeys);
            
            bot.sendMessage(chatId, `✅ <b>Anahtar Eklendi!</b>\n\n🔑 Anahtar: <code>${key}</code>\n📅 Süre: ${days} gün`, {
                parse_mode: 'HTML'
            });
            delete adminState[chatId];
            return showAdminKeys(chatId);
        }
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
        
        // Alt kategori butonları
        const subButtons = subKeys.map(sk => [{
            text: `🗑 ${cat.subcategories[sk].icon || '📦'} ${cat.subcategories[sk].name} Sil`,
            callback_data: `admin_del_subcat_${catKey}_${sk}`
        }]);
        
        return bot.sendMessage(chatId, `📁 **${cat.name}**\n\n**Alt Kategoriler (Platformlar):**\n${subList}`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✏️ Adı Değiştir", callback_data: `admin_cat_rename_${catKey}` }],
                    [{ text: "🎨 İkon Değiştir", callback_data: `admin_cat_icon_${catKey}` }],
                    [{ text: "➕ Alt Kategori Ekle", callback_data: `admin_subcat_select_${catKey}` }],
                    ...subButtons,
                    [{ text: "🗑 Kategoriyi Sil", callback_data: `admin_cat_delete_${catKey}` }],
                    [{ text: "🔙 Geri", callback_data: "admin_edit_cat_menu" }]
                ]
            }
        });
    }
    
    // Alt kategori sil
    if (data.startsWith("admin_del_subcat_")) {
        const parts = data.substring(17).split("_");
        const catKey = parts[0];
        const subKey = parts.slice(1).join("_");
        const prodData = loadProducts();
        
        // Bu alt kategorideki ürünleri kontrol et
        const hasProducts = Object.values(prodData.products || {}).some(
            p => p.category === catKey && p.subcategory === subKey
        );
        if (hasProducts) {
            return bot.sendMessage(chatId, "❌ Bu alt kategoride ürün var! Önce ürünleri başka alt kategoriye taşıyın veya silin.", {
                reply_markup: { inline_keyboard: [[{ text: "🔙 Geri", callback_data: `admin_cat_edit_${catKey}` }]] }
            });
        }
        
        if (prodData.categories[catKey]?.subcategories?.[subKey]) {
            delete prodData.categories[catKey].subcategories[subKey];
            saveProducts(prodData);
            bot.sendMessage(chatId, "✅ Alt kategori silindi.");
        }
        return showAdminCategories(chatId);
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

// Eski showAdminProductEdit fonksiyonu kaldırıldı - yeni versiyon satır 1150'de

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
        
        // Yeni oyun ekle
        if (state.action === 'add_game') {
            const gameName = text.trim();
            const gameKey = gameName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            
            const prodData = loadProducts();
            if (!prodData.games) prodData.games = {};
            
            // En yüksek order'ı bul
            const maxOrder = Math.max(0, ...Object.values(prodData.games).map(g => g.order || 0));
            
            prodData.games[gameKey] = {
                name: gameName,
                icon: '🎮',
                order: maxOrder + 1,
                status: 'active'
            };
            saveProducts(prodData);
            addLog('admin_action', `🎮 Yeni oyun eklendi: ${gameName}`);
            
            delete adminState[chatId];
            return bot.sendMessage(chatId, `✅ Oyun eklendi: <b>${gameName}</b>\n\nŞimdi bu oyuna ürün ekleyebilirsiniz.`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: "🔙 Oyunlar", callback_data: "admin_games" }]] }
            });
        }
        
        // Oyun ikonu değiştir
        if (state.action === 'edit_game_icon') {
            const prodData = loadProducts();
            if (prodData.games && prodData.games[state.gameKey]) {
                prodData.games[state.gameKey].icon = text.trim();
                saveProducts(prodData);
                addLog('admin_action', `🎮 Oyun ikonu değişti: ${state.gameKey} -> ${text.trim()}`);
            }
            delete adminState[chatId];
            return bot.sendMessage(chatId, `✅ Oyun ikonu güncellendi!`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: "🔙 Oyuna Dön", callback_data: `admin_edit_game_${state.gameKey}` }]] }
            });
        }
        
        // Oyun adı değiştir
        if (state.action === 'edit_game_name') {
            const prodData = loadProducts();
            if (prodData.games && prodData.games[state.gameKey]) {
                prodData.games[state.gameKey].name = text.trim();
                saveProducts(prodData);
                addLog('admin_action', `🎮 Oyun adı değişti: ${state.gameKey} -> ${text.trim()}`);
            }
            delete adminState[chatId];
            return bot.sendMessage(chatId, `✅ Oyun adı güncellendi!`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: "🔙 Oyuna Dön", callback_data: `admin_edit_game_${state.gameKey}` }]] }
            });
        }
        
        // Ürün fiyatı düzenle
        if (state.action === 'edit_prod_price') {
            // Format: 7:400,30:750,60:1200
            const parts = text.split(',');
            const newPrices = {};
            
            for (const part of parts) {
                const [days, price] = part.split(':').map(s => s.trim());
                if (days && price && !isNaN(parseInt(price))) {
                    newPrices[days] = parseInt(price);
                }
            }
            
            if (Object.keys(newPrices).length === 0) {
                return bot.sendMessage(chatId, "❌ Geçersiz format! Örnek: 7:400,30:750,60:1200");
            }
            
            const prodData = loadProducts();
            if (prodData.products && prodData.products[state.prodKey]) {
                prodData.products[state.prodKey].prices = newPrices;
                saveProducts(prodData);
                addLog('admin_action', `💰 Ürün fiyatı değişti: ${state.prodKey}`);
            }
            
            const gameKey = prodData.products[state.prodKey]?.game;
            delete adminState[chatId];
            return bot.sendMessage(chatId, `✅ Fiyatlar güncellendi!`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: "🔙 Ürüne Dön", callback_data: `admin_edit_gprod_${state.prodKey}` }]] }
            });
        }
        
        // Ürün ikonu değiştir
        if (state.action === 'edit_prod_icon') {
            const prodData = loadProducts();
            if (prodData.products && prodData.products[state.prodKey]) {
                prodData.products[state.prodKey].icon = text.trim();
                saveProducts(prodData);
                addLog('admin_action', `🎨 Ürün ikonu değişti: ${state.prodKey} -> ${text.trim()}`);
            }
            const gameKey = prodData.products[state.prodKey]?.game;
            delete adminState[chatId];
            return bot.sendMessage(chatId, `✅ Ürün ikonu güncellendi!`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: "🔙 Ürüne Dön", callback_data: `admin_edit_gprod_${state.prodKey}` }]] }
            });
        }
        
        // Ürün adı değiştir
        if (state.action === 'edit_prod_name') {
            const prodData = loadProducts();
            const product = prodData.products[state.prodKey];
            const oldName = product?.name;
            
            if (product) {
                product.name = text.trim();
                saveProducts(prodData);
                addLog('admin_action', `📛 Ürün adı değişti: ${oldName} -> ${text.trim()}`);
                
                // Açıklama dosyasını da yeniden adlandır
                try {
                    const oldDescFile = path.join(__dirname, 'descriptions', `${oldName}.txt`);
                    const newDescFile = path.join(__dirname, 'descriptions', `${text.trim()}.txt`);
                    if (fs.existsSync(oldDescFile)) {
                        fs.renameSync(oldDescFile, newDescFile);
                    }
                } catch (e) {}
            }
            
            delete adminState[chatId];
            return bot.sendMessage(chatId, `✅ Ürün adı güncellendi!`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: "🔙 Ürüne Dön", callback_data: `admin_edit_gprod_${state.prodKey}` }]] }
            });
        }
        
        // Ürün açıklaması değiştir
        if (state.action === 'edit_prod_desc') {
            const prodData = loadProducts();
            const product = prodData.products[state.prodKey];
            
            if (product) {
                // Hem product.description'ı hem de dosyayı güncelle
                product.description = text.trim();
                saveProducts(prodData);
                
                // Açıklama dosyasını güncelle
                try {
                    const descDir = path.join(__dirname, 'descriptions');
                    if (!fs.existsSync(descDir)) {
                        fs.mkdirSync(descDir, { recursive: true });
                    }
                    const descFile = path.join(descDir, `${product.name}.txt`);
                    fs.writeFileSync(descFile, text.trim(), 'utf-8');
                } catch (e) {
                    console.error('Açıklama dosyası yazılamadı:', e);
                }
                
                addLog('admin_action', `📝 Ürün açıklaması güncellendi: ${product.name}`);
            }
            
            delete adminState[chatId];
            return bot.sendMessage(chatId, `✅ Ürün açıklaması güncellendi!`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: "🔙 Ürüne Dön", callback_data: `admin_edit_gprod_${state.prodKey}` }]] }
            });
        }
        
        // Stok ekle
        if (state.action === 'add_stock') {
            const prodData = loadProducts();
            const product = prodData.products[state.prodKey];
            
            if (product) {
                // Her satırı ayrı stok olarak ekle
                const newStocks = text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                
                if (!product.stock) product.stock = {};
                if (!product.stock[state.days]) product.stock[state.days] = [];
                
                product.stock[state.days].push(...newStocks);
                saveProducts(prodData);
                addLog('admin_action', `📦 Stok eklendi: ${product.name} - ${state.days} gün - ${newStocks.length} adet`);
            }
            
            delete adminState[chatId];
            return bot.sendMessage(chatId, `✅ ${newStocks.length} adet stok eklendi!`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: "🔙 Stok Menüsü", callback_data: `admin_prod_stock_${state.prodKey}` }]] }
            });
        }
        
        // Oyuna yeni ürün ekle
        if (state.action === 'add_game_product') {
            const prodData = loadProducts();
            
            if (state.step === 'name') {
                state.productName = text.trim();
                state.step = 'platform';
                adminState[chatId] = state;
                
                return bot.sendMessage(chatId, `➕ <b>Yeni Ürün Ekle</b>\n\n📛 Ad: ${state.productName}\n\n📱 Platform seçin:`, {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [
                        [{ text: "🤖 Android", callback_data: `admin_new_prod_plat_android` }],
                        [{ text: "🍎 iOS", callback_data: `admin_new_prod_plat_ios` }],
                        [{ text: "🪟 Windows", callback_data: `admin_new_prod_plat_windows` }],
                        [{ text: "🎮 Emülatör", callback_data: `admin_new_prod_plat_emulator` }],
                        [{ text: "🔙 İptal", callback_data: `admin_edit_game_${state.gameKey}` }]
                    ]}
                });
            }
            
            if (state.step === 'prices') {
                // Format: 7:400,30:750,60:1200
                const parts = text.split(',');
                const prices = {};
                
                for (const part of parts) {
                    const [days, price] = part.split(':').map(s => s.trim());
                    if (days && price && !isNaN(parseInt(price))) {
                        prices[days] = parseInt(price);
                    }
                }
                
                if (Object.keys(prices).length === 0) {
                    return bot.sendMessage(chatId, "❌ Geçersiz format! Örnek: 7:400,30:750,60:1200");
                }
                
                // Ürünü oluştur
                const prodKey = state.productName.toLowerCase()
                    .replace(/[^a-z0-9]/g, '_')
                    .replace(/_+/g, '_')
                    .replace(/^_|_$/g, '');
                
                // En yüksek order'ı bul
                const gameProducts = Object.values(prodData.products || {}).filter(p => p.game === state.gameKey);
                const maxOrder = Math.max(0, ...gameProducts.map(p => p.order || 0));
                
                const category = (state.platform === 'windows' || state.platform === 'emulator') ? 'pc' : 'mobile';
                
                if (!prodData.products) prodData.products = {};
                prodData.products[prodKey] = {
                    name: state.productName,
                    description: '',
                    category: category,
                    subcategory: state.platform,
                    game: state.gameKey,
                    order: maxOrder + 1,
                    prices: prices,
                    stock: {},
                    maintenance: false,
                    icon: '📦'
                };
                
                // Her süre için boş stok dizisi oluştur
                for (const days of Object.keys(prices)) {
                    prodData.products[prodKey].stock[days] = [];
                }
                
                saveProducts(prodData);
                addLog('admin_action', `➕ Yeni ürün eklendi: ${state.productName}`);
                
                delete adminState[chatId];
                return bot.sendMessage(chatId, `✅ Ürün eklendi: <b>${state.productName}</b>\n\n🎮 Oyun: ${prodData.games[state.gameKey]?.name}\n📱 Platform: ${state.platform}\n💰 Fiyatlar: ${Object.entries(prices).map(([d, p]) => `${d}g: ${p}₺`).join(', ')}`, {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [
                        [{ text: "📝 Açıklama Ekle", callback_data: `admin_prod_desc_${prodKey}` }],
                        [{ text: "📦 Stok Ekle", callback_data: `admin_prod_stock_${prodKey}` }],
                        [{ text: "🔙 Oyun Ürünleri", callback_data: `admin_game_products_${state.gameKey}` }]
                    ]}
                });
            }
        }
        
        // Sadakat puan oranı değiştir
        if (state.action === 'set_loyalty_rate') {
            const rate = parseInt(text);
            if (isNaN(rate) || rate < 1 || rate > 50) {
                return bot.sendMessage(chatId, "❌ Geçersiz değer! 1-50 arası bir sayı girin.");
            }
            
            loyaltySettings.pointRate = rate;
            saveLoyaltySettings(loyaltySettings);
            addLog('admin_action', `⭐ Sadakat puan kazanma oranı %${rate} olarak ayarlandı`);
            
            delete adminState[chatId];
            return bot.sendMessage(chatId, `✅ Puan kazanma oranı <b>%${rate}</b> olarak ayarlandı!\n\n<i>Müşteriler artık aldıkları tutarın %${rate}'ü kadar puan kazanacak.</i>`, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: "🔙 Sadakat Ayarları", callback_data: "admin_loyalty" }]]
                }
            });
        }
        
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
            
            // Sadakat sistemini güncelle
            const originalPrice = state.price || 0;
            const usedPoints = state.usedPoints || 0;
            const paidPrice = originalPrice - usedPoints; // Ödenen gerçek tutar
            
            // Kullanılan puanları düş
            if (usedPoints > 0) {
                useCustomerPoints(userId, usedPoints);
            }
            
            // Yeni puan ekle (ödenen tutarın %4'ü)
            const loyaltyResult = addLoyaltyPoints(userId, parseInt(userId), paidPrice);
            
            // Sadakat bildirimi gönder
            const badge = getLoyaltyBadge(loyaltyResult.purchases);
            let loyaltyMsg = `🎉 <b>Tebrikler! Puan Kazandınız!</b>\n\n`;
            loyaltyMsg += `${badge}\n\n`;
            
            if (usedPoints > 0) {
                loyaltyMsg += `💳 Kullanılan puan: <b>${usedPoints} puan (${usedPoints}₺ indirim)</b>\n`;
            }
            
            loyaltyMsg += `⭐ Kazanılan puan: <b>+${loyaltyResult.earnedPoints} puan</b>\n`;
            loyaltyMsg += `📊 Güncel bakiye: <b>${loyaltyResult.totalPoints} puan</b>\n`;
            loyaltyMsg += `📦 Toplam alışveriş: <b>${loyaltyResult.purchases}</b>\n\n`;
            loyaltyMsg += `💡 <i>1 puan = 1₺ değerindedir. Bir sonraki alışverişinizde kullanabilirsiniz!</i>`;
            
            bot.sendMessage(userId, loyaltyMsg, { parse_mode: 'HTML' }).catch(() => {});
            
            // Log ekle
            const usedPointsLog = usedPoints > 0 ? ` | 🎁 -${usedPoints} puan kullanıldı` : '';
            addLog('key_sent', `👤 ${userId} | 📦 ${state.productName} | 🔑 ${key} | ⏱ ${days} gün | 💰 ${originalPrice}₺ (ödenen: ${paidPrice}₺)${usedPointsLog} | ⭐ +${loyaltyResult.earnedPoints} puan`);
            
            // Siparişi pendingOrders'dan sil
            if (state.orderId) {
                delete pendingOrders[state.orderId];
            }
            
            delete adminState[chatId];
            return;
        }
        
        // UDID gönderme
        if (state.action === 'send_udid') {
            const udid = text.trim();
            const info = state.fcodeInfo;
            
            if (!udid) {
                return bot.sendMessage(chatId, "❌ UDID boş olamaz!");
            }
            
            // Kullanıcıya UDID gönder (Files Bot üzerinden)
            if (filesBot && info.chatId) {
                filesBot.sendMessage(info.chatId, `✅ **UDID Onaylandı!**

📱 **UDID'niz:** \`${udid}\`

📦 Menü: ${info.menu}
📝 Fcode: \`${info.fcode}\`

━━━━━━━━━━━━━━━━━━━━
⚠️ Bu UDID'yi güvenli bir yerde saklayın.`, { parse_mode: 'Markdown' }).catch(e => {
                    console.log('UDID gönderim hatası:', e.message);
                });
            }
            
            // Talebi sil
            delete pendingFcode[state.orderId];
            savePendingFcode();
            
            bot.sendMessage(chatId, `✅ **UDID Gönderildi!**\n\n👤 Kullanıcı: \`${info.chatId}\`\n📱 UDID: \`${udid}\``, { parse_mode: 'Markdown' });
            delete adminState[chatId];
            return showAdminUdidMenu(chatId);
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
        
        // ========== DUYURU GÖNDERME ==========
        
        if (state.action === 'send_announce') {
            const message = text.trim();
            if (!message) {
                return bot.sendMessage(chatId, "❌ Mesaj boş olamaz!");
            }
            
            let sentCount = 0;
            let failCount = 0;
            const targetUsers = [];
            
            // Hedef kullanıcıları belirle
            if (state.targetType === 'all') {
                // Tüm aktif kullanıcılar
                for (const orderId in activeKeys) {
                    const entry = activeKeys[orderId];
                    if (entry.chatId && !targetUsers.includes(entry.chatId)) {
                        targetUsers.push(entry.chatId);
                    }
                }
            } else if (state.targetType === 'product') {
                // Belirli ürünü alan kullanıcılar
                for (const orderId in activeKeys) {
                    const entry = activeKeys[orderId];
                    if (entry.products && entry.products.includes(state.productName)) {
                        if (entry.chatId && !targetUsers.includes(entry.chatId)) {
                            targetUsers.push(entry.chatId);
                        }
                    }
                }
            }
            
            // Duyuru mesajını oluştur
            const announceText = `
📢 <b>ADMİN DUYURU</b>
━━━━━━━━━━━━━━━━━━━━━

${state.productName ? `📦 <b>Ürün:</b> ${state.productName}\n\n` : ''}${message}

━━━━━━━━━━━━━━━━━━━━━
🏪 <i>Best Of Shop Bot</i>`;
            
            // Mesajları gönder (async wrapper)
            (async () => {
                for (const targetChatId of targetUsers) {
                    try {
                        await bot.sendMessage(targetChatId, announceText, { parse_mode: 'HTML' });
                        sentCount++;
                    } catch (e) {
                        failCount++;
                    }
                    // Rate limit için kısa bekleme
                    await new Promise(r => setTimeout(r, 50));
                }
                
                bot.sendMessage(chatId, `✅ <b>Duyuru Gönderildi!</b>\n\n📤 Başarılı: ${sentCount}\n❌ Başarısız: ${failCount}`, { parse_mode: 'HTML' });
            })();
            
            delete adminState[chatId];
            return showAdminPanel(chatId);
        }
        
        // ========== ANAHTAR İŞLEMLERİ ==========
        
        // Manuel anahtar ekleme
        if (state.action === 'add_manual_key') {
            if (state.step === 'key') {
                let key = text.trim();
                if (key.toLowerCase() === 'auto') {
                    key = 'KEY-' + Math.random().toString(36).substring(2, 10).toUpperCase();
                }
                state.key = key;
                state.step = 'days';
                return bot.sendMessage(chatId, `🔑 Anahtar: <code>${key}</code>\n\n📅 Kaç gün geçerli olsun?`, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "7 Gün", callback_data: "manual_key_days_7" },
                                { text: "30 Gün", callback_data: "manual_key_days_30" },
                                { text: "60 Gün", callback_data: "manual_key_days_60" }
                            ],
                            [{ text: "🔙 İptal", callback_data: "admin_keys" }]
                        ]
                    }
                });
            }
            if (state.step === 'userId') {
                const userId = text.trim();
                const key = state.key;
                const days = state.days;
                
                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + days);
                
                const orderId = 'MANUAL-' + Date.now();
                activeKeys[orderId] = {
                    key: key,
                    userId: userId || 'MANUAL',
                    expiresAt: expiresAt.toISOString(),
                    products: [],
                    createdAt: new Date().toISOString()
                };
                saveKeys(activeKeys);
                
                bot.sendMessage(chatId, `✅ <b>Anahtar Eklendi!</b>\n\n🔑 Anahtar: <code>${key}</code>\n📅 Süre: ${days} gün\n👤 Kullanıcı: ${userId || 'MANUAL'}`, {
                    parse_mode: 'HTML'
                });
                delete adminState[chatId];
                return showAdminKeys(chatId);
            }
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
            originalPrice: sel.originalPrice || sel.price,
            usedPoints: sel.usedPoints || 0,
            timestamp: Date.now()
        };
        
        // Puan kullanımı bilgisi
        let pointsInfo = "";
        if (sel.usedPoints && sel.usedPoints > 0) {
            pointsInfo = `\n⭐ <b>Kullanılan Puan:</b> ${sel.usedPoints} puan (-${sel.usedPoints}₺)`;
        }
        
        bot.forwardMessage(ADMIN_ID, chatId, msg.message_id).then((fwd) => {
            bot.sendMessage(ADMIN_ID, `🛒 <b>Yeni Sipariş Bildirimi</b>

👤 Kullanıcı: <code>${chatId}</code>
📦 Ürün: <b>${sel.productName}</b>
⏱ Süre: <b>${sel.days} gün</b>
💰 Orijinal Fiyat: <b>${sel.originalPrice || sel.price}₺</b>${pointsInfo}
✨ Ödenecek: <b>${sel.price}₺</b>

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
        
        // Satış log'u
        const logText = sel.usedPoints > 0 
            ? `💳 Dekont: ${chatId} | ${sel.productName} | ${sel.days} gün | ${sel.price}₺ | ⭐ ${sel.usedPoints} puan kullanıldı`
            : `💳 Dekont: ${chatId} | ${sel.productName} | ${sel.days} gün | ${sel.price}₺`;
        addLog('payment', logText);
        
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
        
        // 1 gün kala - hatırlatma
        if (timeLeft > 0 && timeLeft <= oneDayMs && !entry.notified) {
            const prods = entry.products || [];
            const productList = prods.length > 0 ? prods.join(', ') : 'Ürününüz';
            
            bot.sendMessage(entry.chatId, `⚠️ <b>Süre Hatırlatması!</b>

🔑 Anahtarınız: <code>${entry.key}</code>
📦 Ürün: ${productList}

⏰ <b>Süreniz yarın bitiyor!</b>

Yenilemek için ana menüden ürünü seçebilirsiniz.`, { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🏠 Ana Menü", callback_data: "back_main" }]
                    ]
                }
            }).catch(() => {});
            entry.notified = true;
            changed = true;
        }
        
        // Süresi biten anahtarları hemen sil
        if (timeLeft <= 0) {
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
    const FILES_SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 dakika inaktivite sonrası oturum kapat
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
        // Admin state'i temizle (varsa)
        delete filesAdminState[chatId];
        filesUserSessions.set(chatId, { step: 'awaiting_key', lastActivity: Date.now() });
        filesSendAndDelete('sendMessage', chatId, '🔐 Lütfen ürün anahtarınızı girin:');
    });

    const filesAdminState = {};

    // FILES BOT: /owner paneli (admin paneli)
    filesBot.onText(/\/owner/, (msg) => {
        const chatId = msg.chat.id;
        if (chatId !== ADMIN_ID) return filesBot.sendMessage(chatId, "Yetkisiz.");
        
        // Admin state'i temizle (yeni menü açılıyor)
        delete filesAdminState[chatId];

        const productCount = filesProductUploads.size;
        const mappingCount = Object.keys(productMapping).length;
        filesBot.sendMessage(chatId, `**📁 Files Bot Admin Paneli**\n\nToplam menü: ${productCount}\nEşleştirme: ${mappingCount}`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📦 Ürünleri Yönet', callback_data: 'files_products' }],
                    [{ text: '➕ Yeni Ürün Ekle', callback_data: 'files_add_product' }],
                    [{ text: '🔗 Ürün Eşleştir', callback_data: 'files_mapping' }],
                    [{ text: '📱 UDID Aldırma', callback_data: 'files_udid_menu' }],
                    [{ text: '🔑 Anahtarları Yönet', callback_data: 'files_keys' }],
                ],
            },
        });
    });

    // FILES BOT: Callback handler
    filesBot.on('callback_query', async (query) => {
        const chatId = query.from.id;
        const data = query.data;
        
        try {
            await filesBot.answerCallbackQuery(query.id).catch(()=>{});
        } catch (e) {}

        try {
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
            const state = filesAdminState[chatId];
            const productName = state?.currentProduct;
            if (!productName) return filesBot.sendMessage(chatId, '❌ Önce bir ürün seçin.');
            
            // isUpdate ve pendingNotification bilgilerini koru
            filesAdminState[chatId] = { 
                action: 'edit_desc', 
                currentProduct: productName,
                isUpdate: state?.isUpdate || false,
                pendingNotification: state?.pendingNotification || false
            };
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
                        [{ text: '➕ Manuel Anahtar Ekle', callback_data: 'files_key_manual_add' }],
                        [{ text: '🔍 Anahtar Ara', callback_data: 'files_key_search' }],
                        [{ text: '📋 Son 10 Anahtar', callback_data: 'files_key_list' }],
                        [{ text: '🔙 Geri', callback_data: 'files_back' }],
                    ],
                },
            });
        }
        
        // Manuel anahtar ekleme - Adım 1: Anahtar iste
        if (data === 'files_key_manual_add') {
            filesAdminState[chatId] = { action: 'manual_key_step1' };
            return filesBot.sendMessage(chatId, `**➕ Manuel Anahtar Ekleme**\n\n🔑 Eklemek istediğiniz anahtarı yazın:`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ İptal', callback_data: 'files_keys' }]] }
            });
        }
        
        // Manuel anahtar - Menü seçimi (çoklu seçim)
        if (data === 'files_key_manual_menus') {
            const state = filesAdminState[chatId];
            if (!state || state.action !== 'manual_key_step2') {
                return filesBot.sendMessage(chatId, '❌ Oturum hatası. Tekrar başlayın.');
            }
            
            const filesMenus = Array.from(filesProductUploads.keys());
            if (filesMenus.length === 0) {
                delete filesAdminState[chatId];
                return filesBot.sendMessage(chatId, '❌ Henüz menü oluşturulmamış. Önce menü ekleyin.', {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: 'files_keys' }]] }
                });
            }
            
            const selectedMenus = state.selectedMenus || [];
            const buttons = filesMenus.map(name => {
                const isSelected = selectedMenus.includes(name);
                const icon = isSelected ? '✅' : '⬜';
                return [{ text: `${icon} ${name.substring(0, 28)}`, callback_data: `files_key_toggle_menu_${name.substring(0, 20)}` }];
            });
            
            // Onay ve iptal butonları
            buttons.push([{ text: `✅ Seçimi Tamamla (${selectedMenus.length} menü)`, callback_data: 'files_key_manual_confirm' }]);
            buttons.push([{ text: '❌ İptal', callback_data: 'files_keys' }]);
            
            const selectedList = selectedMenus.length > 0 
                ? selectedMenus.map((m, i) => `${i + 1}. ${m}`).join('\n') 
                : '(Henüz seçilmedi)';
            
            return filesBot.sendMessage(chatId, `**📦 Menü Seçimi**\n\n🔑 Anahtar: \`${state.key}\`\n📅 Süre: ${state.days} gün\n\n**Seçilen Menüler:**\n${selectedList}\n\n👇 Erişim verilecek menüleri seçin (birden fazla seçebilirsiniz):`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons.slice(0, 20) }
            });
        }
        
        // Menü toggle (seç/kaldır)
        if (data.startsWith('files_key_toggle_menu_')) {
            const state = filesAdminState[chatId];
            if (!state || state.action !== 'manual_key_step2') {
                return filesBot.sendMessage(chatId, '❌ Oturum hatası.');
            }
            
            const searchName = data.substring(22);
            let menuName = null;
            for (const name of filesProductUploads.keys()) {
                if (name.startsWith(searchName)) {
                    menuName = name;
                    break;
                }
            }
            
            if (!menuName) return filesBot.answerCallbackQuery(chatId);
            
            if (!state.selectedMenus) state.selectedMenus = [];
            
            const idx = state.selectedMenus.indexOf(menuName);
            if (idx > -1) {
                state.selectedMenus.splice(idx, 1);
            } else {
                state.selectedMenus.push(menuName);
            }
            
            // Menü listesini güncelle
            const filesMenus = Array.from(filesProductUploads.keys());
            const buttons = filesMenus.map(name => {
                const isSelected = state.selectedMenus.includes(name);
                const icon = isSelected ? '✅' : '⬜';
                return [{ text: `${icon} ${name.substring(0, 28)}`, callback_data: `files_key_toggle_menu_${name.substring(0, 20)}` }];
            });
            buttons.push([{ text: `✅ Seçimi Tamamla (${state.selectedMenus.length} menü)`, callback_data: 'files_key_manual_confirm' }]);
            buttons.push([{ text: '❌ İptal', callback_data: 'files_keys' }]);
            
            const selectedList = state.selectedMenus.length > 0 
                ? state.selectedMenus.map((m, i) => `${i + 1}. ${m}`).join('\n') 
                : '(Henüz seçilmedi)';
            
            return filesBot.editMessageText(`**📦 Menü Seçimi**\n\n🔑 Anahtar: \`${state.key}\`\n📅 Süre: ${state.days} gün\n\n**Seçilen Menüler:**\n${selectedList}\n\n👇 Erişim verilecek menüleri seçin (birden fazla seçebilirsiniz):`, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons.slice(0, 20) }
            });
        }
        
        // Manuel anahtar onayı - kaydet
        if (data === 'files_key_manual_confirm') {
            const state = filesAdminState[chatId];
            if (!state || state.action !== 'manual_key_step2') {
                return filesBot.sendMessage(chatId, '❌ Oturum hatası.');
            }
            
            if (!state.selectedMenus || state.selectedMenus.length === 0) {
                return filesBot.sendMessage(chatId, '⚠️ En az bir menü seçmelisiniz!', {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Menü Seçimine Dön', callback_data: 'files_key_manual_menus' }]] }
                });
            }
            
            // Anahtarı kaydet
            const orderId = `manual_${Date.now()}`;
            const expiresAt = Date.now() + state.days * 24 * 60 * 60 * 1000;
            
            activeKeys[orderId] = {
                orderId: orderId,
                chatId: 0, // Manuel eklenen, henüz kullanıcıya atanmadı
                products: state.selectedMenus, // Seçilen menüler
                key: state.key,
                expiresAt: expiresAt,
                notified: false,
                manual: true // Manuel eklendiğini belirt
            };
            saveKeys(activeKeys);
            
            const expiryDate = new Date(expiresAt).toLocaleDateString('tr-TR');
            const menuList = state.selectedMenus.map((m, i) => `${i + 1}. ${m}`).join('\n');
            
            delete filesAdminState[chatId];
            
            return filesBot.sendMessage(chatId, `✅ **Anahtar Başarıyla Eklendi!**\n\n🔑 Anahtar: \`${state.key}\`\n📅 Süre: ${state.days} gün\n📆 Bitiş: ${expiryDate}\n\n📦 **Erişim Verilen Menüler:**\n${menuList}`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Anahtar Yönetimi', callback_data: 'files_keys' }]] }
            });
        }
        
        // Manuel anahtar - Gün seçimleri
        if (data.startsWith('files_manual_days_')) {
            const state = filesAdminState[chatId];
            if (!state || !state.key) {
                return filesBot.sendMessage(chatId, '❌ Oturum hatası. Tekrar başlayın.');
            }
            
            const daysPart = data.substring(18);
            
            // Manuel gün girişi
            if (daysPart === 'custom') {
                filesAdminState[chatId] = { action: 'manual_key_custom_days', key: state.key };
                return filesBot.sendMessage(chatId, `🔑 Anahtar: \`${state.key}\`\n\n📅 Kaç gün geçerli olsun? (1-365 arası sayı girin):`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '❌ İptal', callback_data: 'files_keys' }]] }
                });
            }
            
            const days = parseInt(daysPart);
            if (isNaN(days) || days <= 0) {
                return filesBot.sendMessage(chatId, '❌ Geçersiz süre!');
            }
            
            filesAdminState[chatId] = { 
                action: 'manual_key_step2', 
                key: state.key, 
                days: days,
                selectedMenus: []
            };
            
            // Menü seçimine yönlendir
            const filesMenus = Array.from(filesProductUploads.keys());
            if (filesMenus.length === 0) {
                delete filesAdminState[chatId];
                return filesBot.sendMessage(chatId, '❌ Henüz menü oluşturulmamış. Önce menü ekleyin.', {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: 'files_keys' }]] }
                });
            }
            
            const buttons = filesMenus.map(name => {
                return [{ text: `⬜ ${name.substring(0, 28)}`, callback_data: `files_key_toggle_menu_${name.substring(0, 20)}` }];
            });
            buttons.push([{ text: `✅ Seçimi Tamamla (0 menü)`, callback_data: 'files_key_manual_confirm' }]);
            buttons.push([{ text: '❌ İptal', callback_data: 'files_keys' }]);
            
            return filesBot.sendMessage(chatId, `**📦 Menü Seçimi**\n\n🔑 Anahtar: \`${state.key}\`\n📅 Süre: ${days} gün\n\n**Seçilen Menüler:**\n(Henüz seçilmedi)\n\n👇 Erişim verilecek menüleri seçin (birden fazla seçebilirsiniz):`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons.slice(0, 20) }
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
                        [{ text: '📱 UDID Aldırma', callback_data: 'files_udid_menu' }],
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

        // Eşleştirme sistemi - doğrudan shop ürünlerini göster
        if (data === 'files_mapping') {
            const shopData = loadProducts();
            const mappings = Object.entries(productMapping || {});
            const mappingCount = mappings.length;
            
            let text = `**🔗 Ürün Eşleştirme**\n\nShop ürünlerini Files menülerine eşleştirin.\n\n`;
            
            if (mappingCount > 0) {
                text += `📊 Mevcut: ${mappingCount} eşleştirme\n\n`;
            }
            
            // Shop ürünleri butonları
            const buttons = [];
            for (const prodKey in shopData.products || {}) {
                const prod = shopData.products[prodKey];
                const shortName = prod.name.length > 25 ? prod.name.substring(0, 25) + '...' : prod.name;
                const mapped = productMapping[prod.name] ? '✅' : '❌';
                buttons.push([{ text: `${mapped} ${shortName}`, callback_data: `files_map_shop_${prodKey.substring(0, 25)}` }]);
            }
            
            if (buttons.length === 0) {
                return filesBot.sendMessage(chatId, '❌ Shop bot\'ta ürün bulunamadı.', {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: 'files_back' }]] }
                });
            }
            
            // Mevcut eşleştirmeleri görüntüle/sil butonları
            if (mappingCount > 0) {
                buttons.push([{ text: '📋 Eşleştirmeleri Göster', callback_data: 'files_map_list' }]);
            }
            buttons.push([{ text: '🔙 Geri', callback_data: 'files_back' }]);
            
            return filesBot.sendMessage(chatId, text + '✅ Eşleştirilmiş | ❌ Eşleştirilmemiş\n\nBir ürün seçin:', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons.slice(0, 20) },
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
        
        } catch (error) {
            console.error('Files Bot callback error:', error.message);
        }
    });

    // FILES BOT: Anahtar girişi ve menü erişimi
    filesBot.on('message', (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text?.trim();
        const session = filesUserSessions.get(chatId);

        // Komutları ignore et (/, /start, /admin vs.)
        if (!text || text.startsWith('/')) return;

        // Admin işlemleri için - filesAdminState varsa bu handler'ı atla
        // (Admin mesaj handler'ı ayrı olarak işleyecek)
        if (chatId === ADMIN_ID && filesAdminState[chatId]) {
            return;
        }

        // Anahtar doğrulama - her zaman kontrol et (yeni anahtar girilmiş olabilir)
        const keyInfo = getKeyInfo(text);
        if (keyInfo) {
            console.log(`[Files Bot] Anahtar BULUNDU, session validated yapılıyor`);
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
                expiresAt: keyInfo.expiresAt,
                lastActivity: Date.now()
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
            return;
        }

        // Ürün seçimi
        if (session && session.step === 'validated' && text && !text.startsWith('/')) {
            // Aktivite güncelle
            session.lastActivity = Date.now();
            filesUserSessions.set(chatId, session);
            
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
                filesSendAndDelete('sendMessage', chatId, `⚠️ **Bu ürüne erişim yetkiniz yok.**\n\nFarklı bir ürün anahtarınız varsa onu girin veya botu başlatmak için /start yazın.`, { parse_mode: 'Markdown' });
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
        
        // Manuel anahtar ekleme - Adım 1: Anahtar girişi
        if (state.action === 'manual_key_step1') {
            const key = text.trim();
            if (!key || key.length < 3) {
                return filesBot.sendMessage(chatId, '❌ Geçersiz anahtar! En az 3 karakter olmalı.', {
                    reply_markup: { inline_keyboard: [[{ text: '❌ İptal', callback_data: 'files_keys' }]] }
                });
            }
            
            // Anahtar zaten var mı kontrol et
            const existingOrderId = findOrderIdByKey(key);
            if (existingOrderId) {
                return filesBot.sendMessage(chatId, '⚠️ Bu anahtar zaten mevcut! Farklı bir anahtar girin:', {
                    reply_markup: { inline_keyboard: [[{ text: '❌ İptal', callback_data: 'files_keys' }]] }
                });
            }
            
            filesAdminState[chatId] = { action: 'manual_key_days', key: key };
            return filesBot.sendMessage(chatId, `🔑 Anahtar: \`${key}\`\n\n📅 Kaç gün geçerli olsun?`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '7 Gün', callback_data: 'files_manual_days_7' },
                            { text: '30 Gün', callback_data: 'files_manual_days_30' }
                        ],
                        [
                            { text: '60 Gün', callback_data: 'files_manual_days_60' },
                            { text: '90 Gün', callback_data: 'files_manual_days_90' }
                        ],
                        [{ text: '🔢 Manuel Gün Gir', callback_data: 'files_manual_days_custom' }],
                        [{ text: '❌ İptal', callback_data: 'files_keys' }]
                    ]
                }
            });
        }
        
        // Manuel anahtar - Manuel gün girişi
        if (state.action === 'manual_key_custom_days') {
            const days = parseInt(text);
            if (isNaN(days) || days <= 0 || days > 365) {
                return filesBot.sendMessage(chatId, '❌ Geçersiz süre! 1-365 arası bir sayı girin:', {
                    reply_markup: { inline_keyboard: [[{ text: '❌ İptal', callback_data: 'files_keys' }]] }
                });
            }
            
            filesAdminState[chatId] = { 
                action: 'manual_key_step2', 
                key: state.key, 
                days: days,
                selectedMenus: []
            };
            
            // Menü seçimine yönlendir
            const filesMenus = Array.from(filesProductUploads.keys());
            if (filesMenus.length === 0) {
                delete filesAdminState[chatId];
                return filesBot.sendMessage(chatId, '❌ Henüz menü oluşturulmamış. Önce menü ekleyin.', {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Geri', callback_data: 'files_keys' }]] }
                });
            }
            
            const buttons = filesMenus.map(name => {
                return [{ text: `⬜ ${name.substring(0, 28)}`, callback_data: `files_key_toggle_menu_${name.substring(0, 20)}` }];
            });
            buttons.push([{ text: `✅ Seçimi Tamamla (0 menü)`, callback_data: 'files_key_manual_confirm' }]);
            buttons.push([{ text: '❌ İptal', callback_data: 'files_keys' }]);
            
            return filesBot.sendMessage(chatId, `**📦 Menü Seçimi**\n\n🔑 Anahtar: \`${state.key}\`\n📅 Süre: ${days} gün\n\n**Seçilen Menüler:**\n(Henüz seçilmedi)\n\n👇 Erişim verilecek menüleri seçin (birden fazla seçebilirsiniz):`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons.slice(0, 20) }
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
            
            // Eğer güncelleme modundaysa butonları göster
            if (state.isUpdate || state.pendingNotification) {
                filesAdminState[chatId] = { currentProduct: productName, isUpdate: true, pendingNotification: true };
                return filesBot.sendMessage(chatId, `✅ **${productName}** açıklaması kaydedildi.`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📢 Müşterilere Bildir', callback_data: 'files_send_notification' }],
                            [{ text: '✅ Bildirimsiz Tamamla', callback_data: 'files_back' }],
                        ],
                    },
                });
            }
            
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

    // Periyodik süre kontrolü - süresi dolan ve inaktif kullanıcıların oturumlarını kapat
    setInterval(() => {
        const now = Date.now();
        for (const [chatId, session] of filesUserSessions.entries()) {
            // Anahtar süresi dolmuşsa
            if (session.expiresAt && session.expiresAt < now) {
                deleteAllUserMessages(chatId);
                filesUserSessions.delete(chatId);
                filesBot.sendMessage(chatId, `⏰ **Süreniz Doldu!**\n\nÜrün anahtarınızın süresi bitmiştir. Tüm dosyalar ve mesajlar silindi.\n\n🛒 Yeni anahtar almak için @BestOfShopFiles_Bot botunu ziyaret edin.`, {
                    parse_mode: 'Markdown',
                    reply_markup: { remove_keyboard: true }
                }).catch(() => {});
                continue;
            }
            
            // 5 dakika inaktivite sonrası oturum kapat
            if (session.lastActivity && (now - session.lastActivity) > FILES_SESSION_TIMEOUT_MS) {
                deleteAllUserMessages(chatId);
                filesUserSessions.delete(chatId);
                filesBot.sendMessage(chatId, `🔒 **Oturum Kapatıldı**\n\nGüvenliğiniz için 5 dakika işlem yapılmadığından oturumunuz kapatıldı.\n\n📌 Tekrar erişmek için /start yazın ve anahtarınızı girin.`, {
                    parse_mode: 'Markdown',
                    reply_markup: { remove_keyboard: true }
                }).catch(() => {});
            }
        }
    }, 60 * 1000); // Her 1 dakikada kontrol et

    console.log('Files bot handlers registered.');
}

