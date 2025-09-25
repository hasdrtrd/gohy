// Configuration settings and item definitions

const config = {
    // Bot settings
    botName: 'Telegram Stars Shop Bot',
    version: '1.0.0',
    
    // Admin user IDs (replace with actual admin user IDs)
    adminIds: [
        123456789, // Replace with actual admin user ID
        987654321  // Add more admin IDs as needed
    ],

    // Available items for purchase
    items: [
        {
            id: 'premium_access',
            name: '🌟 Premium Access',
            description: 'Get premium features and exclusive content access for 30 days',
            price: 100, // Price in Telegram Stars
            emoji: '🌟',
            type: 'access'
        },
        {
            id: 'secret_guide',
            name: '📚 Secret Guide',
            description: 'Exclusive digital guide with insider tips and tricks',
            price: 50,
            emoji: '📚',
            type: 'code'
        },
        {
            id: 'digital_artwork',
            name: '🎨 Digital Artwork',
            description: 'High-quality digital artwork collection (5 images)',
            price: 75,
            emoji: '🎨',
            type: 'file'
        },
        {
            id: 'license_key',
            name: '🔑 Software License',
            description: 'Premium software license key with 1-year validity',
            price: 200,
            emoji: '🔑',
            type: 'key'
        },
        {
            id: 'vip_membership',
            name: '👑 VIP Membership',
            description: 'Exclusive VIP membership with special privileges',
            price: 500,
            emoji: '👑',
            type: 'access'
        },
        {
            id: 'ebook_collection',
            name: '📖 eBook Collection',
            description: 'Complete collection of premium eBooks (PDF format)',
            price: 150,
            emoji: '📖',
            type: 'file'
        }
    ],

    // Payment settings
    payment: {
        currency: 'XTR', // Telegram Stars currency code
        refundTimeLimit: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
        maxRefundAmount: 1000 // Maximum refund amount in stars
    },

    // Message templates
    messages: {
        welcome: `
🌟 Welcome to the Digital Items Shop! 🌟

Choose an item to purchase using Telegram Stars:
        `,
        
        paymentSuccess: `
✅ Payment Successful! ✅

🎉 Thank you for your purchase!
        `,
        
        paymentFailed: `
❌ Payment Failed

Please try again or contact support if the problem persists.
        `,
        
        refundSuccess: `
✅ Refund Processed Successfully!

The Stars have been returned to your account.
        `,
        
        refundFailed: `
❌ Refund Failed

Please contact support for assistance.
        `,
        
        invalidTransaction: `
❌ Invalid Transaction ID

Please check your transaction ID and try again.
        `,
        
        support: `
📞 Need Help?

Contact our support team:
• Email: support@example.com
• Telegram: @support_username
        `
    },

    // API endpoints (for future integrations)
    api: {
        baseUrl: 'https://api.example.com',
        endpoints: {
            validatePayment: '/payments/validate',
            processRefund: '/payments/refund',
            getTransactionDetails: '/payments/transaction'
        }
    },

    // Logging configuration
    logging: {
        level: 'info', // debug, info, warn, error
        logPayments: true,
        logRefunds: true,
        logErrors: true
    },

    // Rate limiting
    rateLimit: {
        maxRequestsPerMinute: 30,
        maxPurchasesPerHour: 5
    },

    // Database configuration (if using a database)
    database: {
        // Example for MongoDB
        // mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017/telegram-stars-bot',
        
        // Example for PostgreSQL
        // postgresUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/telegram_stars_bot'
    }
};

module.exports = config;
