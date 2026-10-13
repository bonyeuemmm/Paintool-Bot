const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder,
    ComponentType
} = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN || typeof TOKEN !== 'string' || TOKEN.trim() === '') {
    console.error('[FATAL] DISCORD_TOKEN không tồn tại hoặc không hợp lệ.');
    process.exit(1);
}

// ============ COHERE API KEYS — 1 CHÍNH + 4 DỰ PHÒNG ============
// Thêm 5 biến vào Render Environment (tuỳ chọn):
//   COHERE_API_KEY_0=sk_live_key_chính_ở_đây
//   COHERE_API_KEY_1=sk_live_key_phụ_1_ở_đây
//   COHERE_API_KEY_2=sk_live_key_phụ_2_ở_đây
//   COHERE_API_KEY_3=sk_live_key_phụ_3_ở_đây
//   COHERE_API_KEY_4=sk_live_key_phụ_4_ở_đây
//
// Bot sẽ load keys từ environment khi khởi động
const COHERE_KEYS = {
    0: process.env.COHERE_API_KEY_0 || null,
    1: process.env.COHERE_API_KEY_1 || null,
    2: process.env.COHERE_API_KEY_2 || null,
    3: process.env.COHERE_API_KEY_3 || null,
    4: process.env.COHERE_API_KEY_4 || null,
};

const CLIENT_ID = process.env.CLIENT_ID;
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const OWNER_ID = '1208450889246048306';

const FOOTER_ICON_URL = 'https://i.postimg.cc/gJbhCmHL/Pain-Gamer.png';
const SECRET_KEY = process.env.SECRET_KEY || "PainGamerSecretKey2156#VipTool";

const COLORS = {
    SUCCESS: 0x2ECC71,
    ERROR: 0xE74C3C,
    WARNING: 0xF39C12,
    INFO: 0x3498DB,
    PURPLE: 0x9B59B6,
    GOLD: 0xF1C40F,
    DARK: 0x2C3E50
};

const getFooterOptions = () => {
    return {
        text: 'PAIN PREMIUM SYSTEM • Authorized Only',
        iconURL: FOOTER_ICON_URL
    };
};

async function notifyOwner(client, embed) {
    try {
        const owner = await client.users.fetch(OWNER_ID);
        if (owner) {
            await owner.send({ embeds: [embed] });
            console.log('✅ Đã gửi thông báo DM cho Owner thành công.');
        }
    } catch (e) {
        console.error('❌ Lỗi khi gửi DM cho Owner:', e.message);
    }
}

const adminSchema = new mongoose.Schema({ user_id: String });
const Admin = mongoose.model('Admin', adminSchema);

const keySchema = new mongoose.Schema({
    key: String,
    assigned_key: { type: String, default: null },
    hwid: { type: String, default: null },
    expires_at: { type: Number, default: 0 },
    duration_days: { type: Number, default: 0 },
    user_id: { type: String, default: null },
    is_used: { type: Number, default: 0 },
    last_reset: { type: Number, default: 0 },
    notified_7d: { type: Boolean, default: false },
    notified_24h: { type: Boolean, default: false },
    notified_4h: { type: Boolean, default: false }
});
const Key = mongoose.model('Key', keySchema);

const tokenSchema = new mongoose.Schema({
    token: { type: String, required: true, unique: true },
    user_id: { type: String, default: null },
    created_at: { type: Number, default: Date.now }
});
const ResetToken = mongoose.model('ResetToken', tokenSchema);

console.log('🔄 Đang tiến hành kết nối đến MongoDB Atlas...');
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Đã kết nối MongoDB Atlas thành công!'))
    .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.status(200).send('Bot is active and running successfully!');
});

// ROUTE KIỂM TRA PHIÊN BẢN VÀ TẢI BẢN CẬP NHẬT
// Phiên bản lấy trực tiếp từ dòng VERSION trong paintoolpremium.py trên server,
// nên chỉ cần sửa file là phiên bản và bản tải về luôn khớp nhau.
const PREMIUM_FILE = path.join(__dirname, 'paintoolpremium.py');

const readToolVersion = () => {
    try {
        const text = fs.readFileSync(PREMIUM_FILE, 'utf8');
        const m = text.match(/^VERSION\s*=\s*"([^"]+)"/m);
        return m ? m[1] : null;
    } catch (e) {
        return null;
    }
};

app.get('/api/version', (req, res) => {
    const version = readToolVersion();
    if (!version) return res.status(404).json({ error: 'version_not_found' });
    res.json({ version });
});

app.get('/api/download/latest', (req, res) => {
    if (!fs.existsSync(PREMIUM_FILE)) return res.status(404).send('file_not_found');
    res.type('text/plain; charset=utf-8');
    res.sendFile(PREMIUM_FILE, (err) => {
        if (err && !res.headersSent) res.status(500).send('server_error');
    });
});

// ROUTE XÁC THỰC VÀ PHÁT CODE PREMIUM TRỰC TIẾP
app.post(['/', '/api/verify'], async (req, res) => {
    const { key, hwid, timestamp, signature } = req.body;
    try {
        if (!key || !hwid || !timestamp || !signature) {
            return res.json({ valid: false, reason: "missing_data" });
        }

        const currentTime = Math.floor(Date.now() / 1000);
        if (Math.abs(currentTime - timestamp) > 30) {
            return res.json({ valid: false, reason: "request_expired" });
        }

        const rawData = `${key}:${hwid}:${timestamp}`;
        const expectedSignature = crypto
            .createHmac('sha256', SECRET_KEY)
            .update(rawData)
            .digest('hex');

        if (signature !== expectedSignature) {
            return res.json({ valid: false, reason: "invalid_signature" });
        }

        const row = await Key.findOne({ assigned_key: key });
        if (!row) return res.json({ valid: false, reason: "key_not_found" });
        if (row.expires_at !== 0 && Date.now() > row.expires_at) return res.json({ valid: false, reason: "expired" });
        
        if (!row.hwid) {
            row.hwid = hwid;
            await row.save();
        } else if (row.hwid !== hwid) {
            return res.json({ valid: false, reason: "hwid_mismatch" });
        }

        const premiumFilePath = path.join(__dirname, 'paintoolpremium.py');
        if (!fs.existsSync(premiumFilePath)) {
            return res.json({ valid: false, reason: "source_code_not_found" });
        }

        const rawCode = await fs.promises.readFile(premiumFilePath, 'utf8');

        // Lấy key từ Render tự động thay thế vào vị trí đại diện
        const groqKey = process.env.GROQ_API_KEY || "";
        let updatedCode = rawCode.replace("MY_GROQ_KEY_PLACEHOLDER", () => groqKey);

        // Thay các khóa Cohere trong code bằng biến COHERE_API_KEY_0..4 trên Render
        for (let i = 0; i < 5; i++) {
            const k = COHERE_KEYS[i];
            if (k && k.trim()) {
                updatedCode = updatedCode.replace(`"PASTE_KEY_${i + 1}_HERE"`, () => JSON.stringify(k.trim()));
            }
        }

        const encodedCode = Buffer.from(updatedCode).toString('base64');

        return res.json({ 
            valid: true, 
            code: encodedCode 
        });

    } catch (e) { 
        console.error("❌ Lỗi API Verify:", e);
        res.json({ valid: false, reason: "server_error" }); 
    }
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 API Server đang chạy trên cổng ${PORT}`);
});

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ] 
});

const cooldowns = new Map();
const COOLDOWN_TIME = 5000; 

const commands = [
    new SlashCommandBuilder().setName('setadmin').setDescription('Thêm/xóa admin hệ thống')
        .addStringOption(opt => opt.setName('action').setDescription('Thao tác').setRequired(true).addChoices({ name: '➕ Thêm Admin', value: 'add' }, { name: '➖ Xóa Admin', value: 'remove' }))
        .addUserOption(opt => opt.setName('user').setDescription('Thành viên target').setRequired(true)),
    new SlashCommandBuilder().setName('createkey').setDescription('Tạo key bản quyền Premium')
        .addStringOption(opt => opt.setName('duration').setDescription('Thời hạn key').setRequired(true).addChoices({name: '1 Ngày', value: '1'}, {name: '3 Ngày', value: '3'}, {name: '7 Ngày', value: '7'}, {name: '30 Ngày', value: '30'}, {name: 'Vĩnh viễn', value: '0'}))
        .addUserOption(opt => opt.setName('user').setDescription('Gửi key qua DM cho user').setRequired(false)),
    new SlashCommandBuilder().setName('gettoken').setDescription('Tạo token cho phép Reset HWID')
        .addUserOption(opt => opt.setName('user').setDescription('Gửi token qua DM cho user').setRequired(false)),
    new SlashCommandBuilder().setName('getkey').setDescription('Xem danh sách & thông tin chi tiết key của bạn'),
    new SlashCommandBuilder().setName('removekey').setDescription('Xóa key khỏi hệ thống (Chỉ Owner)')
        .addStringOption(opt => opt.setName('toolkey').setDescription('Mã Tool Key cần xóa').setRequired(true)),
    new SlashCommandBuilder().setName('resethwid').setDescription('Thực hiện Reset HWID cho Key')
        .addStringOption(opt => opt.setName('key').setDescription('Chọn key cần reset').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('token').setDescription('Token cấp phép (Tùy chọn)').setRequired(false)),
    new SlashCommandBuilder().setName('redeem').setDescription('Kích hoạt Key kích hoạt 12 số')
        .addStringOption(opt => opt.setName('key').setDescription('Nhập mã key kích hoạt').setRequired(true))
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function checkExpiredKeys() {
    try {
        const now = Date.now();
        
        // Key đã hết hạn
        const expiredKeys = await Key.find({ is_used: 1, expires_at: { $ne: 0, $lt: now } });
        for (const row of expiredKeys) {
            if (row.user_id) {
                try {
                    const user = await client.users.fetch(row.user_id);
                    const keyVal = row.assigned_key || row.key;
                    const embed = new EmbedBuilder()
                        .setColor(COLORS.ERROR)
                        .setTitle('⌛ THÔNG BÁO HẾT HẠN KEY')
                        .setDescription(`Key bản quyền của bạn đã chính thức **hết hạn** và bị hệ thống thu hồi.\n\n\`\`\`\n${keyVal}\n\`\`\`\nVui lòng liên hệ Admin để gia hạn hoặc mua key mới!`)
                        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                        .setFooter(getFooterOptions());
                    await user.send({ embeds: [embed] });
                } catch (e) {}
            }
            await Key.deleteOne({ _id: row._id });
        }

        // Key đang hoạt động
        const activeKeys = await Key.find({ 
            is_used: 1,
            expires_at: { $gt: now }, 
            user_id: { $ne: null } 
        });

        for (const row of activeKeys) {
            const timeLeftMs = row.expires_at - now;
            const hoursLeft = timeLeftMs / (1000 * 60 * 60);
            const daysLeft = hoursLeft / 24;
            const keyVal = row.assigned_key || row.key;

            if (row.duration_days >= 30 && daysLeft <= 7 && daysLeft > 1 && !row.notified_7d) {
                try {
                    const user = await client.users.fetch(row.user_id);
                    const embed = new EmbedBuilder()
                        .setColor(COLORS.INFO)
                        .setTitle('🗓️ NHẮC NHỞ HẠN SỬ DỤNG KEY (7 NGÀY)')
                        .setDescription(`Key bản quyền gói **30 Ngày** của bạn sắp hết hạn!\n\n\`\`\`\n${keyVal}\n\`\`\`\n• **Thời gian còn lại:** khoảng **${Math.ceil(daysLeft)} ngày**.\n• Hãy chủ động chuẩn bị gia hạn để tránh gián đoạn sử dụng.`)
                        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                        .setFooter(getFooterOptions());
                    await user.send({ embeds: [embed] });
                    row.notified_7d = true;
                    await row.save();
                } catch (e) {}
            }

            const isEligibleFor24h = row.duration_days >= 3;
            if (isEligibleFor24h && hoursLeft <= 24 && hoursLeft > 4 && !row.notified_24h) {
                try {
                    const user = await client.users.fetch(row.user_id);
                    const embed = new EmbedBuilder()
                        .setColor(COLORS.WARNING)
                        .setTitle('⚠️ CẢNH BÁO CÒN 24 GIỜ SỬ DỤNG')
                        .setDescription(`Key bản quyền của bạn sắp hết hạn!\n\n\`\`\`\n${keyVal}\n\`\`\`\n• **Thời gian còn lại:** khoảng **24 giờ**!`)
                        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                        .setFooter(getFooterOptions());
                    await user.send({ embeds: [embed] });
                    row.notified_24h = true;
                    await row.save();
                } catch (e) {}
            }

            if (hoursLeft <= 4 && !row.notified_4h) {
                try {
                    const user = await client.users.fetch(row.user_id);
                    const embed = new EmbedBuilder()
                        .setColor(COLORS.WARNING)
                        .setTitle('🚨 KHẨN CẤP: KEY SẮP HẾT HẠN (4H)')
                        .setDescription(`Key bản quyền của bạn sắp hết hạn khẩn cấp!\n\n\`\`\`\n${keyVal}\n\`\`\`\n• **Thời gian còn lại:** chỉ còn **4 giờ**!`)
                        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                        .setFooter(getFooterOptions());
                    await user.send({ embeds: [embed] });
                    row.notified_4h = true;
                    await row.save();
                } catch (e) {}
            }
        }
    } catch (err) {
        console.error('❌ Lỗi khi quét key hết hạn:', err);
    }
}

client.once('ready', async () => {
    try {
        const appId = CLIENT_ID || client.user.id;
        
        const guilds = client.guilds.cache.map(g => g.id);
        for (const guildId of guilds) {
            try {
                await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] });
            } catch (err) {}
        }

        await rest.put(Routes.applicationCommands(appId), { body: commands });
        console.log(`🌐 Đã đăng ký thành công Slash Commands Toàn Cầu (Global)!`);
        console.log(`✅ Bot Discord đã sẵn sàng hoạt động: ${client.user.tag}`);
        
        checkExpiredKeys();
        setInterval(checkExpiredKeys, 60 * 1000);
    } catch (error) {
        console.error('❌ Lỗi đăng ký Slash Commands:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isAutocomplete()) {
        if (interaction.commandName === 'resethwid') {
            try {
                const userId = interaction.user.id;
                const now = Date.now();
                const userKeys = await Key.find({ 
                    user_id: userId, 
                    assigned_key: { $ne: null },
                    $or: [{ expires_at: 0 }, { expires_at: { $gt: now } }]
                }).limit(25);
                
                const choices = userKeys.map(k => ({
                    name: `${k.assigned_key}${k.hwid ? ' [🔒 Đã khóa HWID]' : ' [🔓 N/A - Chưa liên kết]'}`,
                    value: k.assigned_key
                }));

                await interaction.respond(choices);
            } catch (err) {
                await interaction.respond([]).catch(() => {});
            }
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const userAvatar = interaction.user.displayAvatarURL({ dynamic: true });
    const { commandName } = interaction;

    // PHẢN HỒI NGAY LẬP TỨC CHO DISCORD TRÁNH LỖI OVER 3S
    const isPublicCommand = (commandName === 'redeem');
    try {
        await interaction.deferReply({ ephemeral: !isPublicCommand });
    } catch (e) {
        return;
    }

    // KIỂM TRA COOLDOWN
    if (userId !== OWNER_ID) {
        if (!cooldowns.has(userId)) cooldowns.set(userId, new Map());
        const timestamps = cooldowns.get(userId);
        const now = Date.now();
        if (timestamps.has(commandName) && now < timestamps.get(commandName) + COOLDOWN_TIME) {
            const embed = new EmbedBuilder()
                .setColor(COLORS.WARNING)
                .setTitle('⏳ THAO TÁC QUÁ NHANH')
                .setDescription(`Vui lòng chờ **${((timestamps.get(commandName) + COOLDOWN_TIME - now) / 1000).toFixed(1)}s** nữa để thực hiện lại lệnh.`)
                .setThumbnail(userAvatar)
                .setFooter(getFooterOptions());
            return interaction.editReply({ embeds: [embed] });
        }
        timestamps.set(commandName, now);
        setTimeout(() => timestamps.delete(commandName), COOLDOWN_TIME);
    }

    try {
        if (commandName === 'setadmin') {
            if (userId !== OWNER_ID) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ TỪ CHỐI TRUY CẬP').setDescription('Chỉ có Owner tối cao mới có quyền quản lý Admin!').setThumbnail(userAvatar).setFooter(getFooterOptions())] });
            }
            const action = interaction.options.getString('action');
            const target = interaction.options.getUser('user');

            if (action === 'add') {
                await Admin.findOneAndUpdate({ user_id: target.id }, { user_id: target.id }, { upsert: true });
                const embed = new EmbedBuilder().setColor(COLORS.PURPLE).setTitle('🛡️ CẬP NHẬT TRẠNG THÁI ADMIN').setDescription(`✅ Đã cấp quyền **Admin** cho người dùng:\n• **User:** <@${target.id}> (${target.tag})`).setThumbnail(userAvatar).setFooter(getFooterOptions());
                await interaction.editReply({ embeds: [embed] });
            } else {
                await Admin.deleteOne({ user_id: target.id });
                const embed = new EmbedBuilder().setColor(COLORS.PURPLE).setTitle('🛡️ CẬP NHẬT TRẠNG THÁI ADMIN').setDescription(`✅ Đã gỡ bỏ quyền **Admin** của người dùng:\n• **User:** <@${target.id}> (${target.tag})`).setThumbnail(userAvatar).setFooter(getFooterOptions());
                await interaction.editReply({ embeds: [embed] });
            }
        } 
        else if (commandName === 'createkey') {
            const isAdmin = await Admin.exists({ user_id: userId });
            if (!isAdmin && userId !== OWNER_ID) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ TỪ CHỐI TRUY CẬP').setDescription('Bạn không đủ thẩm quyền để tạo key bản quyền!').setThumbnail(userAvatar).setFooter(getFooterOptions())] });
            }

            const duration = parseInt(interaction.options.getString('duration'));
            const targetUser = interaction.options.getUser('user');
            const keyStr = Math.floor(100000000000 + Math.random() * 900000000000).toString();

            await new Key({ key: keyStr, expires_at: 0, duration_days: duration, is_used: 0 }).save();

            if (userId !== OWNER_ID) {
                const ownerEmbed = new EmbedBuilder()
                    .setColor(COLORS.GOLD)
                    .setTitle('📢 BOT LOG: ADMIN TẠO KEY MỚI')
                    .addFields(
                        { name: '👤 Admin Thực Hiện', value: `<@${userId}> \`(${interaction.user.tag})\``, inline: true },
                        { name: '⏱️ Thời Hạn Gói', value: duration === 0 ? '`Vĩnh viễn`' : `\`${duration} Ngày\``, inline: true },
                        { name: '📥 Người Nhận', value: targetUser ? `<@${targetUser.id}> \`(${targetUser.tag})\`` : '`Không chọn`', inline: true },
                        { name: '🎟️ Mã Key Kích Hoạt (Click Để Copy)', value: `\`\`\`\n${keyStr}\n\`\`\``, inline: false }
                    )
                    .setThumbnail(userAvatar)
                    .setFooter(getFooterOptions());
                notifyOwner(client, ownerEmbed); // Gửi ẩn không await
            }

            if (targetUser) {
                try {
                    const dmEmbed = new EmbedBuilder()
                        .setColor(COLORS.GOLD)
                        .setTitle('🎉 BẠN ĐÃ NHẬN ĐƯỢC KEY BẢN QUYỀN')
                        .setDescription(`Quản trị viên đã gửi tặng bạn một key kích hoạt tool premium.\n\n**Mã Key Kích Hoạt:**\n\`\`\`\n${keyStr}\n\`\`\`\n• **Thời hạn gói:** ${duration === 0 ? '`Vĩnh viễn`' : `\`${duration} Ngày\``}\n\n👉 Sử dụng lệnh \`/redeem key:${keyStr}\` trong server để kích hoạt ngay!`)
                        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                        .setFooter(getFooterOptions());
                    await targetUser.send({ embeds: [dmEmbed] });

                    const replyEmbed = new EmbedBuilder()
                        .setColor(COLORS.GOLD)
                        .setTitle('🎟️ KHỞI TẠO KEY THÀNH CÔNG')
                        .setDescription(`✅ Đã tạo key và tự động gửi trực tiếp qua DM cho **${targetUser.tag}**.\n\n**Mã Key Kích Hoạt:**\n\`\`\`\n${keyStr}\n\`\`\``)
                        .setThumbnail(userAvatar)
                        .setFooter(getFooterOptions());
                    await interaction.editReply({ embeds: [replyEmbed] });
                } catch (e) {
                    const replyEmbed = new EmbedBuilder()
                        .setColor(COLORS.WARNING)
                        .setTitle('🎟️ KHỞI TẠO KEY THÀNH CÔNG')
                        .setDescription(`⚠️ Không thể gửi DM cho **${targetUser.tag}** (Người dùng tắt nhận DM).\n\n**Mã Key Kích Hoạt:**\n\`\`\`\n${keyStr}\n\`\`\``)
                        .setThumbnail(userAvatar)
                        .setFooter(getFooterOptions());
                    await interaction.editReply({ embeds: [replyEmbed] });
                }
            } else {
                const replyEmbed = new EmbedBuilder()
                    .setColor(COLORS.GOLD)
                    .setTitle('🎟️ KHỞI TẠO KEY THÀNH CÔNG')
                    .setDescription(`✅ Khởi tạo key kích hoạt thành công!\n\n**Mã Key Kích Hoạt:**\n\`\`\`\n${keyStr}\n\`\`\``)
                    .setThumbnail(userAvatar)
                    .setFooter(getFooterOptions());
                await interaction.editReply({ embeds: [replyEmbed] });
            }
        }
        else if (commandName === 'gettoken') {
            const isAdmin = await Admin.exists({ user_id: userId });
            if (!isAdmin && userId !== OWNER_ID) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ TỪ CHỐI TRUY CẬP').setDescription('Bạn không đủ thẩm quyền để khởi tạo Token Reset HWID!').setThumbnail(userAvatar).setFooter(getFooterOptions())] });
            }
            const targetUser = interaction.options.getUser('user');
            const tokenStr = `token_${Math.floor(100000 + Math.random() * 900000)}`;

            await new ResetToken({ token: tokenStr, user_id: targetUser ? targetUser.id : null }).save();

            if (userId !== OWNER_ID) {
                const ownerEmbed = new EmbedBuilder()
                    .setColor(COLORS.INFO)
                    .setTitle('📢 BOT LOG: ADMIN TẠO TOKEN RESET HWID')
                    .addFields(
                        { name: '👤 Admin Thực Hiện', value: `<@${userId}> \`(${interaction.user.tag})\``, inline: true },
                        { name: '📥 Người Nhận', value: targetUser ? `<@${targetUser.id}> \`(${targetUser.tag})\`` : '`Không chọn`', inline: true },
                        { name: '🔑 Mã Token Reset (Click Để Copy)', value: `\`\`\`\n${tokenStr}\n\`\`\``, inline: false }
                    )
                    .setThumbnail(userAvatar)
                    .setFooter(getFooterOptions());
                notifyOwner(client, ownerEmbed); // Gửi ẩn không await
            }

            if (targetUser) {
                try {
                    const dmEmbed = new EmbedBuilder()
                        .setColor(COLORS.INFO)
                        .setTitle('🔑 BẠN ĐÃ NHẬN TOKEN RESET HWID')
                        .setDescription(`Dưới đây là token dùng để reset phần cứng HWID cho tool của bạn:\n\n\`\`\`\n${tokenStr}\n\`\`\`\n• Sử dụng kèm trong lệnh \`/resethwid\` để bỏ qua thời gian chờ!`)
                        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                        .setFooter(getFooterOptions());
                    await targetUser.send({ embeds: [dmEmbed] });
                    
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.INFO).setTitle('✅ TẠO TOKEN THÀNH CÔNG').setDescription(`Đã gửi token reset HWID tới **${targetUser.tag}** qua DM.\n\n\`\`\`\n${tokenStr}\n\`\`\``).setThumbnail(userAvatar).setFooter(getFooterOptions())] });
                } catch (e) {
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.WARNING).setTitle('⚠ TẠO TOKEN THÀNH CÔNG').setDescription(`Không thể gửi DM cho người dùng này.\n\n\`\`\`\n${tokenStr}\n\`\`\``).setThumbnail(userAvatar).setFooter(getFooterOptions())] });
                }
            } else {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.INFO).setTitle('🔑 TOKEN RESET HWID MỚI').setDescription(`Dưới đây là mã token reset HWID được khởi tạo:\n\n\`\`\`\n${tokenStr}\n\`\`\``).setThumbnail(userAvatar).setFooter(getFooterOptions())] });
            }
        }
        else if (commandName === 'removekey') {
            if (userId !== OWNER_ID) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ TỪ CHỐI TRUY CẬP').setDescription('Chỉ có Owner mới có quyền xóa key khỏi cơ sở dữ liệu!').setThumbnail(userAvatar).setFooter(getFooterOptions())] });
            }
            const toolKey = interaction.options.getString('toolkey');
            const row = await Key.findOneAndDelete({ assigned_key: toolKey });
            
            if (!row) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ LỖI HỆ THỐNG').setDescription(`Không tìm thấy dữ liệu Tool Key:\n\n\`\`\`\n${toolKey}\n\`\`\``).setThumbnail(userAvatar).setFooter(getFooterOptions())] });
            }
            await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.SUCCESS).setTitle('🗑️ ĐÃ XÓA KEY THÀNH CÔNG').setDescription(`✅ Đã xóa hoàn toàn dữ liệu của Tool Key:\n\n\`\`\`\n${toolKey}\n\`\`\``).setThumbnail(userAvatar).setFooter(getFooterOptions())] });
        }
        else if (commandName === 'redeem') {
            const inputKey = interaction.options.getString('key');
            const row = await Key.findOne({ key: inputKey });
            
            if (!row) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ KÍCH HOẠT THẤT BẠI').setDescription('Mã key này không tồn tại trong hệ thống!').setThumbnail(userAvatar).setFooter(getFooterOptions())] });
            if (row.is_used === 1 || row.assigned_key) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.WARNING).setTitle('⚠️ KÍCH HOẠT THẤT BẠI').setDescription('Mã key này đã được người khác sử dụng trước đó!').setThumbnail(userAvatar).setFooter(getFooterOptions())] });

            const assignedKey = `pain_key_${Math.floor(100000 + Math.random() * 900000)}`;
            
            let newExpiresAt = 0;
            if (row.duration_days > 0) {
                newExpiresAt = Date.now() + (row.duration_days * 24 * 60 * 60 * 1000);
            }

            row.assigned_key = assignedKey;
            row.user_id = userId;
            row.is_used = 1;
            row.expires_at = newExpiresAt;
            row.notified_7d = false;
            row.notified_24h = false;
            row.notified_4h = false;
            await row.save();

            const ownerEmbed = new EmbedBuilder()
                .setColor(COLORS.SUCCESS)
                .setTitle('🔔 BOT LOG: BẰNG CHỨNG KÍCH HOẠT KEY')
                .addFields(
                    { name: '👤 Thành Viên Kích Hoạt', value: `<@${userId}> \`(${interaction.user.tag})\``, inline: true },
                    { name: '⏱ Thời Hạn Gói', value: row.duration_days === 0 ? '`Vĩnh viễn`' : `\`${row.duration_days} Ngày\``, inline: true },
                    { name: '🎟️ Key Gốc Kích Hoạt', value: `\`\`\`\n${inputKey}\n\`\`\``, inline: false },
                    { name: '🔑 Tool Key Cấp Mới', value: `\`\`\`\n${assignedKey}\n\`\`\``, inline: false }
                )
                .setThumbnail(userAvatar)
                .setFooter(getFooterOptions());
            notifyOwner(client, ownerEmbed); // Gửi ẩn không await

            await interaction.editReply({ 
                embeds: [
                    new EmbedBuilder()
                        .setColor(COLORS.SUCCESS)
                        .setTitle('🎉 KÍCH HOẠT BẢN QUYỀN THÀNH CÔNG')
                        .setDescription(`Bạn đã kích hoạt thành công gói bản quyền!\n\n👉 Vui lòng sử dụng lệnh \`/getkey\` để xem và lấy Tool Key dùng cho Tool.`)
                        .setThumbnail(userAvatar)
                        .setFooter(getFooterOptions())
                ] 
            });
        }
        else if (commandName === 'resethwid') {
            const inputKey = interaction.options.getString('key');
            const tokenInput = interaction.options.getString('token');
            const row = await Key.findOne({ assigned_key: inputKey, user_id: userId });
            
            if (!row) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ KHÔNG THỂ RESET').setDescription('Key này không tồn tại hoặc không thuộc quyền sở hữu của bạn!').setThumbnail(userAvatar).setFooter(getFooterOptions())] });

            const now = Date.now();
            if (row.expires_at !== 0 && now > row.expires_at) {
                await Key.deleteOne({ _id: row._id });
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ KHÔNG THỂ RESET').setDescription('Key của bạn đã hết hạn và hệ thống đã xóa dữ liệu.').setThumbnail(userAvatar).setFooter(getFooterOptions())] });
            }

            const cooldown = 24 * 60 * 60 * 1000;

            if (tokenInput) {
                const validToken = await ResetToken.findOneAndDelete({ token: tokenInput });
                if (!validToken) {
                    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ XÁC THỰC THẤT BẠI').setDescription('Token reset HWID nhập vào không hợp lệ hoặc đã được dùng!').setThumbnail(userAvatar).setFooter(getFooterOptions())] });
                }
            } else if (now - row.last_reset < cooldown) {
                const hoursLeft = Math.ceil((cooldown - (now - row.last_reset)) / 3600000);
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.WARNING).setTitle('⏳ ĐANG TRONG THỜI GIAN COOLDOWN').setDescription(`Bạn phải đợi thêm **${hoursLeft} giờ** nữa mới được phép Reset HWID tiếp theo.\n\n• Hoặc bạn có thể liên hệ Admin xin **Token** để reset ngay lập tức.`).setThumbnail(userAvatar).setFooter(getFooterOptions())] });
            }

            row.hwid = null;
            if (!tokenInput) {
                row.last_reset = now;
            }
            await row.save();

            await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.INFO).setTitle('🔄 RESET HWID THÀNH CÔNG').setDescription(`✅ Đã hủy liên kết thiết bị cũ cho Key thành công!\n\n**Mã Key Tool:**\n\`\`\`\n${inputKey}\n\`\`\`\n👉 Giờ đây bạn có thể mở Tool trên máy mới để liên kết HWID tự động.`).setThumbnail(userAvatar).setFooter(getFooterOptions())] });
        }
        else if (commandName === 'getkey') {
            const now = Date.now();

            const userKeys = await Key.find({ 
                user_id: userId, 
                assigned_key: { $ne: null },
                $or: [
                    { expires_at: 0 },
                    { expires_at: { $gt: now } }
                ]
            });

            if (!userKeys.length) {
                const noKeyEmbed = new EmbedBuilder()
                    .setColor(COLORS.ERROR)
                    .setTitle('⚠️ KHÔNG TÌM THẤY BẢN QUYỀN')
                    .setDescription('❌ Bạn hiện chưa sở hữu hoặc kích hoạt bất kỳ key bản quyền nào.')
                    .setThumbnail(userAvatar)
                    .setFooter(getFooterOptions());
                return interaction.editReply({ embeds: [noKeyEmbed] });
            }

            const publicEmbed = new EmbedBuilder()
                .setColor(COLORS.GOLD)
                .setTitle('🔑 DANH SÁCH BẢN QUYỀN CỦA BẠN')
                .setDescription('Vui lòng mở menu bên dưới để chọn Key bạn cần xem chi tiết:')
                .setThumbnail(userAvatar)
                .setFooter(getFooterOptions());

            const customSelectId = `select_getkey_${userId}`;

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(customSelectId)
                .setPlaceholder('▼ Chọn Key bạn muốn xem chi tiết...')
                .addOptions(
                    userKeys.slice(0, 25).map((k, idx) => ({
                        label: `Key #${idx + 1}`,
                        description: k.hwid ? '🔒 Đã liên kết thiết bị' : '🔓 N/A - Chưa liên kết thiết bị',
                        value: k.assigned_key
                    }))
                );

            const rowComponent = new ActionRowBuilder().addComponents(selectMenu);

            const responseMessage = await interaction.editReply({ 
                embeds: [publicEmbed], 
                components: [rowComponent] 
            });

            const collector = responseMessage.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                time: 5 * 60 * 1000
            });

            collector.on('collect', async i => {
                if (i.user.id !== userId) {
                    return i.reply({
                        content: '❌ Bạn không thể tương tác trên menu của người khác!',
                        ephemeral: true
                    });
                }

                const selectedKeyStr = i.values[0];
                const row = await Key.findOne({ assigned_key: selectedKeyStr });
                const currentNow = Date.now();
                
                if (!row || row.user_id !== userId || (row.expires_at !== 0 && currentNow > row.expires_at)) {
                    if (row && row.expires_at !== 0 && currentNow > row.expires_at) {
                        await Key.deleteOne({ _id: row._id });
                    }
                    return i.reply({ 
                        content: '❌ Key này đã hết hạn sử dụng hoặc không tồn tại!', 
                        ephemeral: true 
                    });
                }

                const cooldown = 24 * 60 * 60 * 1000;

                let expireText = r => r.expires_at === 0 ? '`Vĩnh viễn`' : (r.expires_at > currentNow ? `<t:${Math.floor(r.expires_at / 1000)}:R>` : '`Đã hết hạn`');
                let resetStatusText = '🟢 Sẵn sàng Reset HWID';

                if (row.last_reset && (currentNow - row.last_reset < cooldown)) {
                    const diffMs = cooldown - (currentNow - row.last_reset);
                    const hoursLeft = Math.floor(diffMs / (1000 * 60 * 60));
                    const minsLeft = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                    resetStatusText = `🔴 Chờ **${hoursLeft}h${minsLeft}m** để Reset tiếp`;
                }

                const detailEmbed = new EmbedBuilder()
                    .setColor(COLORS.GOLD)
                    .setTitle('🔑 THÔNG TIN BẢN QUYỀN CHI TIẾT')
                    .setThumbnail(i.user.displayAvatarURL({ dynamic: true }))
                    .addFields(
                        { name: '⌛ Hạn Sử Dụng', value: expireText(row), inline: true },
                        { name: '🖥️ Trạng Thái HWID', value: row.hwid ? '🔒 `Đã có HWID`' : '🔓 `N/A`', inline: true },
                        { name: '🔄 Trạng Thái Reset', value: resetStatusText, inline: true },
                        { name: '🔑 Mã Tool Key (Click Mã Bên Dưới Để Copy)', value: `\`\`\`\n${row.assigned_key}\n\`\`\``, inline: false }
                    )
                    .setFooter(getFooterOptions());

                await i.reply({ embeds: [detailEmbed], ephemeral: true });
            });

            collector.on('end', async () => {
                try {
                    const disabledMenu = StringSelectMenuBuilder.from(selectMenu)
                        .setDisabled(true)
                        .setPlaceholder('❌ Menu này đã hết hạn hiệu lực');
                    
                    const disabledRow = new ActionRowBuilder().addComponents(disabledMenu);

                    await interaction.editReply({
                        components: [disabledRow]
                    });
                } catch (e) {}
            });
        }
    } catch (error) {
        console.error('❌ Lỗi xử lý lệnh:', error);
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ LỖI HỆ THỐNG').setDescription('Đã xảy ra lỗi không mong muốn trong quá trình xử lý!').setThumbnail(userAvatar).setFooter(getFooterOptions())] }).catch(() => {});
    }
});

console.log('🤖 Đang tiến hành kiểm tra Token và đăng nhập bot Discord...');

const loginTimeout = setTimeout(() => {
    console.error('❌ [CRITICAL] Kết nối Discord Gateway bị chặn/treo!');
}, 12000);

// Kiểm tra Token trực tiếp qua Rest API trước khi mở WebSocket
rest.get(Routes.user())
    .then(user => {
        console.log(`🔑 Token hợp lệ! Đã xác thực tài khoản Bot: ${user.username}#${user.discriminator}`);
        return client.login(TOKEN);
    })
    .then(() => clearTimeout(loginTimeout))
    .catch(err => {
        clearTimeout(loginTimeout);
        console.error('❌ LỖI XÁC THỰC HOẶC ĐĂNG NHẬP DISCORD:', err.message || err);
    });