const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    EmbedBuilder,
    AttachmentBuilder,
    ActionRowBuilder, 
    StringSelectMenuBuilder,
    ComponentType,
} = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// BOT_ROLE: 'main' = bot chính (API, lệnh thành viên, tác vụ nền). 'admin' = bot admin (lệnh quản trị).
// Mỗi service trên bot-hosting chạy một vai trò, cùng một file này.
const BOT_ROLE = (process.env.BOT_ROLE || 'main').trim().toLowerCase();
if (BOT_ROLE !== 'main' && BOT_ROLE !== 'admin') {
    console.error(`[FATAL] BOT_ROLE phải là 'main' hoặc 'admin' (hiện là '${BOT_ROLE}').`);
    process.exit(1);
}
const IS_MAIN = BOT_ROLE === 'main';
const IS_ADMIN = BOT_ROLE === 'admin';

const TOKEN = process.env.DISCORD_TOKEN;
if (IS_MAIN && (!TOKEN || typeof TOKEN !== 'string' || TOKEN.trim() === '')) {
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

// Log trạng thái load key lúc khởi động (che bớt key, không in ra toàn bộ)
const maskKey = (k) => {
    if (!k || !k.trim()) return null;
    const v = k.trim();
    return v.length <= 8 ? '****' : `${v.slice(0, 4)}...${v.slice(-4)}`;
};
(() => {
    const loaded = [];
    const missing = [];
    for (let i = 0; i < 5; i++) {
        const masked = maskKey(COHERE_KEYS[i]);
        if (masked) loaded.push(`#${i}: ${masked}`);
        else missing.push(`#${i}`);
    }
    if (loaded.length) {
        console.log(`✅ [COHERE] Đã load ${loaded.length}/5 key: ${loaded.join(', ')}`);
    } else {
        console.warn('⚠️ [COHERE] Không có key nào được load — kiểm tra lại biến môi trường COHERE_API_KEY_0..4.');
    }
    if (missing.length) {
        console.log(`ℹ️ [COHERE] Chưa đặt: ${missing.join(', ')}`);
    }
})();

const CLIENT_ID = process.env.CLIENT_ID;
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const OWNER_ID = '1208450889246048306';

const FOOTER_ICON_URL = 'https://i.postimg.cc/gJbhCmHL/Pain-Gamer.png';
const SECRET_KEY = process.env.SECRET_KEY || "PainGamerSecretKey2156#VipTool";
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
if (!process.env.SECRET_KEY) console.warn('⚠️ [SECURITY] Chưa cấu hình SECRET_KEY trong Environment; hãy đặt một chuỗi bí mật ngẫu nhiên dài.');

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

async function notifyOwner(client, embed, files = []) {
    try {
        const owner = await client.users.fetch(OWNER_ID);
        if (!owner) return false;
        await owner.send({ embeds: [embed], files });
        console.log('✅ Đã gửi thông báo và dữ liệu tạo mới qua DM cho Owner.');
        return true;
    } catch (e) {
        console.error('❌ Lỗi khi gửi DM cho Owner:', e.message);
        return false;
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
    notified_4h: { type: Boolean, default: false },
    blacklisted_until: { type: Number, default: 0 },
    created_by: { type: String, default: null },
    created_at: { type: Number, default: Date.now }
});
keySchema.index({ key: 1 }, { unique: true });
keySchema.index({ assigned_key: 1 }, { unique: true, partialFilterExpression: { assigned_key: { $type: 'string' } } });
const Key = mongoose.model('Key', keySchema);

function generateToolKey() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const parts = Array.from({ length: 3 }, () =>
        Array.from({ length: 4 }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('')
    );
    return `PAIN-${parts.join('-')}`;
}

const tokenSchema = new mongoose.Schema({
    token: { type: String, required: true, unique: true },
    user_id: { type: String, default: null },
    created_by: { type: String, default: null },
    is_used: { type: Boolean, default: false },
    used_at: { type: Number, default: null },
    used_by: { type: String, default: null },
    created_at: { type: Number, default: Date.now }
});
const ResetToken = mongoose.model('ResetToken', tokenSchema);

const auditSchema = new mongoose.Schema({
    action: { type: String, required: true },
    actor_id: { type: String, default: null },
    target_id: { type: String, default: null },
    key_value: { type: String, default: null },
    token_value: { type: String, default: null },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    created_at: { type: Number, default: Date.now }
});
auditSchema.index({ created_at: -1 });
auditSchema.index({ key_value: 1, created_at: -1 });
const AuditLog = mongoose.model('AuditLog', auditSchema);

async function writeAudit(data) {
    try { await AuditLog.create(data); }
    catch (err) { console.error('[AUDIT] Không ghi được lịch sử:', err.message); }
}

const isSystemAdmin = async (userId) => userId === OWNER_ID || !!(await Admin.exists({ user_id: userId }));
const adminOnly = (builder) => builder.setDefaultMemberPermissions(0n);

console.log('🔄 Đang tiến hành kết nối đến MongoDB Atlas...');
mongoose.connect(MONGODB_URI)
    .then(async () => {
        console.log('✅ Đã kết nối MongoDB Atlas thành công!');
        if (IS_MAIN) backupDatabase();
    })
    .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});
app.use(express.json({ limit: '16kb', strict: true }));
const apiRateBuckets = new Map();
app.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let bucket = apiRateBuckets.get(ip);
    if (!bucket || now - bucket.startedAt >= 60_000) { bucket = { startedAt: now, count: 0 }; apiRateBuckets.set(ip, bucket); }
    bucket.count++;
    if (bucket.count > 30) return res.status(429).json({ valid: false, reason: 'rate_limited' });
    next();
});
setInterval(() => { const cutoff = Date.now() - 120_000; for (const [ip, b] of apiRateBuckets) if (b.startedAt < cutoff) apiRateBuckets.delete(ip); }, 60_000).unref();

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
// Báo owner khi một key bị thử trên máy khác. Mỗi key chỉ báo tối đa 1 lần / giờ để tránh spam.
const HWID_ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const lastHwidAlert = new Map();
const maskHwid = (h) => (h && h.length > 10 ? `${h.slice(0, 4)}...${h.slice(-4)}` : (h || 'N/A'));
function alertHwidMismatch(row, newHwid) {
    const now = Date.now();
    const last = lastHwidAlert.get(row.assigned_key) || 0;
    if (now - last < HWID_ALERT_COOLDOWN_MS) return;
    lastHwidAlert.set(row.assigned_key, now);
    const embed = new EmbedBuilder()
        .setColor(COLORS.WARNING)
        .setTitle('⚠️ KEY ĐƯỢC DÙNG TRÊN MÁY KHÁC')
        .addFields(
            { name: 'Key', value: `\`${row.assigned_key}\``, inline: false },
            { name: 'Người sở hữu', value: row.user_id ? `<@${row.user_id}>` : 'Chưa liên kết', inline: true },
            { name: 'HWID đã gắn', value: `\`${maskHwid(row.hwid)}\``, inline: true },
            { name: 'HWID vừa thử', value: `\`${maskHwid(newHwid)}\``, inline: true },
            { name: 'Thời điểm', value: `<t:${Math.floor(now / 1000)}:F>`, inline: false }
        )
        .setFooter(getFooterOptions());
    notifyOwner(client, embed).catch(() => {});
}

app.post(['/', '/api/verify'], async (req, res) => {
    const { key, hwid, legacy_hwid, timestamp, signature } = req.body;
    try {
        if (typeof key !== 'string' || key.length > 64 || typeof hwid !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(hwid) || !Number.isSafeInteger(timestamp) || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
            return res.status(400).json({ valid: false, reason: 'invalid_data' });
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

        const supplied = Buffer.from(signature, 'hex');
        const expected = Buffer.from(expectedSignature, 'hex');
        if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
            return res.json({ valid: false, reason: "invalid_signature" });
        }

        const row = await Key.findOne({ assigned_key: key });
        if (!row) return res.json({ valid: false, reason: "key_not_found" });
        if (row.blacklisted_until && row.blacklisted_until > Date.now()) return res.json({ valid: false, reason: 'blacklisted' });
        if (row.expires_at !== 0 && Date.now() > row.expires_at) return res.json({ valid: false, reason: "expired" });
        
        if (!row.hwid) {
            row.hwid = hwid;
            await row.save();
        } else if (row.hwid !== hwid) {
            // Key đã gắn bằng HWID cũ (UUID file): chuyển sang HWID phần cứng mới một lần.
            const legacy = typeof legacy_hwid === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(legacy_hwid) ? legacy_hwid : null;
            if (legacy && row.hwid === legacy) {
                const oldHwid = row.hwid;
                row.hwid = hwid;
                await row.save();
                await writeAudit({ action: 'HWID_MIGRATED', key_value: row.key, details: { assigned_key: row.assigned_key, from: maskHwid(oldHwid), to: maskHwid(hwid) } });
            } else {
                alertHwidMismatch(row, hwid);
                return res.json({ valid: false, reason: "hwid_mismatch" });
            }
        }

        const premiumFilePath = path.join(__dirname, 'paintoolpremium.py');
        if (!fs.existsSync(premiumFilePath)) {
            return res.json({ valid: false, reason: "source_code_not_found" });
        }

        const rawCode = await fs.promises.readFile(premiumFilePath, 'utf8');

        // Thay các khóa Cohere trong code bằng biến COHERE_API_KEY_0..4 trên server
        let updatedCode = rawCode;
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

const PORT = Number(process.env.SERVER_PORT || process.env.PORT) || 3000;
if (IS_MAIN) app.listen(PORT, '0.0.0.0', () => {
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

// ============ BOT ADMIN (token riêng). Thiếu ADMIN_BOT_TOKEN thì chỉ chạy bot chính. ============
const ADMIN_BOT_TOKEN = IS_ADMIN ? ((process.env.ADMIN_BOT_TOKEN || '').trim() || null) : null;
if (IS_ADMIN && !ADMIN_BOT_TOKEN) {
    console.error('[FATAL] BOT_ROLE=admin nhưng thiếu ADMIN_BOT_TOKEN.');
    process.exit(1);
}
const ADMIN_CLIENT_ID_ENV = process.env.ADMIN_CLIENT_ID || null;
const adminClient = ADMIN_BOT_TOKEN ? new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ]
}) : null;
const adminRest = ADMIN_BOT_TOKEN ? new REST({ version: '10' }).setToken(ADMIN_BOT_TOKEN) : null;

const cooldowns = new Map();
const COOLDOWN_TIME = 5000; 

// Lệnh cho mọi thành viên (đăng ký ở mọi server)
const PUBLIC_COMMAND_NAMES = ['getkey', 'resethwid', 'redeem'];
// Server riêng chỉ có Owner/Admin: chỉ tại đây mới đăng ký lệnh quản trị.
const ADMIN_GUILD_ID = process.env.ADMIN_GUILD_ID || null;

const commands = [
    adminOnly(new SlashCommandBuilder().setName('setadmin').setDescription('Owner: Thêm/xóa Admin hệ thống')
        .addStringOption(opt => opt.setName('action').setDescription('Thao tác').setRequired(true).addChoices({ name: '➕ Thêm Admin', value: 'add' }, { name: '➖ Xóa Admin', value: 'remove' }))
        .addUserOption(opt => opt.setName('user').setDescription('Thành viên target').setRequired(true))),
    adminOnly(new SlashCommandBuilder().setName('createkey').setDescription('Admin: Tạo key bản quyền Premium')
        .addStringOption(opt => opt.setName('duration').setDescription('Thời hạn key').setRequired(true).addChoices({name: '1 Ngày', value: '1'}, {name: '3 Ngày', value: '3'}, {name: '7 Ngày', value: '7'}, {name: '30 Ngày', value: '30'}, {name: 'Vĩnh viễn', value: '0'}))
        .addUserOption(opt => opt.setName('user').setDescription('Gửi key qua DM cho user').setRequired(false))
        .addIntegerOption(opt => opt.setName('quantity').setDescription('Số lượng muốn tạo (mặc định 1, tối đa 50)').setRequired(false).setMinValue(2).setMaxValue(50))),
    adminOnly(new SlashCommandBuilder().setName('gettoken').setDescription('Admin: Tạo token cho phép Reset HWID')
        .addUserOption(opt => opt.setName('user').setDescription('Gửi token qua DM cho user').setRequired(false))
        .addIntegerOption(opt => opt.setName('quantity').setDescription('Số lượng muốn tạo (mặc định 1, tối đa 50)').setRequired(false).setMinValue(2).setMaxValue(50))),
    new SlashCommandBuilder().setName('getkey').setDescription('Xem danh sách & thông tin chi tiết key của bạn'),
    adminOnly(new SlashCommandBuilder().setName('removekey').setDescription('Owner: Xóa key khỏi hệ thống')
        .addStringOption(opt => opt.setName('toolkey').setDescription('Mã Tool Key cần xóa').setRequired(true))),
    new SlashCommandBuilder().setName('resethwid').setDescription('Thực hiện Reset HWID cho Key')
        .addStringOption(opt => opt.setName('key').setDescription('Chọn key cần reset').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('token').setDescription('Token cấp phép (Tùy chọn)').setRequired(false)),
    new SlashCommandBuilder().setName('redeem').setDescription('Kích hoạt Key bản quyền')
        .addStringOption(opt => opt.setName('key').setDescription('Nhập mã key kích hoạt').setRequired(true)),
    adminOnly(new SlashCommandBuilder().setName('keylist').setDescription('Admin: Danh sách key (đã nhập / chưa nhập, thời hạn)')),
    adminOnly(new SlashCommandBuilder().setName('keyinfo').setDescription('Admin: Xem thông tin Key')
        .addStringOption(opt => opt.setName('key').setDescription('Key gốc hoặc Tool Key').setRequired(true))),
    adminOnly(new SlashCommandBuilder().setName('blacklist').setDescription('Admin: Khóa Key theo thời hạn')
        .addStringOption(opt => opt.setName('key').setDescription('Key gốc hoặc Tool Key').setRequired(true))
        .addStringOption(opt => opt.setName('duration').setDescription('Thời gian: 1h, 1d, 1m... hoặc unlock để mở khóa ngay').setRequired(true))),
    adminOnly(new SlashCommandBuilder().setName('backupcheck').setDescription('Admin: Kiểm tra các bản sao lưu')),
    adminOnly(new SlashCommandBuilder().setName('backuprestore').setDescription('Owner: Khôi phục bản sao lưu gần nhất')),
    adminOnly(new SlashCommandBuilder().setName('adminlist').setDescription('Admin: Danh sách Admin')),
    adminOnly(new SlashCommandBuilder().setName('adminstats').setDescription('Admin: Thống kê hệ thống')),
    adminOnly(new SlashCommandBuilder().setName('searchkey').setDescription('Admin: Tìm Key theo mã hoặc Discord UID')
        .addStringOption(opt => opt.setName('query').setDescription('Key gốc, Tool Key hoặc Discord UID').setRequired(true)))
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
                        .setDescription(`Key bản quyền của bạn đã chính thức **hết hạn** và bị hệ thống thu hồi.\n\n${keyVal}\nVui lòng liên hệ Admin để gia hạn hoặc mua key mới!`)
                        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                        .setFooter(getFooterOptions());
                    await user.send({ embeds: [embed] });
                } catch (e) {}
            }
            await writeAudit({ action: 'KEY_EXPIRED_CLEANUP', key_value: row.key, target_id: row.user_id, details: { assigned_key: row.assigned_key } });
            await Key.deleteOne({ _id: row._id });
        }

        // Dọn Token đã dùng quá 90 ngày và lịch sử quá 180 ngày
        await ResetToken.deleteMany({ is_used: true, used_at: { $lt: now - 90 * 24 * 60 * 60 * 1000 } });
        await AuditLog.deleteMany({ created_at: { $lt: now - 180 * 24 * 60 * 60 * 1000 } });

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
                        .setDescription(`Key bản quyền gói **30 Ngày** của bạn sắp hết hạn!\n\n${keyVal}\n• **Thời gian còn lại:** khoảng **${Math.ceil(daysLeft)} ngày**.\n• Hãy chủ động chuẩn bị gia hạn để tránh gián đoạn sử dụng.`)
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
                        .setDescription(`Key bản quyền của bạn sắp hết hạn!\n\n${keyVal}\n• **Thời gian còn lại:** khoảng **24 giờ**!`)
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
                        .setDescription(`Key bản quyền của bạn sắp hết hạn khẩn cấp!\n\n${keyVal}\n• **Thời gian còn lại:** chỉ còn **4 giờ**!`)
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


async function backupDatabase() {
    try {
        if (mongoose.connection.readyState !== 1) return;
        const db = mongoose.connection.db;
        const names = ['admins', 'keys', 'resettokens', 'auditlogs'];
        const snapshot = { created_at: new Date().toISOString(), collections: {} };
        for (const name of names) {
            const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext();
            snapshot.collections[name] = exists ? await db.collection(name).find({}).toArray() : [];
        }
        const dir = BACKUP_DIR;
        await fs.promises.mkdir(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const target = path.join(dir, `pain-db-${stamp}.json.gz`);
        const gz = zlib.gzipSync(Buffer.from(JSON.stringify(snapshot), 'utf8'));
        await fs.promises.writeFile(target, gz, { flag: 'wx', mode: 0o600 });
        const files = (await fs.promises.readdir(dir)).filter(x => /^pain-db-.*\.json\.gz$/.test(x)).sort();
        for (const old of files.slice(0, Math.max(0, files.length - 7))) await fs.promises.unlink(path.join(dir, old));
        console.log(`✅ [BACKUP] Đã sao lưu MongoDB: ${path.basename(target)}`);
    } catch (err) { console.error('❌ [BACKUP] Lỗi sao lưu database:', err.message); }
}

client.once('ready', async () => {
    try {
        const appId = CLIENT_ID || client.user.id;

        // Lệnh thành viên: đăng ký GLOBAL và bật cho cả DM, nên hiện ở mọi server lẫn tin nhắn riêng.
        const publicBody = commands.filter(c => PUBLIC_COMMAND_NAMES.includes(c.name));
        for (const c of publicBody) {
            if (typeof c.setContexts === 'function') c.setContexts([0, 1, 2]); // guild, DM, DM nhóm
            else c.setDMPermission(true);
        }
        await rest.put(Routes.applicationCommands(appId), { body: publicBody });
        if (!ADMIN_GUILD_ID) {
            console.warn('⚠️ [SLASH] Chưa đặt ADMIN_GUILD_ID: lệnh quản trị sẽ không được đăng ký ở server nào.');
        }
        let successGuilds = 0;
        for (const guild of client.guilds.cache.values()) {
            try {
                // Bot chính chỉ đăng ký lệnh thành viên (global). Lệnh admin do bot admin đăng ký: xóa lệnh riêng của guild.
                const body = [];
                const registered = await rest.put(
                    Routes.applicationGuildCommands(appId, guild.id),
                    { body }
                );
                successGuilds++;
                console.log(`[SLASH] Đã đăng ký ${registered.length} lệnh tại ${guild.name} (${guild.id}).`);
            } catch (guildError) {
                console.error(`[SLASH] Không thể đăng ký lệnh tại ${guild.name} (${guild.id}):`, guildError.message);
            }
        }

        console.log(`🌐 Đăng ký Guild Slash Commands hoàn tất: ${successGuilds}/${client.guilds.cache.size} server.`);
        console.log('🔐 Lệnh thành viên hiện ở mọi server và DM. Lệnh quản trị do bot admin phục vụ.');
        console.log(`✅ Bot Discord đã sẵn sàng hoạt động: ${client.user.tag}`);
        checkExpiredKeys();
        setInterval(checkExpiredKeys, 60 * 1000);
        setInterval(backupDatabase, 24 * 60 * 60 * 1000);
    } catch (error) {
        console.error('❌ Lỗi đăng ký Slash Commands:', error);
    }
});

async function handleInteraction(interaction) {
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
                    name: `${k.assigned_key}${k.hwid ? ' - đã có hwid' : ' - chưa có hwid'}`,
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
    const isPublicCommand = ['redeem', 'createkey', 'gettoken'].includes(commandName);
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
        const adminCommands = ['keylist','keyinfo','blacklist','backupcheck','backuprestore','adminlist','adminstats','searchkey'];
        if (adminCommands.includes(commandName) && !(await isSystemAdmin(userId))) {
            return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ TỪ CHỐI TRUY CẬP').setDescription('Chỉ Owner hoặc Admin hệ thống mới được sử dụng lệnh này.').setFooter(getFooterOptions())] });
        }
        if (commandName === 'adminlist') {
            const rows = await Admin.find({}, {user_id:1,_id:0}).lean();
            return interaction.editReply({ content: `**Owner:** <@${OWNER_ID}>\n**Admin (${rows.length}):**\n${rows.length ? rows.map((a,i)=>`${i+1}. <@${a.user_id}>`).join('\n') : 'Chưa có Admin.'}` });
        }
        if (commandName === 'adminstats') {
            const [admins, logs] = await Promise.all([Admin.countDocuments(),AuditLog.countDocuments()]);
            return interaction.editReply({ embeds:[new EmbedBuilder().setColor(COLORS.INFO).setTitle('📊 THỐNG KÊ QUẢN TRỊ').addFields({name:'Admin',value:String(admins),inline:true},{name:'Audit Log',value:String(logs),inline:true}).setFooter(getFooterOptions())] });
        }
        if (commandName === 'searchkey') {
            const q = interaction.options.getString('query').trim();
            const rows = await Key.find({$or:[{key:q},{assigned_key:q},{user_id:q}]}).limit(10).lean();
            if (!rows.length) return interaction.editReply({content:'Không tìm thấy Key phù hợp.'});
            const lines = rows.map((r,i)=>`${i+1}. ${r.assigned_key || r.key} | User: ${r.user_id || 'Chưa gán'} | ${r.is_used ? 'Đã kích hoạt' : 'Chưa kích hoạt'}`);
            return interaction.editReply({content:lines.join('\n')});
        }
        if (commandName === 'backupcheck') {
            const names = (await fs.promises.readdir(BACKUP_DIR).catch(()=>[])).filter(n=>/^pain-db-.*\.json\.gz$/.test(n)).sort().reverse();
            const checks=[];
            for (const name of names.slice(0,10)) { try { const buf=await fs.promises.readFile(path.join(BACKUP_DIR,name)); const data=JSON.parse(zlib.gunzipSync(buf).toString('utf8')); checks.push(`✅ ${name} — ${Object.keys(data.collections||{}).length} collections`); } catch { checks.push(`❌ ${name} — lỗi/không đọc được`); } }
            return interaction.editReply({content:`**Backup tìm thấy:** ${names.length}\n${checks.join('\n') || 'Chưa có bản Backup.'}`});
        }
        if (commandName === 'backuprestore') {
            if (userId !== OWNER_ID) return interaction.editReply({content:'Chỉ Owner mới được khôi phục Backup.'});
            const names=(await fs.promises.readdir(BACKUP_DIR)).filter(n=>/^pain-db-.*\.json\.gz$/.test(n)).sort().reverse();
            if (!names.length) return interaction.editReply({content:'Không tìm thấy bản Backup để khôi phục.'});
            const data=JSON.parse(zlib.gunzipSync(await fs.promises.readFile(path.join(BACKUP_DIR,names[0]))).toString('utf8'));
            const db=mongoose.connection.db;
            for (const [name, docs] of Object.entries(data.collections||{})) { if (!['admins','keys','resettokens','auditlogs'].includes(name) || !Array.isArray(docs)) continue; await db.collection(name).deleteMany({}); if (docs.length) await db.collection(name).insertMany(docs); }
            return interaction.editReply({content:`Đã khôi phục dữ liệu từ Backup mới nhất: **${names[0]}**.`});
        }
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
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ TỪ CHỐI TRUY CẬP').setDescription('Bạn không đủ thẩm quyền để tạo key bản quyền!').setFooter(getFooterOptions())] });
            }

            const duration = parseInt(interaction.options.getString('duration'), 10);
            const targetUser = interaction.options.getUser('user');
            const quantity = interaction.options.getInteger('quantity') ?? 1;
            if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50 || (quantity !== 1 && quantity < 2)) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ SỐ LƯỢNG KHÔNG HỢP LỆ').setDescription('Số lượng mặc định là **1**, hoặc nhập từ **2 đến 50**.').setFooter(getFooterOptions())] });
            }

            const generatedKeys = [];
            for (let i = 0; i < quantity; i++) {
                let keyStr;
                let exists = true;
                while (exists) {
                    keyStr = crypto.randomInt(100000000000, 1000000000000).toString();
                    exists = await Key.exists({ key: keyStr });
                }
                await new Key({ key: keyStr, expires_at: 0, duration_days: duration, is_used: 0, created_by: userId }).save();
                await writeAudit({ action: 'KEY_CREATED', actor_id: userId, key_value: keyStr, details: { duration_days: duration } });
                generatedKeys.push(keyStr);
            }

            if (userId !== OWNER_ID) {
                const ownerEmbed = new EmbedBuilder()
                    .setColor(COLORS.GOLD)
                    .setTitle('📢 BOT LOG: ADMIN TẠO KEY MỚI')
                    .addFields(
                        { name: '👤 Admin Thực Hiện', value: `<@${userId}> (${interaction.user.tag})`, inline: true },
                        { name: '⏱️ Thời Hạn Gói', value: duration === 0 ? 'Vĩnh viễn' : `${duration} Ngày`, inline: true },
                        { name: '🔢 Số lượng', value: `${quantity}`, inline: true },
                        { name: '📥 Người Nhận', value: targetUser ? `<@${targetUser.id}> (${targetUser.tag})` : 'Không chọn', inline: true },
                        { name: '📄 File Key', value: '**PAIN KEY.text** (đính kèm bên dưới)', inline: false }
                    ).setThumbnail(interaction.user.displayAvatarURL({ dynamic: true })).setFooter(getFooterOptions());
                const ownerKeyFile = new AttachmentBuilder(
                    Buffer.from(generatedKeys.join('\n'), 'utf8'),
                    { name: 'PAIN KEY.text' }
                );
                await notifyOwner(client, ownerEmbed, [ownerKeyFile]);
            }

            if (quantity >= 5) {
                try {
                    const file = new AttachmentBuilder(Buffer.from(generatedKeys.join('\n'), 'utf8'), { name: 'PAIN KEY.text' });
                    await interaction.user.send({ content: `✅ Đã tạo **${quantity} Key** thành công. Thời hạn: **${duration === 0 ? 'Vĩnh viễn' : `${duration} ngày`}**.`, files: [file] });
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.GOLD).setTitle('🎟️ TẠO KEY HÀNG LOẠT THÀNH CÔNG').setDescription(`✅ Đã tạo **${quantity} Key**. File **PAIN KEY.text** đã được gửi qua DM cho bạn.${targetUser ? `\nNgười nhận được chọn: <@${targetUser.id}>.` : ''}`).setFooter(getFooterOptions())] });
                } catch (e) {
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.WARNING).setTitle('⚠️ ĐÃ TẠO KEY NHƯNG KHÔNG GỬI ĐƯỢC DM').setDescription(`Đã lưu **${quantity} Key** vào hệ thống nhưng không thể gửi file qua DM. Hãy bật nhận tin nhắn từ server rồi thử lại hoặc liên hệ Owner.`).setFooter(getFooterOptions())] });
                }
                return;
            }

            const keyFields = generatedKeys.map((key, i) => ({
                name: `🔑 Key ${i + 1}`,
                value: `${key}`,
                inline: false
            }));
            const keyNote = targetUser ? `\n• **Dành cho:** <@${targetUser.id}>` : '';
            await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.GOLD).setTitle('🎟️ KHỞI TẠO KEY THÀNH CÔNG')
                .setDescription(`✅ Đã tạo **${quantity} Key** kích hoạt.\n\n• **Thời hạn:** ${duration === 0 ? 'Vĩnh viễn' : `${duration} ngày`}${keyNote}`)
                .addFields(keyFields).setFooter(getFooterOptions())] });
        }
        else if (commandName === 'gettoken') {
            const isAdmin = await Admin.exists({ user_id: userId });
            if (!isAdmin && userId !== OWNER_ID) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ TỪ CHỐI TRUY CẬP').setDescription('Bạn không đủ thẩm quyền để khởi tạo Token Reset HWID!').setFooter(getFooterOptions())] });
            }
            const targetUser = interaction.options.getUser('user');
            const quantity = interaction.options.getInteger('quantity') ?? 1;
            if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50 || (quantity !== 1 && quantity < 2)) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ SỐ LƯỢNG KHÔNG HỢP LỆ').setDescription('Số lượng mặc định là **1**, hoặc nhập từ **2 đến 50**.').setFooter(getFooterOptions())] });
            }

            const generatedTokens = [];
            for (let i = 0; i < quantity; i++) {
                let tokenStr;
                let exists = true;
                while (exists) {
                    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                    const randomPart = Array.from({ length: 18 }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('');
                    tokenStr = randomPart;
                    exists = await ResetToken.exists({ token: tokenStr });
                }
                await new ResetToken({ token: tokenStr, user_id: targetUser ? targetUser.id : null, created_by: userId }).save();
                await writeAudit({ action: 'TOKEN_CREATED', actor_id: userId, target_id: targetUser ? targetUser.id : null, token_value: tokenStr });
                generatedTokens.push(tokenStr);
            }

            if (userId !== OWNER_ID) {
                const ownerEmbed = new EmbedBuilder().setColor(COLORS.INFO).setTitle('📢 BOT LOG: ADMIN TẠO TOKEN RESET HWID')
                    .addFields(
                        { name: '👤 Admin Thực Hiện', value: `<@${userId}> (${interaction.user.tag})`, inline: true },
                        { name: '📥 Người Nhận', value: targetUser ? `<@${targetUser.id}> (${targetUser.tag})` : 'Không chọn', inline: true },
                        { name: '🔢 Số lượng Token', value: `**${quantity} Token**`, inline: true },
                        { name: '📄 File Token', value: '**PAIN TOKEN.text** (đính kèm bên dưới)', inline: false }
                    )
                    .setFooter(getFooterOptions());
                const ownerTokenFile = new AttachmentBuilder(Buffer.from(generatedTokens.join('\n'), 'utf8'), { name: 'PAIN TOKEN.text' });
                await notifyOwner(client, ownerEmbed, [ownerTokenFile]);
            }

            if (quantity >= 5) {
                try {
                    const file = new AttachmentBuilder(Buffer.from(generatedTokens.join('\n'), 'utf8'), { name: 'PAIN TOKEN.text' });
                    await interaction.user.send({ content: `✅ Đã tạo **${quantity} Token Reset HWID** thành công.`, files: [file] });
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.INFO).setTitle('🔑 TẠO TOKEN HÀNG LOẠT THÀNH CÔNG').setDescription(`✅ Đã tạo **${quantity} Token**. File **PAIN TOKEN.text** đã được gửi qua DM cho bạn.${targetUser ? `\nToken đã liên kết với người nhận: <@${targetUser.id}>.` : ''}`).setFooter(getFooterOptions())] });
                } catch (e) {
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.WARNING).setTitle('⚠️ ĐÃ TẠO TOKEN NHƯNG KHÔNG GỬI ĐƯỢC DM').setDescription(`Đã lưu **${quantity} Token** vào hệ thống nhưng không thể gửi file qua DM. Hãy bật nhận tin nhắn từ server rồi thử lại hoặc liên hệ Owner.`).setFooter(getFooterOptions())] });
                }
                return;
            }

            const tokenFields = generatedTokens.map((token, i) => ({
                name: `🔐 Token ${i + 1}`,
                value: `${token}`,
                inline: false
            }));
            const tokenNote = targetUser ? `\n\n• **Dành cho:** <@${targetUser.id}>` : '';
            await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.INFO).setTitle('🔑 TOKEN RESET HWID MỚI')
                .setDescription(`Đã tạo **${quantity} Token**:${tokenNote}`)
                .addFields(tokenFields).setFooter(getFooterOptions())] });
        }
        else if (['keylist', 'keyinfo', 'blacklist'].includes(commandName)) {
            if (!(await isSystemAdmin(userId))) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ TỪ CHỐI TRUY CẬP').setDescription('Chỉ Admin hệ thống mới được sử dụng lệnh này.').setFooter(getFooterOptions())] });
            }
            if (commandName === 'keyinfo') {
                const value = interaction.options.getString('key').trim();
                const row = await Key.findOne({ $or: [{ key: value }, { assigned_key: value }] });
                if (!row) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('KHÔNG TÌM THẤY KEY').setDescription('Key không tồn tại trong hệ thống.').setFooter(getFooterOptions())] });
                const now = Date.now();
                const blacklistActive = row.blacklisted_until > now;
                const embed = new EmbedBuilder().setColor(blacklistActive ? COLORS.ERROR : COLORS.INFO).setTitle('🔑 THÔNG TIN KEY')
                    .addFields(
                        { name: 'Key kích hoạt', value: `${row.key}`, inline: false },
                        { name: 'Tool Key', value: row.assigned_key ? `${row.assigned_key}` : 'Chưa kích hoạt', inline: false },
                        { name: 'Trạng thái', value: row.is_used ? 'Đã kích hoạt' : 'Chưa kích hoạt', inline: true },
                        { name: 'Người tạo', value: row.created_by ? `<@${row.created_by}>` : 'Không rõ / Key cũ', inline: true },
                        { name: 'Người sở hữu', value: row.user_id ? `<@${row.user_id}>` : 'Chưa có', inline: true },
                        { name: 'Ngày tạo', value: `<t:${Math.floor(row.created_at / 1000)}:F>`, inline: true },
                        { name: 'HWID', value: row.hwid || 'Chưa gắn HWID', inline: true },
                        { name: 'Thời hạn', value: row.duration_days === 0 ? 'Vĩnh viễn' : `${row.duration_days} ngày`, inline: true },
                        { name: 'Hết hạn', value: row.expires_at === 0 ? 'Vĩnh viễn / chưa kích hoạt' : `<t:${Math.floor(row.expires_at / 1000)}:F>`, inline: true },
                        { name: 'Blacklist', value: blacklistActive ? `Đang khóa đến <t:${Math.floor(row.blacklisted_until / 1000)}:F>` : 'Không bị khóa', inline: true }
                    ).setFooter(getFooterOptions());
                return interaction.editReply({ embeds: [embed] });
            }
            if (commandName === 'keylist') {
                const now = Date.now();
                const [total, redeemed, expired, locked] = await Promise.all([
                    Key.countDocuments({}),
                    Key.countDocuments({ user_id: { $ne: null } }),
                    Key.countDocuments({ user_id: { $ne: null }, expires_at: { $gt: 0, $lt: now } }),
                    Key.countDocuments({ blacklisted_until: { $gt: now } }),
                ]);
                if (!total) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.WARNING).setTitle('CHƯA CÓ KEY').setDescription('Hệ thống chưa có key nào.').setFooter(getFooterOptions())] });

                const LIMIT = 40;
                const rows = await Key.find({}).sort({ created_at: -1 }).limit(LIMIT).lean();
                const lines = rows.map((r, i) => {
                    const keyVal = r.assigned_key || r.key || 'N/A';
                    const who = r.user_id ? `<@${r.user_id}>` : '`Chưa nhập`';
                    let when;
                    if (!r.user_id) when = r.duration_days ? `${r.duration_days} ngày (chưa kích hoạt)` : '`Vĩnh viễn` (chưa kích hoạt)';
                    else if (r.expires_at === 0) when = '`Vĩnh viễn`';
                    else if (r.expires_at > now) when = `<t:${Math.floor(r.expires_at / 1000)}:R>`;
                    else when = '`Đã hết hạn`';
                    const lock = Number(r.blacklisted_until || 0) > now ? ' | 🔒 Đang khóa' : '';
                    return `**${i + 1}.** \`${keyVal}\` | ${who} | ${when}${lock}`;
                });
                const summary = `Tổng: **${total}** · Đã nhập: **${redeemed}** · Chưa nhập: **${total - redeemed}** · Hết hạn: **${expired}** · Đang khóa: **${locked}**`;
                const note = total > rows.length ? `\n\n_Hiển thị ${rows.length} key mới nhất trên tổng ${total}._` : '';
                const body = `${summary}\n\n${lines.join('\n')}${note}`;
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.INFO).setTitle('📋 DANH SÁCH KEY').setDescription(body.slice(0, 4000)).setFooter(getFooterOptions())] });
            }
            if (commandName === 'blacklist') {
                const value = interaction.options.getString('key').trim();
                const durationText = interaction.options.getString('duration').trim().toLowerCase();
                const row = await Key.findOne({ $or: [{ key: value }, { assigned_key: value }] });
                if (!row) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('KHÔNG TÌM THẤY KEY').setDescription('Key không tồn tại trong hệ thống.').setFooter(getFooterOptions())] });

                // Từ khóa unlock: xóa trạng thái blacklist ngay lập tức.
                if (durationText === 'unlock') {
                    const wasLocked = Number(row.blacklisted_until || 0) > Date.now();
                    row.blacklisted_until = 0;
                    await row.save();
                    await writeAudit({ action: 'KEY_UNBLACKLISTED', actor_id: userId, key_value: row.key, details: { assigned_key: row.assigned_key, previous_until: wasLocked ? 'active' : 'inactive' } });
                    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.SUCCESS).setTitle('🔓 MỞ KHÓA KEY THÀNH CÔNG').setDescription(`Đã mở khóa Key ngay lập tức.\nKey **${row.assigned_key || row.key}** hiện có thể sử dụng bình thường.`).setFooter(getFooterOptions())] });
                }

                const match = durationText.match(/^(\d+)(h|d|m)$/);
                if (!match) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('THỜI GIAN KHÔNG HỢP LỆ').setDescription('Dùng định dạng `1h`, `1d`, `1m` hoặc `unlock` để mở khóa ngay. Tháng tối đa 12m.').setFooter(getFooterOptions())] });
                const amount = Number(match[1]);
                const unit = match[2];
                if (!Number.isSafeInteger(amount) || amount < 1 || (unit === 'm' && amount > 12) || (unit !== 'm' && amount > (unit === 'h' ? 8760 : 365))) {
                    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('THỜI GIAN VƯỢT GIỚI HẠN').setDescription('Thời gian blacklist không hợp lệ; riêng tháng không được vượt quá **12m**.').setFooter(getFooterOptions())] });
                }
                const ms = amount * (unit === 'h' ? 60 * 60 * 1000 : unit === 'd' ? 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000);
                row.blacklisted_until = Date.now() + ms;
                await row.save();
                await writeAudit({ action: 'KEY_BLACKLISTED', actor_id: userId, key_value: row.key, details: { assigned_key: row.assigned_key, duration: durationText, until: row.blacklisted_until } });
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.SUCCESS).setTitle('⛔ BLACKLIST KEY THÀNH CÔNG').setDescription(`Đã khóa Key trong **${durationText}**.\nHết khóa: <t:${Math.floor(row.blacklisted_until / 1000)}:F>`).setFooter(getFooterOptions())] });
            }
        }
        else if (commandName === 'removekey') {
            if (userId !== OWNER_ID) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ TỪ CHỐI TRUY CẬP').setDescription('Chỉ có Owner mới có quyền xóa key khỏi cơ sở dữ liệu!').setThumbnail(userAvatar).setFooter(getFooterOptions())] });
            }
            const toolKey = interaction.options.getString('toolkey');
            const row = await Key.findOneAndDelete({ assigned_key: toolKey });
            
            if (!row) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ LỖI HỆ THỐNG').setDescription(`Không tìm thấy dữ liệu Tool Key:\n\n${toolKey}`).setThumbnail(userAvatar).setFooter(getFooterOptions())] });
            }
            await writeAudit({ action: 'KEY_REMOVED', actor_id: userId, key_value: row.key, details: { assigned_key: row.assigned_key } });
            await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.SUCCESS).setTitle('🗑️ ĐÃ XÓA KEY THÀNH CÔNG').setDescription(`✅ Đã xóa hoàn toàn dữ liệu của Tool Key:\n\n${toolKey}`).setThumbnail(userAvatar).setFooter(getFooterOptions())] });
        }
        else if (commandName === 'redeem') {
            const inputKey = interaction.options.getString('key');
            const row = await Key.findOne({ key: inputKey });
            
            if (!row) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ KÍCH HOẠT THẤT BẠI').setDescription('Mã key này không tồn tại trong hệ thống!').setThumbnail(userAvatar).setFooter(getFooterOptions())] });
            if (row.blacklisted_until && row.blacklisted_until > Date.now()) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('⛔ KEY ĐANG BỊ KHÓA').setDescription('Key này đang nằm trong danh sách blacklist.').setFooter(getFooterOptions())] });
            if (row.is_used === 1 || row.assigned_key) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.WARNING).setTitle('⚠️ KÍCH HOẠT THẤT BẠI').setDescription('Mã key này đã được người khác sử dụng trước đó!').setThumbnail(userAvatar).setFooter(getFooterOptions())] });

            // Chỉ đổi định dạng Tool Key được cấp sau khi redeem.
            let assignedKey;
            let assignedKeyExists = true;
            while (assignedKeyExists) {
                assignedKey = generateToolKey();
                assignedKeyExists = await Key.exists({ assigned_key: assignedKey });
            }

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
            await writeAudit({ action: 'KEY_REDEEMED', actor_id: userId, key_value: inputKey, details: { assigned_key: assignedKey, duration_days: row.duration_days } });

            const ownerEmbed = new EmbedBuilder()
                .setColor(COLORS.SUCCESS)
                .setTitle('🔔 BOT LOG: BẰNG CHỨNG KÍCH HOẠT KEY')
                .addFields(
                    { name: '👤 Thành Viên Kích Hoạt', value: `<@${userId}> \`(${interaction.user.tag})\``, inline: true },
                    { name: '⏱ Thời Hạn Gói', value: row.duration_days === 0 ? '`Vĩnh viễn`' : `\`${row.duration_days} Ngày\``, inline: true },
                    { name: '🎟️ Key Gốc Kích Hoạt', value: `${inputKey}`, inline: false },
                    { name: '🔑 Tool Key Cấp Mới', value: `${assignedKey}`, inline: false }
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
                const validToken = await ResetToken.findOneAndUpdate(
                    { token: tokenInput, is_used: { $ne: true } },
                    { $set: { is_used: true, used_at: now, used_by: userId } },
                    { new: true }
                );
                if (!validToken) {
                    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.ERROR).setTitle('❌ XÁC THỰC THẤT BẠI').setDescription('Token reset HWID nhập vào không hợp lệ hoặc đã được dùng!').setThumbnail(userAvatar).setFooter(getFooterOptions())] });
                } else {
                    await writeAudit({ action: 'TOKEN_USED', actor_id: userId, token_value: tokenInput, key_value: inputKey });
                }
            } else if (now - row.last_reset < cooldown) {
                const remainingMs = cooldown - (now - row.last_reset);
                const totalMinutes = Math.ceil(remainingMs / 60000);
                const hoursLeft = Math.floor(totalMinutes / 60);
                const minutesLeft = totalMinutes % 60;
                const waitTime = `${hoursLeft} giờ ${minutesLeft} phút`;
                return interaction.editReply({ embeds: [new EmbedBuilder()
                    .setColor(COLORS.ERROR)
                    .setTitle('RESET HWID THẤT BẠI')
                    .setDescription(`Thực hiện Reset HWID thất bại! Bạn cần đợi **${waitTime}** nữa để reset miễn phí, hoặc dùng token để reset.`)
                    .setThumbnail(userAvatar)
                    .setFooter(getFooterOptions())] });
            }

            row.hwid = null;
            if (!tokenInput) {
                row.last_reset = now;
            }
            await row.save();
            await writeAudit({ action: 'HWID_RESET', actor_id: userId, key_value: inputKey, details: { used_token: !!tokenInput } });

            await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.INFO).setTitle('RESET HWID').setDescription('Thực Hiện Reset Thành Công!').setFooter(getFooterOptions())] });
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
                        label: `${k.assigned_key}${k.hwid ? ' - đã có hwid' : ' - chưa có hwid'}`,
                        description: k.hwid ? 'Đã có HWID' : 'Chưa có HWID',
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
                        { name: '🖥️ Trạng Thái HWID', value: row.hwid ? '🔒 Đã có HWID' : 'N/A', inline: true },
                        { name: '🔄 Trạng Thái Reset', value: resetStatusText, inline: true },
                        { name: '🔑 Your key:', value: row.assigned_key, inline: false }
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
}

if (IS_MAIN) client.on('interactionCreate', handleInteraction);
if (IS_ADMIN && adminClient) adminClient.on('interactionCreate', handleInteraction);

if (IS_ADMIN && adminClient) {
    adminClient.once('ready', async () => {
        try {
            const appId = ADMIN_CLIENT_ID_ENV || adminClient.user.id;
            // Bot admin không có lệnh toàn cục; chỉ có lệnh quản trị ở server admin.
            await adminRest.put(Routes.applicationCommands(appId), { body: [] });
            const adminBody = commands.filter(c => !PUBLIC_COMMAND_NAMES.includes(c.name));
            if (!ADMIN_GUILD_ID) {
                console.warn('⚠️ [ADMIN BOT] Chưa đặt ADMIN_GUILD_ID: lệnh quản trị chưa được đăng ký ở đâu.');
            } else {
                const registered = await adminRest.put(Routes.applicationGuildCommands(appId, ADMIN_GUILD_ID), { body: adminBody });
                console.log(`[ADMIN BOT] Đã đăng ký ${registered.length} lệnh quản trị tại server ${ADMIN_GUILD_ID}.`);
            }
            console.log(`✅ Bot admin đã sẵn sàng: ${adminClient.user.tag}`);
        } catch (error) {
            console.error('❌ [ADMIN BOT] Lỗi đăng ký lệnh quản trị:', error.message || error);
        }
    });
    adminRest.get(Routes.user())
        .then(user => {
            console.log(`🔑 Token bot admin hợp lệ: ${user.username}`);
            return adminClient.login(ADMIN_BOT_TOKEN);
        })
        .catch(err => console.error('❌ [ADMIN BOT] Không đăng nhập được:', err.message || err));
}

console.log('🤖 Đang tiến hành kiểm tra Token và đăng nhập bot Discord...');

const loginTimeout = !IS_MAIN ? null : setTimeout(() => {
    console.error('❌ [CRITICAL] Kết nối Discord Gateway bị chặn/treo!');
}, 12000);

// Kiểm tra Token trực tiếp qua Rest API trước khi mở WebSocket
if (IS_MAIN) rest.get(Routes.user())
    .then(user => {
        console.log(`🔑 Token hợp lệ! Đã xác thực tài khoản Bot: ${user.username}#${user.discriminator}`);
        return client.login(TOKEN);
    })
    .then(() => clearTimeout(loginTimeout))
    .catch(err => {
        clearTimeout(loginTimeout);
        console.error('❌ LỖI XÁC THỰC HOẶC ĐĂNG NHẬP DISCORD:', err.message || err);
    });