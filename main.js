const { Telegraf, Markup } = require('telegraf');
require('dotenv').config();
const config = require('./config');

class TelegramStarsBot {
    constructor() {
        this.bot = new Telegraf(process.env.BOT_TOKEN);
        this.statistics = {
            totalSales: 0,
            totalRevenue: 0,
            successfulPayments: 0,
            refunds: 0
        };
        this.setupHandlers();
    }

    setupHandlers() {
        // Start command
        this.bot.start(async (ctx) => {
            try {
                await this.handleStart(ctx);
            } catch (error) {
                console.error('Error in start handler:', error);
                await ctx.reply('❌ An error occurred. Please try again.');
            }
        });

        // Help command
        this.bot.help(async (ctx) => {
            try {
                await this.handleHelp(ctx);
            } catch (error) {
                console.error('Error in help handler:', error);
                await ctx.reply('❌ An error occurred. Please try again.');
            }
        });

        // Refund command
        this.bot.command('refund', async (ctx) => {
            try {
                await this.handleRefund(ctx);
            } catch (error) {
                console.error('Error in refund handler:', error);
                await ctx.reply('❌ An error occurred while processing refund request.');
            }
        });

        // Statistics command (admin only)
        this.bot.command('stats', async (ctx) => {
            try {
                await this.handleStats(ctx);
            } catch (error) {
                console.error('Error in stats handler:', error);
                await ctx.reply('❌ An error occurred while fetching statistics.');
            }
        });

        // Callback query handlers
        this.bot.action(/^buy_(.+)$/, async (ctx) => {
            try {
                const itemId = ctx.match[1];
                await this.handlePurchase(ctx, itemId);
            } catch (error) {
                console.error('Error in purchase handler:', error);
                await ctx.answerCbQuery('❌ An error occurred. Please try again.');
            }
        });

        this.bot.action('back_to_menu', async (ctx) => {
            try {
                await this.handleStart(ctx);
                await ctx.answerCbQuery();
            } catch (error) {
                console.error('Error in back to menu handler:', error);
                await ctx.answerCbQuery('❌ An error occurred.');
            }
        });

        // Pre-checkout query handler
        this.bot.on('pre_checkout_query', async (ctx) => {
            try {
                await this.handlePreCheckout(ctx);
            } catch (error) {
                console.error('Error in pre-checkout handler:', error);
                await ctx.answerPreCheckoutQuery(false, 'Payment processing error');
            }
        });

        // Successful payment handler
        this.bot.on('successful_payment', async (ctx) => {
            try {
                await this.handleSuccessfulPayment(ctx);
            } catch (error) {
                console.error('Error in successful payment handler:', error);
                await ctx.reply('❌ Payment processed but an error occurred. Contact support.');
            }
        });

        // Error handler
        this.bot.catch((err, ctx) => {
            console.error('Bot error:', err);
            if (ctx) {
                ctx.reply('❌ An unexpected error occurred. Please try again later.');
            }
        });
    }

    async handleStart(ctx) {
        const welcomeMessage = `
🌟 Welcome to the Digital Items Shop! 🌟

Choose an item to purchase using Telegram Stars:
        `;

        const keyboard = this.createItemsKeyboard();

        if (ctx.callbackQuery) {
            await ctx.editMessageText(welcomeMessage, keyboard);
        } else {
            await ctx.reply(welcomeMessage, keyboard);
        }
    }

    async handleHelp(ctx) {
        const helpMessage = `
📚 Available Commands:

/start - View available items for purchase
/help - Show this help message
/refund - Request a refund (requires transaction ID)

💳 Payment Information:
• All payments are processed using Telegram Stars
• After successful payment, you'll receive your digital item
• Refunds are available within 24 hours of purchase

💰 Current Items:
${config.items.map(item => `• ${item.name} - ${item.price} ⭐`).join('\n')}

❓ Need more help? Contact support!
        `;

        await ctx.reply(helpMessage, Markup.inlineKeyboard([
            [Markup.button.callback('🛍️ Back to Shop', 'back_to_menu')]
        ]));
    }

    async handleRefund(ctx) {
        const args = ctx.message.text.split(' ').slice(1);
        
        if (args.length === 0) {
            await ctx.reply(
                '💰 To request a refund, please provide your transaction ID:\n\n' +
                'Usage: /refund <transaction_id>\n\n' +
                '📝 You can find your transaction ID in the payment confirmation message.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('🛍️ Back to Shop', 'back_to_menu')]
                ])
            );
            return;
        }

        const transactionId = args[0];
        
        try {
            // Process refund
            const refundResult = await this.processRefund(transactionId, ctx.from.id);
            
            if (refundResult.success) {
                this.statistics.refunds++;
                await ctx.reply(
                    `✅ Refund processed successfully!\n\n` +
                    `💰 Amount: ${refundResult.amount} ⭐\n` +
                    `📋 Transaction ID: ${transactionId}\n\n` +
                    `The Stars have been returned to your account.`,
                    Markup.inlineKeyboard([
                        [Markup.button.callback('🛍️ Back to Shop', 'back_to_menu')]
                    ])
                );
            } else {
                await ctx.reply(
                    `❌ Refund failed: ${refundResult.error}\n\n` +
                    `Please contact support if you believe this is an error.`,
                    Markup.inlineKeyboard([
                        [Markup.button.callback('🛍️ Back to Shop', 'back_to_menu')]
                    ])
                );
            }
        } catch (error) {
            console.error('Refund processing error:', error);
            await ctx.reply(
                '❌ An error occurred while processing your refund request.\n\n' +
                'Please try again later or contact support.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('🛍️ Back to Shop', 'back_to_menu')]
                ])
            );
        }
    }

    async handleStats(ctx) {
        // Simple admin check (you should implement proper admin verification)
        if (!config.adminIds.includes(ctx.from.id)) {
            await ctx.reply('❌ You are not authorized to view statistics.');
            return;
        }

        const statsMessage = `
📊 Bot Statistics:

💰 Total Revenue: ${this.statistics.totalRevenue} ⭐
📦 Total Sales: ${this.statistics.totalSales}
✅ Successful Payments: ${this.statistics.successfulPayments}
🔄 Refunds: ${this.statistics.refunds}

📈 Success Rate: ${this.statistics.totalSales > 0 ? 
    ((this.statistics.successfulPayments / this.statistics.totalSales) * 100).toFixed(1) : 0}%
        `;

        await ctx.reply(statsMessage, Markup.inlineKeyboard([
            [Markup.button.callback('🛍️ Back to Shop', 'back_to_menu')]
        ]));
    }

    createItemsKeyboard() {
        const buttons = config.items.map(item => [
            Markup.button.callback(`${item.emoji} ${item.name} - ${item.price} ⭐`, `buy_${item.id}`)
        ]);

        return Markup.inlineKeyboard(buttons);
    }

    async handlePurchase(ctx, itemId) {
        const item = config.items.find(i => i.id === itemId);
        
        if (!item) {
            await ctx.answerCbQuery('❌ Item not found');
            return;
        }

        try {
            // Create invoice
            await ctx.replyWithInvoice({
                title: item.name,
                description: item.description,
                payload: JSON.stringify({
                    itemId: item.id,
                    userId: ctx.from.id,
                    timestamp: Date.now()
                }),
                currency: 'XTR', // Telegram Stars currency
                prices: [{
                    label: item.name,
                    amount: item.price
                }],
                provider_token: '', // Empty for Telegram Stars
                start_parameter: `buy_${item.id}`,
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
                ])
            });

            this.statistics.totalSales++;
            await ctx.answerCbQuery();

        } catch (error) {
            console.error('Error creating invoice:', error);
            await ctx.answerCbQuery('❌ Failed to create payment. Please try again.');
        }
    }

    async handlePreCheckout(ctx) {
        try {
            const payload = JSON.parse(ctx.preCheckoutQuery.invoice_payload);
            const item = config.items.find(i => i.id === payload.itemId);
            
            if (!item) {
                await ctx.answerPreCheckoutQuery(false, 'Item not found');
                return;
            }

            // Validate payment amount
            if (ctx.preCheckoutQuery.total_amount !== item.price) {
                await ctx.answerPreCheckoutQuery(false, 'Invalid payment amount');
                return;
            }

            // Approve payment
            await ctx.answerPreCheckoutQuery(true);
            
        } catch (error) {
            console.error('Pre-checkout error:', error);
            await ctx.answerPreCheckoutQuery(false, 'Payment processing error');
        }
    }

    async handleSuccessfulPayment(ctx) {
        try {
            const payment = ctx.message.successful_payment;
            const payload = JSON.parse(payment.invoice_payload);
            const item = config.items.find(i => i.id === payload.itemId);

            if (!item) {
                await ctx.reply('❌ Error: Item not found. Contact support.');
                return;
            }

            // Update statistics
            this.statistics.successfulPayments++;
            this.statistics.totalRevenue += payment.total_amount;

            // Generate and send digital item
            const digitalItem = this.generateDigitalItem(item);
            
            const successMessage = `
✅ Payment Successful! ✅

🎉 Thank you for your purchase!

📦 Item: ${item.name}
💰 Price: ${payment.total_amount} ⭐
💳 Transaction ID: ${payment.telegram_payment_charge_id}

🎁 Your Digital Item:
${digitalItem}

📋 Keep your transaction ID for refund requests.
💝 Enjoy your purchase!
            `;

            await ctx.reply(successMessage, Markup.inlineKeyboard([
                [Markup.button.callback('🛍️ Buy More Items', 'back_to_menu')]
            ]));

            // Log successful payment
            console.log(`Payment successful: User ${ctx.from.id} bought ${item.name} for ${payment.total_amount} stars`);

        } catch (error) {
            console.error('Successful payment handling error:', error);
            await ctx.reply('❌ Payment processed but an error occurred. Contact support with your transaction ID.');
        }
    }

    generateDigitalItem(item) {
        // Generate the digital item based on item type
        switch (item.type) {
            case 'code':
                return `🔐 Secret Code: ${this.generateSecretCode()}`;
            case 'key':
                return `🗝️ License Key: ${this.generateLicenseKey()}`;
            case 'file':
                return `📁 Download Link: ${this.generateDownloadLink(item.id)}`;
            case 'access':
                return `🚪 Access Token: ${this.generateAccessToken()}`;
            default:
                return `🎁 Digital Content: ${this.generateGenericContent()}`;
        }
    }

    generateSecretCode() {
        return Math.random().toString(36).substring(2, 15).toUpperCase();
    }

    generateLicenseKey() {
        const segments = [];
        for (let i = 0; i < 4; i++) {
            segments.push(Math.random().toString(36).substring(2, 7).toUpperCase());
        }
        return segments.join('-');
    }

    generateDownloadLink(itemId) {
        const token = Math.random().toString(36).substring(2, 25);
        return `https://example.com/download/${itemId}?token=${token}`;
    }

    generateAccessToken() {
        return 'AT-' + Math.random().toString(36).substring(2, 20).toUpperCase();
    }

    generateGenericContent() {
        return `Content-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    }

    async processRefund(transactionId, userId) {
        try {
            // In a real implementation, you would:
            // 1. Validate the transaction ID
            // 2. Check if refund is eligible (time limit, etc.)
            // 3. Process the actual refund via Telegram Bot API
            
            // For demo purposes, we'll simulate the process
            const isValidTransaction = this.validateTransactionId(transactionId);
            
            if (!isValidTransaction) {
                return {
                    success: false,
                    error: 'Invalid or expired transaction ID'
                };
            }

            // Simulate refund processing
            // In real implementation, use: await ctx.telegram.refundStarPayment(userId, transactionId)
            
            return {
                success: true,
                amount: 100, // This would be the actual refund amount
                transactionId: transactionId
            };

        } catch (error) {
            console.error('Refund processing error:', error);
            return {
                success: false,
                error: 'Refund processing failed'
            };
        }
    }

    validateTransactionId(transactionId) {
        // Basic validation - in real implementation, check against your database
        return transactionId && transactionId.length > 10;
    }

    start() {
        console.log('🚀 Starting Telegram Stars Bot...');
        
        // Set bot commands
        this.bot.telegram.setMyCommands([
            { command: 'start', description: 'View available items for purchase' },
            { command: 'help', description: 'Show help message' },
            { command: 'refund', description: 'Request a refund (requires transaction ID)' }
        ]).catch(console.error);

        // Start polling
        this.bot.launch();
        console.log('✅ Bot is running!');

        // Graceful stop
        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }
}

// Initialize and start the bot
if (require.main === module) {
    const bot = new TelegramStarsBot();
    bot.start();
}

module.exports = TelegramStarsBot;
