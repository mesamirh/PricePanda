// Required dependencies
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const schedule = require('node-schedule');
const Web3 = require('web3');
const { createCanvas } = require('canvas');

// Initialize data storage
const DATA_FILE = 'users.json';
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [] }));
}

// Data management functions
function readData() {
    try {
        const data = fs.readFileSync(DATA_FILE);
        return JSON.parse(data);
    } catch (error) {
        return { users: [] };
    }
}

function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function findUser(telegramId) {
    const data = readData();
    return data.users.find(user => user.telegramId === telegramId);
}

function saveUser(userData) {
    const data = readData();
    const index = data.users.findIndex(user => user.telegramId === userData.telegramId);
    
    if (index === -1) {
        data.users.push(userData);
    } else {
        data.users[index] = userData;
    }
    
    writeData(data);
}

// Bot configuration
const token = process.env.TELEGRAM_BOT_TOKEN;
let bot;

// Cleanup function to stop existing bot instance
async function cleanup() {
    if (bot) {
        try {
            await bot.stopPolling();
            console.log('Stopped existing bot instance');
        } catch (error) {
            console.error('Error stopping bot:', error.message);
        }
    }
}

// Initialize bot with better error handling and retry logic
async function initBot() {
    await cleanup();
    
    const options = {
        polling: {
            interval: 2000,
            params: {
                timeout: 10
            },
            autoStart: true,
            retryAfter: 5000
        }
    };
    
    bot = new TelegramBot(token, options);

    bot.on('error', (error) => {
        console.error('Bot error:', error.message);
        if (error.code === 'ETELEGRAM') {
            console.log('Telegram API error, waiting before retry...');
            setTimeout(() => {
                console.log('Attempting to reconnect...');
                bot.startPolling();
            }, 10000);
        }
    });

    bot.on('polling_error', (error) => {
        console.error('Polling error:', error.message);
        if (error.code === 'ETELEGRAM' && error.response.statusCode === 502) {
            console.log('Bad Gateway error, waiting before retry...');
            setTimeout(() => {
                console.log('Attempting to reconnect...');
                bot.startPolling();
            }, 10000);
        }
    });

    // Reconnection logic
    let isConnected = false;
    
    bot.on('webhook_error', (error) => {
        console.error('Webhook error:', error.message);
    });

    bot.on('polling_error', (error) => {
        if (!isConnected) {
            console.log('Connection lost, attempting to reconnect...');
            setTimeout(() => {
                bot.startPolling();
            }, 5000);
        }
    });

    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const welcomeMessage = `🚀 *Welcome to Price Panda Bot!*\n\n` +
            `Your personal crypto assistant for real-time market insights! 📊\n\n` +
            `*Essential Commands:*\n` +
            `💰 /price or /p <symbol> - Live price updates\n` +
            `📈 /chart or /c <symbol> - Interactive price charts\n` +
            `🔔 /alerts - Smart price notifications\n` +
            `⭐️ /favorites - Your watchlist\n` +
            `❓ /help - Full command list\n\n` +
            `*Quick Examples:*\n` +
            `• /p BTC - Check Bitcoin price\n` +
            `• /c ETH - View Ethereum chart\n\n` +
            `Ready to start tracking your favorite cryptocurrencies? Try any command above! 🎯`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '➕ Add to Your Group', url: `https://t.me/${bot.options.username}?startgroup=true` }],
                [
                    { text: '💰 Check Price', callback_data: 'check_price' },
                    { text: '📈 View Chart', callback_data: 'view_chart' }
                ],
                [
                    { text: '⭐ Favorites', callback_data: 'favorites' },
                    { text: '🔔 Set Alerts', callback_data: 'alerts' }
                ],
                [{ text: '❓ Help', callback_data: 'help' }]
            ]
        };

        await bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    });

    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        const helpMessage = `*Price Panda Bot Commands:*\n\n` +
            `*Price Commands:*\n` +
            `🔹 /price or /p (symbol) - Get current price\n` +
            `🔹 /chart or /c (symbol) - View price chart\n\n` +
            `*Alert Commands:*\n` +
            `🔹 /alert (symbol) (price) - Set price alert\n` +
            `🔹 /alerts - View your alerts\n` +
            `🔹 /delalert (number) - Delete alert\n\n` +
            `*Favorite Commands:*\n` +
            `🔹 /addfav (symbol) - Add to favorites\n` +
            `🔹 /delfav (symbol) - Remove from favorites\n` +
            `🔹 /favorites - View favorites\n\n` +
            `*Examples:*\n` +
            `• /p BTC\n` +
            `• /c ETH\n` +
            `• /alert BTC 50000\n` +
            `• /addfav BTC`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '💰 Check Price', callback_data: 'check_price' },
                    { text: '📈 View Chart', callback_data: 'view_chart' }
                ],
                [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
            ]
        };

        await bot.sendMessage(chatId, helpMessage, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    });

    bot.on('new_chat_members', async (msg) => {
        const chatId = msg.chat.id;
        const newMembers = msg.new_chat_members;
        
        // Check if the bot was added to the group
        const botWasAdded = newMembers.some(member => member.username === bot.options.username);
        
        if (botWasAdded) {
            const welcomeMessage = `👋 *Thanks for adding me to the group!*\n\n` +
                `I'll help track cryptocurrency prices and alerts.\n\n` +
                `*Quick Commands:*\n` +
                `🔹 /price (symbol) - Get current price\n` +
                `🔹 /chart (symbol) - View price chart\n` +
                `🔹 /help - Show all commands\n\n` +
                `Example: /price BTC`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '💰 Check Price', callback_data: 'check_price' },
                        { text: '📈 View Chart', callback_data: 'view_chart' }
                    ],
                    [{ text: '❓ Help', callback_data: 'help' }]
                ]
            };

            await bot.sendMessage(chatId, welcomeMessage, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
    });

    bot.on('callback_query', async (query) => {
        try {
            const chatId = query.message.chat.id;
            const messageId = query.message.message_id;
            const data = query.data;
            const userId = query.from.id;

            switch (data) {
                case 'check_price':
                    await bot.sendMessage(chatId, 
                        '📊 *Enter the cryptocurrency symbol:*\n' +
                        'Example: BTC, ETH, DOGE\n\n' +
                        'Or use the command: /price (symbol)',
                        { parse_mode: 'Markdown' }
                    );
                    break;

                case 'view_chart':
                    await bot.sendMessage(chatId,
                        '📈 *Enter the cryptocurrency symbol for chart:*\n' +
                        'Example: BTC, ETH, DOGE\n\n' +
                        'Or use the command: /chart (symbol)',
                        { parse_mode: 'Markdown' }
                    );
                    break;

                case 'help':
                    const helpMessage = `*Price Panda Bot Commands:*\n\n` +
                        `*Price Commands:*\n` +
                        `🔹 /price or /p (symbol) - Get current price\n` +
                        `🔹 /chart or /c (symbol) - View price chart\n\n` +
                        `*Alert Commands:*\n` +
                        `🔹 /alert (symbol) (price) - Set price alert\n` +
                        `🔹 /alerts - View your alerts\n` +
                        `🔹 /delalert (number) - Delete alert\n\n` +
                        `*Favorite Commands:*\n` +
                        `🔹 /addfav (symbol) - Add to favorites\n` +
                        `🔹 /delfav (symbol) - Remove from favorites\n` +
                        `🔹 /favorites - View favorites\n\n` +
                        `*Examples:*\n` +
                        `• /p BTC\n` +
                        `• /c ETH\n` +
                        `• /alert BTC 50000\n` +
                        `• /addfav BTC`;

                    const helpKeyboard = {
                        inline_keyboard: [
                            [
                                { text: '💰 Check Price', callback_data: 'check_price' },
                                { text: '📈 View Chart', callback_data: 'view_chart' }
                            ],
                            [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
                        ]
                    };

                    try {
                        await bot.editMessageText(helpMessage, {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown',
                            reply_markup: helpKeyboard
                        });
                    } catch (editError) {
                        if (editError.response?.body?.error_code === 400) {
                            await bot.sendMessage(chatId, helpMessage, {
                                parse_mode: 'Markdown',
                                reply_markup: helpKeyboard
                            });
                        } else {
                            throw editError;
                        }
                    }
                    break;

                case 'main_menu':
                    const mainMenuMessage = `🚀 *Welcome to Price Panda Bot!*\n\n` +
            `Your personal crypto assistant for real-time market insights! 📊\n\n` +
            `*Essential Commands:*\n` +
            `💰 /price or /p <symbol> - Live price updates\n` +
            `📈 /chart or /c <symbol> - Interactive price charts\n` +
            `🔔 /alerts - Smart price notifications\n` +
            `⭐️ /favorites - Your watchlist\n` +
            `❓ /help - Full command list\n\n` +
            `*Quick Examples:*\n` +
            `• /p BTC - Check Bitcoin price\n` +
            `• /c ETH - View Ethereum chart\n\n` +
            `Ready to start tracking your favorite cryptocurrencies? Try any command above! 🎯`;

                    const mainMenuKeyboard = {
                        inline_keyboard: [
                            [{ text: '➕ Add to Your Group', url: `https://t.me/${bot.options.username}?startgroup=true` }],
                            [
                                { text: '💰 Check Price', callback_data: 'check_price' },
                                { text: '📈 View Chart', callback_data: 'view_chart' }
                            ],
                            [
                                { text: '⭐ Favorites', callback_data: 'favorites' },
                                { text: '🔔 Set Alerts', callback_data: 'alerts' }
                            ],
                            [{ text: '❓ Help', callback_data: 'help' }]
                        ]
                    };

                    try {
                        await bot.editMessageText(mainMenuMessage, {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown',
                            reply_markup: mainMenuKeyboard
                        });
                    } catch (editError) {
                        if (editError.response?.body?.error_code === 400) {
                            await bot.sendMessage(chatId, mainMenuMessage, {
                                parse_mode: 'Markdown',
                                reply_markup: mainMenuKeyboard
                            });
                        } else {
                            throw editError;
                        }
                    }
                    break;

                case 'alerts':
                    const userAlerts = getAlerts(userId);
                    let alertsMessage;
                    
                    if (userAlerts.length === 0) {
                        alertsMessage = '🔔 *Your Price Alerts*\n\nYou have no active alerts.\n\nTo set an alert, use:\n/alert (symbol) (price)\nExample: /alert BTC 50000';
                    } else {
                        alertsMessage = '🔔 *Your Price Alerts*\n\n' +
                            userAlerts.map((alert, index) => 
                                `${index + 1}. ${alert.symbol} - $${alert.targetPrice}`
                            ).join('\n') +
                            '\n\nTo delete an alert, use:\n/delalert (number)';
                    }

                    const alertsKeyboard = {
                        inline_keyboard: [
                            [{ text: '➕ Set New Alert', callback_data: 'set_alert' }],
                            [{ text: ' Main Menu', callback_data: 'main_menu' }]
                        ]
                    };

                    try {
                        await bot.editMessageText(alertsMessage, {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown',
                            reply_markup: alertsKeyboard
                        });
                    } catch (editError) {
                        if (editError.response?.body?.error_code === 400) {
                            await bot.sendMessage(chatId, alertsMessage, {
                                parse_mode: 'Markdown',
                                reply_markup: alertsKeyboard
                            });
                        } else {
                            throw editError;
                        }
                    }
                    break;

                case 'favorites':
                    const userFavorites = getFavorites(userId);
                    let favoritesMessage;
                    let favoritesKeyboard;

                    if (userFavorites.length === 0) {
                        favoritesMessage = '⭐ *Your Favorite Coins*\n\n' +
                            'You have no favorites yet.\n\n' +
                            'To add a favorite, use:\n' +
                            '/addfav (symbol)\n' +
                            'Example: /addfav BTC';
                        
                        favoritesKeyboard = {
                            inline_keyboard: [
                                [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
                            ]
                        };
                    } else {
                        favoritesMessage = '⭐ *Your Favorite Coins*\n\n' +
                            userFavorites.map((symbol, index) => 
                                `${index + 1}. ${symbol}`
                            ).join('\n') +
                            '\n\nTo remove a favorite, use:\n/delfav (symbol)';

                        const favoriteButtons = userFavorites.map(symbol => ([
                            { text: `💰 ${symbol}`, callback_data: `price_${symbol}` }
                        ]));

                        favoritesKeyboard = {
                            inline_keyboard: [
                                ...favoriteButtons,
                                [{ text: '🔄 Refresh', callback_data: 'favorites' }],
                                [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
                            ]
                        };
                    }

                    try {
                        await bot.editMessageText(favoritesMessage, {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown',
                            reply_markup: favoritesKeyboard
                        });
                    } catch (editError) {
                        if (editError.response?.body?.error_code === 400) {
                            await bot.sendMessage(chatId, favoritesMessage, {
                                parse_mode: 'Markdown',
                                reply_markup: favoritesKeyboard
                            });
                        } else {
                            throw editError;
                        }
                    }
                    break;

                case 'set_alert':
                    await bot.sendMessage(chatId,
                        '⚡ *Set a Price Alert*\n\n' +
                        'Use the command:\n' +
                        '/alert (symbol) (price)\n\n' +
                        'Example:\n' +
                        '/alert BTC 50000\n' +
                        '/alert ETH 3000',
                        { parse_mode: 'Markdown' }
                    );
                    break;

                default:
                    if (data.startsWith('alert_')) {
                        const symbol = data.split('_')[1];
                        await bot.sendMessage(chatId,
                            `🔔 *Set Alert for ${symbol}*\n\n` +
                            'Use the command:\n' +
                            `/alert ${symbol} (price)\n\n` +
                            'Example:\n' +
                            `/alert ${symbol} 50000`,
                            { parse_mode: 'Markdown' }
                        );
                    }

                case data.match(/^favorite_(.+)/)?.input:
                    const coinSymbol = data.split('_')[1];
                    const added = addFavorite(userId, coinSymbol);
                    
                    await bot.answerCallbackQuery(query.id, {
                        text: added 
                            ? `✅ Added ${coinSymbol} to favorites!` 
                            : `ℹ️ ${coinSymbol} is already in favorites!`,
                        show_alert: true
                    });
                    break;

                case data.match(/^price_(.+)/)?.input:
                    const [_, priceSymbol, priceAmount = 1] = data.split('_');
                    const amount = parseFloat(priceAmount);
                    
                    const statusMessage = await bot.sendMessage(chatId, 
                        `🔍 Fetching price for ${amount} ${priceSymbol}...`
                    );
                    
                    try {
                        const price = await getTokenPrice(priceSymbol);
                        if (price) {
                            const totalValue = price.price_usd * amount;
                            let message = formatPriceMessage(price);
                            
                            if (amount !== 1) {
                                message += `\n\n💰 *Amount Calculation:*\n` +
                                    `${amount} ${priceSymbol} = $${totalValue.toFixed(2)}\n` +
                                    `Rate: $${price.price_usd.toFixed(price.price_usd < 1 ? 8 : 4)} per ${priceSymbol}`;
                            }

                            const keyboard = {
                                inline_keyboard: [
                                    [
                                        { text: '📈 View Chart', callback_data: `chart_${priceSymbol}` },
                                        { text: '⭐ Add to Favorites', callback_data: `favorite_${priceSymbol}` }
                                    ],
                                    [
                                        { text: '🔄 Refresh', callback_data: `price_${priceSymbol}_${amount}`},
                                        { text: '🔔 Set Alert', callback_data: `alert_${priceSymbol}` }
                                    ],
                                    [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
                                ]
                            };

                            await bot.editMessageText(message, {
                                chat_id: chatId,
                                message_id: statusMessage.message_id,
                                parse_mode: 'Markdown',
                                reply_markup: keyboard
                            });
                        } else {
                            await bot.editMessageText(`❌ Could not find price for ${priceSymbol}`, {
                                chat_id: chatId,
                                message_id: statusMessage.message_id,
                                reply_markup: {
                                    inline_keyboard: [[
                                        { text: '🏠 Main Menu', callback_data: 'main_menu' }
                                    ]]
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Price fetch error:', error);
                        await bot.editMessageText(
                            `❌ Error fetching price for ${priceSymbol}`, {
                            chat_id: chatId,
                            message_id: statusMessage.message_id,
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '🏠 Main Menu', callback_data: 'main_menu' }
                                ]]
                            }
                        });
                    }
                    break;

                case data.match(/^chart_(.+)/)?.input:
                    const chartSymbol = data.split('_')[1];
                    
                    try {
                        // First, answer the callback query immediately to prevent timeout
                        await bot.answerCallbackQuery(query.id);
                        
                        // Then send the "generating" message
                        const chartStatusMessage = await bot.sendMessage(chatId, 
                            `📊 Generating chart for ${chartSymbol}...`
                        );

                        try {
                            // Generate and send the chart with a filename
                            const chartBuffer = await generateChart(chartSymbol);
                            await bot.sendPhoto(chatId, chartBuffer, {
                                filename: `${chartSymbol}_chart.png`,
                                caption: `📈 ${chartSymbol}/USDT Price Chart (30 Days)`,
                                reply_markup: {
                                    inline_keyboard: [
                                        [
                                            { text: '💰 Get Price', callback_data: `price_${chartSymbol}` },
                                            { text: '🔄 Refresh Chart', callback_data: `chart_${chartSymbol}` }
                                        ],
                                        [
                                            { text: '⭐ Add to Favorites', callback_data: `favorite_${chartSymbol}` },
                                            { text: '🏠 Main Menu', callback_data: 'main_menu' }
                                        ]
                                    ]
                                }
                            });

                            // Delete the status message after successful chart generation
                            await bot.deleteMessage(chatId, chartStatusMessage.message_id);
                        } catch (chartError) {
                            console.error('Chart generation error:', chartError);
                            await bot.editMessageText(
                                `❌ Error generating chart for ${chartSymbol}. Please try again.`, {
                                chat_id: chatId,
                                message_id: chartStatusMessage.message_id,
                                reply_markup: {
                                    inline_keyboard: [[
                                        { text: '🔄 Retry', callback_data: `chart_${chartSymbol}` },
                                        { text: '🏠 Main Menu', callback_data: 'main_menu' }
                                    ]]
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Chart callback error:', error);
                        try {
                            await bot.sendMessage(chatId,
                                `❌ Error generating chart for ${chartSymbol}. Please try again.`,
                                {
                                    reply_markup: {
                                        inline_keyboard: [[
                                            { text: '🔄 Retry', callback_data: `chart_${chartSymbol}` },
                                            { text: '🏠 Main Menu', callback_data: 'main_menu' }
                                        ]]
                                    }
                                }
                            );
                        } catch (msgError) {
                            console.error('Failed to send error message:', msgError);
                        }
                    }
                    break;
            }

            await bot.answerCallbackQuery(query.id);
        } catch (error) {
            console.error('Callback query error:', error);
            try {
                await bot.answerCallbackQuery(query.id, {
                    text: 'An error occurred. Please try again.',
                    show_alert: true
                });
                
                await bot.sendMessage(query.message.chat.id, 
                    '❌ Sorry, there was an error processing your request. Please try again.',
                    { parse_mode: 'Markdown' }
                );
            } catch (callbackError) {
                console.error('Error answering callback:', callbackError);
            }
        }
    });

    bot.onText(/\/(price|p)(?:@\w+)?\s+(\w+)(?:\s+(\d*\.?\d*))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const symbol = match[2].toUpperCase();
        const amount = match[3] ? parseFloat(match[3]) : 1; // Default is 1 if no amount specified
        
        const statusMessage = await bot.sendMessage(chatId, `🔍 Fetching price for ${amount} ${symbol}...`);
        
        try {
            const price = await getTokenPrice(symbol);
            if (price) {
                const totalValue = price.price_usd * amount;
                let message = formatPriceMessage(price);
                
                if (amount !== 1) {
                    message += `\n\n💰 *Amount Calculation:*\n` +
                        `${amount} ${symbol} = $${totalValue.toFixed(2)}\n` +
                        `Rate: $${price.price_usd.toFixed(price.price_usd < 1 ? 8 : 4)} per ${symbol}`;
                }

                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '📈 View Chart', callback_data: `chart_${symbol}` },
                            { text: '⭐ Add to Favorites', callback_data: `favorite_${symbol}` }
                        ],
                        [
                            { text: '🔄 Refresh', callback_data: `price_${symbol}_${amount}`},
                            { text: '🔔 Set Alert', callback_data: `alert_${symbol}` }
                        ],
                        [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
                    ]
                };

                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: statusMessage.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            } else {
                await bot.editMessageText(`❌ Could not find price for ${symbol}`, {
                    chat_id: chatId,
                    message_id: statusMessage.message_id,
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🏠 Main Menu', callback_data: 'main_menu' }
                        ]]
                    }
                });
            }
        } catch (error) {
            console.error('Price command error:', error);
            await bot.editMessageText(`❌ Error fetching price for ${symbol}`, {
                chat_id: chatId,
                message_id: statusMessage.message_id,
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🏠 Main Menu', callback_data: 'main_menu' }
                    ]]
                }
            });
        }
    });

    bot.onText(/\/(chart|c)(?:@\w+)? (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const symbol = match[2].toUpperCase();
        
        const statusMessage = await bot.sendMessage(chatId, 
            `📊 Generating chart for ${symbol}...`
        );

        try {
            await generateAndSendChart(chatId, symbol);
            await bot.deleteMessage(chatId, statusMessage.message_id);
        } catch (error) {
            console.error('Chart command error:', error);
            await bot.editMessageText(
                `❌ Error generating chart for ${symbol}. Please try again.`, {
                chat_id: chatId,
                message_id: statusMessage.message_id
            });
        }
    });

    try {
        await bot.getMe();
        isConnected = true;
        console.log('Bot is running...');
    } catch (error) {
        console.error('Failed to connect to Telegram:', error.message);
        process.exit(1);
    }

    // Alert and favorite command handlers
    bot.onText(/\/alert(?:@\w+)? (\w+)\s+(\d+\.?\d*)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const symbol = match[1].toUpperCase();
        const targetPrice = parseFloat(match[2]);

        setAlert(userId, symbol, targetPrice);
        await bot.sendMessage(chatId,
            `✅ Alert set for ${symbol} at $${targetPrice}\n\n` +
            'You will be notified when the price reaches this target.',
            { parse_mode: 'Markdown' }
        );
    });

    bot.onText(/\/alerts(?:@\w+)?/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const alerts = getAlerts(userId);

        let message;
        if (alerts.length === 0) {
            message = '🔔 *Your Price Alerts*\n\nYou have no active alerts.\n\nTo set an alert, use:\n/alert (symbol) (price)\nExample: /alert BTC 50000';
        } else {
            message = '🔔 *Your Price Alerts*\n\n' +
                alerts.map((alert, index) => 
                    `${index + 1}. ${alert.symbol} - $${alert.targetPrice}`
                ).join('\n') +
                '\n\nTo delete an alert, use:\n/delalert (number)';
        }

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/delalert(?:@\w+)? (\d+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const alertIndex = parseInt(match[1]) - 1;

        removeAlert(userId, alertIndex);
        await bot.sendMessage(chatId,
            '✅ Alert removed successfully!',
            { parse_mode: 'Markdown' }
        );
    });

    // Add favorite command handler
    bot.onText(/\/addfav(?:@\w+)? (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const symbol = match[1].toUpperCase();

        try {
            const price = await getTokenPrice(symbol);
            if (!price) {
                await bot.sendMessage(chatId, 
                    `❌ Could not find cryptocurrency: ${symbol}`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            const added = addFavorite(userId, symbol);
            if (added) {
                await bot.sendMessage(chatId,
                    `✅ Added ${symbol} to your favorites!`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await bot.sendMessage(chatId,
                    `ℹ️ ${symbol} is already in your favorites!`,
                    { parse_mode: 'Markdown' }
                );
            }
        } catch (error) {
            console.error('Add favorite error:', error);
            await bot.sendMessage(chatId,
                '❌ Error adding to favorites. Please try again.',
                { parse_mode: 'Markdown' }
            );
        }
    });

    // Remove favorite command handler
    bot.onText(/\/delfav(?:@\w+)? (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const symbol = match[1].toUpperCase();

        const removed = removeFavorite(userId, symbol);
        if (removed) {
            await bot.sendMessage(chatId,
                `✅ Removed ${symbol} from your favorites!`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await bot.sendMessage(chatId,
                `ℹ️ ${symbol} was not in your favorites!`,
                { parse_mode: 'Markdown' }
            );
        }
    });
}

// CoinMarketCap configuration
const CMC_API_KEY = process.env.CMC_API_KEY;
const CMC_BASE_URL = 'https://pro-api.coinmarketcap.com';
const cmcAxios = axios.create({
    baseURL: CMC_BASE_URL,
    headers: {
        'X-CMC_PRO_API_KEY': CMC_API_KEY,
        'Accept': 'application/json'
    }
});

// Price fetching functions
async function getTokenPrice(symbol) {
    try {
        const response = await cmcAxios.get('/v2/cryptocurrency/quotes/latest', {
            params: {
                symbol: symbol.toUpperCase(),
                convert: 'USD'
            }
        });
        
        const data = response.data.data;
        if (!data || Object.keys(data).length === 0) {
            console.log('No data found for symbol:', symbol);
            return null;
        }

        const tokenData = data[symbol.toUpperCase()][0];
        if (!tokenData || !tokenData.quote || !tokenData.quote.USD) {
            console.log('Invalid token data structure for symbol:', symbol);
            return null;
        }

        return {
            name: tokenData.name,
            symbol: tokenData.symbol,
            price_usd: tokenData.quote.USD.price,
            percent_change_1h: tokenData.quote.USD.percent_change_1h,
            percent_change_24h: tokenData.quote.USD.percent_change_24h,
            percent_change_7d: tokenData.quote.USD.percent_change_7d,
            percent_change_30d: tokenData.quote.USD.percent_change_30d,
            market_cap: tokenData.quote.USD.market_cap,
            volume_24h: tokenData.quote.USD.volume_24h,
            circulating_supply: tokenData.circulating_supply,
            max_supply: tokenData.max_supply || null,
            ath: tokenData.ath || null
        };
    } catch (error) {
        console.error('Error fetching price:', error.response?.data || error.message);
        return null;
    }
}

async function getHistoricalData(symbol) {
    try {
        const response = await cmcAxios.get('/v2/cryptocurrency/quotes/historical', {
            params: {
                symbol: symbol.toUpperCase(),
                convert: 'USD',
                interval: '1d',
                count: 30
            }
        });
        return response.data.data;
    } catch (error) {
        console.error('Error fetching historical data:', error);
        return null;
    }
}

async function searchToken(query) {
    try {
        const response = await cmcAxios.get('/v1/cryptocurrency/map', {
            params: {
                search: query,
                limit: 5
            }
        });
        return response.data.data;
    } catch (error) {
        console.error('Error searching token:', error);
        return [];
    }
}

async function getTrendingTokens() {
    try {
        const response = await cmcAxios.get('/v1/cryptocurrency/trending/gainers-losers');
        return response.data.data;
    } catch (error) {
        console.error('Error fetching trending tokens:', error);
        return [];
    }
}

// Wallet tracking functions
function getChainRPC(chain) {
    const RPCs = {
        'ETH': 'https://mainnet.infura.io/v3/YOUR-PROJECT-ID',
        'BSC': 'https://bsc-dataseed.binance.org',
        'MATIC': 'https://polygon-rpc.com'
    };
    return RPCs[chain] || RPCs['ETH'];
}

async function getWalletBalance(address, chain) {
    const web3 = new Web3(getChainRPC(chain));
    try {
        const balance = await web3.eth.getBalance(address);
        return web3.utils.fromWei(balance, 'ether');
    } catch (error) {
        console.error('Error fetching wallet balance:', error);
        return null;
    }
}

function formatNumber(num) {
    if (num >= 1e9) {
        return (num / 1e9).toFixed(2) + 'B';
    }
    if (num >= 1e6) {
        return (num / 1e6).toFixed(2) + 'M';
    }
    if (num >= 1e3) {
        return (num / 1e3).toFixed(2) + 'K';
    }
    return num.toFixed(2);
}

async function generateAndSendChart(chatId, symbol) {
    try {
        const response = await axios.get(`https://api.binance.us/api/v3/klines`, {
            params: {
                symbol: `${symbol}USDT`,
                interval: '1d',
                limit: 30
            }
        });
        
        const chartData = response.data.map(d => ({
            time: new Date(d[0]),
            price: parseFloat(d[4])
        }));
        
        const canvas = createCanvas(800, 400);
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 800, 400);
        
        const prices = chartData.map(d => d.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        
        ctx.beginPath();
        ctx.strokeStyle = '#2196f3';
        ctx.lineWidth = 2;
        
        chartData.forEach((d, i) => {
            const x = (i / (chartData.length - 1)) * 760 + 20;
            const y = 380 - ((d.price - minPrice) / (maxPrice - minPrice)) * 360;
            
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        
        ctx.stroke();
        
        ctx.fillStyle = '#000000';
        ctx.font = '12px Arial';
        ctx.fillText(`$${minPrice.toFixed(2)}`, 5, 380);
        ctx.fillText(`$${maxPrice.toFixed(2)}`, 5, 20);
        
        await bot.sendPhoto(chatId, canvas.toBuffer(), {
            caption: `📈 ${symbol}/USDT Price Chart (30 Days)`,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '💰 Get Price', callback_data: `price_${symbol}` },
                        { text: '🔄 Refresh Chart', callback_data: `chart_${symbol}` }
                    ],
                    [
                        { text: '⭐ Add to Favorites', callback_data: `favorite_${symbol}` },
                        { text: '🏠 Main Menu', callback_data: 'main_menu' }
                    ]
                ]
            }
        });
    } catch (error) {
        console.error('Error generating chart:', error);
        throw error;
    }
}

function getTrendEmoji(value) {
    if (value > 5) return '🚀';
    if (value > 0) return '📈';
    if (value > -5) return '📉';
    return '💥';
}

function formatPriceMessage(price) {
    return `*${price.name} (${price.symbol})*\n\n` +
        `💎 *Price:* $${price.price_usd.toFixed(price.price_usd < 1 ? 8 : 4)}\n\n` +
        `📊 *Performance:*\n` +
        `${getTrendEmoji(price.percent_change_1h)} 1H: ${price.percent_change_1h.toFixed(2)}%\n` +
        `${getTrendEmoji(price.percent_change_24h)} 24H: ${price.percent_change_24h.toFixed(2)}%\n` +
        `${getTrendEmoji(price.percent_change_7d)} 7D: ${price.percent_change_7d.toFixed(2)}%\n` +
        `${getTrendEmoji(price.percent_change_30d)} 30D: ${price.percent_change_30d.toFixed(2)}%\n\n` +
        `📈 *Market Data:*\n` +
        `Market Cap: $${formatNumber(price.market_cap)}\n` +
        `24h Volume: $${formatNumber(price.volume_24h)}\n` +
        `Circulating Supply: ${formatNumber(price.circulating_supply)} ${price.symbol}\n` +
        (price.max_supply ? `Max Supply: ${formatNumber(price.max_supply)} ${price.symbol}\n` : '') +
        (price.ath ? `\n🏆 ATH: $${price.ath.toFixed(price.ath < 1 ? 8 : 4)}` : '');
}

// Alert management functions
function setAlert(userId, symbol, targetPrice) {
    const user = findUser(userId) || { telegramId: userId, alerts: [] };
    user.alerts = user.alerts || [];
    user.alerts.push({ symbol, targetPrice });
    saveUser(user);
}

function getAlerts(userId) {
    const user = findUser(userId);
    return user ? user.alerts || [] : [];
}

function removeAlert(userId, alertIndex) {
    const user = findUser(userId);
    if (user && user.alerts) {
        user.alerts.splice(alertIndex, 1);
        saveUser(user);
    }
}

// Favorite management functions
function addFavorite(userId, symbol) {
    const user = findUser(userId) || { telegramId: userId, favorites: [] };
    user.favorites = user.favorites || [];
    if (!user.favorites.includes(symbol)) {
        user.favorites.push(symbol);
        saveUser(user);
        return true;
    }
    return false;
}

function removeFavorite(userId, symbol) {
    const user = findUser(userId);
    if (user && user.favorites) {
        const index = user.favorites.indexOf(symbol);
        if (index !== -1) {
            user.favorites.splice(index, 1);
            saveUser(user);
            return true;
        }
    }
    return false;
}

function getFavorites(userId) {
    const user = findUser(userId);
    return user ? user.favorites || [] : [];
}

// Chart generation function
async function generateChart(symbol) {
    try {
        const response = await axios.get(`https://api.binance.us/api/v3/klines`, {
            params: {
                symbol: `${symbol}USDT`,
                interval: '1d',
                limit: 30
            }
        });
        
        const chartData = response.data.map(d => ({
            time: new Date(d[0]),
            price: parseFloat(d[4])
        }));
        
        const canvas = createCanvas(800, 400);
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 800, 400);
        
        const prices = chartData.map(d => d.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        
        const padding = (maxPrice - minPrice) * 0.1;
        const yMin = minPrice - padding;
        const yMax = maxPrice + padding;
        
        ctx.beginPath();
        ctx.strokeStyle = '#2196f3';
        ctx.lineWidth = 2;
        
        chartData.forEach((d, i) => {
            const x = (i / (chartData.length - 1)) * 760 + 20;
            const y = 380 - ((d.price - yMin) / (yMax - yMin)) * 360;
            
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        
        ctx.stroke();
        
        ctx.fillStyle = '#000000';
        ctx.font = '12px Arial';
        
        for (let i = 0; i <= 5; i++) {
            const price = yMin + (yMax - yMin) * (i / 5);
            const y = 380 - (i / 5) * 360;
            
            ctx.fillText(`$${price.toFixed(2)}`, 5, y + 4);
            
            ctx.beginPath();
            ctx.strokeStyle = '#e0e0e0';
            ctx.lineWidth = 1;
            ctx.moveTo(20, y);
            ctx.lineTo(780, y);
            ctx.stroke();
        }
        
        return canvas.toBuffer('image/png');
    } catch (error) {
        console.error('Error generating chart:', error);
        throw error;
    }
}

async function startBot() {
    let retryCount = 0;
    const maxRetries = 5;

    while (retryCount < maxRetries) {
        try {
            await initBot();
            break;
        } catch (error) {
            retryCount++;
            console.error(`Failed to start bot (attempt ${retryCount}/${maxRetries}):`, error.message);
            
            if (retryCount === maxRetries) {
                console.error('Max retry attempts reached. Exiting...');
                process.exit(1);
            }
            
            // Wait before retrying
            console.log(`Waiting ${retryCount * 5} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, retryCount * 5000));
        }
    }
}

// Handle process termination
process.on('SIGINT', async () => {
    console.log('Received SIGINT. Cleaning up...');
    try {
        await cleanup();
        console.log('Cleanup completed. Exiting...');
        process.exit(0);
    } catch (error) {
        console.error('Error during cleanup:', error);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM. Cleaning up...');
    try {
        await cleanup();
        console.log('Cleanup completed. Exiting...');
        process.exit(0);
    } catch (error) {
        console.error('Error during cleanup:', error);
        process.exit(1);
    }
});
// Start the bot
startBot();

