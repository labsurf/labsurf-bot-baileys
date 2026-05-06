const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const Pino = require('pino');
const qrcode = require('qrcode-terminal');

async function start() {
    const { state, saveCreds } = await useMultiFileAuthState('./baileys_auth');
    const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: Pino({ level: 'silent' }),
    // ✨ La línea que soluciona el error 405 ✨
    browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        version: [2, 3000, 1015901307],
        connectTimeoutMs: 30000,
        defaultQueryTimeoutMs: 30000,
        keepAliveIntervalMs: 10000
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) {
            console.log('📱 Escanea este QR con WhatsApp:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') {
            console.log('✅ Bot conectado correctamente');
            // Aquí pondrías tu lógica de procesar mensajes
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
