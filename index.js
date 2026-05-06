const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

// =========================
// 🔥 IMPORTS LOCALES
// =========================
const { buscarContexto, initRAG, isReady, getStats } = require('./rag/data/llama');
const { detectarProducto, PRODUCTOS } = require('./rag/data/embeddings');
const { SALES_FLOWS, PRICES, SalesStateManager } = require('./sales-flows');

// =========================
// ⚙️ CONFIG
// =========================
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxFXdw2C2fX4QAMGOPGPrYw-7VDKz6A6tf40aR9DDol3COWdFVPInSP6fH4W8acj261hQ/exec';
const WEB_URL = 'https://labsurf.github.io/vitaminas/';

// Groq setup
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY});
const GROQ_MODEL = 'llama-3.1-8b-instant';

// =========================
// 📁 LOGS
// =========================
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logConversacion(numero, nombre, producto, estado, origen, textoUsuario, textoBot) {
  try {
    const ahora = new Date();
    const fechaArchivo = ahora.toISOString().split('T')[0];
    const hora = ahora.toTimeString().split(' ')[0];
    const filePath = path.join(LOG_DIR, `${fechaArchivo}.md`);

    const entrada = `
## [${hora}] Usuario: ${numero} (${nombre})
- Producto: ${producto}
- Estado: ${estado}
- Origen: ${origen}

**Usuario:** ${textoUsuario}
**Bot:** ${textoBot}

---
`;
    fs.appendFileSync(filePath, entrada, 'utf8');
  } catch (err) {
    console.error('⚠️ Error al guardar log:', err.message);
  }
}

// =========================
// 🧠 ESTADOS
// =========================
const STATES = {
  INIT: 'init',
  MENU: 'menu',
  CHAT: 'chat',
  CIERRE: 'cierre'
};

const userState = {};
const processingUsers = new Set();
const salesManager = new SalesStateManager();

// =========================
// 📣 DETECCIÓN DE CAMPAÑAS
// =========================
const CAMPAIGN_KEYWORDS = {
  'DIGESTIVO_FB': { producto: 'digestivo', origen: 'Facebook' },
  'ENFOQUE_FB': { producto: 'enfoque', origen: 'Facebook' },
  'ENERGIA_FB': { producto: 'energia', origen: 'Facebook' },
  'DIGESTIVO_TK': { producto: 'digestivo', origen: 'TikTok' },
  'ENFOQUE_TK': { producto: 'enfoque', origen: 'TikTok' },
  'ENERGIA_TK': { producto: 'energia', origen: 'TikTok' },
  'DIGESTIVO_IG': { producto: 'digestivo', origen: 'Instagram' },
  'ENFOQUE_IG': { producto: 'enfoque', origen: 'Instagram' },
  'ENERGIA_IG': { producto: 'energia', origen: 'Instagram' },
};

// =========================
// 🛡️ CIRCUIT BREAKER
// =========================
const circuitBreaker = {
  failures: 0,
  lastFail: 0,
  state: 'CLOSED',
  
  async call(fn, fallback) {
    const now = Date.now();
    
    if (this.state === 'OPEN') {
      if (now - this.lastFail > 30000) {
        this.state = 'HALF_OPEN';
        console.log('  🔄 Circuito: probando recuperación...');
      } else {
        console.log('  ⚠️ Circuito abierto → usando fallback');
        return fallback();
      }
    }
    
    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failures = 0;
        console.log('  ✅ Circuito cerrado');
      }
      return result;
    } catch (err) {
      this.failures++;
      this.lastFail = now;
      if (this.failures >= 3) {
        this.state = 'OPEN';
        console.log('  🔴 Circuito abierto (3 fallos)');
      }
      return fallback();
    }
  }
};

// =========================
// 🔥 PRELOAD RAG
// =========================
(async () => {
  console.log('🔥 Iniciando sistema...');
  const t0 = Date.now();
  await initRAG();
  console.log(`✅ Sistema listo en ${Date.now() - t0}ms`);
  console.log('📊 Stats RAG:', getStats());
  console.log('');
})();

function getTexto(message) {
  return (message.body || message.content || message.caption || '').toLowerCase().trim();
}

function detectarCampana(texto) {
  const textoUpper = texto.toUpperCase().trim();
  for (const [keyword, data] of Object.entries(CAMPAIGN_KEYWORDS)) {
    if (textoUpper === keyword || textoUpper.startsWith(keyword)) {
      return data;
    }
  }
  return null;
}

async function evaluarSituacionConIA(contexto) {
  const prompt = `Eres un vendedor profesional. Responde UNA SOLA PALABRA:

- AVANZAR
- EXPLICAR
- COMPRA
- PRECIO
- OBJECION
- INFORMACION

Situación:
${contexto}

Decisión:`;

  const t0 = Date.now();
  console.log(`🧠 Evaluando situación con IA...`);

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "Eres un vendedor profesional. Responde con UNA SOLA PALABRA." },
        { role: "user", content: prompt }
      ],
      model: GROQ_MODEL,
      temperature: 0.0,
      max_tokens: 10
    });
    
    const decision = completion.choices[0]?.message?.content?.trim().toUpperCase() || 'AVANZAR';
    console.log(`✅ IA decidió en ${Date.now() - t0}ms: ${decision}`);
    return decision;
  } catch (err) {
    console.log(`  ⚠️ Error evaluando situación: ${err.message}`);
    return 'AVANZAR';
  }
}

async function generarPreguntaSeguimiento(producto, paso, respuestaUsuario, resp1, resp2) {
  const descripcionProducto = {
    energia: 'NAD+ y Resveratrol - suplemento para energía celular, antienvejecimiento y vitalidad',
    enfoque: 'Fosfatidilserina y Huperzina-A - suplemento para concentración, memoria y enfoque mental',
    digestivo: 'Intestinal Cleanse - suplemento para limpieza intestinal, digestión y desinflamación'
  };

  const prompt = `Eres un vendedor de suplementos naturales de Labsurf.
Estás vendiendo: ${descripcionProducto[producto] || 'suplementos para la salud'}

El usuario dio una respuesta vaga o negativa a tu pregunta de diagnóstico.
Genera UNA pregunta corta, natural y empática.

Producto: ${producto}
Paso actual: ${paso}
Respuesta del usuario: "${respuestaUsuario}"
Respuestas anteriores: Q1="${resp1 || 'ninguna'}", Q2="${resp2 || 'ninguna'}"

Pregunta:`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "Eres un vendedor empático de suplementos naturales. Genera preguntas cortas y naturales." },
        { role: "user", content: prompt }
      ],
      model: GROQ_MODEL,
      temperature: 0.3,
      max_tokens: 50
    });
    
    let pregunta = completion.choices[0]?.message?.content?.trim() || '';
    pregunta = pregunta.replace(/^["']|["']$/g, '');
    
    console.log(`  ❓ Pregunta generada: "${pregunta}"`);
    return pregunta;
  } catch (err) {
    console.log(`  ⚠️ Error generando pregunta: ${err.message}`);
    return `Cuéntame un poco más sobre qué es lo que sí sientes o te preocupa. Así puedo recomendarte mejor.`;
  }
}

async function generarRespuestaCompleta(producto, historialUsuario) {
  const presentacion = SALES_FLOWS.presentation[producto]();
  const precio = PRICES[producto].oferta;
  const precioRegular = PRICES[producto].regular;

  const prompt = `Eres un vendedor de suplementos de Labsurf. Tienes el siguiente historial con el usuario:

${historialUsuario}

Información del producto:
${presentacion}

Precio oferta: S/${precio} (Regular S/${precioRegular})
Envío: GRATIS

Genera un mensaje de WhatsApp que incluya:
1. Empatía basada en lo que el usuario dijo (1-2 líneas)
2. La información del producto más relevante para su caso
3. El precio con envío gratis
4. Pregunta: "¿Te gustaría probarlo? Responde SI"

Sé natural, cálido y directo.
No incluyas el enlace de la web, ya se agregará después.

Mensaje:`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "Eres un vendedor cálido y empático de suplementos naturales. Responde en español." },
        { role: "user", content: prompt }
      ],
      model: GROQ_MODEL,
      temperature: 0.3,
      max_tokens: 200
    });
    
    return completion.choices[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.log(`  ⚠️ Error generando respuesta completa: ${err.message}`);
    return `Basado en lo que me cuentas, el suplemento de ${producto} puede ayudarte:\n\n` +
      `${presentacion}\n\n` +
      `💰 *Inversión:* S/${precio} (Regular S/${precioRegular})\n` +
      `📦 Envío GRATIS incluido\n\n` +
      `¿Te gustaría probarlo? Responde *SI*`;
  }
}

async function generarRespuestaIA(mensaje, contexto, producto) {
  const t0 = Date.now();
  console.log('\n' + '='.repeat(60));
  console.log('🤖 GENERANDO RESPUESTA IA');
  console.log('='.repeat(60));
  console.log(`📥 Mensaje: "${mensaje}"`);
  console.log(`📦 Producto: ${producto}`);
  
  const contextoRaw = contexto || '';
  if (!contextoRaw) return 'No tengo ese dato.';

  const contextoLimpio = contextoRaw
    .replace(/https?:\/\/\S+/g, '')
    .replace(/GET IN TOUCH|FOLLOW|Message|SEND|Name|Email/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  console.log(`📄 Contexto limpio (${contextoLimpio.length} caracteres):`);
  console.log(`   "${contextoLimpio}"`);

  const prompt = `Contexto:
${contextoLimpio}

Pregunta: ${mensaje}

Responde de manera concisa y específica basándote exclusivamente en el contexto. Máximo 20 palabras.`;

  console.log(`📝 Prompt: ${prompt.length} caracteres`);
  
  return circuitBreaker.call(
    async () => {
      const tGroq = Date.now();
      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: "Eres un asistente útil. Responde de forma concisa y basada solo en el contexto proporcionado." },
          { role: "user", content: prompt }
        ],
        model: GROQ_MODEL,
        temperature: 0.1,
        max_tokens: 60
      });
      
      console.log(`✅ Groq respondió en ${Date.now() - tGroq}ms`);
      
      let respuesta = completion.choices[0]?.message?.content?.trim() || 'No tengo ese dato.';
      respuesta = respuesta.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      
      if (respuesta.length > 150) respuesta = respuesta.substring(0, 147) + '...';
      
      console.log(`💬 Final: "${respuesta}"`);
      console.log('='.repeat(60) + '\n');
      return respuesta || 'No tengo ese dato.';
    },
    () => 'No tengo ese dato.'
  );
}

async function guardarLead(message, producto, estado, origen = '') {
  let numeroReal = '';

  if (message.from && message.from.match(/^\d+@c\.us$/)) {
    numeroReal = message.from;
  } else if (message.sender && message.sender.formattedName) {
    const posibleNumero = message.sender.formattedName.replace(/[\s\(\)\-]/g, '');
    if (/^\+\d+$/.test(posibleNumero)) {
      numeroReal = posibleNumero.replace(/^\+/, '') + '@c.us';
    } else {
      numeroReal = message.from;
    }
  } else {
    numeroReal = message.from;
  }

  if (!origen && message.from && message.from.includes('@lid')) {
    origen = 'Facebook';
  }

  console.log(`  📱 Número real extraído: ${numeroReal}`);
  console.log(`  🌐 Origen: ${origen || 'WhatsApp'}`);

  try {
    await axios.post(GOOGLE_SCRIPT_URL, {
      numero: numeroReal,
      nombre: message.sender?.pushname || 'Sin nombre',
      producto,
      estado,
      origen: origen || '',
      timestamp: new Date().toISOString()
    }, { timeout: 10000 });
    console.log(`  ✅ Lead: ${estado} | ${producto || 'N/A'} | Origen: ${origen || 'WhatsApp'}`);
  } catch (err) {
    console.log(`  ⚠️ Error guardando lead: ${err.message}`);
  }
}

async function enviarCampana(client) {
  console.log('\n📢 Iniciando campaña...');
  const t0 = Date.now();
  try {
    const res = await axios.get(GOOGLE_SCRIPT_URL, { timeout: 10000 });
    const leads = res.data || [];
    const pendientes = leads.filter(l => l.estado === 'interesado' && l.campana !== 'enviado' && l.numero);
    if (pendientes.length === 0) {
      console.log(`  ℹ️ Sin leads pendientes (${Date.now() - t0}ms)`);
      return;
    }
    console.log(`  📊 ${pendientes.length} leads pendientes`);
    for (let i = 0; i < pendientes.length; i++) {
      const lead = pendientes[i];
      try {
        await client.sendMessage(lead.numero, 
          `🔥 *OFERTA ESPECIAL*\n\n` +
          `Mejora tu bienestar 💪\n\n` +
          `🔗 ${WEB_URL}\n\n` +
          `Responde *SI* para más info`
        );
        axios.post(GOOGLE_SCRIPT_URL, { action: 'marcar', fila: lead.fila }).catch(() => {});
        console.log(`  ✅ Enviado a ${lead.numero}`);
        if (i < pendientes.length - 1) await new Promise(r => setTimeout(r, 3000));
      } catch (err) {
        console.error(`  ❌ Error ${lead.numero}:`, err.message);
      }
    }
    console.log(`✅ Campaña completada en ${Date.now() - t0}ms\n`);
  } catch (err) {
    console.error(`⚠️ Error campaña (${Date.now() - t0}ms):`, err.message);
  }
}

async function procesarMensaje(client, message) {
  const t0 = Date.now();
  const user = message.from;
  if (message.isGroupMsg) return;
  
  const texto = getTexto(message);
  if (!texto) return;
  
  console.log('\n' + '🔹'.repeat(30));
  console.log(`📩 [${user}] "${texto}"`);
  console.log('🔹'.repeat(30));
  
  if (!userState[user]) {
    userState[user] = { step: STATES.INIT, producto: null, consultas: 0, lastActivity: t0 };
  }
  const state = userState[user];
  state.consultas++;
  state.lastActivity = t0;
  
  console.log(`📊 Estado: step=${state.step}, producto=${state.producto || 'none'}, consultas=${state.consultas}`);

  const enviarRespuesta = async (respuesta) => {
    await client.sendMessage(user, respuesta);
    const origenLog = message.from?.includes('@lid') ? 'Facebook' : 'WhatsApp';
    logConversacion(
      user,
      message.sender?.pushname || 'Sin nombre',
      state.producto || 'N/A',
      state.step,
      origenLog,
      texto,
      respuesta
    );
  };

  const campana = detectarCampana(texto);
  
  if (campana && (state.step === STATES.INIT || state.step === STATES.MENU)) {
    console.log(`📣 Campaña detectada: ${campana.origen} → ${campana.producto}`);
    
    state.step = STATES.CHAT;
    state.producto = campana.producto;
    salesManager.startFlow(user, campana.producto);
    
    await enviarRespuesta(
      `¡Hola! 👋 Gracias por tu interés en LABSURF y nuestro suplemento de *${campana.producto}*.\n\n` +
      `Déjame contarte exactamente cómo solucionarlo de raíz.\n\n` +
      SALES_FLOWS.diagnostic[campana.producto]?.pregunta1
    );
    
    guardarLead(message, campana.producto, 'interesado', campana.origen);
    return;
  }
  
  if (salesManager.isInSalesFlow(user)) {
    const salesState = salesManager.getState(user);
    const producto = salesState.producto;
    
    console.log(`📊 Flujo de ventas: step=${salesState.step}, producto=${producto}`);
    
    const reencaminarVenta = async () => {
      const precio = PRICES[producto].oferta;
      const mensaje = `💰 *Inversión:* S/${precio} con envío GRATIS\n\n` +
        `¿Te animas a probar el suplemento de ${producto}? Responde *SI* para asegurar tu pedido, o dime qué duda tienes.\n` +
        `🔗 ${WEB_URL}`;
      console.log(`📤 Re-encaminando: "${mensaje.substring(0, 80)}..."`);
      await enviarRespuesta(mensaje);
    };
    
    const responderConRAG = async (pregunta) => {
      console.log(`  💭 Consultando RAG para: "${pregunta}"`);
      await client.sendMessage(user, '💭 Consultando...');
      let contexto = null;
      if (isReady()) {
        try {
          contexto = await Promise.race([
            buscarContexto(pregunta, producto),
            new Promise(resolve => setTimeout(() => resolve(null), 8000))
          ]);
        } catch (err) {
          console.log(`  ⚠️ Error RAG: ${err.message}`);
        }
      }
      const reply = await generarRespuestaIA(pregunta, contexto, producto);
      console.log(`  📤 Respuesta RAG: "${reply}"`);
      await enviarRespuesta(reply);
    };
    
    if (texto === 'hola' || texto === 'hola!' || texto === 'hola.' || texto.includes('reiniciar') || texto.includes('menu')) {
      salesManager.endFlow(user);
      state.step = STATES.MENU;
      state.producto = null;
      const nombre = message.sender?.pushname || '';
      const asesor = 'Luis';
      const menu = SALES_FLOWS.opening.hook(nombre, asesor) + `\n\n🔗 ${WEB_URL}`;
      console.log(`  🔄 Reiniciando flujo...`);
      await enviarRespuesta(menu);
      return;
    }
    
    if ((texto === 'no' || texto.includes('no quiero') || texto.includes('no me interesa')) && 
        (salesState.rechazos || 0) >= 2) {
      const mensajeRechazo = `Entiendo. Si cambias de opinión, aquí estoy para ayudarte.\n\n` +
        `Escribe *hola* para ver otras opciones.\n` +
        `🔗 ${WEB_URL}`;
      console.log(`  👋 Saliendo del flujo por rechazos acumulados`);
      await enviarRespuesta(mensajeRechazo);
      salesManager.endFlow(user);
      state.step = STATES.MENU;
      state.producto = null;
      return;
    }
    
    if (texto === 'no') salesState.rechazos = (salesState.rechazos || 0) + 1;
    
    const contextoIA = `
Producto: ${producto}
Paso actual: ${salesState.step}
Pregunta que se le hizo: ${salesState.step === 'diagnostic_q1' ? SALES_FLOWS.diagnostic[producto]?.pregunta1 : salesState.step === 'diagnostic_q2' ? SALES_FLOWS.diagnostic[producto]?.pregunta2 : 'presentación del producto'}
Respuesta del usuario: "${texto}"
Respuestas anteriores: Q1="${salesState.respuesta1 || 'ninguna'}", Q2="${salesState.respuesta2 || 'ninguna'}"
`;

    let decisionIA = await evaluarSituacionConIA(contextoIA);
    console.log(`🧠 Decisión IA: ${decisionIA}`);
    
    if (decisionIA === 'EXPLICAR') {
      salesState.contadorExplicar = (salesState.contadorExplicar || 0) + 1;
      console.log(`  📊 Contador EXPLICAR: ${salesState.contadorExplicar}/2`);
      if (salesState.contadorExplicar >= 2) {
        console.log(`  ⚠️ Límite de EXPLICAR alcanzado → generando respuesta completa`);
        await client.sendMessage(user, '💭 Preparando información...');
        const historial = `Q1: ${salesState.respuesta1 || 'ninguna'}, Q2: ${salesState.respuesta2 || 'ninguna'}, Última respuesta: "${texto}"`;
        const respuestaCompleta = await generarRespuestaCompleta(producto, historial);
        const finalMsg = `${respuestaCompleta}\n🔗 ${WEB_URL}`;
        console.log(`📤 Respuesta completa: "${finalMsg.substring(0, 100)}..."`);
        await enviarRespuesta(finalMsg);
        salesState.step = 'presentation';
        return;
      }
    } else {
      salesState.contadorExplicar = 0;
    }
    
    switch (decisionIA) {
      case 'AVANZAR':
        if (salesState.step === 'diagnostic_q1') {
          if (salesState._huboExplicar) {
            console.log(`  💭 Ya hubo repregunta - generando respuesta completa...`);
            await client.sendMessage(user, '💭 Preparando información...');
            salesState.respuesta1 = salesState.respuesta1 || texto;
            const historial = `Q1: ${salesState.respuesta1}, Respuesta a repregunta: "${texto}"`;
            const respuestaCompleta = await generarRespuestaCompleta(producto, historial);
            const finalMsg = `${respuestaCompleta}\n🔗 ${WEB_URL}`;
            console.log(`📤 Respuesta completa: "${finalMsg.substring(0, 100)}..."`);
            await enviarRespuesta(finalMsg);
            salesState.step = 'presentation';
            salesState._huboExplicar = false;
            return;
          }
          
          salesState.respuesta1 = texto;
          salesState.step = 'diagnostic_q2';
          const q2 = SALES_FLOWS.diagnostic[producto]?.pregunta2 || `Gracias. ¿Hay algo más específico que quieras saber?`;
          console.log(`  ➡️ Avanzando a diagnostic_q2: "${q2}"`);
          await enviarRespuesta(q2);
        } else if (salesState.step === 'diagnostic_q2') {
          salesState.respuesta2 = texto;
          salesState.step = 'presentation';
          
          console.log(`  💭 Generando presentación personalizada...`);
          await client.sendMessage(user, '💭 Preparando información...');
          
          const historial = `Q1: ${salesState.respuesta1}, Q2: ${salesState.respuesta2}`;
          const respuestaCompleta = await generarRespuestaCompleta(producto, historial);
          const finalMsg = `${respuestaCompleta}\n🔗 ${WEB_URL}`;
          
          console.log(`📤 Respuesta completa: "${finalMsg.substring(0, 100)}..."`);
          await enviarRespuesta(finalMsg);
        } else {
          await reencaminarVenta();
        }
        return;
        
      case 'EXPLICAR':
        console.log(`  💬 La IA decidió EXPLICAR - generando pregunta de seguimiento...`);
        await client.sendMessage(user, '💭 Pensando...');
        salesState._huboExplicar = true;
        
        const preguntaSeguimiento = await generarPreguntaSeguimiento(
          producto, 
          salesState.step, 
          texto, 
          salesState.respuesta1, 
          salesState.respuesta2
        );
        
        console.log(`  ❓ Pregunta de seguimiento: "${preguntaSeguimiento}"`);
        await enviarRespuesta(preguntaSeguimiento);
        return;
        
      case 'COMPRA':
        salesState.step = 'closing';
        const precioFinalCompra = PRICES[producto].oferta;
        const closingMsgCompra = SALES_FLOWS.closing.standard(producto, precioFinalCompra);
        const alternativeMsgCompra = SALES_FLOWS.closing.alternative;
        console.log(`  🔥 IA detectó COMPRA - yendo a cierre`);
        await enviarRespuesta(`${closingMsgCompra}\n🔗 ${WEB_URL}`);
        await client.sendMessage(user, alternativeMsgCompra);
        logConversacion(user, message.sender?.pushname || '', producto, 'closing', 'WhatsApp', texto, alternativeMsgCompra);
        return;
        
      case 'PRECIO':
        const mensajePrecio = `💰 El precio es S/${PRICES[producto].oferta} con envío GRATIS.\n🔗 ${WEB_URL}`;
        console.log(`📤 Respuesta: "${mensajePrecio}"`);
        await enviarRespuesta(mensajePrecio);
        await reencaminarVenta();
        return;
        
      case 'OBJECION':
        const obj = SALES_FLOWS.objections[producto](PRICES[producto].oferta);
        console.log(`  💡 IA detectó OBJECIÓN - respondiendo`);
        await enviarRespuesta(`${obj}\n🔗 ${WEB_URL}`);
        await client.sendMessage(user, '¿Qué opinas? Responde *SI* para continuar.');
        logConversacion(user, message.sender?.pushname || '', producto, 'objecion', 'WhatsApp', texto, '¿Qué opinas? Responde *SI* para continuar.');
        return;
        
      case 'INFORMACION':
      default:
        console.log(`  📋 IA detectó INFORMACION - usando RAG`);
        await responderConRAG(texto);
        await reencaminarVenta();
        return;
    }
  }
  
  if (texto === 'hola' || texto === 'hola!' || texto === 'hola.' || texto.includes('reiniciar')) {
    state.step = STATES.MENU;
    state.producto = null;
    salesManager.endFlow(user);
    
    const nombre = message.sender?.pushname || '';
    const asesor = 'Luis';
    const menu = SALES_FLOWS.opening.hook(nombre, asesor) + `\n\n🔗 ${WEB_URL}`;
    
    console.log(`  ✅ Menú enviado`);
    await enviarRespuesta(menu);
    console.log(`  ⏱ Tiempo total: ${Date.now() - t0}ms`);
    guardarLead(message, 'N/A', 'interesado');
    return;
  }
  
  if (!state.producto && state.step !== STATES.MENU && state.step !== STATES.INIT) {
    console.log('🔍 Detectando producto...');
    const tDetect = Date.now();
    try {
      const detectado = await Promise.race([
        detectarProducto(texto),
        new Promise(resolve => setTimeout(() => resolve(null), 3000))
      ]);
      if (detectado) {
        state.producto = detectado;
        state.step = STATES.CHAT;
        console.log(`  🎯 Detectado: ${detectado} en ${Date.now() - tDetect}ms`);
        const msgDeteccion = `✅ Perfecto! Te interesa: *${detectado}*\n\n¿Qué deseas saber?\n🔗 ${WEB_URL}`;
        console.log(`  📤 "${msgDeteccion}"`);
        await enviarRespuesta(msgDeteccion);
        guardarLead(message, detectado, 'interesado');
        return;
      }
    } catch (err) {
      console.log(`  ⚠️ Error detección: ${err.message}`);
    }
  }
  
  if (state.step === STATES.MENU) {
    if (texto === '1') state.producto = 'digestivo';
    else if (texto === '2') state.producto = 'enfoque';
    else if (texto === '3') state.producto = 'energia';
    
    if (state.producto) {
      state.step = STATES.CHAT;
      console.log(`  📦 Producto seleccionado: ${state.producto}`);
      
      const diagMsg = `Perfecto 👌 has elegido *${state.producto}*\n\n` +
        `Déjame contarte exactamente cómo solucionarlo de raíz.\n\n` +
        SALES_FLOWS.diagnostic[state.producto]?.pregunta1;
      console.log(`  📤 Iniciando diagnóstico: "${diagMsg.substring(0, 80)}..."`);
      await enviarRespuesta(diagMsg);
      
      salesManager.startFlow(user, state.producto);
      guardarLead(message, state.producto, 'interesado');
      return;
    }
    
    console.log(`  🤔 MENU: "${texto}" → consultando IA...`);
    await client.sendMessage(user, '💭 Consultando...');
    
    const promptMenu = `Eres un vendedor de LABSURF. El usuario está en el menú principal y preguntó: "${texto}"

Productos disponibles:
1️⃣ Digestivo (S/110) - Hinchazón, digestión lenta, parásitos
2️⃣ Enfoque (S/130) - Concentración, memoria, claridad mental
3️⃣ Energía (S/150) - Fatiga, envejecimiento, vitalidad

Tu tarea:
1. Responde la pregunta del usuario de forma breve y útil
2. Al final, invítalo a elegir uno de los 3 productos mencionando las opciones 1, 2, 3

Responde en máximo 3 líneas. Sé natural y cálido.`;

    try {
      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: "Eres un vendedor de suplementos. Responde en máximo 3 líneas." },
          { role: "user", content: promptMenu }
        ],
        model: GROQ_MODEL,
        temperature: 0.3,
        max_tokens: 100
      });
      
      const respuestaMenu = completion.choices[0]?.message?.content?.trim() || '';
      console.log(`  📤 Respuesta IA: "${respuestaMenu}"`);
      await enviarRespuesta(respuestaMenu);
      
    } catch (err) {
      const fallbackMenu = `Gracias por tu interés. Elige una opción:\n\n` +
        `1️⃣ Digestivo\n` +
        `2️⃣ Enfoque\n` +
        `3️⃣ Energía`;
      await enviarRespuesta(fallbackMenu);
    }
    
    return;
  }
  
  if (state.step === STATES.CHAT) {
    console.log('➡️ CHAT');
    const palabras = texto.split(/[\s,.;!?]+/);
    const esConfirmacion = palabras.includes('si') || palabras.includes('sí') || texto === 'si';
    const esNegacion = (palabras.includes('no') || texto === 'no') && texto.length < 10;
    
    if (esConfirmacion || texto.includes('comprar') || texto.includes('compro')) {
      state.step = STATES.CIERRE;
      const precioFinal = PRICES[state.producto]?.oferta || PRICES.energia.oferta;
      const cierreMsg = `🔥 *¡Perfecto!*\n\n` +
        `📲 *Yape:* 975455782\n` +
        `💳 *Plin:* 975455782\n\n` +
        `💰 Inversión: S/${precioFinal}\n` +
        `Envía tu comprobante y coordinamos entrega 🚚\n` +
        `🔗 ${WEB_URL}`;
      console.log(`  ✅ Cierre enviado`);
      await enviarRespuesta(cierreMsg);
      guardarLead(message, state.producto, 'cliente');
      return;
    }
    
    if (esNegacion) {
      guardarLead(message, state.producto, 'no_interesado');
      console.log(`  ✅ Rechazo registrado`);
      const rechazoMsg = 'Ok 👍 ¿Quieres ver otro producto? Escribe *hola* para reiniciar';
      await enviarRespuesta(rechazoMsg);
      return;
    }
    
    console.log(`  💭 Consultando RAG...`);
    await client.sendMessage(user, '💭 Consultando...');
    let contexto = null;
    if (isReady()) {
      try {
        contexto = await Promise.race([
          buscarContexto(texto, state.producto),
          new Promise(resolve => setTimeout(() => resolve(null), 8000))
        ]);
      } catch (err) {
        console.log(`  ⚠️ Error RAG: ${err.message}`);
      }
    }
    const reply = await generarRespuestaIA(texto, contexto, state.producto);
    const respuestaFinal = `${reply}\n\n🔗 ${WEB_URL}\n👉 ¿Deseas comprar ahora? Responde *SI*`;
    console.log(`📤 Respuesta final: "${respuestaFinal.substring(0, 100)}..."`);
    await enviarRespuesta(respuestaFinal);
    console.log(`  ⏱ Tiempo total: ${Date.now() - t0}ms`);
    return;
  }
  
  if (state.step === STATES.CIERRE) {
    console.log('➡️ CIERRE (pero puede preguntar)');
    if (texto === 'hola') {
      state.step = STATES.MENU;
      state.producto = null;
      salesManager.endFlow(user);
      
      const nombre = message.sender?.pushname || '';
      const asesor = 'Luis';
      const menu = SALES_FLOWS.opening.hook(nombre, asesor) + `\n\n🔗 ${WEB_URL}`;
      
      await enviarRespuesta(menu);
      return;
    }
    if (texto.includes('info') || texto.includes('beneficio') || texto.includes('sirve') ||
        texto.includes('precio') || texto.includes('costo')) {
      state.step = STATES.CHAT;
      console.log('  🔄 Volviendo a CHAT para procesar pregunta');
      return procesarMensaje(client, message);
    }
    const cierreMsg = `💬 ¿Tienes dudas sobre el pago o envío?\n` +
      `Escríbenos al WhatsApp: +51 975 455 782\n\n` +
      `Escribe *hola* para ver más productos\n` +
      `🔗 ${WEB_URL}`;
    await enviarRespuesta(cierreMsg);
    return;
  }
  
  if (state.step === STATES.INIT) {
    state.step = STATES.MENU;
    
    const nombre = message.sender?.pushname || '';
    const asesor = 'Luis';
    const menu = SALES_FLOWS.opening.hook(nombre, asesor) + `\n\n🔗 ${WEB_URL}`;
    
    console.log(`  👋 Primer contacto - mostrando menú`);
    await enviarRespuesta(menu);
    guardarLead(message, 'N/A', 'interesado');
    return;
  }
  
  console.log('🔹'.repeat(30) + '\n');
}

// =========================
// 🚀 INICIAR BOT CON WHATSAPP-WEB.JS
// =========================
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "labsurf-bot",
        dataPath: "./tokens"
    }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ],
        headless: true
    }
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('📱 Escanea el código QR con WhatsApp desde tu celular:');
    console.log('   Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo');
});

client.on('ready', () => {
    console.log('\n✅ Bot conectado a WhatsApp correctamente');
    console.log('💓 Esperando mensajes...\n');
    console.log('📬 El bot está listo para recibir y responder mensajes');
});

client.on('message', async (message) => {
    console.log(`📨 Mensaje recibido de: ${message.from}`);
    console.log(`📝 Contenido: "${message.body}"`);
    
    if (message.fromMe) {
        console.log(`  ⏩ Ignorando mensaje propio`);
        return;
    }
    if (message.isGroupMsg) {
        console.log(`  ⏩ Ignorando mensaje de grupo`);
        return;
    }
    
    const user = message.from;
    const numeroLimpio = user.replace('@c.us', '');
    
    const messageSimulado = {
        from: user,
        body: message.body,
        sender: {
            pushname: message._data?.notifyName || message._data?.pushname || 'Usuario'
        },
        isGroupMsg: false,
        fromMe: false
    };
    
    if (processingUsers.has(numeroLimpio)) {
        console.log(`⚠️ [${numeroLimpio}] Ya está procesando...`);
        return;
    }
    
    processingUsers.add(numeroLimpio);
    try {
        console.log(`🤖 Procesando mensaje de ${numeroLimpio}...`);
        await procesarMensaje(client, messageSimulado);
    } catch (err) {
        console.error('❌ Error general:', err.message);
        console.error(err.stack);
        await client.sendMessage(user, '❌ Ocurrió un error. Intenta de nuevo.');
    } finally {
        processingUsers.delete(numeroLimpio);
    }
});

client.on('auth_failure', (msg) => {
    console.error('❌ Error de autenticación:', msg);
});

client.on('disconnected', (reason) => {
    console.log('⚠️ Cliente desconectado:', reason);
});

client.initialize();

// Mantener el proceso vivo
setInterval(() => {
    console.log('💓 Heartbeat - Bot activo');
}, 60000);

process.on('SIGINT', () => {
  console.log('\n👋 Cerrando bot...');
  process.exit(0);
});