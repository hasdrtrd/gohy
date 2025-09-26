const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Store for tracking payments and statistics
const paymentStore = new Map();
const stats = {
    totalSales: 0,
    totalRevenue: 0,
    refundCount: 0
};

// Middleware for error handling
bot.use(async (ctx, next) => {
    try {
        await next();
    } catch (error) {
        console.error('Bot error:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
});

// Start command
bot.command('start', async (ctx) => {
    const welcomeMessage = `
🌟 Welcome to Digital Stars Shop! 🌟

I can sell you digital items using Telegram Stars ⭐️

Available commands:
/start - View available items for purchase
/help - Show help message  
/refund - Request a refund (requires transaction ID)

Choose an item below to purchase:
    `;

    const keyboard = Markup.inlineKeyboard(
        config.items.map(item => [
            Markup.button.callback(
                `${item.emoji} ${item.name} - ${item.price} ⭐️`,
                `buy_${item.id}`
            )
        ])
    );

    await ctx.reply(welcomeMessage, keyboard);
});

// Help command
bot.command('help', async (ctx) => {
    const helpMessage = `
🆘 Help - Digital Stars Shop

Available commands:
• /start - View available items for purchase
• /help - Show this help message
• /refund - Request a refund for a previous purchase

How it works:
1. Choose an item from the menu
2. Complete payment with Telegram Stars ⭐️
3. Receive your digital item instantly
4. You can request a refund within 24 hours

Need support? Contact @your_support_handle
    `;

    await ctx.reply(helpMessage);
});

// Refund command
bot.command('refund', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    
    if (args.length === 0) {
        await ctx.reply(
            'To request a refund, please provide your transaction ID:\n\n' +
            'Example: /refund your_transaction_id_here\n\n' +
            'You can find the transaction ID in your payment confirmation message.'
        );
        return;
    }

    const transactionId = args[0];
    
    try {
        // Check if payment exists in our store
        const paymentData = paymentStore.get(transactionId);
        
        if (!paymentData) {
            await ctx.reply(
                '❌ Transaction not found or already refunded.\n\n' +
                'Please check your transaction ID and try again.'
            );
            return;
        }

        // Process refund using Telegram Bot API
        const refundResult = await ctx.telegram.refundStarPayment(
            ctx.from.id,
            transactionId
        );

        if (refundResult) {
            // Remove from payment store
            paymentStore.delete(transactionId);
            
            // Update statistics
            stats.refundCount++;
            stats.totalRevenue -= paymentData.amount;
            
            await ctx.reply(
                '✅ Refund processed successfully!\n\n' +
                `Amount: ${paymentData.amount} ⭐️\n` +
                'The stars will be returned to your balance shortly.'
            );
            
            console.log(`Refund processed: ${transactionId} - ${paymentData.amount} stars`);
        }
    } catch (error) {
        console.error('Refund error:', error);
        
        if (error.description?.includes('CHARGE_NOT_FOUND')) {
            await ctx.reply('❌ Transaction not found. Please check your transaction ID.');
        } else if (error.description?.includes('CHARGE_ALREADY_REFUNDED')) {
            await ctx.reply('❌ This transaction has already been refunded.');
        } else {
            await ctx.reply(
                '❌ Unable to process refund at this time.\n\n' +
                'Please try again later or contact support.'
            );
        }
    }
});

// Handle item purchase callbacks
bot.action(/^buy_(.+)$/, async (ctx) => {
    const itemId = ctx.match[1];
    const item = config.items.find(i => i.id === itemId);
    
    if (!item) {
        await ctx.answerCbQuery('Item not found');
        return;
    }

    try {
        // Create invoice for Telegram Stars payment
        await ctx.replyWithInvoice({
            title: item.name,
            description: item.description,
            payload: JSON.stringify({
                itemId: item.id,
                userId: ctx.from.id,
                timestamp: Date.now()
            }),
            provider_token: '', // Empty for Stars payments
            currency: 'XTR', // Telegram Stars currency code
            prices: [{
                label: item.name,
                amount: item.price // Price in Stars
            }],
            photo_url: item.photo_url,
            photo_size: item.photo_size || 512,
            photo_width: item.photo_width || 512,
            photo_height: item.photo_height || 512,
            need_name: false,
            need_phone_number: false,
            need_email: false,
            need_shipping_address: false,
            send_phone_number_to_provider: false,
            send_email_to_provider: false,
            is_flexible: false
        });

        await ctx.answerCbQuery();
        
    } catch (error) {
        console.error('Invoice creation error:', error);
        await ctx.answerCbQuery('Unable to create invoice. Please try again.');
    }
});

// Handle pre-checkout queries
bot.on('pre_checkout_query', async (ctx) => {
    try {
        const payload = JSON.parse(ctx.preCheckoutQuery.invoice_payload);
        const item = config.items.find(i => i.id === payload.itemId);
        
        if (!item || payload.userId !== ctx.from.id) {
            await ctx.answerPreCheckoutQuery(false, 'Invalid item or user mismatch');
            return;
        }

        // Validate payment amount
        if (ctx.preCheckoutQuery.total_amount !== item.price) {
            await ctx.answerPreCheckoutQuery(false, 'Invalid payment amount');
            return;
        }

        await ctx.answerPreCheckoutQuery(true);
        
    } catch (error) {
        console.error('Pre-checkout error:', error);
        await ctx.answerPreCheckoutQuery(false, 'Payment validation failed');
    }
});

// Handle successful payments
bot.on('successful_payment', async (ctx) => {
    try {
        const payment = ctx.message.successful_payment;
        const payload = JSON.parse(payment.invoice_payload);
        const item = config.items.find(i => i.id === payload.itemId);
        
        if (!item) {
            console.error('Item not found for successful payment:', payload.itemId);
            return;
        }

        // Store payment data for potential refunds
        const transactionId = payment.telegram_payment_charge_id;
        paymentStore.set(transactionId, {
            itemId: item.id,
            userId: ctx.from.id,
            amount: payment.total_amount,
            timestamp: Date.now()
        });

        // Update statistics
        stats.totalSales++;
        stats.totalRevenue += payment.total_amount;

        // Send the digital item (secret code)
        const successMessage = `
🎉 Payment Successful! 🎉

You have successfully purchased: ${item.emoji} ${item.name}

🔐 Your Secret Code: \`${item.secret_code}\`

💫 Stars Paid: ${payment.total_amount} ⭐️
🆔 Transaction ID: \`${transactionId}\`

Thank you for your purchase! 

ℹ️ You can request a refund within 24 hours using:
/refund ${transactionId}
        `;

        await ctx.reply(successMessage, { parse_mode: 'Markdown' });
        
        console.log(`Sale completed: ${item.name} - ${payment.total_amount} stars - User: ${ctx.from.id}`);
        
    } catch (error) {
        console.error('Payment processing error:', error);
        await ctx.reply(
            '❌ There was an error processing your payment. ' +
            'Your payment was successful, but we encountered an issue delivering your item. ' +
            'Please contact support with your transaction ID.'
        );
    }
});

// Admin command to view statistics (optional)
bot.command('stats', async (ctx) => {
    // Add your admin user ID check here
    const adminIds = process.env.ADMIN_IDS?.split(',').map(id => parseInt(id)) || [];
    
    if (!adminIds.includes(ctx.from.id)) {
        return;
    }

    const statsMessage = `
📊 Bot Statistics

💰 Total Sales: ${stats.totalSales}
⭐️ Total Revenue: ${stats.totalRevenue} Stars
🔄 Refunds: ${stats.refundCount}
💾 Active Payments: ${paymentStore.size}
    `;

    await ctx.reply(statsMessage);
});

// Error handling for unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
process.once('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully...');
    bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    bot.stop('SIGTERM');
});

// Start the bot
console.log('Starting Telegram Stars Payment Bot...');
bot.launch().then(() => {
    console.log('Bot is running successfully!');
}).catch(error => {
    console.error('Failed to start bot:', error);
    process.exit(1);
});

module.exports = bot;
