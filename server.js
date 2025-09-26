// server.js - Enhanced Telegram Chat Bot with grammY Framework
import { Bot, session, GrammyError, HttpError } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import { Menu } from '@grammyjs/menu';
import { hydrate } from '@grammyjs/hydrate';
import { parseMode } from '@grammyjs/parse-mode';
import express from 'express';

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [];
const CHANNEL_LINK = process.env.CHANNEL_LINK || 'https://t.me/yourchannel';
const GROUP_LINK = process.env.GROUP_LINK || 'https://t.me/yourgroup';
const BOT_USERNAME = process.env.BOT_USERNAME || 'YourBotUsername';
const PORT = process.env.PORT || 3000;

// Initialize bot with grammY
const bot = new Bot(BOT_TOKEN);

// Install plugins
bot.use(hydrate());
bot.use(parseMode("Markdown"));
bot.use(session({ initial: () => ({}) }));
bot.use(conversations());

// Express server
const app = express();

// In-memory storage (for MVP - replace with database in production)
const users = new Map(); // userId -> user data
const activeChats = new Map(); // userId -> partnerId
const waitingQueue = new Set(); // users waiting for chat
const reports = new Map(); // userId -> reports array
const stats = {
    totalUsers: 0,
    dailyActiveUsers: new Set(),
    totalReports: 0,
    totalEarnings: 0
};

// Bad words filter (basic implementation)
const badWords = ['spam', 'scam', 'porn', 'xxx', 'sex', 'nude', 'drugs'];

function containsBadWords(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return badWords.some(word => lowerText.includes(word));
}

function maskBadWords(text) {
    let maskedText = text;
    badWords.forEach(word => {
        const regex = new RegExp(word, 'gi');
        maskedText = maskedText.replace(regex, '*'.repeat(word.length));
    });
    return maskedText;
}

// User management
function getUser(userId) {
    if (!users.has(userId)) {
        users.set(userId, {
            id: userId,
            joinDate: new Date(),
            safeMode: true,
            isActive: true,
            reportCount: 0,
            supporter: false,
            supportAmount: 0,
            lastSupport: null,
            totalShares: 0
        });
        stats.totalUsers++;
    }
    stats.dailyActiveUsers.add(userId);
    return users.get(userId);
}

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

// Chat management
function findPartner(userId) {
    waitingQueue.delete(userId);
    
    const user = getUser(userId);
    const isSupporter = user.supporter && user.supportAmount > 0;
    
    // Priority matching: supporters get matched with other supporters first
    if (isSupporter) {
        for (const partnerId of waitingQueue) {
            if (partnerId !== userId) {
                const partner = getUser(partnerId);
                if (partner.supporter && partner.supportAmount > 0) {
                    waitingQueue.delete(partnerId);
                    return partnerId;
                }
            }
        }
    }
    
    // Find any available partner
    for (const partnerId of waitingQueue) {
        if (partnerId !== userId) {
            waitingQueue.delete(partnerId);
            return partnerId;
        }
    }
    
    // No partner found, add to queue with priority
    if (isSupporter) {
        const queueArray = Array.from(waitingQueue);
        waitingQueue.clear();
        waitingQueue.add(userId);
        queueArray.forEach(id => waitingQueue.add(id));
    } else {
        waitingQueue.add(userId);
    }
    
    return null;
}

async function startChat(user1Id, user2Id, ctx) {
    activeChats.set(user1Id, user2Id);
    activeChats.set(user2Id, user1Id);
    waitingQueue.delete(user1Id);
    waitingQueue.delete(user2Id);
    
    const user1 = getUser(user1Id);
    const user2 = getUser(user2Id);
    const bothSupporters = user1.supporter && user2.supporter;
    
    let connectMessage = '💬 Connected! You can now chat anonymously. Use /stop to end chat.';
    
    if (bothSupporters) {
        connectMessage = '💬✨ Connected with fellow supporter! You can now chat anonymously. Use /stop to end chat.\n\n🌟 Thank you both for supporting our bot!';
    } else if (user1.supporter) {
        await ctx.api.sendMessage(user1Id, '💬⭐ Connected! As a supporter, you get priority matching. Chat away!');
        await ctx.api.sendMessage(user2Id, connectMessage);
        return;
    } else if (user2.supporter) {
        await ctx.api.sendMessage(user2Id, '💬⭐ Connected! As a supporter, you get priority matching. Chat away!');
        await ctx.api.sendMessage(user1Id, connectMessage);
        return;
    }
    
    await ctx.api.sendMessage(user1Id, connectMessage);
    await ctx.api.sendMessage(user2Id, connectMessage);
}

function endChat(userId) {
    const partnerId = activeChats.get(userId);
    if (partnerId) {
        activeChats.delete(userId);
        activeChats.delete(partnerId);
        return partnerId;
    }
    return null;
}

// Generate random support tip
function getRandomSupportTip() {
    const tips = [
        "💡 Tip: Support us with /support to get priority matching!",
        "🌟 Love our bot? Consider supporting us with Telegram Stars!",
        "⚡ Supporters get faster matching and special features!",
        "💖 Help us grow by using /support - every Star counts!",
        "🚀 Want premium features? Check out /support!",
        "⭐ Share the love! Use /share to tell friends about us!"
    ];
    return tips[Math.floor(Math.random() * tips.length)];
}

// Create menus using grammY Menu plugin
const mainMenu = new Menu("main-menu")
    .text("💬 Start Chatting", async (ctx) => {
        await handleChatCommand(ctx);
    })
    .text("⭐ Support Us", async (ctx) => {
        await handleSupportCommand(ctx);
    }).row()
    .url("📢 Channel", CHANNEL_LINK)
    .url("👥 Group", GROUP_LINK).row()
    .text("📤 Share Bot", async (ctx) => {
        await handleShareCommand(ctx);
    });

const supportMenu = new Menu("support-menu")
    .text("⭐ 5 Stars - Starter", async (ctx) => {
        await handleStarsPurchase(ctx, 5);
    })
    .text("⭐⭐ 25 Stars - Supporter", async (ctx) => {
        await handleStarsPurchase(ctx, 25);
    }).row()
    .text("⭐⭐⭐ 50 Stars - Premium", async (ctx) => {
        await handleStarsPurchase(ctx, 50);
    })
    .text("⭐⭐⭐⭐ 100 Stars - VIP", async (ctx) => {
        await handleStarsPurchase(ctx, 100);
    }).row()
    .text("⭐⭐⭐⭐⭐ 500 Stars - Champion", async (ctx) => {
        await handleStarsPurchase(ctx, 500);
    }).row()
    .text("📤 Share Bot Instead", async (ctx) => {
        await handleShareCommand(ctx);
    });

const safeModeMenu = new Menu("safe-mode-menu")
    .text("🔒 Toggle Safe Mode", async (ctx) => {
        const user = getUser(ctx.from.id);
        user.safeMode = !user.safeMode;
        
        const status = user.safeMode ? 'ON' : 'OFF';
        await ctx.answerCallbackQuery(`Safe Mode: ${status}`);
        await ctx.editMessageText(
            `🔒 Safe Mode is now *${status}*\n\n${getRandomSupportTip()}`,
            { reply_markup: safeModeMenu }
        );
    })
    .text("📤 Share Bot", async (ctx) => {
        await handleShareCommand(ctx);
    });

// Register menus
bot.use(mainMenu);
bot.use(supportMenu);
bot.use(safeModeMenu);

// Command handlers
async function handleStartCommand(ctx) {
    const userId = ctx.from.id;
    const user = getUser(userId);
    
    let welcomeMessage = `🎉 Welcome to StrangerTalk Bot!
Stay anonymous, safe & have fun chatting with strangers worldwide.

💬 Tap /chat to find someone to talk with!
🔒 Use /safemode to control media filtering
📊 Check /premium for exclusive features

${getRandomSupportTip()}`;

    if (user.supporter && user.supportAmount > 0) {
        welcomeMessage = `🎉 Welcome back, Premium User!

⭐ Thank you for your ${user.supportAmount} Stars support!
🚀 You have priority matching and exclusive features!

💬 Ready to chat? Use /chat to get matched faster!`;
    }

    await ctx.reply(welcomeMessage, { reply_markup: mainMenu });
}

async function handleChatCommand(ctx) {
    const userId = ctx.from.id;
    const user = getUser(userId);
    
    if (activeChats.has(userId)) {
        await ctx.reply('💬 You are already in a chat! Use /stop to end current chat first.');
        return;
    }
    
    if (!user.isActive) {
        await ctx.reply('🚫 You have been banned from using this bot.');
        return;
    }
    
    const partnerId = findPartner(userId);
    
    if (partnerId) {
        await startChat(userId, partnerId, ctx);
    } else {
        if (user.supporter && user.supportAmount > 0) {
            await ctx.reply('🔍⭐ Looking for a partner... Supporters get priority matching!\n\n✨ Thank you for your support!');
        } else {
            const tipMessage = getRandomSupportTip();
            await ctx.reply(`🔍 Looking for a partner... Please wait!\n\n${tipMessage}`);
        }
    }
}

async function handleStopCommand(ctx) {
    const userId = ctx.from.id;
    const partnerId = endChat(userId);
    
    if (partnerId) {
        const tipMessage = getRandomSupportTip();
        await ctx.reply(`⏹ Chat ended. Use /chat to start a new conversation!\n\n${tipMessage}`);
        await ctx.api.sendMessage(partnerId, '⏹ Your partner left the chat. Use /chat to find a new partner!');
    } else {
        await ctx.reply('⏹ You are not in a chat currently.');
    }
    
    waitingQueue.delete(userId);
}

async function handleShareCommand(ctx) {
    const userId = ctx.from.id;
    const user = getUser(userId);
    user.totalShares++;
    
    const shareText = `🤖 Join me on StrangerTalk Bot!

Chat anonymously with people from around the world 🌍

✨ Features:
• Anonymous chatting
• Safe mode protection
• Premium features available
• 24/7 active community

Start chatting now! 👇`;

    const shareUrl = `https://t.me/${BOT_USERNAME}?start=shared_by_${userId}`;
    
    const shareMessage = `📤 Share StrangerTalk Bot!

Help us grow our community! Share the bot with your friends and family.

🎁 The more users join, the faster matching becomes for everyone!

📋 Copy this link to share:
\`${shareUrl}\`

${getRandomSupportTip()}`;

    await ctx.reply(shareMessage);
}

async function handleSupportCommand(ctx) {
    const supportMessage = `⭐ Support Our Bot!

Your donations with Telegram Stars help us:
• Keep the service free for everyone
• Add new features and improvements
• Maintain fast, reliable servers
• Create a safe community

Choose your support level:

💡 All supporters get premium features instantly!`;

    await ctx.reply(supportMessage, { reply_markup: supportMenu });
}

async function handlePremiumCommand(ctx) {
    const userId = ctx.from.id;
    const user = getUser(userId);
    
    if (!user.supporter || user.supportAmount === 0) {
        const premiumInfo = `🌟 Premium Features

Support our bot with Telegram Stars and unlock amazing benefits:

⚡ **Priority Matching**
• Get matched 3x faster than regular users
• Skip to front of waiting queue

👑 **Supporter Badge**  
• Special recognition in chats
• Exclusive supporter-only messages

🤝 **Supporter-to-Supporter Matching**
• Higher chance to chat with other supporters
• Premium community experience

🎨 **Exclusive Features**
• Custom welcome messages
• Priority customer support
• Early access to new features

💫 **Coming Soon**
• Custom themes and colors
• Extended chat history
• Special emojis and stickers
• Private supporter group access

Ready to upgrade? Use /support to donate with Telegram Stars!

${getRandomSupportTip()}`;

        await ctx.reply(premiumInfo, { reply_markup: supportMenu });
        return;
    }
    
    const supportDate = new Date(user.lastSupport).toLocaleDateString();
    const statusMessage = `👑 Your Premium Status

✅ **Active Supporter**
⭐ Total Support: ${user.supportAmount} Stars
📅 Last Support: ${supportDate}
📤 Total Shares: ${user.totalShares}

🎯 **Your Benefits:**
• ⚡ Priority matching (active)
• 👑 Supporter badge (active)  
• 🤝 Supporter-to-supporter matching (active)
• 🎨 Exclusive features (active)

Thank you for supporting StrangerTalk Bot! 💖

Want to support more? Use /support`;

    await ctx.reply(statusMessage, { reply_markup: supportMenu });
}

async function handleSafeModeCommand(ctx) {
    const userId = ctx.from.id;
    const user = getUser(userId);
    const status = user.safeMode ? 'ON' : 'OFF';
    
    const safeModeMessage = `🔒 Safe Mode Settings

Current Status: **${status}**

Safe Mode blocks ALL media from strangers (photos, videos, documents, audio, voice messages, stickers).

• ON = Only text messages allowed (safest)
• OFF = All media types allowed

Toggle using the button below:

${getRandomSupportTip()}`;

    await ctx.reply(safeModeMessage, { reply_markup: safeModeMenu });
}

async function handleReportCommand(ctx) {
    const userId = ctx.from.id;
    const partnerId = activeChats.get(userId);
    
    if (!partnerId) {
        await ctx.reply('⏹ You are not in a chat currently.');
        return;
    }
    
    if (!reports.has(partnerId)) {
        reports.set(partnerId, []);
    }
    reports.get(partnerId).push({
        reporterId: userId,
        date: new Date(),
        reason: 'User reported'
    });
    
    stats.totalReports++;
    
    const reportedUser = getUser(partnerId);
    reportedUser.reportCount++;
    
    const thankYouMessage = `✅ User reported successfully. Thank you for keeping our community safe!

${getRandomSupportTip()}`;
    
    await ctx.reply(thankYouMessage);
    
    // Auto-ban if too many reports
    if (reportedUser.reportCount >= 3) {
        reportedUser.isActive = false;
        await ctx.api.sendMessage(partnerId, '🚫 You have been banned due to multiple reports.');
        endChat(partnerId);
    }
}

async function handleStarsPurchase(ctx, amount) {
    let title, description, benefits;
    
    switch(amount) {
        case 5:
            title = "Starter Support ⭐";
            description = "Thank you for supporting our bot with 5 Stars!";
            benefits = "• Basic supporter badge\n• Priority queue";
            break;
        case 25:
            title = "Supporter Package ⭐⭐";
            description = "Amazing! 25 Stars helps us keep growing!";
            benefits = "• Supporter badge in chats\n• Priority matching\n• Supporter-to-supporter matching";
            break;
        case 50:
            title = "Premium Support ⭐⭐⭐";
            description = "Fantastic! 50 Stars unlocks premium features!";
            benefits = "• Premium supporter badge\n• Priority matching\n• Special welcome messages\n• Early feature access";
            break;
        case 100:
            title = "VIP Support ⭐⭐⭐⭐";
            description = "Incredible! 100 Stars - you're a VIP supporter!";
            benefits = "• VIP supporter status\n• All premium features\n• Priority customer support\n• Exclusive supporter group access";
            break;
        case 500:
            title = "Champion Support ⭐⭐⭐⭐⭐";
            description = "WOW! 500 Stars - you're our champion supporter!";
            benefits = "• Champion supporter status\n• All premium features\n• Direct line to developers\n• Feature request priority\n• Lifetime supporter status";
            break;
    }
    
    try {
        const payload = JSON.stringify({
            type: 'stars_donation',
            amount: amount,
            userId: ctx.from.id,
            timestamp: Date.now()
        });
        
        await ctx.api.sendInvoice(ctx.chat.id, {
            title: title,
            description: `${description}\n\nWhat you get:\n${benefits}`,
            payload: payload,
            provider_token: "",
            currency: "XTR",
            prices: [{ 
                label: `${amount} Telegram Stars`, 
                amount: amount 
            }],
            photo_url: "https://img.icons8.com/fluency/96/star.png",
            photo_width: 96,
            photo_height: 96
        });
        
        await ctx.answerCallbackQuery(`💫 Invoice sent for ${amount} Stars!`);
        
        await ctx.reply(`ℹ️ About Telegram Stars:

⭐ Telegram Stars are Telegram's official virtual currency
💳 You can buy Stars in any Telegram app
🔒 Payments are processed securely by Telegram
💰 Stars go directly to our bot owner account

Your support helps us keep this service free for everyone! 💖`);
        
    } catch (error) {
        console.error('Error sending invoice:', error);
        await ctx.answerCallbackQuery("❌ Payment temporarily unavailable");
        await ctx.reply("❌ Sorry, Telegram Stars payments are temporarily unavailable. Please try again later.\n\nMake sure you have:\n• Updated Telegram app\n• Sufficient Stars balance\n• Payment method configured");
    }
}

// Admin commands
async function handleAdminStats(ctx) {
    const userId = ctx.from.id;
    
    if (!isAdmin(userId)) {
        await ctx.reply('⏹ Access denied. Admin only command.');
        return;
    }
    
    const supporters = Array.from(users.values()).filter(u => u.supporter).length;
    const totalDonations = Array.from(users.values()).reduce((sum, u) => sum + (u.supportAmount || 0), 0);
    const totalShares = Array.from(users.values()).reduce((sum, u) => sum + (u.totalShares || 0), 0);
    
    const statsMessage = `📊 Bot Statistics:

👥 **Users:**
• Total Users: ${stats.totalUsers}
• Active Today: ${stats.dailyActiveUsers.size}
• Supporters: ${supporters}

💬 **Activity:**
• Current Chats: ${Math.floor(activeChats.size / 2)}
• Waiting Queue: ${waitingQueue.size}
• Total Reports: ${stats.totalReports}

💰 **Revenue:**
• Total Donations: ${totalDonations} Stars ⭐
• Total Earnings: $${(totalDonations * 0.013).toFixed(2)} USD

📤 **Growth:**
• Total Shares: ${totalShares}
• Avg. Shares/User: ${(totalShares / stats.totalUsers).toFixed(1)}`;

    await ctx.reply(statsMessage);
}

// Register commands
bot.command('start', handleStartCommand);
bot.command('chat', handleChatCommand);
bot.command('stop', handleStopCommand);
bot.command('share', handleShareCommand);
bot.command('support', handleSupportCommand);
bot.command('premium', handlePremiumCommand);
bot.command('safemode', handleSafeModeCommand);
bot.command('report', handleReportCommand);
bot.command('stats', handleAdminStats);

// Admin commands with better organization
bot.command('users', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        await ctx.reply('⏹ Access denied. Admin only command.');
        return;
    }
    
    const recentUsers = Array.from(users.values())
        .sort((a, b) => new Date(b.joinDate) - new Date(a.joinDate))
        .slice(0, 10);
    
    let usersList = '👥 Recent Users (Last 10):\n\n';
    recentUsers.forEach((user, index) => {
        const status = user.isActive ? '✅' : '🚫';
        const supporter = user.supporter ? '⭐' : '';
        const date = new Date(user.joinDate).toLocaleDateString();
        usersList += `${index + 1}. ${status}${supporter} ID: ${user.id} (${date})\n`;
    });
    
    await ctx.reply(usersList);
});

bot.command('reports', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        await ctx.reply('⏹ Access denied. Admin only command.');
        return;
    }
    
    if (reports.size === 0) {
        await ctx.reply('📋 No reports found.');
        return;
    }
    
    let reportsList = '🚨 Flagged Users:\n\n';
    let count = 0;
    
    for (const [reportedUserId, userReports] of reports) {
        if (count >= 10) break;
        
        const user = users.get(reportedUserId);
        const status = user?.isActive ? '✅' : '🚫';
        reportsList += `${status} User ID: ${reportedUserId}\n`;
        reportsList += `Reports: ${userReports.length}\n`;
        reportsList += `Latest: ${new Date(userReports[userReports.length - 1].date).toLocaleDateString()}\n\n`;
        count++;
    }
    
    await ctx.reply(reportsList);
});

bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        await ctx.reply('⏹ Access denied. Admin only command.');
        return;
    }
    
    const message = ctx.message.text.split(' ').slice(1).join(' ');
    if (!message) {
        await ctx.reply('⏹ Please provide a message to broadcast. Usage: /broadcast <message>');
        return;
    }
    
    let successCount = 0;
    let failCount = 0;
    
    await ctx.reply(`📢 Broadcasting to ${users.size} users...`);
    
    for (const userId of users.keys()) {
        try {
            await ctx.api.sendMessage(userId, `📢 Announcement:\n\n${message}`);
            successCount++;
        } catch (error) {
            failCount++;
        }
    }
    
    await ctx.reply(`✅ Broadcast completed!\nSuccess: ${successCount}\nFailed: ${failCount}`);
});

bot.command('ban', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        await ctx.reply('⏹ Access denied. Admin only command.');
        return;
    }
    
    const targetUserId = parseInt(ctx.message.text.split(' ')[1]);
    if (!targetUserId) {
        await ctx.reply('⏹ Please provide a user ID. Usage: /ban <user_id>');
        return;
    }
    
    const targetUser = users.get(targetUserId);
    if (!targetUser) {
        await ctx.reply('⏹ User not found.');
        return;
    }
    
    if (!targetUser.isActive) {
        await ctx.reply(`⚠️ User ${targetUserId} is already banned.`);
        return;
    }
    
    targetUser.isActive = false;
    endChat(targetUserId);
    
    try {
        await ctx.api.sendMessage(targetUserId, '🚫 You have been banned by an administrator.');
    } catch (error) {
        // User might have blocked the bot
    }
    
    await ctx.reply(`✅ User ${targetUserId} has been banned.`);
});

bot.command('unban', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        await ctx.reply('⏹ Access denied. Admin only command.');
        return;
    }
    
    const targetUserId = parseInt(ctx.message.text.split(' ')[1]);
    if (!targetUserId) {
        await ctx.reply('⏹ Please provide a user ID. Usage: /unban <user_id>');
        return;
    }
    
    const targetUser = users.get(targetUserId);
    if (!targetUser) {
        await ctx.reply('⏹ User not found.');
        return;
    }
    
    if (targetUser.isActive) {
        await ctx.reply(`⚠️ User ${targetUserId} is not banned.`);
        return;
    }
    
    targetUser.isActive = true;
    targetUser.reportCount = 0;
    
    try {
        await ctx.api.sendMessage(targetUserId, '✅ You have been unbanned! You can now use the bot again. Use /chat to start chatting.');
    } catch (error) {
        // User might have blocked the bot
    }
    
    await ctx.reply(`✅ User ${targetUserId} has been unbanned.`);
});

bot.command('supporters', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        await ctx.reply('⏹ Access denied. Admin only command.');
        return;
    }
    
    const supporters = Array.from(users.values())
        .filter(user => user.supporter && user.supportAmount > 0)
        .sort((a, b) => b.supportAmount - a.supportAmount);
    
    if (supporters.length === 0) {
        await ctx.reply('💫 No supporters yet. Share the /support command to get donations!');
        return;
    }
    
    let supportersList = `💖 Bot Supporters (${supporters.length}):\n\n`;
    let totalSupport = 0;
    
    supporters.slice(0, 10).forEach((user, index) => {
        const supportDate = new Date(user.lastSupport).toLocaleDateString();
        supportersList += `${index + 1}. ID: ${user.id}\n`;
        supportersList += `   ⭐ ${user.supportAmount} Stars\n`;
        supportersList += `   📅 ${supportDate}\n`;
        supportersList += `   📤 Shares: ${user.totalShares || 0}\n\n`;
        totalSupport += user.supportAmount;
    });
    
    if (supporters.length > 10) {
        supportersList += `... and ${supporters.length - 10} more supporters\n\n`;
        totalSupport = supporters.reduce((sum, user) => sum + user.supportAmount, 0);
    }
    
    supportersList += `💰 Total Support: ${totalSupport} Stars ⭐\n`;
    supportersList += `💵 Estimated Revenue: $${(totalSupport * 0.013).toFixed(2)} USD`;
    
    await ctx.reply(supportersList);
});

bot.command('banned', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        await ctx.reply('⏹ Access denied. Admin only command.');
        return;
    }
    
    const bannedUsers = Array.from(users.values()).filter(user => !user.isActive);
    
    if (bannedUsers.length === 0) {
        await ctx.reply('✅ No banned users found.');
        return;
    }
    
    let bannedList = '🚫 Banned Users:\n\n';
    bannedUsers.slice(0, 15).forEach((user, index) => {
        const joinDate = new Date(user.joinDate).toLocaleDateString();
        bannedList += `${index + 1}. ID: ${user.id}\n`;
        bannedList += `   Reports: ${user.reportCount}\n`;
        bannedList += `   Joined: ${joinDate}\n`;
        bannedList += `   Unban: /unban ${user.id}\n\n`;
    });
    
    if (bannedUsers.length > 15) {
        bannedList += `... and ${bannedUsers.length - 15} more banned users`;
    }
    
    await ctx.reply(bannedList);
});

// Handle all messages (message relay)
bot.on('message', async (ctx) => {
    // Skip if it's a command
    if (ctx.message.text && ctx.message.text.startsWith('/')) {
        return;
    }
    
    const userId = ctx.from.id;
    const partnerId = activeChats.get(userId);
    
    if (!partnerId) {
        return;
    }
    
    const user = getUser(userId);
    const partner = getUser(partnerId);
    
    // Check if either user is banned
    if (!user.isActive || !partner.isActive) {
        endChat(userId);
        await ctx.reply('⏹ Chat ended due to user restrictions.');
        if (partner.isActive) {
            await ctx.api.sendMessage(partnerId, '⏹ Chat ended due to user restrictions.');
        }
        return;
    }
    
    try {
        // Handle different message types
        if (ctx.message.text) {
            // Text message
            if (containsBadWords(ctx.message.text)) {
                const maskedText = maskBadWords(ctx.message.text);
                
                let finalMessage = maskedText;
                if (user.supporter && user.supportAmount >= 50) {
                    finalMessage = `${maskedText}\n\n⭐ _From Premium Supporter_`;
                }
                
                await ctx.api.sendMessage(partnerId, finalMessage, { parse_mode: 'Markdown' });
                await ctx.reply('⚠️ Your message contained inappropriate content and was filtered.');
            } else {
                let finalMessage = ctx.message.text;
                if (user.supporter && user.supportAmount >= 50) {
                    finalMessage = `${ctx.message.text}\n\n⭐ _From Premium Supporter_`;
                }
                
                await ctx.api.sendMessage(partnerId, finalMessage, { parse_mode: 'Markdown' });
            }
        } else if (ctx.message.photo) {
            // Photo
            if (partner.safeMode) {
                await ctx.api.sendMessage(partnerId, '📷 [Photo blocked by Safe Mode]');
                await ctx.reply('📷 Your photo was blocked by your partner\'s Safe Mode.');
            } else {
                const photo = ctx.message.photo[ctx.message.photo.length - 1];
                await ctx.api.sendPhoto(partnerId, photo.file_id, {
                    caption: ctx.message.caption || ''
                });
            }
        } else if (ctx.message.video) {
            // Video
            if (partner.safeMode) {
                await ctx.api.sendMessage(partnerId, '🎥 [Video blocked by Safe Mode]');
                await ctx.reply('🎥 Your video was blocked by your partner\'s Safe Mode.');
            } else {
                await ctx.api.sendVideo(partnerId, ctx.message.video.file_id, {
                    caption: ctx.message.caption || ''
                });
            }
        } else if (ctx.message.document) {
            // Document
            if (partner.safeMode) {
                await ctx.api.sendMessage(partnerId, '📄 [Document blocked by Safe Mode]');
                await ctx.reply('📄 Your document was blocked by your partner\'s Safe Mode.');
            } else {
                await ctx.api.sendDocument(partnerId, ctx.message.document.file_id, {
                    caption: ctx.message.caption || ''
                });
            }
        } else if (ctx.message.audio) {
            // Audio
            if (partner.safeMode) {
                await ctx.api.sendMessage(partnerId, '🎵 [Audio blocked by Safe Mode]');
                await ctx.reply('🎵 Your audio was blocked by your partner\'s Safe Mode.');
            } else {
                await ctx.api.sendAudio(partnerId, ctx.message.audio.file_id);
            }
        } else if (ctx.message.voice) {
            // Voice message
            if (partner.safeMode) {
                await ctx.api.sendMessage(partnerId, '🎤 [Voice message blocked by Safe Mode]');
                await ctx.reply('🎤 Your voice message was blocked by your partner\'s Safe Mode.');
            } else {
                await ctx.api.sendVoice(partnerId, ctx.message.voice.file_id);
            }
        } else if (ctx.message.sticker) {
            // Sticker
            if (partner.safeMode) {
                await ctx.api.sendMessage(partnerId, '😀 [Sticker blocked by Safe Mode]');
                await ctx.reply('😀 Your sticker was blocked by your partner\'s Safe Mode.');
            } else {
                await ctx.api.sendSticker(partnerId, ctx.message.sticker.file_id);
                
                if (user.supporter && user.supportAmount >= 50) {
                    await ctx.api.sendMessage(partnerId, '⭐ From Premium Supporter');
                }
            }
        }
    } catch (error) {
        console.error('Error relaying message:', error);
        await ctx.reply('⏹ Failed to send message. Your partner might have left.');
        endChat(userId);
    }
});

// Handle pre-checkout query (payment validation)
bot.on('pre_checkout_query', async (ctx) => {
    const query = ctx.preCheckoutQuery;
    const userId = query.from.id;
    const totalAmount = query.total_amount;
    
    try {
        const payload = JSON.parse(query.invoice_payload);
        
        if (payload.type === 'stars_donation' && payload.userId === userId) {
            await ctx.answerPreCheckoutQuery(true);
            console.log(`Pre-checkout approved: User ${userId} - ${totalAmount} Stars`);
        } else {
            await ctx.answerPreCheckoutQuery(false, "Invalid payment data");
            console.log(`Pre-checkout rejected: Invalid payload for user ${userId}`);
        }
    } catch (error) {
        console.error('Pre-checkout error:', error);
        await ctx.answerPreCheckoutQuery(false, "Payment processing error");
    }
});

// Handle successful payment
bot.on('message:successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    const userId = ctx.from.id;
    const username = ctx.from.username || 'Unknown';
    const firstName = ctx.from.first_name || 'User';
    const amount = payment.total_amount;
    const currency = payment.currency;
    
    try {
        const payload = JSON.parse(payment.invoice_payload);
        
        // Update user data
        const user = getUser(userId);
        const oldAmount = user.supportAmount || 0;
        user.supporter = true;
        user.supportAmount = oldAmount + amount;
        user.lastSupport = new Date();
        
        // Update stats
        stats.totalEarnings += amount;
        
        // Determine support tier
        let tier = 'Supporter';
        let tierEmoji = '⭐';
        if (user.supportAmount >= 500) {
            tier = 'Champion';
            tierEmoji = '⭐⭐⭐⭐⭐';
        } else if (user.supportAmount >= 100) {
            tier = 'VIP';
            tierEmoji = '⭐⭐⭐⭐';
        } else if (user.supportAmount >= 50) {
            tier = 'Premium';
            tierEmoji = '⭐⭐⭐';
        } else if (user.supportAmount >= 25) {
            tier = 'Supporter';
            tierEmoji = '⭐⭐';
        }
        
        console.log(`Payment successful: ${username} (${userId}) paid ${amount} Stars - Total: ${user.supportAmount}`);
        
        // Thank the user with personalized message
        const thankYouMessage = `🎉 Payment Successful!

Thank you ${firstName} for your generous ${amount} Stars donation! ${tierEmoji}

🏆 **Your Status:** ${tier}
💎 **Total Support:** ${user.supportAmount} Stars
⚡ **Benefits Unlocked:**
${user.supportAmount >= 5 ? '• ✅ Priority matching' : ''}
${user.supportAmount >= 25 ? '\n• ✅ Supporter badge in chats' : ''}
${user.supportAmount >= 50 ? '\n• ✅ Premium supporter features' : ''}
${user.supportAmount >= 100 ? '\n• ✅ VIP status and priority support' : ''}
${user.supportAmount >= 500 ? '\n• ✅ Champion status and direct developer access' : ''}

Your contribution helps us:
💻 Keep the bot running 24/7
🚀 Add new features and improvements
🛡️ Maintain a safe community
🌟 Provide free service to everyone

You're amazing! 💖

Ready to chat with priority matching? Use /chat`;

        await ctx.reply(thankYouMessage, { reply_markup: mainMenu });
        
        // Notify admins about the payment
        for (const adminId of ADMIN_IDS) {
            try {
                const adminMessage = `💰 Payment Received!

👤 **User:** @${username} (${firstName})
🆔 **ID:** ${userId}
💳 **Amount:** ${amount} Stars ⭐
💎 **Total Support:** ${user.supportAmount} Stars
🏆 **Tier:** ${tier} ${tierEmoji}
⏰ **Time:** ${new Date().toLocaleString()}

📊 **Bot Stats:**
• Total Earnings: ${stats.totalEarnings} Stars
• Total Users: ${stats.totalUsers}
• Current Supporters: ${Array.from(users.values()).filter(u => u.supporter).length}

Keep growing! 🚀`;
                
                await ctx.api.sendMessage(adminId, adminMessage);
            } catch (error) {
                console.error('Error notifying admin:', error);
            }
        }
        
        // Send special welcome message to other supporters about new supporter
        const supporters = Array.from(users.values()).filter(u => u.supporter && u.id !== userId);
        if (supporters.length > 0 && user.supportAmount >= 50) {
            const welcomeMessage = `🎉 New ${tier} Supporter!

Welcome to our premium community! Another amazing supporter just joined us.

Current premium community: ${supporters.length + 1} supporters strong! 💪

Thank you all for making this bot better! ✨`;
            
            // Send to random 3 supporters to avoid spam
            const randomSupporters = supporters.sort(() => 0.5 - Math.random()).slice(0, 3);
            for (const supporter of randomSupporters) {
                try {
                    await ctx.api.sendMessage(supporter.id, welcomeMessage);
                } catch (error) {
                    // Supporter might have blocked the bot
                }
            }
        }
        
    } catch (error) {
        console.error('Error processing successful payment:', error);
        await ctx.reply('Payment received but there was an error processing your supporter status. Please contact an admin.');
    }
});

// Express server for health checks (required for hosting)
app.use(express.static('public'));
app.use(express.json());

app.get('/', (req, res) => {
    const totalSupporters = Array.from(users.values()).filter(u => u.supporter).length;
    const totalEarnings = Array.from(users.values()).reduce((sum, u) => sum + (u.supportAmount || 0), 0);
    
    res.json({
        status: '🤖 StrangerTalk Bot is running!',
        framework: 'grammY',
        users: stats.totalUsers,
        supporters: totalSupporters,
        activeChats: Math.floor(activeChats.size / 2),
        earnings: `${totalEarnings} Stars`,
        uptime: Math.floor(process.uptime() / 3600) + ' hours'
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        framework: 'grammY',
        timestamp: new Date().toISOString(),
        version: '2.0.0'
    });
});

app.get('/stats', (req, res) => {
    const supporters = Array.from(users.values()).filter(u => u.supporter);
    const totalEarnings = supporters.reduce((sum, u) => sum + (u.supportAmount || 0), 0);
    
    res.json({
        totalUsers: stats.totalUsers,
        dailyActive: stats.dailyActiveUsers.size,
        currentChats: Math.floor(activeChats.size / 2),
        waitingQueue: waitingQueue.size,
        supporters: supporters.length,
        totalEarnings: totalEarnings,
        totalReports: stats.totalReports,
        uptime: process.uptime(),
        framework: 'grammY'
    });
});

// Webhook endpoint for Telegram (optional, for production deployment)
app.post(`/webhook/${BOT_TOKEN}`, express.json(), (req, res) => {
    bot.handleUpdate(req.body);
    res.sendStatus(200);
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`🤖 StrangerTalk Bot started successfully with grammY!`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`👑 Admins configured: ${ADMIN_IDS.length}`);
});

// Start the bot
bot.start().then(() => {
    console.log('✅ Bot is running and listening for updates!');
});

// Error handling
bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`❌ Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    
    if (e instanceof GrammyError) {
        console.error('Error in request:', e.description);
    } else if (e instanceof HttpError) {
        console.error('Could not contact Telegram:', e);
    } else {
        console.error('Unknown error:', e);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    if (process.env.NODE_ENV === 'production') {
        console.log('🔄 Attempting to recover...');
        setTimeout(() => process.exit(1), 5000);
    } else {
        process.exit(1);
    }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('📴 SIGTERM received, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('📴 SIGINT received, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
});
