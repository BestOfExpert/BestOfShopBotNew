const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");

const token = "7545067961:AAGEeXPWdG4f3o-w8b5EvIFhsdzxz8Mc_yI"; // Tokenini buraya yaz
const bot = new TelegramBot(token, { polling: true });

const ADMIN_ID = 1447919062;
const IBAN = "TR45 0001 0004 8875 9375 7450 07";
const PAPARA_KODU = "2096561589";
const BINANCE_USDT = "TWdjyffvtyhbwuQzrNdh3A215EG6cNPWVL";
const GROUP_LINK = "@BestOfShopFiles_Bot";

let users = {};
let userState = {};

function loadProducts() {
    return JSON.parse(fs.readFileSync("./products.json"));
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

bot.on("callback_query", (query) => {
    const chatId = query.from.id;
    const data = query.data;
    const products = loadProducts();

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

        bot.sendMessage(
            chatId,
            `**Ürün:** ${productName}
            
**Özellikler:**

${description}

**Fiyat:** ${price}₺

**Ödeme yöntemini seçin:**`,
            {
                parse_mode: "Markdown",
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

Açıklama: \`8595962689\`

Alıcı Adı: \`MYPAYZ ÖDEME KURULUŞU A.Ş.\`

‼️ **Dikkat:** Açıklamadaki numarayı yazmassanız ödeme bize geçmez!Lütfen Açıklamaya 8595962689 yazmayı unutmayın.

**Ödeme Yaptıktan Sonra Lütfen dekontu PDF veya ekran görüntüsü olarak buraya atın.Farklı Dekont Veya Ekran Görüntüsü Atan Kullanıcılar Yasaklanacaktır.**`;
        } else if (data === "pay_papara") {
            message = `**🏦 Papara ile ödeme bilgileri:**

Papara Numarası: \`${PAPARA_KODU}\`

Açıklama: Boş Bırakın

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

📥 Kurulum için kanal (Aşağıdaki Files Bot a Tıklayın Start Diyin Satın Aldığınız Anahtarı virgül olmadan girin Ordan Aldığınız Ürünü Seçin Otomatik Kurulum Dosyaları Gelecektir Bot: ): ${GROUP_LINK}`,
            {
                parse_mode: "HTML",
            },
        );

        bot.sendMessage(ADMIN_ID, `✅ Sipariş teslim edildi: ${userId}`);
    }
});

bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    const sel = users[chatId];
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
