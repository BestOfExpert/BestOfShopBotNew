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
        { text: cat, callback_data: "cat_" + cat },
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
    const data = query.data;
    const products = loadProducts();
    // Admin callbacks
    if (data === 'admin_products' && chatId === ADMIN_ID) {
        const categories = Object.keys(products);
        const buttons = categories.map((cat) => [
            { text: cat, callback_data: `admin_cat_${encodeURIComponent(cat)}` },
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
            { text: p, callback_data: `admin_prod_${encodeURIComponent(category)}|${encodeURIComponent(p)}` },
        ]);
        return bot.sendMessage(chatId, `**${category}** — Ürün seçin:`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [...buttons, [{ text: '🔙 Geri', callback_data: 'admin_products' }]] },
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
                    [{ text: '✏️ Fiyatı Düzenle', callback_data: `admin_edit_price|${encodeURIComponent(category)}|${encodeURIComponent(productName)}` }],
                    [{ text: '📝 Açıklamayı Düzenle', callback_data: `admin_edit_desc|${encodeURIComponent(category)}|${encodeURIComponent(productName)}` }],
                    [{ text: '🗑 Ürünü Sil', callback_data: `admin_delete|${encodeURIComponent(category)}|${encodeURIComponent(productName)}` }],
                    [{ text: '🔙 Geri', callback_data: `admin_cat_${encodeURIComponent(category)}` }],
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
        adminState[chatId] = { action: 'add_product', step: 1, buffer: {} };
        return bot.sendMessage(chatId, 'Yeni ürün ekleme: Hangi kategoriye eklemek istiyorsunuz? (Kategori adı yazın)');
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
                text: `📦 ${name}`,
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

        const stock = products[sel.category][sel.product].stock || [];
        const key = stock.shift();
        if (!key)
            return bot.sendMessage(userId, "**Üzgünüz, ürün stokta yok.**", {
                parse_mode: "Markdown",
            });

        products[sel.category][sel.product].stock = stock;
        fs.writeFileSync("./products.json", JSON.stringify(products, null, 2));

        bot.sendMessage(
            userId,
            `✅ **Ödemeniz onaylandı.**

🔑 **Ürün Anahtarınız:**
\`${key}\`

Satın Aldığınız Anahtar İle Aşagıdan @BestOfShopFiles_Bot'a Gidip Aldıgınız Ürünü Seçerek Kurulum Dosyalarını İndirebilirsiniz.

📥 Kurulum Dosyaları İçin: ${GROUP_LINK}`,
            {
                parse_mode: "HTML",
            },
        );

        bot.sendMessage(
            ADMIN_ID,
            `✅ Sipariş teslim edildi. Kullanıcı: ${userId} | Ürün: ${sel.product} | Kod: ${key}`,
        );
    }
});

bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    const sel = users[chatId];

    // Admin interactive flows (edit price, edit desc, add product)
    if (adminState[chatId]) {
        const state = adminState[chatId];
        const products = loadProducts();

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

        if (state.action === 'edit_desc') {
            const text = msg.text || '';
            const descPath = path.join(__dirname, 'descriptions', `${state.productName}.txt`);
            fs.writeFileSync(descPath, text, 'utf-8');
            delete adminState[chatId];
            return bot.sendMessage(chatId, `✅ *${state.productName}* açıklaması güncellendi.`, { parse_mode: 'Markdown' });
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
        bot.forwardMessage(ADMIN_ID, chatId, msg.message_id);
        bot.sendMessage(
            ADMIN_ID,
            `🛒 Kullanıcı *${chatId}* '${sel.product}' için ödeme yaptı. Onaylıyor musunuz?`,
            {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "✅ Onayla",
                                callback_data: `approve_${chatId}`,
                            },
                        ],
                    ],
                },
            },
        );
        bot.sendMessage(
            chatId,
            "**Dekontunuz alındı. Kontrol Edildikten Ve Admin onayından sonra ürününüz teslim edilecektir.Yoğunluğa Göre Süre Uzayabilir.Lütfen Bekleyiniz.Teşekkür Ederiz**",
            { parse_mode: "Markdown" },
        );
    }
});
