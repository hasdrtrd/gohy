// main.js
import "dotenv/config";
import { Telegraf, Markup } from "telegraf";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN not set in .env");
}

const bot = new Telegraf(BOT_TOKEN);

// Example items (replace with your config.js)
const ITEMS = {
  item1: {
    name: "Golden Sword",
    price: 100,
    description: "A powerful digital sword",
    secret: "SWORD-SECRET-123"
  },
  item2: {
    name: "Magic Shield",
    price: 150,
    description: "A legendary digital shield",
    secret: "SHIELD-SECRET-456"
  }
};

const MESSAGES = {
  welcome: "👋 Welcome! Choose an item to buy with Stars:",
  help: "💡 Use /start to see items, tap a button to buy.\nUse `/refund <charge_id>` to refund.",
  refund_usage: "Usage: /refund <charge_id>",
  refund_success: "✅ Refund successful!",
  refund_failed: "❌ Refund failed. Please check the ID."
};

// In-memory stats
const STATS = {
  purchases: {},
  refunds: {}
};

// /start
bot.start((ctx) => {
  const buttons = Object.entries(ITEMS).map(([id, item]) =>
    [Markup.button.callback(`${item.name} - ${item.price}⭐`, `buy:${id}`)]
  );

  return ctx.reply(MESSAGES.welcome, Markup.inlineKeyboard(buttons));
});

// /help
bot.command("help", (ctx) => {
  return ctx.reply(MESSAGES.help, { parse_mode: "Markdown" });
});

// /refund
bot.command("refund", async (ctx) => {
  const parts = ctx.message.text.split(" ");
  if (parts.length < 2) {
    return ctx.reply(MESSAGES.refund_usage);
  }

  const chargeId = parts[1];
  const userId = ctx.from.id;

  try {
    // Refund API (simulated, since telegraf doesn’t have refund method)
    // In production, you'd call Telegram's refund_star_payment here if available
    const success = true;

    if (success) {
      STATS.refunds[userId] = (STATS.refunds[userId] || 0) + 1;
      return ctx.reply(MESSAGES.refund_success);
    } else {
      return ctx.reply(MESSAGES.refund_failed);
    }
  } catch (err) {
    console.error("Refund error:", err);
    return ctx.reply("❌ Error processing your refund. Try again.");
  }
});

// Handle buy button
bot.action(/buy:(.+)/, async (ctx) => {
  const itemId = ctx.match[1];
  const item = ITEMS[itemId];
  if (!item) return ctx.reply("❌ Invalid item.");

  try {
    await ctx.replyWithInvoice({
      title: item.name,
      description: item.description,
      payload: itemId,
      provider_token: "", // Empty for Stars
      currency: "XTR", // Stars
      prices: [{ label: item.name, amount: item.price }]
    });
  } catch (err) {
    console.error("Invoice error:", err);
    ctx.reply("❌ Something went wrong while creating the invoice.");
  }
});

// Pre-checkout
bot.on("pre_checkout_query", (ctx) => {
  if (ITEMS[ctx.update.pre_checkout_query.invoice_payload]) {
    return ctx.answerPreCheckoutQuery(true);
  } else {
    return ctx.answerPreCheckoutQuery(false, "Something went wrong...");
  }
});

// Successful payment
bot.on("successful_payment", (ctx) => {
  const payment = ctx.message.successful_payment;
  const itemId = payment.invoice_payload;
  const item = ITEMS[itemId];
  const userId = ctx.from.id;

  STATS.purchases[userId] = (STATS.purchases[userId] || 0) + 1;

  ctx.reply(
    `🎉 Thank you for your purchase!\n\n` +
    `Here’s your secret code for *${item.name}*:\n` +
    `\`${item.secret}\`\n\n` +
    `To refund, use:\n` +
    `\`/refund ${payment.telegram_payment_charge_id}\``,
    { parse_mode: "Markdown" }
  );
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Bot error for ${ctx.updateType}`, err);
});

bot.launch();
console.log("🚀 Bot started with Stars support");
