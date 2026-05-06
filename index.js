const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const Pino = require('pino');
const qrcode = require('qrcode-terminal');

async function start() {
    const { state, saveCreds } = await useMultiFileAuthState('./baileys_auth');
    const sock = makeWASocket({
        auth: state,
        logger: Pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        version: [2, 3000, 1015901307],
        connectTimeoutMs: 60000
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) {
            console.log('📱 Escanea este QR con WhatsApp:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') {
            console.log('✅ Bot conectado correctamente (nuevo servicio)');
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`⚠️ Conexión cerrada (${statusCode})`);
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(start, 10000);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

start().catch(console.error);