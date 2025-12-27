const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");

// Load local `.env` when running locally (optional). Install `dotenv` if you want this behavior.
try { require('dotenv').config(); } catch (e) {}

// Prefer environment variable `BOT_TOKEN` (set this in Railway env). A fallback hard-coded token remains for
// development: `.env` will be loaded by `dotenv` if present. In production always set `BOT_TOKEN`.
const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('FATAL: BOT_TOKEN environment variable is not set. Set BOT_TOKEN in Railway (or create a local .env for development).');
    process.exit(1);
}
const bot = new TelegramBot(token, { polling: true });

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
                [{ text: "📣 Menüyü Gönder (Preview)", callback_data: "admin_preview_menu" }],
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
        const buttons = prodNames.map((p) => [
            { text: `${ICONS[`prod:${category}|${p}`] || ICONS.defaultProduct} ${p}`, callback_data: makeCallbackRef({ type: 'admin_prod', category, product: p }) },
        ]);
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
        adminState[chatId] = { action: null, category, productName };
        return bot.sendMessage(chatId, `Seçildi: *${productName}*\nNe yapmak istiyorsunuz?`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✏️ Fiyatı Düzenle', callback_data: makeCallbackRef({ type: 'admin_edit_price', category, product: productName }) }],
                    [{ text: '📝 Açıklamayı Düzenle', callback_data: makeCallbackRef({ type: 'admin_edit_desc', category, product: productName }) }],
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

        const buttons = subProducts.map((name) => [
            {
                text: `${ICONS.defaultProduct} ${name}`,
                callback_data: `product_${name}`,
            },
        ]);

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
            return bot.sendMessage(chatId, "Ürün bulunamadı.");
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
            return bot.sendMessage(chatId, "Lütfen önce bir ürün seçin.");

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
