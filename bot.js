const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");

// Load local `.env` when running locally (optional). Install `dotenv` if you want this behavior.
try { require('dotenv').config(); } catch (e) {}

// ============== SHOP BOT ==============
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
const IBAN = "TR230010300000000014365322";
const PAPARA_KODU = "papara ödeme yöntemi şuanda kullanımda değildir";
const BINANCE_USDT = "TWdjyffvtyhbwuQzrNdh3A215EG6cNPWVL";
const GROUP_LINK = "@BestOfShopFiles_Bot";

let users = {};
let userState = {};
let adminState = {};

// Icons: persisted in `icons.json`. Use defaults when file missing.
const DEFAULT_ICONS = {
    defaultCategory: '📁',
    defaultProduct: '📦',
    payments: '💸',
};

function loadIcons() {
    try {
        const p = path.join(__dirname, 'icons.json');
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (e) {}
    return Object.assign({}, DEFAULT_ICONS);
}

function saveIcons(icons) {
    try {
        fs.writeFileSync(path.join(__dirname, 'icons.json'), JSON.stringify(icons, null, 2), 'utf-8');
    } catch (e) {}
}

let ICONS = loadIcons();

// Keys management: stores active keys with expiry dates
// Format: { oderId: { oderId, chatId, product, key, expiresAt (timestamp), notified (bool) } }
function loadKeys() {
    try {
        const p = path.join(__dirname, 'keys.json');
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (e) {}
    return {};
}

function saveKeys(keys) {
    try {
        fs.writeFileSync(path.join(__dirname, 'keys.json'), JSON.stringify(keys, null, 2), 'utf-8');
    } catch (e) {}
}

let activeKeys = loadKeys();

// Check expiring keys daily and send reminders
function checkExpiringKeys() {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    let changed = false;

    for (const orderId in activeKeys) {
        const entry = activeKeys[orderId];
        const timeLeft = entry.expiresAt - now;

        // If expires in less than 24 hours and not yet notified
        if (timeLeft > 0 && timeLeft <= oneDayMs && !entry.notified) {
            bot.sendMessage(
                entry.chatId,
                `⚠️ **Hatırlatma**\n\nSatın aldığınız *${entry.product}* anahtarı yarın sona erecektir.\n\n🔑 Anahtar: \`${entry.key}\`\n\nYenilemek isterseniz bottan tekrar satın alım yapabilirsiniz.`,
                { parse_mode: 'Markdown' }
            ).catch(() => {});
            entry.notified = true;
            changed = true;
        }

        // Clean up expired keys (7 days after expiry)
        if (timeLeft < -7 * oneDayMs) {
            delete activeKeys[orderId];
            changed = true;
        }
    }

    if (changed) saveKeys(activeKeys);
}

// Run expiry check every hour
setInterval(checkExpiringKeys, 60 * 60 * 1000);
// Also run once on startup
setTimeout(checkExpiringKeys, 5000);

// Short callback ref map to avoid long/invalid callback_data values.
// Stores small keys (ref_<id>) -> payload object. Used only for admin/internal flows.
const callbackMap = {};
function makeCallbackRef(obj) {
    const id = Math.random().toString(36).slice(2, 9);
    callbackMap[id] = obj;
    return `ref_${id}`;
}
function resolveCallbackRef(data) {
    if (!data || !data.startsWith('ref_')) return null;
    const id = data.slice(4);
    return callbackMap[id] || null;
}
// simple HTML escaper for user-provided text
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function saveProducts(products) {
    fs.writeFileSync("./products.json", JSON.stringify(products, null, 2));
}

function loadProducts() {
    return JSON.parse(fs.readFileSync("./products.json", "utf-8"));
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const products = loadProducts();
    const categories = Object.keys(products);

        const buttons = categories.map((cat) => [
        { text: `${ICONS[cat] || ICONS.defaultCategory} ${cat}`, callback_data: "cat_" + cat },
    ]);
    bot.sendMessage(chatId, "**Lütfen bir kategori seçin:**", {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                ...buttons,
                [{ text: "🔙 Ana Menü", callback_data: "main_menu" }],
            ],
        },
    });
});

// Admin entry: show admin panel for owner
bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_ID) return bot.sendMessage(chatId, "Yetkisiz. Bu komut sadece admin içindir.");

    bot.sendMessage(chatId, "**Admin Paneli** — Yapmak istediğin işlemi seçin:", {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "🛠 Ürünleri Yönet", callback_data: "admin_products" }],
                [{ text: "➕ Ürün Ekle", callback_data: "admin_add_product" }],
                [{ text: "� Anahtarları Yönet", callback_data: "admin_keys" }],
                [{ text: "�📣 Menüyü Gönder (Preview)", callback_data: "admin_preview_menu" }],
            ],
        },
    });
});

bot.on("callback_query", (query) => {
    const chatId = query.from.id;
    let data = query.data;
    console.log('callback_query from', chatId, 'data=', data);
    // acknowledge callback to remove loading state
    try { bot.answerCallbackQuery(query.id).catch(()=>{}); } catch (e) {}
    const products = loadProducts();
    // If this callback is a ref we created, resolve it into a synthetic data string
    const ref = resolveCallbackRef(data);
    if (ref) {
        // Map ref types to the legacy data strings used by the handlers
        if (ref.type === 'admin_cat') data = `admin_cat_${encodeURIComponent(ref.category)}`;
        else if (ref.type === 'admin_prod') data = `admin_prod_${encodeURIComponent(ref.category)}|${encodeURIComponent(ref.product)}`;
        else if (ref.type === 'admin_set_icon_cat') data = `admin_set_icon_cat|${encodeURIComponent(ref.category)}`;
        else if (ref.type === 'admin_set_icon_prod') data = `admin_set_icon_prod|${encodeURIComponent(ref.category)}|${encodeURIComponent(ref.product)}`;
        else if (ref.type === 'admin_edit_price') data = `admin_edit_price|${encodeURIComponent(ref.category)}|${encodeURIComponent(ref.product)}`;
        else if (ref.type === 'admin_edit_desc') data = `admin_edit_desc|${encodeURIComponent(ref.category)}|${encodeURIComponent(ref.product)}`;
        else if (ref.type === 'admin_delete') data = `admin_delete|${encodeURIComponent(ref.category)}|${encodeURIComponent(ref.product)}`;
        else if (ref.type === 'admin_products') data = 'admin_products';
        else if (ref.type === 'admin_set_icon') data = `admin_set_icon|${encodeURIComponent(ref.category)}`;
        else if (ref.type === 'admin_toggle_maintenance') data = `admin_toggle_maintenance|${encodeURIComponent(ref.category)}|${encodeURIComponent(ref.product)}`;
    }
    // Admin callbacks
    if (data === 'admin_products' && chatId === ADMIN_ID) {
        const categories = Object.keys(products);
        const buttons = categories.map((cat) => [
            { text: `${ICONS[cat] || ICONS.defaultCategory} ${cat}`, callback_data: makeCallbackRef({ type: 'admin_cat', category: cat }) },
        ]);
        return bot.sendMessage(chatId, "**Kategori seçin (düzenlemek için):**", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [...buttons, [{ text: '🔙 Geri', callback_data: 'admin_back' }]] },
        });
    }

    if (data && data.startsWith('admin_cat_') && chatId === ADMIN_ID) {
        const category = decodeURIComponent(data.substring(10));
        const prodNames = Object.keys(products[category] || {});
        const buttons = prodNames.map((p) => {
            const isMaintenance = products[category][p].maintenance === true;
            const icon = isMaintenance ? '🔵' : (ICONS[`prod:${category}|${p}`] || ICONS.defaultProduct);
            const label = isMaintenance ? `${icon} ${p} (Bakımda)` : `${icon} ${p}`;
            return [{ text: label, callback_data: makeCallbackRef({ type: 'admin_prod', category, product: p }) }];
        });
        // Add an extra row to edit category icon
        const keyboard = [
            ...buttons,
            [{ text: '🔖 İkonu Düzenle', callback_data: makeCallbackRef({ type: 'admin_set_icon_cat', category }) }],
            [{ text: '🔙 Geri', callback_data: makeCallbackRef({ type: 'admin_products' }) }],
        ];
        return bot.sendMessage(chatId, `**${category}** — Ürün seçin:`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard },
        });
    }

    if (data && data.startsWith('admin_prod_') && chatId === ADMIN_ID) {
        const payload = data.substring(11);
        const [encCat, encProd] = payload.split('|');
        const category = decodeURIComponent(encCat);
        const productName = decodeURIComponent(encProd);
        const isMaintenance = products[category]?.[productName]?.maintenance === true;
        const maintenanceBtn = isMaintenance 
            ? { text: '✅ Bakımdan Çıkar', callback_data: makeCallbackRef({ type: 'admin_toggle_maintenance', category, product: productName }) }
            : { text: '🔵 Bakıma Al', callback_data: makeCallbackRef({ type: 'admin_toggle_maintenance', category, product: productName }) };
        const statusText = isMaintenance ? '\n🔵 *Durum: Bakımda*' : '';
        adminState[chatId] = { action: null, category, productName };
        return bot.sendMessage(chatId, `Seçildi: *${productName}*${statusText}\nNe yapmak istiyorsunuz?`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✏️ Fiyatı Düzenle', callback_data: makeCallbackRef({ type: 'admin_edit_price', category, product: productName }) }],
                    [{ text: '📝 Açıklamayı Düzenle', callback_data: makeCallbackRef({ type: 'admin_edit_desc', category, product: productName }) }],
                    [maintenanceBtn],
                    [{ text: '🗑 Ürünü Sil', callback_data: makeCallbackRef({ type: 'admin_delete', category, product: productName }) }],
                    [{ text: '🔖 İkonu Düzenle', callback_data: makeCallbackRef({ type: 'admin_set_icon_prod', category, product: productName }) }],
                    [{ text: '🔙 Geri', callback_data: makeCallbackRef({ type: 'admin_cat', category }) }],
                ],
            },
        });
    }

    if (data && data.startsWith('admin_edit_price') && chatId === ADMIN_ID) {
        const parts = data.split('|');
        const category = decodeURIComponent(parts[1]);
        const productName = decodeURIComponent(parts[2]);
        adminState[chatId] = { action: 'edit_price', category, productName };
        return bot.sendMessage(chatId, `Lütfen *${productName}* için yeni fiyatı girin (sadece rakam):`, { parse_mode: 'Markdown' });
    }

    if (data && data.startsWith('admin_edit_desc') && chatId === ADMIN_ID) {
        const parts = data.split('|');
        const category = decodeURIComponent(parts[1]);
        const productName = decodeURIComponent(parts[2]);
        adminState[chatId] = { action: 'edit_desc', category, productName };
        return bot.sendMessage(chatId, `Lütfen *${productName}* için yeni açıklamayı gönderin (metin):`, { parse_mode: 'Markdown' });
    }

    if (data && data.startsWith('admin_delete') && chatId === ADMIN_ID) {
        const parts = data.split('|');
        const category = decodeURIComponent(parts[1]);
        const productName = decodeURIComponent(parts[2]);
        delete products[category][productName];
        saveProducts(products);
        return bot.sendMessage(chatId, `✅ *${productName}* silindi.`, { parse_mode: 'Markdown' });
    }

    // Admin: toggle maintenance mode
    if (data && data.startsWith('admin_toggle_maintenance') && chatId === ADMIN_ID) {
        const parts = data.split('|');
        const category = decodeURIComponent(parts[1]);
        const productName = decodeURIComponent(parts[2]);
        if (products[category] && products[category][productName]) {
            const current = products[category][productName].maintenance === true;
            products[category][productName].maintenance = !current;
            saveProducts(products);
            const newStatus = !current ? 'bakıma alındı 🔵' : 'bakımdan çıkarıldı ✅';
            return bot.sendMessage(chatId, `*${productName}* ${newStatus}`, { parse_mode: 'Markdown' });
        }
    }

    if (data === 'admin_add_product' && chatId === ADMIN_ID) {
        const categories = Object.keys(products);
        const buttons = categories.map((cat) => [
            { text: `${ICONS[cat] || ICONS.defaultCategory} ${cat}`, callback_data: makeCallbackRef({ type: 'admin_add_to_cat', category: cat }) },
        ]);
        buttons.push([{ text: '➕ Yeni Kategori Oluştur', callback_data: 'admin_new_category' }]);
        buttons.push([{ text: '🔙 Geri', callback_data: 'admin_back' }]);
        return bot.sendMessage(chatId, '**Ürün eklemek istediğiniz kategoriyi seçin:**', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons },
        });
    }

    // Admin: add product to existing category
    if (ref && ref.type === 'admin_add_to_cat' && chatId === ADMIN_ID) {
        adminState[chatId] = { action: 'add_product', step: 2, buffer: { category: ref.category } };
        return bot.sendMessage(chatId, `*${ref.category}* kategorisine ürün ekleniyor.\nÜrün adı girin:`, { parse_mode: 'Markdown' });
    }

    // Admin: create new category
    if (data === 'admin_new_category' && chatId === ADMIN_ID) {
        adminState[chatId] = { action: 'add_category', step: 1, buffer: {} };
        return bot.sendMessage(chatId, 'Yeni kategori adı girin:');
    }

    // Admin: set category icon
    if (data && data.startsWith('admin_set_icon_cat') && chatId === ADMIN_ID) {
        const parts = data.split('|');
        const category = decodeURIComponent(parts[1]);
        adminState[chatId] = { action: 'set_icon', target: 'category', category };
        return bot.sendMessage(chatId, `Lütfen *${category}* için kullanılacak emoji veya ikon karakterini gönderin (örnek: 🤖):`, { parse_mode: 'Markdown' });
    }

    // Admin: set product icon
    if (data && data.startsWith('admin_set_icon_prod') && chatId === ADMIN_ID) {
        const parts = data.split('|');
        const category = decodeURIComponent(parts[1]);
        const productName = decodeURIComponent(parts[2]);
        adminState[chatId] = { action: 'set_icon', target: 'product', category, productName };
        return bot.sendMessage(chatId, `Lütfen *${productName}* için kullanılacak emoji veya ikon karakterini gönderin (örnek: 📦):`, { parse_mode: 'Markdown' });
    }

    if (data === 'admin_preview_menu' && chatId === ADMIN_ID) {
        // Build a simple preview of the main menu
        const categories = Object.keys(products);
        const text = `**Menü Önizlemesi**\n\n${categories.map((c) => `• *${c}*`).join('\n')}`;
        return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    }

    // ============== ANAHTAR YÖNETİMİ ==============
    if (data === 'admin_keys' && chatId === ADMIN_ID) {
        const keyCount = Object.keys(activeKeys).length;
        return bot.sendMessage(chatId, `**🔑 Anahtar Yönetimi**\n\nToplam aktif anahtar: ${keyCount}`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📋 Anahtarları Listele', callback_data: 'admin_keys_list' }],
                    [{ text: '➕ Manuel Anahtar Ekle', callback_data: 'admin_keys_add' }],
                    [{ text: '🗑 Anahtar Sil', callback_data: 'admin_keys_delete' }],
                    [{ text: '🔙 Geri', callback_data: 'admin_back' }],
                ],
            },
        });
    }

    if (data === 'admin_keys_list' && chatId === ADMIN_ID) {
        const now = Date.now();
        const keyList = Object.values(activeKeys);
        if (keyList.length === 0) {
            return bot.sendMessage(chatId, '📋 Hiç aktif anahtar yok.');
        }
        let text = '**📋 Aktif Anahtarlar:**\n\n';
        keyList.forEach((entry, i) => {
            const daysLeft = Math.ceil((entry.expiresAt - now) / (24 * 60 * 60 * 1000));
            const status = daysLeft > 0 ? `${daysLeft} gün kaldı` : '⚠️ Süresi dolmuş';
            text += `${i + 1}. \`${entry.key}\`\n   📦 ${entry.product || 'Bilinmiyor'}\n   ⏳ ${status}\n\n`;
        });
        return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    }

    if (data === 'admin_keys_add' && chatId === ADMIN_ID) {
        adminState[chatId] = { action: 'add_key', step: 1 };
        return bot.sendMessage(chatId, '🔑 **Manuel Anahtar Ekleme**\n\nLütfen anahtarı ve süresini şu formatta girin:\n\n`anahtar süre`\n\nÖrnek: `PREMIUM_KEY_123 30`\n\n(30 = 30 gün geçerli)', { parse_mode: 'Markdown' });
    }

    if (data === 'admin_keys_delete' && chatId === ADMIN_ID) {
        const keyList = Object.values(activeKeys);
        if (keyList.length === 0) {
            return bot.sendMessage(chatId, '📋 Silinecek anahtar yok.');
        }
        const buttons = keyList.slice(0, 10).map((entry) => [
            { text: `🗑 ${entry.key.substring(0, 20)}...`, callback_data: makeCallbackRef({ type: 'admin_delete_key', oderId: entry.oderId }) }
        ]);
        buttons.push([{ text: '🔙 Geri', callback_data: 'admin_keys' }]);
        return bot.sendMessage(chatId, '**🗑 Silmek istediğiniz anahtarı seçin:**', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons },
        });
    }

    // Admin: delete specific key
    if (ref && ref.type === 'admin_delete_key' && chatId === ADMIN_ID) {
        const entry = activeKeys[ref.oderId];
        if (entry) {
            delete activeKeys[ref.oderId];
            saveKeys(activeKeys);
            return bot.sendMessage(chatId, `✅ Anahtar silindi: \`${entry.key}\``, { parse_mode: 'Markdown' });
        }
        return bot.sendMessage(chatId, '❌ Anahtar bulunamadı.');
    }

    if (data === "main_menu") {
        userState[chatId] = null;
        const categories = Object.keys(products);
        const buttons = categories.map((cat) => [
            { text: cat, callback_data: "cat_" + cat },
        ]);
        bot.sendMessage(
            chatId,
            "**Ana menüye dönüldü. Lütfen kategori seçin:**",
            {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        ...buttons,
                        [{ text: "🔙 Ana Menü", callback_data: "main_menu" }],
                    ],
                },
            },
        );
    } else if (data.startsWith("cat_")) {
        const category = data.substring(4);
        userState[chatId] = category;
        const subProducts = Object.keys(products[category]);

        const buttons = subProducts.map((name) => {
            const isMaintenance = products[category][name]?.maintenance === true;
            const icon = isMaintenance ? '🔵' : ICONS.defaultProduct;
            const label = isMaintenance ? `${icon} ${name} (Bakımda)` : `${icon} ${name}`;
            return [{
                text: label,
                callback_data: `product_${name}`,
            }];
        });

        bot.sendMessage(
            chatId,
            `**${category} kategorisindeki modları seçin:**`,
            {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        ...buttons,
                        [{ text: "🔙 Geri", callback_data: "main_menu" }],
                    ],
                },
            },
        );
    } else if (data.startsWith("product_")) {
        const productName = data.substring(8);
        const category = userState[chatId];
        if (!category || !products[category][productName]) {
            return bot.sendMessage(chatId, "⚠️ Oturum zaman aşımına uğradı.\n\nBotu başlatmak için /start yazın.");
        }

        // Check if product is under maintenance
        if (products[category][productName].maintenance === true) {
            return bot.sendMessage(chatId, "🔵 **Bu ürün şu anda bakımdadır.**\n\nLütfen daha sonra tekrar deneyin veya başka bir ürün seçin.", { parse_mode: 'Markdown' });
        }

        users[chatId] = { category, product: productName };
        const price = products[category][productName].price;
        const descPath = path.join(
            __dirname,
            "descriptions",
            `${productName}.txt`,
        );
        const description = fs.existsSync(descPath)
            ? fs.readFileSync(descPath, "utf-8")
            : "Açıklama bulunamadı.";

        const productMsg = `<b>Ürün:</b> ${escapeHtml(productName)}\n\n<b>Özellikler:</b>\n\n${escapeHtml(description)}\n\n💵 <b>Fiyat: ${price}₺</b>\n\n<b>Ödeme yöntemini seçin:</b>`;

        bot.sendMessage(
            chatId,
            productMsg,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "💸 IBAN ile Öde",
                                callback_data: "pay_iban",
                            },
                        ],
                        [
                            {
                                text: "🏦 Papara ile Öde",
                                callback_data: "pay_papara",
                            },
                        ],
                        [
                            {
                                text: "💰 Binance (USDT) ile Öde",
                                callback_data: "pay_binance",
                            },
                        ],
                        [{ text: "🔙 Ana Menü", callback_data: "main_menu" }],
                    ],
                },
            },
        );
    } else if (
        data === "pay_iban" ||
        data === "pay_papara" ||
        data === "pay_binance"
    ) {
        const selected = users[chatId];
        if (!selected)
            return bot.sendMessage(chatId, "⚠️ Oturum zaman aşımına uğradı.\n\nBotu başlatmak için /start yazın.");

        let message = "";
        if (data === "pay_iban") {
            message = `**💸 IBAN ile ödeme bilgileri:**

IBAN: \`${IBAN}\`

Açıklama: \`88295280440\`

Alıcı Adı: \`Moka United Ödeme ve Elektronik Para Kuruluşu A.Ş.\`

‼️ **Dikkat:** Açıklamadaki numarayı yazmassanız ödeme bize geçmez!Lütfen Açıklamaya 88295280440 yazmayı unutmayın.

**Ödeme Yaptıktan Sonra Lütfen dekontu PDF veya ekran görüntüsü olarak buraya atın.Farklı Dekont Veya Ekran Görüntüsü Atan Kullanıcılar Yasaklanacaktır.**`;
        } else if (data === "pay_papara") {
            message = `**🏦 Papara ile ödeme bilgileri:**

Papara Numarası: \`${PAPARA_KODU}\`

Açıklama: papara ödeme yöntemi şuanda kullanımda değildir

**Ödeme Yaptıktan Sonra Lütfen dekontu PDF veya ekran görüntüsü olarak buraya atın.Farklı Dekont Veya Ekran Görüntüsü Atan Kullanıcılar Yasaklanacaktır.**`;
        } else if (data === "pay_binance") {
            message = `**💰 Binance (USDT) ile ödeme bilgileri:**

USDT (TRC20) Adresi: \`${BINANCE_USDT}\`

Açıklama: \`Tron TRC20 USDT Adresidir. Farklı ağ veya Crypto ile ödeme yapılamaz gönderdiğiniz hatalı işlemlerden kullanıcı sorumludur.Mod Fiyatını tl cinsinden USD ye çevirin Karsılıgı kaç $ ise onu göndermeniz yeterlidir.\`

**Ödeme Yaptıktan Sonra Lütfen dekontu PDF veya ekran görüntüsü olarak buraya atın.Farklı Dekont Veya Ekran Görüntüsü Atan Kullanıcılar Yasaklanacaktır.**`;
        }

        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } else if (data.startsWith("approve_")) {
        const userId = data.split("_")[1];
        const sel = users[userId];
        if (!sel) return;

        // Instead of auto-sending key, ask admin to enter key + duration
        adminState[chatId] = { action: 'send_key', targetUserId: userId, product: sel.product, category: sel.category };
        return bot.sendMessage(
            chatId,
            `✅ Onay veriliyor: *${sel.product}*\n\nLütfen anahtarı ve süresini (gün) şu formatta girin:\n\n\`anahtar süre\`\n\nÖrnek: \`THE_BEST_KEY123 30\`\n\n(30 = 30 gün geçerli)`,
            { parse_mode: 'Markdown' }
        );
    } else if (data.startsWith("reject_")) {
        const userId = data.split("_")[1];
        const sel = users[userId];
        if (!sel) return;

        // Notify user about rejection
        bot.sendMessage(
            userId,
            `❌ **Ödemeniz reddedildi.**\n\nDekontunuz geçersiz veya hatalı bulundu. Lütfen doğru dekontu gönderin veya destek için iletişime geçin.`,
            { parse_mode: 'Markdown' }
        );

        bot.sendMessage(chatId, `❌ Kullanıcı *${userId}* için sipariş reddedildi.`, { parse_mode: 'Markdown' });
        delete users[userId];
    }
});

bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    const sel = users[chatId];

    // Admin interactive flows (edit price, edit desc, add product)
    if (adminState[chatId]) {
        const state = adminState[chatId];
        const products = loadProducts();

        // Admin sending key to user
        if (state.action === 'send_key') {
            const text = (msg.text || '').trim();
            const parts = text.split(/\s+/);
            if (parts.length < 2) {
                return bot.sendMessage(chatId, 'Geçersiz format. Lütfen şu şekilde girin: `anahtar süre`\nÖrnek: `THE_BEST_KEY123 30`', { parse_mode: 'Markdown' });
            }
            const key = parts.slice(0, -1).join(' '); // Allow spaces in key if needed
            const days = parseInt(parts[parts.length - 1], 10);
            if (isNaN(days) || days <= 0) {
                return bot.sendMessage(chatId, 'Geçersiz süre. Lütfen gün sayısını rakam olarak girin.');
            }

            const userId = state.targetUserId;
            const product = state.product;
            const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
            const orderId = `${userId}_${Date.now()}`;

            // Save key info
            activeKeys[orderId] = {
                oderId: orderId,
                chatId: parseInt(userId, 10),
                product: product,
                key: key,
                expiresAt: expiresAt,
                notified: false
            };
            saveKeys(activeKeys);

            // Send key to user
            const expiryDate = new Date(expiresAt).toLocaleDateString('tr-TR');
            bot.sendMessage(
                userId,
                `✅ **Ödemeniz onaylandı!**\n\n🔑 **Ürün Anahtarınız:**\n\`${key}\`\n\n📅 **Geçerlilik:** ${days} gün (${expiryDate} tarihine kadar)\n\nSatın Aldığınız Anahtar İle Aşağıdan @BestOfShopFiles_Bot'a Gidip Aldığınız Ürünü Seçerek Kurulum Dosyalarını İndirebilirsiniz.\n\n📥 Kurulum Dosyaları İçin: ${GROUP_LINK}`,
                { parse_mode: 'Markdown' }
            );

            // Confirm to admin
            bot.sendMessage(
                chatId,
                `✅ Anahtar gönderildi!\n\n👤 Kullanıcı: ${userId}\n📦 Ürün: ${product}\n🔑 Anahtar: \`${key}\`\n📅 Süre: ${days} gün`,
                { parse_mode: 'Markdown' }
            );

            delete adminState[chatId];
            delete users[userId];
            return;
        }

        // Admin: manuel anahtar ekleme
        if (state.action === 'add_key') {
            const text = (msg.text || '').trim();
            const parts = text.split(/\s+/);
            if (parts.length < 2) {
                return bot.sendMessage(chatId, 'Geçersiz format. Lütfen şu şekilde girin: `anahtar süre`\nÖrnek: `PREMIUM_KEY_123 30`', { parse_mode: 'Markdown' });
            }
            const key = parts.slice(0, -1).join('_'); // Boşlukları _ ile değiştir
            const days = parseInt(parts[parts.length - 1], 10);
            if (isNaN(days) || days <= 0) {
                return bot.sendMessage(chatId, 'Geçersiz süre. Lütfen gün sayısını rakam olarak girin.');
            }

            const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
            const orderId = `manual_${Date.now()}`;

            // Save key info
            activeKeys[orderId] = {
                oderId: orderId,
                chatId: ADMIN_ID, // Manuel eklenen için admin ID
                product: 'Manuel Eklenen',
                key: key,
                expiresAt: expiresAt,
                notified: false
            };
            saveKeys(activeKeys);

            const expiryDate = new Date(expiresAt).toLocaleDateString('tr-TR');
            delete adminState[chatId];
            return bot.sendMessage(chatId, `✅ **Anahtar eklendi!**\n\n🔑 Anahtar: \`${key}\`\n📅 Süre: ${days} gün (${expiryDate} tarihine kadar)`, { parse_mode: 'Markdown' });
        }

        if (state.action === 'edit_price') {
            const text = msg.text && msg.text.trim();
            const value = Number(text);
            if (!text || isNaN(value)) {
                return bot.sendMessage(chatId, 'Geçersiz fiyat. Lütfen sadece rakam girin.');
            }
            products[state.category][state.productName].price = value;
            saveProducts(products);
            delete adminState[chatId];
            return bot.sendMessage(chatId, `✅ *${state.productName}* için yeni fiyat ${value}₺ olarak kaydedildi.`, { parse_mode: 'Markdown' });
        }

        if (state.action === 'set_icon') {
            const text = (msg.text || '').trim();
            if (!text) return bot.sendMessage(chatId, 'Geçersiz ikon. Lütfen bir emoji veya kısa karakter girin.');
            if (state.target === 'category') {
                ICONS[state.category] = text;
                saveIcons(ICONS);
                delete adminState[chatId];
                return bot.sendMessage(chatId, `✅ *${state.category}* için ikon olarak ${text} ayarlandı.`, { parse_mode: 'Markdown' });
            }
            if (state.target === 'product') {
                const key = `prod:${state.category}|${state.productName}`;
                ICONS[key] = text;
                saveIcons(ICONS);
                delete adminState[chatId];
                return bot.sendMessage(chatId, `✅ *${state.productName}* için ikon olarak ${text} ayarlandı.`, { parse_mode: 'Markdown' });
            }
        }

        if (state.action === 'edit_desc') {
            const text = msg.text || '';
            const descPath = path.join(__dirname, 'descriptions', `${state.productName}.txt`);
            fs.writeFileSync(descPath, text, 'utf-8');
            delete adminState[chatId];
            return bot.sendMessage(chatId, `✅ *${state.productName}* açıklaması güncellendi.`, { parse_mode: 'Markdown' });
        }

        if (state.action === 'add_category') {
            const text = (msg.text || '').trim();
            if (state.step === 1) {
                if (!text) return bot.sendMessage(chatId, 'Geçersiz kategori adı. Tekrar deneyin.');
                if (products[text]) return bot.sendMessage(chatId, 'Bu kategori zaten mevcut. Başka bir isim girin.');
                products[text] = {};
                saveProducts(products);
                state.buffer.category = text;
                state.action = 'add_product';
                state.step = 2;
                return bot.sendMessage(chatId, `✅ *${text}* kategorisi oluşturuldu!\nŞimdi bu kategoriye eklenecek ürün adını girin:`, { parse_mode: 'Markdown' });
            }
        }

        if (state.action === 'add_product') {
            const text = (msg.text || '').trim();
            if (state.step === 1) {
                state.buffer.category = text;
                state.step = 2;
                return bot.sendMessage(chatId, 'Ürün adı girin:');
            }
            if (state.step === 2) {
                state.buffer.productName = text;
                state.step = 3;
                return bot.sendMessage(chatId, 'Fiyat girin (sadece rakam):');
            }
            if (state.step === 3) {
                const value = Number(text);
                if (!text || isNaN(value)) return bot.sendMessage(chatId, 'Geçersiz fiyat. Lütfen sadece rakam girin.');
                const cat = state.buffer.category;
                const prod = state.buffer.productName;
                if (!products[cat]) products[cat] = {};
                products[cat][prod] = { price: value, stock: [] };
                saveProducts(products);
                state.step = 4;
                return bot.sendMessage(chatId, 'Ürün eklendi. İsterseniz şimdi açıklama gönderin (metin) veya "skip" yazarak atlayın.');
            }
            if (state.step === 4) {
                if ((msg.text || '').toLowerCase() === 'skip') {
                    delete adminState[chatId];
                    return bot.sendMessage(chatId, 'Tamam. Açıklama atlandı. İşlem tamamlandı.');
                }
                const desc = msg.text || '';
                const prodName = state.buffer.productName;
                const descPath = path.join(__dirname, 'descriptions', `${prodName}.txt`);
                fs.writeFileSync(descPath, desc, 'utf-8');
                delete adminState[chatId];
                return bot.sendMessage(chatId, `✅ Ürün ve açıklama başarıyla kaydedildi: *${prodName}*`, { parse_mode: 'Markdown' });
            }
        }
    }

    // Existing flow: forward payment receipts/photos to admin
    if ((msg.document || msg.photo) && sel) {
        const products = loadProducts();
        const price = products[sel.category]?.[sel.product]?.price || '?';
        
        bot.forwardMessage(ADMIN_ID, chatId, msg.message_id).then((forwardedMsg) => {
            bot.sendMessage(
                ADMIN_ID,
                `🛒 Kullanıcı *${chatId}* '*${sel.product}*' için ödeme yaptı.\n\n💰 Fiyat: ${price}₺\n\nOnaylıyor musunuz?`,
                {
                    parse_mode: "Markdown",
                    reply_to_message_id: forwardedMsg.message_id,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "✅ Onayla",
                                    callback_data: `approve_${chatId}`,
                                },
                                {
                                    text: "❌ Reddet",
                                    callback_data: `reject_${chatId}`,
                                },
                            ],
                        ],
                    },
                },
            );
        }).catch((err) => {
            console.error('Forward/approval error:', err);
            // Fallback: send without reply
            bot.sendMessage(
                ADMIN_ID,
                `🛒 Kullanıcı *${chatId}* '*${sel.product}*' için ödeme yaptı.\n\n💰 Fiyat: ${price}₺\n\nOnaylıyor musunuz?`,
                {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "✅ Onayla",
                                    callback_data: `approve_${chatId}`,
                                },
                                {
                                    text: "❌ Reddet",
                                    callback_data: `reject_${chatId}`,
                                },
                            ],
                        ],
                    },
                },
            );
        });
        bot.sendMessage(
            chatId,
            "**Dekontunuz alındı. Kontrol Edildikten Ve Admin onayından sonra ürününüz teslim edilecektir.Yoğunluğa Göre Süre Uzayabilir.Lütfen Bekleyiniz.Teşekkür Ederiz**",
            { parse_mode: "Markdown" },
        );
    }
});

// ============================================================
// =================== FILES BOT ENTEGRASYONU =================
// ============================================================

if (filesBot) {
    const FILES_DELETE_DELAY_MS = 8 * 60 * 1000; // 8 dakika sonra sil
    const filesUserSessions = new Map();
    const filesProductUploads = new Map();
    const FILES_PRODUCTS_FILE = path.join(__dirname, 'files_products.json');

    // Dosya ürünlerini yükle
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

    // Dosya ürünlerini kaydet
    function saveFilesProducts() {
        const obj = {};
        for (const [name, product] of filesProductUploads.entries()) {
            obj[name] = product;
        }
        fs.writeFileSync(FILES_PRODUCTS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    }

    // Otomatik silmeli gönderim
    function filesSendAndDelete(method, chatId, payload, options = {}) {
        filesBot[method](chatId, payload, options).then(sent => {
            setTimeout(() => {
                filesBot.deleteMessage(chatId, sent.message_id).catch(() => {});
            }, FILES_DELETE_DELAY_MS);
        }).catch(() => {});
    }

    // Anahtar doğrulama - Shop bot'un keys.json'unu kullan
    function isValidFilesKey(key) {
        // Shop bot'un activeKeys'inden kontrol et
        for (const orderId in activeKeys) {
            const entry = activeKeys[orderId];
            if (entry.key === key && entry.expiresAt > Date.now()) {
                return true;
            }
        }
        return false;
    }

    // Anahtar bilgisini getir
    function getKeyInfo(key) {
        for (const orderId in activeKeys) {
            const entry = activeKeys[orderId];
            if (entry.key === key && entry.expiresAt > Date.now()) {
                return entry;
            }
        }
        return null;
    }

    // Menü oluştur - Shop bot'un products.json'undan al
    function getFilesDynamicMenu() {
        const shopProducts = loadProducts();
        const allProducts = [];
        
        // Tüm kategorilerdeki ürünleri topla
        for (const category in shopProducts) {
            for (const productName in shopProducts[category]) {
                allProducts.push(productName);
            }
        }
        
        // Files bot'a özel ürünler varsa onları da ekle
        for (const name of filesProductUploads.keys()) {
            if (!allProducts.includes(name)) {
                allProducts.push(name);
            }
        }
        
        const keyboard = [];
        for (let i = 0; i < allProducts.length; i += 2) {
            const row = [allProducts[i]];
            if (allProducts[i + 1]) row.push(allProducts[i + 1]);
            keyboard.push(row);
        }
        return {
            reply_markup: {
                keyboard,
                resize_keyboard: true,
                one_time_keyboard: true
            }
        };
    }

    // FILES BOT: /start
    filesBot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        filesUserSessions.set(chatId, { step: 'awaiting_key' });
        filesSendAndDelete('sendMessage', chatId, '🔐 Lütfen ürün anahtarınızı girin:');
    });

    // FILES BOT: Admin state
    const filesAdminState = {};

    // FILES BOT: /admin paneli
    filesBot.onText(/\/admin/, (msg) => {
        const chatId = msg.chat.id;
        if (chatId !== ADMIN_ID) return filesBot.sendMessage(chatId, "Yetkisiz.");

        const productCount = filesProductUploads.size;
        filesBot.sendMessage(chatId, `**📁 Files Bot Admin Paneli**\n\nToplam ürün: ${productCount}`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📦 Ürünleri Yönet', callback_data: 'files_products' }],
                    [{ text: '➕ Yeni Ürün Ekle', callback_data: 'files_add_product' }],
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

        // Ürünleri listele
        if (data === 'files_products') {
            const products = Array.from(filesProductUploads.keys());
            if (products.length === 0) {
                return filesBot.sendMessage(chatId, '📦 Henüz ürün yok. "➕ Yeni Ürün Ekle" ile ekleyin.');
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

        // Ürün detayı
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
                        [{ text: '� Güncelle (Eski Dosyaları Sil)', callback_data: 'files_update_prod' }],
                        [{ text: '�🗑 Ürünü Sil', callback_data: 'files_delete_prod' }],
                        [{ text: '🔙 Geri', callback_data: 'files_products' }],
                    ],
                },
            });
        }

        // Yeni ürün ekle
        if (data === 'files_add_product') {
            filesAdminState[chatId] = { action: 'add_product' };
            return filesBot.sendMessage(chatId, '📦 **Yeni Ürün Ekleme**\n\nÜrün adını yazın:', { parse_mode: 'Markdown' });
        }

        // Açıklama düzenle
        if (data === 'files_edit_desc') {
            const productName = filesAdminState[chatId]?.currentProduct;
            if (!productName) return filesBot.sendMessage(chatId, '❌ Önce bir ürün seçin.');
            filesAdminState[chatId] = { action: 'edit_desc', currentProduct: productName };
            return filesBot.sendMessage(chatId, `📄 **${productName}** için açıklama yazın:\n\n(Metin veya fotoğraf+caption gönderebilirsiniz)`, { parse_mode: 'Markdown' });
        }

        // Dosya ekle
        if (data === 'files_add_file') {
            const productName = filesAdminState[chatId]?.currentProduct;
            if (!productName) return filesBot.sendMessage(chatId, '❌ Önce bir ürün seçin.');
            filesAdminState[chatId] = { action: 'add_file', currentProduct: productName };
            return filesBot.sendMessage(chatId, `📁 **${productName}** için dosya gönderin:\n\n(Belge, video veya fotoğraf gönderebilirsiniz)\n\nBitirince "tamam" yazın.`, { parse_mode: 'Markdown' });
        }

        // Ürün güncelle - eski dosyaları sil, yeni ekleme moduna al
        if (data === 'files_update_prod') {
            const productName = filesAdminState[chatId]?.currentProduct;
            if (!productName) return filesBot.sendMessage(chatId, '❌ Önce bir ürün seçin.');
            
            const product = filesProductUploads.get(productName);
            if (!product) return filesBot.sendMessage(chatId, '❌ Ürün bulunamadı.');
            
            const oldFileCount = product.files?.length || 0;
            const hadDesc = product.description ? true : false;
            
            // Eski dosyaları ve açıklamayı sil
            product.description = '';
            product.files = [];
            saveFilesProducts();
            
            // Dosya ekleme moduna al
            filesAdminState[chatId] = { action: 'add_file', currentProduct: productName, isUpdate: true };
            
            let msg = `🔄 **${productName}** güncelleniyor\n\n`;
            msg += `🗑 Silinen: ${oldFileCount} dosya${hadDesc ? ' + açıklama' : ''}\n\n`;
            msg += `📁 Şimdi yeni dosyaları gönderin.\n`;
            msg += `📄 Açıklama eklemek için önce dosyaları bitirin ("tamam" yazın).\n\n`;
            msg += `Dosya göndermeye başlayın:`;
            
            return filesBot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        }

        // Ürün sil
        if (data === 'files_delete_prod') {
            const productName = filesAdminState[chatId]?.currentProduct;
            if (!productName) return filesBot.sendMessage(chatId, '❌ Önce bir ürün seçin.');
            filesProductUploads.delete(productName);
            saveFilesProducts();
            delete filesAdminState[chatId];
            return filesBot.sendMessage(chatId, `✅ **${productName}** silindi.`, { parse_mode: 'Markdown' });
        }

        // Anahtarları yönet - Shop bot'a yönlendir
        if (data === 'files_keys') {
            const keyCount = Object.keys(activeKeys).length;
            const keyList = Object.values(activeKeys).slice(0, 5);
            let text = `**🔑 Aktif Anahtarlar** (${keyCount} adet)\n\n`;
            keyList.forEach((entry, i) => {
                const daysLeft = Math.ceil((entry.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
                text += `${i + 1}. \`${entry.key}\` - ${daysLeft > 0 ? daysLeft + ' gün' : 'Süresi dolmuş'}\n`;
            });
            if (keyCount > 5) text += `\n... ve ${keyCount - 5} anahtar daha`;
            text += '\n\n💡 Anahtar eklemek için Shop Bot\'ta /admin → Anahtarları Yönet';
            return filesBot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        }

        // Geri
        if (data === 'files_back') {
            delete filesAdminState[chatId];
            const productCount = filesProductUploads.size;
            return filesBot.sendMessage(chatId, `**📁 Files Bot Admin Paneli**\n\nToplam ürün: ${productCount}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📦 Ürünleri Yönet', callback_data: 'files_products' }],
                        [{ text: '➕ Yeni Ürün Ekle', callback_data: 'files_add_product' }],
                        [{ text: '🔑 Anahtarları Yönet', callback_data: 'files_keys' }],
                    ],
                },
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
            if (isValidFilesKey(text)) {
                filesUserSessions.set(chatId, { step: 'validated', key: text });
                const menu = getFilesDynamicMenu();
                filesSendAndDelete('sendMessage', chatId, '✅ Anahtar doğrulandı. Ürün menüsüne erişebilirsiniz.', menu);
            } else {
                filesSendAndDelete('sendMessage', chatId, '❌ Geçersiz veya süresi dolmuş anahtar.');
            }
            return;
        }

        // Ürün seçimi - Shop bot ürünleri veya Files bot ürünleri
        if (session && session.step === 'validated' && text && !text.startsWith('/')) {
            // Önce Files bot'a özel ürünlerde ara
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
                    filesSendAndDelete('sendMessage', chatId, '📁 Bu ürün için henüz dosya eklenmemiş.\n\nAdmin tarafından dosya eklenmesini bekleyin.');
                }
                return;
            }

            // Shop bot ürünlerinde ara
            const shopProducts = loadProducts();
            let foundProduct = null;
            let foundCategory = null;
            for (const category in shopProducts) {
                if (shopProducts[category][text]) {
                    foundProduct = text;
                    foundCategory = category;
                    break;
                }
            }

            if (foundProduct) {
                // Files bot'ta bu ürün için dosya var mı kontrol et
                if (filesProductUploads.has(foundProduct)) {
                    const product = filesProductUploads.get(foundProduct);
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
                        return;
                    }
                }
                // Dosya yoksa bilgi ver
                filesSendAndDelete('sendMessage', chatId, `📦 *${foundProduct}*\n\n📁 Bu ürün için henüz dosya eklenmemiş.\n\nAdmin Files bot'tan \`/ekle ${foundProduct}\` komutuyla dosya ekleyebilir.`, { parse_mode: 'Markdown' });
                return;
            }

            // Ürün bulunamadı
            const menu = getFilesDynamicMenu();
            filesSendAndDelete('sendMessage', chatId, '❌ Ürün bulunamadı. Lütfen menüden seçin.', menu);
        }
    });

    // FILES BOT: Ürün ekleme (admin)
    filesBot.onText(/\/ekle (.+)/, (msg, match) => {
        if (msg.from.id !== ADMIN_ID) return;

        const productName = match[1].trim();
        if (!productName) return filesSendAndDelete('sendMessage', msg.chat.id, "❌ Ürün adı eksik.");

        filesProductUploads.set(productName, { description: '', files: [] });
        saveFilesProducts();
        filesSendAndDelete('sendMessage', msg.chat.id, `✅ '${productName}' ürünü için dosya eklemeye hazırım. Lütfen dosyaları bu sohbette gönderin.`);
    });

    // FILES BOT: Menü silme (admin)
    filesBot.onText(/\/menüsil (.+)/, (msg, match) => {
        if (msg.from.id !== ADMIN_ID) return;
        const productName = match[1].trim();

        if (!filesProductUploads.has(productName)) {
            return filesSendAndDelete('sendMessage', msg.chat.id, `❌ '${productName}' adlı ürün bulunamadı.`);
        }

        filesProductUploads.delete(productName);
        saveFilesProducts();
        filesSendAndDelete('sendMessage', msg.chat.id, `🗑 '${productName}' menüden silindi.`);
    });

    // FILES BOT: Dosya yükleme (admin) - Admin panel state ile çalışır
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
        
        // Açıklama için fotoğraf mı, dosya için fotoğraf mı?
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

    // FILES BOT: Admin mesaj handler (ürün adı, açıklama, tamam)
    filesBot.on('message', (msg) => {
        if (msg.from.id !== ADMIN_ID) return;
        if (msg.text?.startsWith('/')) return;
        if (msg.document || msg.video || msg.photo) return; // Dosyalar yukarıda işleniyor
        
        const chatId = msg.chat.id;
        const text = (msg.text || '').trim();
        const state = filesAdminState[chatId];
        
        if (!state) return;

        // Yeni ürün ekleme - ürün adı
        if (state.action === 'add_product') {
            if (!text) return filesBot.sendMessage(chatId, '❌ Geçersiz ürün adı.');
            if (filesProductUploads.has(text)) return filesBot.sendMessage(chatId, '⚠️ Bu ürün zaten mevcut.');
            
            filesProductUploads.set(text, { description: '', files: [] });
            saveFilesProducts();
            filesAdminState[chatId] = { currentProduct: text };
            
            return filesBot.sendMessage(chatId, `✅ **${text}** oluşturuldu!\n\nŞimdi ne yapmak istiyorsunuz?`, {
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

        // Açıklama ekleme
        if (state.action === 'edit_desc') {
            const productName = state.currentProduct;
            if (!productName || !filesProductUploads.has(productName)) return;
            
            filesProductUploads.get(productName).description = text;
            saveFilesProducts();
            delete filesAdminState[chatId];
            return filesBot.sendMessage(chatId, `✅ **${productName}** açıklaması kaydedildi.`, { parse_mode: 'Markdown' });
        }

        // Dosya ekleme bitir
        if (state.action === 'add_file' && text.toLowerCase() === 'tamam') {
            const productName = state.currentProduct;
            const product = filesProductUploads.get(productName);
            const fileCount = product?.files?.length || 0;
            const isUpdate = state.isUpdate;
            
            // Güncelleme modundaysa açıklama ekleme seçeneği sun
            if (isUpdate) {
                filesAdminState[chatId] = { currentProduct: productName };
                return filesBot.sendMessage(chatId, `✅ **${productName}** için ${fileCount} dosya eklendi.\n\nŞimdi ne yapmak istiyorsunuz?`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📄 Açıklama Ekle', callback_data: 'files_edit_desc' }],
                            [{ text: '✅ Tamamla', callback_data: 'files_back' }],
                        ],
                    },
                });
            }
            
            delete filesAdminState[chatId];
            return filesBot.sendMessage(chatId, `✅ **${productName}** için ${fileCount} dosya kaydedildi.`, { parse_mode: 'Markdown' });
        }
    });

    console.log('Files bot handlers registered.');
}
