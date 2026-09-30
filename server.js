require('dotenv').config();
const express   = require('express');
const session   = require('express-session');
const bcrypt    = require('bcrypt');
const axios     = require('axios');
const rateLimit = require('express-rate-limit');
const cors      = require('cors');
const path      = require('path');
const http      = require('http');
const { WebSocketServer } = require('ws');
const mongoose  = require('mongoose');

const app = express();

const OWNER    = '@sahilxalone';
const CHANNEL  = '@OSINTxarmy';
const NEW_BASE = 'http://100.31.203.71:3000';
const MASTER_KEYS = {
    mistral  : 'FVKec5Xqa2ORzSoBrqi21nRbIM6rFk2q',
    ayaanmods: 'ayaan-key'
};

// ─── MONGODB CONNECTION ───────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI ||
    'mongodb+srv://vf5cfx_db_user:edDgF8u5V9AChTlI@cluster0.ltogsg4.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => { console.error('❌ MongoDB connection error:', err); process.exit(1); });

// ─── SCHEMAS ──────────────────────────────────────────────────────────────────

const userSchema = new mongoose.Schema({
    username   : { type: String, unique: true, required: true },
    password   : { type: String, required: true },
    role       : { type: String, default: 'admin' },
    created_by : { type: String, default: 'system' },
    created_at : { type: Date, default: Date.now }
});

const apiKeySchema = new mongoose.Schema({
    key                   : { type: String, unique: true, required: true },
    name                  : { type: String, default: '' },
    owner_username        : { type: String, default: '' },
    owner_channel         : { type: String, default: '' },
    created_at            : { type: Date, default: Date.now },
    expires_at            : { type: Date, default: null },
    hits                  : { type: Number, default: 0 },
    status                : { type: String, default: 'active' },
    unlimited_hits        : { type: Boolean, default: false },
    allowed_apis          : { type: String, default: '["all"]' },
    is_custom             : { type: Boolean, default: false },
    rate_limit_enabled    : { type: Boolean, default: true },
    rate_limit_per_day    : { type: Number, default: 100 },
    rate_limit_per_minute : { type: Number, default: 5 },
    key_note              : { type: String, default: '' },
    note_enabled          : { type: Boolean, default: false },
    last_updated          : { type: Date, default: Date.now },
    api_enabled           : { type: Boolean, default: true },
    max_hits              : { type: Number, default: 0 },
    api_overrides         : { type: String, default: '{}' }
});

const rateLimitTrackingSchema = new mongoose.Schema({
    api_key          : String,
    date             : String,
    minute_timestamp : Number,
    requests         : { type: Number, default: 0 }
});
rateLimitTrackingSchema.index({ api_key: 1, date: 1, minute_timestamp: 1 }, { unique: true });

const analyticsSchema = new mongoose.Schema({
    api_key       : String,
    endpoint      : String,
    status_code   : Number,
    ip_address    : String,
    response_time : Number,
    date          : { type: String, default: () => new Date().toISOString().split('T')[0] },
    created_at    : { type: Date, default: Date.now }
});

const dailyCallsSchema = new mongoose.Schema({
    api_key : String,
    date    : String,
    calls   : { type: Number, default: 0 }
});
dailyCallsSchema.index({ api_key: 1, date: 1 }, { unique: true });

const availableApiSchema = new mongoose.Schema({
    name            : String,
    display_name    : String,
    endpoint        : String,
    required_params : String,
    example_params  : String,
    description     : String,
    is_active       : { type: Boolean, default: true },
    custom_message  : { type: String, default: 'API is currently turned off.' },
    expires_at      : { type: Date, default: null }
});

const loginHistorySchema = new mongoose.Schema({
    username   : String,
    role       : { type: String, default: 'unknown' },
    ip_address : String,
    user_agent : String,
    status     : { type: String, default: 'success' },
    created_at : { type: Date, default: Date.now }
});

const settingsSchema = new mongoose.Schema({
    maintenance_message : { type: String, default: 'API is currently under maintenance.' }
});

// ─── MODELS ───────────────────────────────────────────────────────────────────
const User             = mongoose.model('User',             userSchema);
const ApiKey           = mongoose.model('ApiKey',           apiKeySchema);
const RateLimitTracking= mongoose.model('RateLimitTracking',rateLimitTrackingSchema);
const Analytics        = mongoose.model('Analytics',        analyticsSchema);
const DailyCalls       = mongoose.model('DailyCalls',       dailyCallsSchema);
const AvailableApi     = mongoose.model('AvailableApi',     availableApiSchema);
const LoginHistory     = mongoose.model('LoginHistory',     loginHistorySchema);
const Settings         = mongoose.model('Settings',         settingsSchema);

// ─── SEED DATA ────────────────────────────────────────────────────────────────
async function seedData() {
    // Settings
    const settingsCount = await Settings.countDocuments();
    if (!settingsCount) {
        await Settings.create({ maintenance_message: 'API is currently under maintenance.' });
    }

    // Head admin
    const mainUser = await User.findOne({ username: 'main' });
    if (!mainUser) {
        await User.create({
            username  : 'main',
            password  : await bcrypt.hash('sahil', 10),
            role      : 'head_admin',
            created_by: 'system'
        });
    }

    // Default admin
    const sahilUser = await User.findOne({ username: 'sahil' });
    if (!sahilUser) {
        await User.create({
            username  : 'sahil',
            password  : await bcrypt.hash('sexy', 10),
            role      : 'admin',
            created_by: 'main'
        });
    }

    // APIs
    const apiCount = await AvailableApi.countDocuments();
    if (!apiCount) {
        const APIs = [
            ['tg',           '📞 TG to Number',       '/api/tg',           '{"number":""}',  '{"number":"9876543210"}',   'Telegram number lookup'],
            ['num',          '📱 Number Info',         '/api/num',          '{"number":""}',  '{"number":"9876543210"}',   'Complete number information'],
            ['num2',         '🔍 Number Info v2',      '/api/num2',         '{"number":""}',  '{"number":"9876543210"}',   'Advanced number information'],
            ['num-india',    '🇮🇳 Indian Number',       '/api/num-india',    '{"number":""}',  '{"number":"9876543210"}',   'Indian mobile number details'],
            ['num-pak',      '🇵🇰 Pakistani Number',    '/api/num-pak',      '{"number":""}',  '{"number":"03001234567"}',  'Pakistani mobile number'],
            ['chain',        '🔗 Chain Lookup',        '/api/chain',        '{"number":""}',  '{"number":"9876543210"}',   'Chained number info'],
            ['bom',          '💥 BOM Lookup',          '/api/bom',          '{"number":""}',  '{"number":"9876543210"}',   'BOM number lookup'],
            ['aadhr',        '🪪 Aadhaar Info',        '/api/aadhr',        '{"q":""}',       '{"q":"123456789012"}',      'Aadhaar information lookup'],
            ['pan',          '📄 PAN Card',            '/api/pan',          '{"pan":""}',     '{"pan":"ABCDE1234F"}',      'PAN card details'],
            ['family',       '👨‍👩‍👧‍👦 Family Tree',        '/api/family',       '{"term":""}',    '{"term":"123456789012"}',   'Family relationship lookup'],
            ['email-info',   '📧 Email Info',          '/api/email-info',   '{"q":""}',       '{"q":"test@example.com"}',  'Email address information'],
            ['veh-to-num',   '🚗 Vehicle to Number',   '/api/veh-to-num',   '{"term":""}',    '{"term":"DL01AB1234"}',     'Vehicle registration to owner number'],
            ['vehicle-info', '🚘 Vehicle Info',         '/api/vehicle-info', '{"vehicle":""}', '{"vehicle":"DL01AB1234"}',  'Vehicle challan/info'],
            ['rc',           '📋 RC Details',          '/api/rc',           '{"owner":""}',   '{"owner":"DL01AB1234"}',    'Registration certificate details'],
            ['insta',        '📸 Instagram Info',      '/api/insta',        '{"username":""}','{"username":"instagram"}',  'Instagram profile'],
            ['snap',         '👻 Snapchat Info',       '/api/snap',         '{"username":""}','{"username":"john_doe"}',   'Snapchat profile lookup'],
            ['git',          '🐙 GitHub User',         '/api/git',          '{"username":""}','{"username":"octocat"}',    'GitHub profile info'],
            ['bgmi',         '🎮 BGMI Player',         '/api/bgmi',         '{"uid":""}',     '{"uid":"5121439477"}',      'BGMI player stats'],
            ['ff',           '🔫 FreeFire ID',         '/api/ff',           '{"uid":""}',     '{"uid":"123456789"}',       'FreeFire player info'],
            ['ip',           '🌐 IP Geolocation',      '/api/ip',           '{"ip":""}',      '{"ip":"8.8.8.8"}',          'IP address location'],
            ['bank',         '🏦 Bank IFSC',           '/api/bank',         '{"ifsc":""}',    '{"ifsc":"SBIN0001234"}',    'Bank branch details'],
            ['pincode',      '📍 Pincode Info',        '/api/pincode',      '{"pin":""}',     '{"pin":"110001"}',          'Area details from pincode'],
            ['leak',         '🔍 Leak Info',           '/api/leak',         '{"number":""}',  '{"number":"9876543210"}',   'Breach/leak database search'],
            ['leakpro',      '🔓 Leak Pro',            '/api/leakpro',      '{"number":""}',  '{"number":"919876543210"}', 'LEAK pro information'],
            ['ai-image',     '🎨 AI Image Gen',        '/api/ai-image',     '{"prompt":""}',  '{"prompt":"cyberpunk cat"}','Generate AI images'],
            ['mistral',      '🤖 Mistral AI',          '/api/mistral',      '{"message":""}', '{"message":"What is AI?"}', 'Chat with Mistral AI'],
        ];
        await AvailableApi.insertMany(APIs.map(a => ({
            name: a[0], display_name: a[1], endpoint: a[2],
            required_params: a[3], example_params: a[4], description: a[5],
            is_active: true, custom_message: 'API is currently turned off.'
        })));
        console.log('✅ APIs seeded');
    }
}

// Wait for mongoose connection then seed
mongoose.connection.once('open', () => {
    seedData().catch(err => console.error('Seed error:', err));
});

// ─── BRUTE FORCE PROTECTION ───────────────────────────────────────────────────
const loginAttempts = {};
const MAX_ATTEMPTS  = 5;
const BLOCK_MINUTES = 15;

function isBlocked(key) {
    const entry = loginAttempts[key];
    if (!entry) return false;
    if (entry.blockedUntil && Date.now() < entry.blockedUntil) return true;
    if (entry.blockedUntil && Date.now() >= entry.blockedUntil) { delete loginAttempts[key]; }
    return false;
}
function recordFail(key) {
    if (!loginAttempts[key]) loginAttempts[key] = { count: 0, blockedUntil: null };
    loginAttempts[key].count++;
    if (loginAttempts[key].count >= MAX_ATTEMPTS)
        loginAttempts[key].blockedUntil = Date.now() + BLOCK_MINUTES * 60 * 1000;
}
function resetAttempts(key) { delete loginAttempts[key]; }

// ─── EXPRESS SETUP ────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use(cors());
app.use(session({
    secret           : 'osint_secret_2024',
    resave           : false,
    saveUninitialized: false,
    cookie           : { maxAge: 24 * 60 * 60 * 1000 }
}));

const globalLimiter = rateLimit({
    windowMs    : 60 * 1000,
    max         : 60,
    keyGenerator: req => req.query.key || req.ip,
    handler     : (req, res) => res.json({ error: 'Global rate limit exceeded', contact: OWNER })
});

const requireAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect('/nazriya');
    next();
};
const requireHeadAdmin = (req, res, next) => {
    if (!req.session.user) return res.redirect('/nazriya');
    if (req.session.user.role !== 'head_admin') return res.redirect('/nazriya/mine');
    next();
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const getParam = (p, ...keys) => {
    for (const k of keys)
        if (p[k] !== undefined && p[k] !== null && p[k] !== '') return encodeURIComponent(p[k]);
    return '';
};
const parseParam = (raw) => {
    let params = {};
    try { params = JSON.parse(raw || '{}'); } catch(_) {}
    return params;
};
const formatApis = (apis) => apis.map(api => {
    const params = parseParam(api.required_params);
    return { ...api.toObject ? api.toObject() : api, param_name: Object.keys(params)[0] || 'param' };
});

// ─── API PROXY MAP ────────────────────────────────────────────────────────────
const apiProxyMap = {
    'tg'          : p => `${NEW_BASE}/api/tg?number=${getParam(p,'number','term','id','username','num','query','q')}`,
    'num'         : p => `${NEW_BASE}/api/num?number=${getParam(p,'q','number','num','query','term')}`,
    'num2'        : p => `${NEW_BASE}/api/num2?number=${getParam(p,'q','number','num','query','term')}`,
    'num-india'   : p => `${NEW_BASE}/api/num-india?number=${getParam(p,'num','number','q','query')}`,
    'num-pak'     : p => `${NEW_BASE}/api/num-pak?number=${getParam(p,'number','num','q','query')}`,
    'chain'       : p => `${NEW_BASE}/api/chain?number=${getParam(p,'number','query','q','num','term')}`,
    'bom'         : p => `${NEW_BASE}/api/bom?number=${getParam(p,'number','num','q','query','term')}`,
    'telegram-num': p => `${NEW_BASE}/api/tg?number=${getParam(p,'term','id','username','num','query','q')}`,
    'number-info' : p => `${NEW_BASE}/api/num?number=${getParam(p,'q','number','num','query','term')}`,
    'num-newinfo' : p => `${NEW_BASE}/api/num2?number=${getParam(p,'q','number','num','query','term')}`,
    'aadhr'       : p => `${NEW_BASE}/api/adhar?adhar=${getParam(p,'q','adhar','term','id','query','number')}`,
    'pan'         : p => `${NEW_BASE}/api/pan?pan=${getParam(p,'pan','q','query')}`,
    'family'      : p => `${NEW_BASE}/api/family?adhar=${getParam(p,'term','adhar','q','query','number')}`,
    'email-info'  : p => `${NEW_BASE}/api/email?email=${getParam(p,'q','email','query')}`,
    'veh-to-num'  : p => `${NEW_BASE}/api/veh-info?registration_number=${getParam(p,'vehicle','term','q','query')}`,
    'vehicle-info': p => `${NEW_BASE}/api/veh?vehicle=${getParam(p,'vehicle','registration_number','q','term','query')}`,
    'vehicle'     : p => `${NEW_BASE}/api/veh?vehicle=${getParam(p,'vehicle','q','term','query')}`,
    'rc'          : p => `${NEW_BASE}/api/rc?registration_number=${getParam(p,'owner','vehicle','q','query')}`,
    'insta'       : p => `${NEW_BASE}/api/insta?username=${getParam(p,'username','q','query')}`,
    'snap'        : p => `${NEW_BASE}/api/snap?username=${getParam(p,'username','q','query')}`,
    'git'         : p => `${NEW_BASE}/api/git?username=${getParam(p,'username','q','query')}`,
    'bgmi'        : p => `${NEW_BASE}/api/bgmi?uid=${getParam(p,'uid','q','query')}`,
    'ff'          : p => `${NEW_BASE}/api/ff?uid=${getParam(p,'uid','q','query')}`,
    'ip'          : p => `${NEW_BASE}/api/ip?ip=${getParam(p,'ip','q','query')}`,
    'bank'        : p => `${NEW_BASE}/api/ifsc?ifsc=${getParam(p,'ifsc','q','query')}`,
    'pincode'     : p => `${NEW_BASE}/api/pin?pincode=${getParam(p,'pin','pincode','q','query')}`,
    'leak'        : p => `${NEW_BASE}/api/leak?query=${getParam(p,'number','query','q','num','term')}`,
    'leakpro'     : p => `${NEW_BASE}/api/leakpro?query=${getParam(p,'number','query','q','num','quiry','term')}`,
    'ai-image'    : p => `https://ayaanmods.site/aiimage.php?key=${MASTER_KEYS.ayaanmods}&prompt=${getParam(p,'prompt','q','query')}`,
    'mistral': async (p, res, keyData, rateLimitInfo) => {
        const message = decodeURIComponent(getParam(p, 'message', 'q', 'query', 'prompt'));
        if (!message) return res.status(400).json({ error: 'message param required', contact: OWNER });
        const r = await axios.post('https://api.mistral.ai/v1/chat/completions', {
            model   : 'mistral-small-latest',
            messages: [{ role: 'user', content: message }],
            max_tokens: 1024
        }, {
            headers: { Authorization: `Bearer ${MASTER_KEYS.mistral}`, 'Content-Type': 'application/json' },
            timeout: 30000
        });
        const out = { success: true, reply: r.data.choices?.[0]?.message?.content || '', owner: OWNER, channel: CHANNEL };
        if (Object.keys(rateLimitInfo).length) out.rate_limit = rateLimitInfo;
        if (keyData.note_enabled && keyData.key_note) out.key_note = keyData.key_note;
        return res.json(out);
    }
};

const REMOVE_FIELDS = new Set([
    'owner','OWNER','channel','CHANNEL','telegram','contact','instagram','twitter',
    'fb','facebook','website','github','created_by','createdBy','owner_username',
    'owner_channel','credit','Credits','Credit','Source','source','provider','Provider',
    'api_source','API_Source','developer','Developer','dev','Dev','invalidayushh',
    'ftgamerv2','ftgamer2','@invalidayushh','@ftgamerv2','@ftgamer2','InvalidAyush',
    '@InvalidAyush','invalidayush','@invalidayush','DM TO BUY ACCESS','xtradeep',
    'Kon_Hu_Mai','support','@raxusss','raxusss','Raxusss','Support','help','Help'
]);
const REMOVE_STRINGS = ['@raxusss','raxusss','InvalidAyush','@InvalidAyush','invalidayush','ftgamerv2','ftgamer2','@ftgamerv2','@ftgamer2'];

function cleanResponse(data) {
    if (!data || typeof data !== 'object') return data;
    const obj = JSON.parse(JSON.stringify(data));
    function clean(o) {
        if (!o || typeof o !== 'object') return;
        for (const k of Object.keys(o)) {
            if (REMOVE_FIELDS.has(k) || REMOVE_FIELDS.has(k.toLowerCase())) { delete o[k]; continue; }
            if (typeof o[k] === 'string' && REMOVE_STRINGS.some(s => o[k].includes(s))) { delete o[k]; continue; }
            if (typeof o[k] === 'object') clean(o[k]);
        }
    }
    clean(obj);
    obj.owner   = OWNER;
    obj.channel = CHANNEL;
    return obj;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

app.get('/', async (req, res) => {
    try {
        const [keys, apis] = await Promise.all([
            ApiKey.find({}, 'hits'),
            AvailableApi.countDocuments()
        ]);
        res.render('index', {
            user      : req.session.user || null,
            totalApis : apis,
            totalKeys : keys.length,
            totalHits : keys.reduce((s, k) => s + (k.hits || 0), 0),
            owner     : OWNER,
            channel   : CHANNEL
        });
    } catch (err) {
        console.error('Index error:', err);
        res.status(500).send('Database error: ' + err.message);
    }
});

app.get('/endpoints', async (req, res) => {
    try {
        const apis = await AvailableApi.find({ is_active: true });
        const formatted = apis.map(api => {
            let params = {}, examples = {};
            try { params   = JSON.parse(api.required_params || '{}'); } catch(_) {}
            try { examples = JSON.parse(api.example_params  || '{}'); } catch(_) {}
            const pName = Object.keys(params)[0] || 'param';
            return { ...api.toObject(), param_name: pName, param_example: examples[pName] || 'value', full_url: api.endpoint };
        });
        res.render('endpoints', {
            apis: formatted, baseUrl: req.protocol + '://' + req.get('host'),
            owner: OWNER, channel: CHANNEL, user: req.session.user || null
        });
    } catch (err) {
        console.error('Endpoints error:', err);
        res.status(500).send('Database error: ' + err.message);
    }
});

app.get('/docs', async (req, res) => {
    try {
        const apis = await AvailableApi.find({ is_active: true });
        const base  = req.protocol + '://' + req.get('host');
        const formatted = apis.map(api => {
            let params = {}, examples = {};
            try { params   = JSON.parse(api.required_params || '{}'); } catch(_) {}
            try { examples = JSON.parse(api.example_params  || '{}'); } catch(_) {}
            const pName = Object.keys(params)[0] || 'query';
            const pVal  = examples[pName] || 'sample_value';
            return {
                ...api.toObject(), param_name: pName, param_example: pVal,
                full_example_url: `${base}${api.endpoint}?key=YOUR_API_KEY&${pName}=${pVal}`
            };
        });
        res.render('docs', { apis: formatted, baseUrl: base, owner: OWNER, channel: CHANNEL, user: req.session.user || null });
    } catch (err) {
        console.error('Docs error:', err);
        res.status(500).send('Database error: ' + err.message);
    }
});

app.get('/login', (req, res) => res.status(404).send('Not found'));
app.get('/nazriya', (req, res) => res.render('login', { error: req.query.error || null }));

app.post('/nazriya', async (req, res) => {
    const { username, password } = req.body;
    const ip = req.ip || '';
    const ua = req.headers['user-agent'] || '';
    const log = (u, role, status) =>
        LoginHistory.create({ username: u, role: role || 'unknown', ip_address: ip, user_agent: ua, status }).catch(() => {});

    if (!username || !password) {
        await log(username || null, null, 'failed_missing');
        return res.redirect('/nazriya?error=missing');
    }

    const ipKey   = 'ip:' + ip;
    const userKey = 'user:' + username.toLowerCase();

    if (isBlocked(ipKey) || isBlocked(userKey)) {
        await log(username, null, 'failed_blocked');
        return res.redirect('/nazriya?error=blocked');
    }

    try {
        const user = await User.findOne({ username });
        if (!user) {
            recordFail(ipKey); recordFail(userKey);
            await log(username, null, 'failed_invalid');
            return res.redirect('/nazriya?error=invalid');
        }
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            recordFail(ipKey); recordFail(userKey);
            await log(username, null, 'failed_wrong_pass');
            return res.redirect('/nazriya?error=invalid');
        }
        resetAttempts(ipKey); resetAttempts(userKey);
        req.session.user = { id: user._id.toString(), username: user.username, role: user.role };
        await log(user.username, user.role, 'success');
        res.redirect(user.role === 'head_admin' ? '/head-admin/dashboard' : '/nazriya/mine');
    } catch (err) {
        console.error('Login error:', err);
        res.redirect('/nazriya?error=server');
    }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.get('/nazriya/mine', requireAuth, async (req, res) => {
    try {
        const [keys, apis, settings] = await Promise.all([
            ApiKey.find().sort({ created_at: -1 }),
            AvailableApi.find(),
            Settings.findOne()
        ]);

        // Chart data — last 7 days
        const chartAgg = await DailyCalls.aggregate([
            { $group: { _id: '$date', total_calls: { $sum: '$calls' } } },
            { $sort: { _id: -1 } },
            { $limit: 7 }
        ]);
        const chartRows = chartAgg.map(r => ({ date: r._id, total_calls: r.total_calls })).reverse();

        // Top endpoints
        const topEndpoints = await Analytics.aggregate([
            { $group: { _id: '$endpoint', hits: { $sum: 1 } } },
            { $sort: { hits: -1 } },
            { $limit: 5 },
            { $project: { endpoint: '$_id', hits: 1, _id: 0 } }
        ]);

        // Recent activity
        const recentActivity = await Analytics.find().sort({ created_at: -1 }).limit(8);

        // Stats
        const totalReq   = await Analytics.countDocuments();
        const successReq = await Analytics.countDocuments({ status_code: { $gte: 200, $lt: 300 } });
        const successRate= totalReq > 0 ? ((successReq / totalReq) * 100).toFixed(1) : '100.0';

        const activeApis = (apis || []).filter(a => a.is_active).length;
        const recent = (recentActivity || []).map(r => ({
            endpoint: '/api/' + r.endpoint,
            code    : r.status_code,
            ok      : r.status_code >= 200 && r.status_code < 300,
            time    : r.created_at
        }));

        res.render('dashboard', {
            keys           : keys || [],
            totalHits      : keys.reduce((s, k) => s + (k.hits || 0), 0),
            active         : keys.filter(k => k.status === 'active').length,
            apis           : formatApis(apis || []),
            chartData      : chartRows,
            dailyVolume    : chartRows,
            topEndpoints   : topEndpoints || [],
            recentActivity : recent,
            health: {
                uptime      : Math.floor(process.uptime()),
                activeApis,
                totalApis   : (apis || []).length,
                successRate,
                totalReq
            },
            user    : req.session.user,
            baseUrl : req.protocol + '://' + req.get('host'),
            settings: settings || { maintenance_message: 'API is currently under maintenance.' },
            owner   : OWNER,
            channel : CHANNEL
        });
    } catch (err) {
        console.error('Admin dashboard error:', err);
        res.status(500).send('Database error: ' + err.message);
    }
});

app.get('/head-admin/dashboard', requireHeadAdmin, async (req, res) => {
    try {
        const [keys, users, apis, settings] = await Promise.all([
            ApiKey.find().sort({ created_at: -1 }),
            User.find().sort({ created_at: -1 }),
            AvailableApi.find(),
            Settings.findOne()
        ]);

        const chartAgg = await DailyCalls.aggregate([
            { $group: { _id: '$date', total_calls: { $sum: '$calls' } } },
            { $sort: { _id: -1 } },
            { $limit: 7 }
        ]);
        const chartRows = chartAgg.map(r => ({ date: r._id, total_calls: r.total_calls })).reverse();

        res.render('head_admin_dashboard', {
            keys     : keys || [],
            users    : users || [],
            totalHits: keys.reduce((s, k) => s + (k.hits || 0), 0),
            apis     : formatApis(apis || []),
            chartData: chartRows,
            user     : req.session.user,
            baseUrl  : req.protocol + '://' + req.get('host'),
            settings : settings || { maintenance_message: 'API is currently under maintenance.' },
            owner    : OWNER,
            channel  : CHANNEL
        });
    } catch (err) {
        console.error('Head admin dashboard error:', err);
        res.status(500).send('Database error: ' + err.message);
    }
});

app.get('/nazriya/analytics', requireAuth, async (req, res) => {
    try {
        const totalEndpoints = await AvailableApi.countDocuments();
        res.render('analytics', { totalEndpoints, user: req.session.user, owner: OWNER, channel: CHANNEL });
    } catch (err) {
        console.error('Analytics page error:', err);
        res.status(500).send('Database error: ' + err.message);
    }
});

app.get('/analytics/data', requireAuth, async (req, res) => {
    try {
        const [totalReq, totalSuccess, totalError, uniqueIpsAgg, latAgg, epCount] = await Promise.all([
            Analytics.countDocuments(),
            Analytics.countDocuments({ status_code: { $gte: 200, $lt: 300 } }),
            Analytics.countDocuments({ status_code: { $gte: 400 } }),
            Analytics.distinct('ip_address'),
            Analytics.aggregate([{ $group: { _id: null, avg: { $avg: '$response_time' } } }]),
            AvailableApi.countDocuments()
        ]);

        const uniqueIps  = uniqueIpsAgg.length;
        const avgLatency = latAgg.length && latAgg[0].avg ? Math.round(latAgg[0].avg) : 0;
        const errorRate  = totalReq > 0 ? ((totalError / totalReq) * 100).toFixed(1) : '0.0';

        // Hourly chart — last 24h
        const hourlyAgg = await Analytics.aggregate([
            { $match: { created_at: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } } },
            { $group: {
                _id    : { $hour: '$created_at' },
                hits   : { $sum: 1 },
                success: { $sum: { $cond: [{ $and: [{ $gte: ['$status_code', 200] }, { $lt: ['$status_code', 300] }] }, 1, 0] } },
                error  : { $sum: { $cond: [{ $gte: ['$status_code', 400] }, 1, 0] } }
            }},
            { $sort: { _id: 1 } }
        ]);

        const hourMap = {};
        hourlyAgg.forEach(h => { hourMap[String(h._id).padStart(2,'0')] = h; });
        const nowH = new Date().getHours();
        const hourlyChart = [];
        for (let i = 23; i >= 0; i--) {
            const hh  = String((nowH - i + 24) % 24).padStart(2, '0');
            const row = hourMap[hh];
            hourlyChart.push({ label: hh + ':00', hits: row ? row.hits : 0, success: row ? row.success : 0, error: row ? row.error : 0 });
        }

        // Top endpoints
        const endpointAgg = await Analytics.aggregate([
            { $group: {
                _id    : '$endpoint',
                hits   : { $sum: 1 },
                success: { $sum: { $cond: [{ $and: [{ $gte: ['$status_code', 200] }, { $lt: ['$status_code', 300] }] }, 1, 0] } },
                error  : { $sum: { $cond: [{ $gte: ['$status_code', 400] }, 1, 0] } },
                avg_lat: { $avg: '$response_time' },
                min_lat: { $min: '$response_time' },
                max_lat: { $max: '$response_time' }
            }},
            { $sort: { hits: -1 } },
            { $limit: 15 }
        ]);
        const topEndpoints = endpointAgg.map(ep => ({
            name        : ep._id,
            hits        : ep.hits,
            success     : ep.success,
            error       : ep.error,
            avgLatencyMs: ep.avg_lat ? Math.round(ep.avg_lat) : 0,
            minLatency  : ep.min_lat || 0,
            maxLatency  : ep.max_lat || 0,
            errorRate   : ep.hits > 0 ? ((ep.error / ep.hits) * 100).toFixed(1) : '0.0'
        }));

        // Status distribution
        const statusAgg = await Analytics.aggregate([
            { $group: { _id: '$status_code', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);
        const statusDist = statusAgg.map(s => ({ code: s._id || 0, count: s.count }));

        // Recent requests
        const recentRows = await Analytics.find().sort({ created_at: -1 }).limit(30);
        const recentRequests = recentRows.map(r => ({
            time      : r.created_at,
            endpoint  : '/api/' + r.endpoint,
            statusCode: r.status_code,
            latencyMs : r.response_time || 0,
            success   : r.status_code >= 200 && r.status_code < 300
        }));

        res.json({
            totalRequests: totalReq, totalSuccess, totalError, errorRate,
            uniqueIps, avgLatency,
            uptime        : Math.floor(process.uptime()),
            totalEndpoints: epCount,
            hourlyChart, topEndpoints, statusDist, recentRequests
        });
    } catch (err) {
        console.error('Analytics data error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/nazriya/heatmap-data', requireAuth, async (req, res) => {
    try {
        const cutoff = new Date(Date.now() - 56 * 24 * 3600 * 1000);
        const rows   = await DailyCalls.aggregate([
            { $match: { date: { $gte: cutoff.toISOString().split('T')[0] } } },
            { $group: { _id: '$date', total: { $sum: '$calls' } } },
            { $sort: { _id: 1 } }
        ]);
        res.json(rows.map(r => ({ date: r._id, total: r.total })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/nazriya/login-history', requireAuth, async (req, res) => {
    try {
        const logs = await LoginHistory.find().sort({ created_at: -1 }).limit(200);
        const topFailedIPs = await LoginHistory.aggregate([
            { $match: { status: { $ne: 'success' } } },
            { $group: { _id: '$ip_address', attempts: { $sum: 1 } } },
            { $sort: { attempts: -1 } },
            { $limit: 10 }
        ]);
        res.render('login_history', {
            logs        : logs || [],
            successCount: (logs || []).filter(l => l.status === 'success').length,
            failCount   : (logs || []).filter(l => l.status !== 'success').length,
            topFailedIPs: topFailedIPs.map(r => ({ ip_address: r._id, attempts: r.attempts })),
            user        : req.session.user,
            owner       : OWNER,
            channel     : CHANNEL
        });
    } catch (err) {
        console.error('Login history error:', err);
        res.status(500).send('Database error: ' + err.message);
    }
});

// ─── KEY MANAGEMENT ───────────────────────────────────────────────────────────
app.post('/nazriya/generate-key', requireAuth, async (req, res) => {
    const {
        name, expiry, usage_mode, one_time_limit, max_hits: raw_max_hits,
        selected_apis, custom_key,
        rate_limit_per_day, rate_limit_per_minute, key_note,
        custom_expiry_date, custom_expiry_time
    } = req.body;
    const isCustomEnabled = req.body.enable_custom === 'on';

    if (isCustomEnabled && (!custom_key || !custom_key.trim()))
        return res.status(400).send('❌ Please enter a custom key string.');

    let expires_at = null;
    const now = new Date();
    if      (expiry === '3d')  expires_at = new Date(now.getTime() + 3  * 86400000);
    else if (expiry === '7d')  expires_at = new Date(now.getTime() + 7  * 86400000);
    else if (expiry === '30d') expires_at = new Date(now.getTime() + 30 * 86400000);
    else if (expiry === 'custom' && custom_expiry_date) {
        const d = new Date(`${custom_expiry_date}T${custom_expiry_time || '23:59'}`);
        if (!isNaN(d)) expires_at = d;
    }

    let allowedApisJson = '["all"]';
    if (selected_apis) {
        if (selected_apis === 'all' || (Array.isArray(selected_apis) && selected_apis.includes('all')))
            allowedApisJson = '["all"]';
        else
            allowedApisJson = JSON.stringify(Array.isArray(selected_apis) ? selected_apis : [selected_apis]);
    }

    const mode = ['unlimited','ratelimited','onetime'].includes(usage_mode) ? usage_mode : 'ratelimited';
    let isUnlimited, rateLimitEnabled, perDay, perMin, maxHits;
    if (mode === 'unlimited') {
        isUnlimited = true; rateLimitEnabled = false; perDay = 0; perMin = 0; maxHits = 0;
    } else if (mode === 'onetime') {
        isUnlimited = false; rateLimitEnabled = false; perDay = 0; perMin = 0;
        maxHits = Math.max(1, parseInt(one_time_limit) || 1);
    } else {
        isUnlimited = false; rateLimitEnabled = true;
        perDay  = Math.max(0, parseInt(rate_limit_per_day)    || 100);
        perMin  = Math.max(0, parseInt(rate_limit_per_minute) || 0);
        maxHits = Math.max(0, parseInt(raw_max_hits) || 0);
    }

    const noteText = (key_note || '').trim();

    try {
        let apiKey;
        if (isCustomEnabled && custom_key && custom_key.trim()) {
            apiKey = custom_key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
            if (apiKey.length < 3) return res.status(400).send('❌ Custom key must be at least 3 characters');
            const existing = await ApiKey.findOne({ key: apiKey });
            if (existing) return res.status(400).send('❌ Key already exists: ' + apiKey);
        } else {
            apiKey = 'OSINT_' + Math.random().toString(36).substring(2, 18).toUpperCase();
        }

        await ApiKey.create({
            key                  : apiKey,
            name                 : name || '',
            owner_username       : OWNER,
            owner_channel        : CHANNEL,
            expires_at,
            unlimited_hits       : isUnlimited,
            allowed_apis         : allowedApisJson,
            status               : 'active',
            is_custom            : isCustomEnabled,
            rate_limit_enabled   : rateLimitEnabled,
            rate_limit_per_day   : perDay,
            rate_limit_per_minute: perMin,
            key_note             : noteText,
            note_enabled         : noteText.length > 0,
            last_updated         : new Date(),
            api_enabled          : true,
            max_hits             : maxHits
        });
        res.redirect('/nazriya/mine');
    } catch (err) {
        console.error('Generate key error:', err);
        res.status(500).send('Database error: ' + err.message);
    }
});

app.post('/nazriya/edit-key', requireAuth, async (req, res) => {
    const {
        key_id, name, expiry, usage_mode, one_time_limit, max_hits: raw_max_hits,
        rate_limit_per_day, rate_limit_per_minute,
        key_note, status, selected_apis, api_enabled, api_overrides
    } = req.body;

    if (!key_id) return res.status(400).json({ success: false, error: 'Key ID required' });

    try {
        const existing = await ApiKey.findById(key_id);
        if (!existing) return res.status(404).json({ success: false, error: 'Key not found' });

        let expires_at = existing.expires_at;
        if (expiry && expiry !== 'keep' && expiry !== 'never') {
            const now = new Date();
            if      (expiry === '3d')  expires_at = new Date(now.getTime() + 3  * 86400000);
            else if (expiry === '7d')  expires_at = new Date(now.getTime() + 7  * 86400000);
            else if (expiry === '30d') expires_at = new Date(now.getTime() + 30 * 86400000);
        } else if (expiry === 'never') {
            expires_at = null;
        }

        let allowedApisJson = '["all"]';
        if (selected_apis) {
            if (selected_apis === 'all' || (Array.isArray(selected_apis) && selected_apis.includes('all')))
                allowedApisJson = '["all"]';
            else
                allowedApisJson = JSON.stringify(Array.isArray(selected_apis) ? selected_apis : [selected_apis]);
        }

        const mode = ['unlimited','ratelimited','onetime'].includes(usage_mode)
            ? usage_mode
            : (existing.unlimited_hits ? 'unlimited' : (existing.rate_limit_enabled ? 'ratelimited' : 'onetime'));

        let isUnlimited, rateLimitEnabled, perDay, perMin, maxHits;
        if (mode === 'unlimited') {
            isUnlimited = true; rateLimitEnabled = false; perDay = 0; perMin = 0; maxHits = 0;
        } else if (mode === 'onetime') {
            isUnlimited = false; rateLimitEnabled = false; perDay = 0; perMin = 0;
            maxHits = Math.max(1, parseInt(one_time_limit) || parseInt(raw_max_hits) || 1);
        } else {
            isUnlimited = false; rateLimitEnabled = true;
            perDay  = parseInt(rate_limit_per_day)    >= 0 ? parseInt(rate_limit_per_day)    : 100;
            perMin  = parseInt(rate_limit_per_minute) >= 0 ? parseInt(rate_limit_per_minute) : 0;
            maxHits = Math.max(0, parseInt(raw_max_hits) || 0);
        }

        const enabled  = !['false','0',0].includes(api_enabled);
        const noteText = (key_note || '').trim();

        let overridesJson = existing.api_overrides || '{}';
        if (api_overrides !== undefined) {
            try {
                const parsed = typeof api_overrides === 'string' ? JSON.parse(api_overrides) : api_overrides;
                overridesJson = JSON.stringify(parsed && typeof parsed === 'object' ? parsed : {});
            } catch(_) { overridesJson = '{}'; }
        }

        let newStatus = status || existing.status;
        if (!status && existing.status === 'expired') {
            const stillOverCap = !isUnlimited && maxHits > 0 && existing.hits >= maxHits;
            const dateExpired  = expires_at ? new Date(expires_at) < new Date() : false;
            if (!stillOverCap && !dateExpired) newStatus = 'active';
        }

        await ApiKey.findByIdAndUpdate(key_id, {
            name                 : name || existing.name,
            allowed_apis         : allowedApisJson,
            key_note             : noteText,
            note_enabled         : noteText.length > 0,
            unlimited_hits       : isUnlimited,
            rate_limit_enabled   : rateLimitEnabled,
            rate_limit_per_day   : perDay,
            rate_limit_per_minute: perMin,
            max_hits             : maxHits,
            status               : newStatus,
            api_enabled          : enabled,
            api_overrides        : overridesJson,
            expires_at,
            last_updated         : new Date()
        });
        res.json({ success: true, message: 'Key updated successfully' });
    } catch (err) {
        console.error('Edit key error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/nazriya/delete-key', requireAuth, async (req, res) => {
    if (!req.body.id) return res.status(400).send('Key ID required');
    try {
        await ApiKey.findByIdAndDelete(req.body.id);
        res.redirect('/nazriya/mine');
    } catch (err) { res.status(500).send('Database error: ' + err.message); }
});

app.post('/nazriya/toggle-key-enabled', requireAuth, async (req, res) => {
    const { key_id, api_enabled } = req.body;
    if (!key_id) return res.status(400).json({ success: false, error: 'Key ID required' });
    const enabled = ['true','1',1,true].includes(api_enabled);
    try {
        await ApiKey.findByIdAndUpdate(key_id, { api_enabled: enabled, last_updated: new Date() });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/nazriya/bulk-key-action', requireAuth, async (req, res) => {
    const { key_ids, action } = req.body;
    if (!key_ids || !Array.isArray(key_ids) || !key_ids.length)
        return res.status(400).json({ success: false, error: 'No keys selected' });

    try {
        if      (action === 'enable')  await ApiKey.updateMany({ _id: { $in: key_ids } }, { api_enabled: true });
        else if (action === 'disable') await ApiKey.updateMany({ _id: { $in: key_ids } }, { api_enabled: false });
        else if (action === 'revoke')  await ApiKey.updateMany({ _id: { $in: key_ids } }, { status: 'disabled' });
        else if (action === 'delete')  await ApiKey.deleteMany({ _id: { $in: key_ids } });
        else return res.status(400).json({ success: false, error: 'Invalid action' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/nazriya/duplicate-key', requireAuth, async (req, res) => {
    const { key_id } = req.body;
    if (!key_id) return res.status(400).json({ success: false, error: 'key_id required' });
    try {
        const src = await ApiKey.findById(key_id);
        if (!src) return res.status(404).json({ success: false, error: 'Key not found' });

        const newKey = 'OSINT_' + Math.random().toString(36).substring(2, 18).toUpperCase();
        await ApiKey.create({
            key                  : newKey,
            name                 : (src.name || 'Unnamed') + ' (copy)',
            owner_username       : src.owner_username,
            owner_channel        : src.owner_channel,
            expires_at           : src.expires_at,
            unlimited_hits       : src.unlimited_hits,
            allowed_apis         : src.allowed_apis,
            status               : 'active',
            is_custom            : false,
            rate_limit_enabled   : src.rate_limit_enabled,
            rate_limit_per_day   : src.rate_limit_per_day,
            rate_limit_per_minute: src.rate_limit_per_minute,
            key_note             : src.key_note,
            note_enabled         : src.note_enabled,
            last_updated         : new Date(),
            api_enabled          : true,
            max_hits             : src.max_hits || 0,
            api_overrides        : src.api_overrides || '{}'
        });
        res.json({ success: true, key: newKey });
    } catch (err) {
        console.error('Duplicate key error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── GLOBAL API MANAGEMENT ─────────────────────────────────────────────────
app.post('/nazriya/toggle-api', requireAuth, async (req, res) => {
    const { api_id, is_active } = { ...req.body, ...req.query };
    if (!api_id) return res.status(400).json({ error: 'API ID required' });
    try {
        await AvailableApi.findByIdAndUpdate(api_id, { is_active: !!is_active });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/nazriya/update-api-status', requireAuth, async (req, res) => {
    const { api_id, is_active, custom_message } = { ...req.body, ...req.query };
    if (!api_id) return res.status(400).json({ error: 'API ID required' });
    try {
        await AvailableApi.findByIdAndUpdate(api_id, {
            is_active     : !!is_active,
            custom_message: custom_message || 'API is currently turned off.'
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/nazriya/update-api-expiry', requireAuth, async (req, res) => {
    const { api_id, expires_at } = req.body;
    if (!api_id) return res.status(400).json({ error: 'API ID required' });
    try {
        const expDate = expires_at ? new Date(expires_at) : null;
        const update  = { expires_at: expDate };
        if (expDate && expDate < new Date()) update.is_active = false;
        await AvailableApi.findByIdAndUpdate(api_id, update);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/nazriya/update-api-name', requireAuth, async (req, res) => {
    const { api_id, display_name } = req.body;
    if (!api_id || !display_name) return res.status(400).json({ error: 'API ID and display name required' });
    try {
        await AvailableApi.findByIdAndUpdate(api_id, { display_name });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/nazriya/update-settings', requireAuth, async (req, res) => {
    const { maintenance_message } = req.body;
    if (!maintenance_message) return res.status(400).send('Maintenance message required');
    try {
        await Settings.findOneAndUpdate({}, { maintenance_message }, { upsert: true });
        res.redirect('/nazriya/mine');
    } catch (err) { res.status(500).send('Database error: ' + err.message); }
});

app.post('/head-admin/create-user', requireHeadAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role)
        return res.status(400).json({ success: false, error: 'username, password, role required' });
    try {
        const hashed = await bcrypt.hash(password, 10);
        await User.create({ username, password: hashed, role, created_by: req.session.user.username });
        res.json({ success: true });
    } catch (err) {
        if (err.code === 11000)
            return res.status(400).json({ success: false, error: 'Username already exists' });
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/head-admin/delete-user', requireHeadAdmin, async (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
    try {
        await User.findOneAndDelete({ _id: user_id, username: { $ne: 'main' } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── MAIN API ENDPOINT ────────────────────────────────────────────────────────
app.all('/api/:endpoint', globalLimiter, async (req, res) => {
    const userKey  = req.query.key || req.body.key;
    const endpoint = req.params.endpoint;
    const reqStart = Date.now();
    const today    = new Date().toISOString().split('T')[0];

    try {
        if (!userKey)
            return res.status(401).json({ error: 'API key required', contact: OWNER });

        // Global API status + auto-expiry lazy heal
        const targetApi = await AvailableApi.findOne({
            $or: [{ name: endpoint }, { endpoint: `/api/${endpoint}` }]
        });
        if (targetApi) {
            const apiExpired = targetApi.expires_at && new Date(targetApi.expires_at) < new Date();
            if (!targetApi.is_active || apiExpired) {
                if (apiExpired && targetApi.is_active) {
                    AvailableApi.findByIdAndUpdate(targetApi._id, { is_active: false }).catch(() => {});
                }
                return res.json({
                    status : false,
                    message: targetApi.custom_message || (apiExpired ? 'This API has expired.' : 'This API is currently turned off.')
                });
            }
        }

        const keyData = await ApiKey.findOne({ key: { $regex: new RegExp('^' + userKey + '$', 'i') } });
        if (!keyData)
            return res.status(403).json({ error: 'Invalid API key', contact: OWNER });
        if (!keyData.api_enabled)
            return res.status(403).json({ success: false, message: 'This API Key has been disabled by administrator.' });
        if (keyData.status !== 'active')
            return res.status(403).json({ error: `Key status is ${keyData.status}`, contact: OWNER });

        try {
            const allowed = JSON.parse(keyData.allowed_apis || '["all"]');
            if (!allowed.includes('all') && !allowed.includes(endpoint))
                return res.status(403).json({ success: false, error: `Endpoint "${endpoint}" not allowed for this key.` });
        } catch(_) {}

        try {
            const overrides = JSON.parse(keyData.api_overrides || '{}');
            if (overrides[endpoint] && overrides[endpoint].enabled === false) {
                return res.json({ status: false, message: overrides[endpoint].message || 'This API is currently turned off for this key.' });
            }
        } catch(_) {}

        if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
            ApiKey.findByIdAndUpdate(keyData._id, { status: 'expired' }).catch(() => {});
            return res.status(403).json({ error: 'Key expired', contact: OWNER });
        }

        if (!keyData.unlimited_hits && keyData.max_hits > 0 && keyData.hits >= keyData.max_hits) {
            ApiKey.findByIdAndUpdate(keyData._id, { status: 'expired', api_enabled: false }).catch(() => {});
            return res.status(403).json({
                success: false,
                error  : `Key expired — request limit reached (${keyData.max_hits} calls)`,
                used   : keyData.hits,
                limit  : keyData.max_hits,
                contact: OWNER
            });
        }

        let rateLimitInfo = {};
        if (!keyData.unlimited_hits && keyData.rate_limit_enabled) {
            const perDay = parseInt(keyData.rate_limit_per_day)    || 100;
            const perMin = parseInt(keyData.rate_limit_per_minute) || 0;
            const nowTs  = Math.floor(Date.now() / 60000);

            // Daily count
            const dailyAgg = await RateLimitTracking.aggregate([
                { $match: { api_key: userKey, date: today } },
                { $group: { _id: null, total: { $sum: '$requests' } } }
            ]);
            const dailyCount = dailyAgg.length ? dailyAgg[0].total : 0;

            if (perDay > 0 && dailyCount >= perDay)
                return res.status(429).json({
                    success: false, error: `Daily limit exceeded (${perDay}/day)`,
                    rate_limit: { per_day: { limit: perDay, used: dailyCount, remaining: 0 } }, contact: OWNER
                });

            let minCount = 0;
            if (perMin > 0) {
                const minDoc = await RateLimitTracking.findOne({ api_key: userKey, minute_timestamp: nowTs });
                minCount = minDoc ? minDoc.requests : 0;
                if (minCount >= perMin)
                    return res.status(429).json({
                        success: false, error: `Per-minute limit exceeded (${perMin}/min)`,
                        rate_limit: {
                            per_minute: { limit: perMin, used: minCount, remaining: 0 },
                            per_day   : { limit: perDay, used: dailyCount, remaining: Math.max(0, perDay - dailyCount) }
                        }, contact: OWNER
                    });
            }

            // Upsert rate limit tracking
            await RateLimitTracking.findOneAndUpdate(
                { api_key: userKey, date: today, minute_timestamp: nowTs },
                { $inc: { requests: 1 } },
                { upsert: true }
            );

            rateLimitInfo.per_day = { limit: perDay, used: dailyCount + 1, remaining: Math.max(0, perDay - dailyCount - 1) };
            if (perMin > 0)
                rateLimitInfo.per_minute = { limit: perMin, used: minCount + 1, remaining: Math.max(0, perMin - minCount - 1) };
        }

        // Increment daily calls + hits
        DailyCalls.findOneAndUpdate(
            { api_key: userKey, date: today },
            { $inc: { calls: 1 } },
            { upsert: true }
        ).catch(() => {});
        ApiKey.findByIdAndUpdate(keyData._id, { $inc: { hits: 1 } }).catch(() => {});

        wsBroadcast({ type: 'hit', endpoint, key: userKey.slice(0, 8) + '…', ts: Date.now() });

        const proxyFn = apiProxyMap[endpoint];
        if (!proxyFn)
            return res.status(404).json({ error: 'Unknown endpoint', contact: OWNER });

        const params = { ...req.query, ...req.body };

        if (endpoint === 'mistral') {
            try { await proxyFn(params, res, keyData, rateLimitInfo); }
            catch (err) {
                console.error('Mistral error:', err);
                res.status(500).json({ error: 'Mistral request failed', details: err.message });
            }
            return;
        }

        try {
            const targetUrl  = proxyFn(params);
            const upstream   = await axios.get(targetUrl, { timeout: 30000 });
            const responseMs = Date.now() - reqStart;
            let data         = cleanResponse(upstream.data);

            if (Object.keys(rateLimitInfo).length) data.rate_limit = rateLimitInfo;
            if (keyData.note_enabled && keyData.key_note) data.key_note = keyData.key_note;

            Analytics.create({
                api_key      : userKey,
                endpoint,
                status_code  : upstream.status,
                ip_address   : req.ip,
                response_time: responseMs,
                date         : today
            }).catch(() => {});

            res.json(data);
        } catch (err) {
            console.error('Proxy error:', err);
            Analytics.create({
                api_key      : userKey,
                endpoint,
                status_code  : 500,
                ip_address   : req.ip,
                response_time: Date.now() - reqStart,
                date         : today
            }).catch(() => {});
            res.status(500).json({ error: 'Upstream API failed', details: err.message });
        }

    } catch (err) {
        console.error('API handler error:', err);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.use((err, req, res, next) => {
    console.error('Unhandled:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// ─── AUTO-EXPIRE APIS ─────────────────────────────────────────────────────────
async function autoExpireApis() {
    try {
        await AvailableApi.updateMany(
            { expires_at: { $ne: null, $lte: new Date() }, is_active: true },
            { is_active: false }
        );
    } catch (err) {
        console.error('Auto-expire APIs error:', err);
    }
}
autoExpireApis();
setInterval(autoExpireApis, 60 * 1000);

// ─── SERVER + WEBSOCKET ───────────────────────────────────────────────────────
const PORT   = process.env.PORT || 3000;
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/ws/hits' });

function wsBroadcast(payload) {
    const msg = JSON.stringify(payload);
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(msg);
    });
}

setInterval(() => {
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.ping();
    });
}, 25000);

server.listen(PORT, () => console.log(`\n🚀 OSINT API HUB (MongoDB) — PORT ${PORT}`));
module.exports = app;
