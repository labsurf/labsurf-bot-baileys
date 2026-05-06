// =========================
// 📦 FLUJOS DE VENTA ESTRUCTURADOS
// =========================

const SALES_FLOWS = {
  // FASE 1: APERTURA Y MENÚ
  opening: {
    hook: (nombre, asesor) => 
      `Hola ${nombre}, soy ${asesor} de Labsurf. Estamos ayudando a personas que sienten que la edad, la digestión o el estrés les está robando energía y claridad. Vi que te interesa el bienestar integral.\n\n` +
      `Tengo tres protocolos que están funcionando muy bien porque atacan la CAUSA, no el síntoma. Dime cuál de estas situaciones se parece más a lo que sientes HOY:\n\n` +
      `1️⃣ 🤢 PROBLEMA DIGESTIVO: Vientre hinchado sin razón, pesadez después de comer, estreñimiento o sospecha de parásitos.\n\n` +
      `2️⃣ 😵‍💫 NIEBLA MENTAL: Te cuesta concentrarte, olvidas dónde dejas las llaves, sientes que tu cerebro va lento o el estrés te come vivo.\n\n` +
      `3️⃣ 🔋 FALTA DE ENERGÍA / ENVEJECIMIENTO: Te levantas cansado, ves líneas de expresión nuevas, te falta esa "chispa" juvenil o duermes mal.\n\n` +
      `👉 Responde 1, 2 o 3 para contarte exactamente cómo solucionarlo de raíz.`
  },

  // FASE 2: DIAGNÓSTICO POR PRODUCTO
  diagnostic: {
    digestivo: {
      pregunta1: `Para ayudarte mejor, necesito hacerte dos preguntas (¿me permites?):\n\n` +
                 `¿Esa inflamación aparece justo después de comer o la tienes constante todo el día?`,
      pregunta2: `¿Has notado antojos de dulce o harinas muy fuertes por las noches?`
    },
    enfoque: {
      pregunta1: `Dime una cosa, ¿Notas que esto te pasa más en las tardes después de almuerzo o cuando estás frente a la computadora intentando terminar un informe importante?`
    },
    energia: {
      pregunta1: `¿Has notado que cuando tenías 25 años te trasnochabas y al otro día estabas nuevo, y ahora un día malo te dura 3 días?`
    }
  },

  // FASE 3: PRESENTACIÓN DE PRODUCTO (usa RAG para datos técnicos)
  presentation: {
    digestivo: (contextoRAG) => 
      `Mira, el problema no es lo que comes, sino lo que tu intestino no logra procesar. Este protocolo ataca por tres frentes:\n\n` +
      `🪱 Nogal Negro + Ajenjo: Antiparasitarios naturales. Van a barrer a esos "inquilinos" que se roban tus nutrientes.\n\n` +
      `🧄 Extracto de Ajo: Potente antimicrobiano. Limpia bacterias dañinas.\n\n` +
      `🍈 Papaína de Papaya: Enzima que descompone proteínas difíciles. Digestión exprés.`,
    
    enfoque: (contextoRAG) =>
      `Aquí tienes la combinación perfecta para quien vive de su cabeza:\n\n` +
      `🧠 Fosfatidilserina: Protege tus neuronas y baja el Cortisol (hormona del estrés).\n\n` +
      `⚡ Huperzina-A: Amplificador de señal neuronal. Como pasar de Internet lento a Fibra Óptica.`,
    
    energia: (contextoRAG) =>
      `Lo que ves aquí es el Dúo Dinámico Antienvejecimiento:\n\n` +
      `🍇 Resveratrol: Antioxidante concentrado. Activa los genes de la longevidad.\n\n` +
      `⚡ Precursores NAD+: Reparación Celular. No es un energizante, es gasolina para tus mitocondrias.`
  },

  // FASE 4: MANEJO DE OBJECIONES
  objections: {
    digestivo: (precio) =>
      `Te entiendo. Pero si una persona gasta S/15 al día en antiácidos y té de hierbas, en una semana gastó S/105. Y siguió inflamada.\n\n` +
      `Aquí en 1 mes solucionas la CAUSA. El frasco dura 1 mes. Es S/3.60 al día para sentir el estómago plano.\n\n` +
      `¿Cuánto vale para ti no sentirte como un globo después de cada comida?`,
    
    enfoque: (precio) =>
      `Apliquemos el método Ben Franklin:\n\n` +
      `✅ Aumenta tu productividad\n` +
      `✅ Recuerdas nombres y datos\n` +
      `✅ Menos de S/4.30 al día\n` +
      `✅ 52% de descuento hoy\n\n` +
      `❌ Invertir S/130 hoy\n\n` +
      `¿Cuál lista pesa más?`,
    
    energia: (precio) =>
      `Hagamos cuentas: 60 cápsulas = 2 meses = S/75 al mes = S/2.50 al día.\n\n` +
      `¿Cuánto pagarías por despertarte con energía real? Esto es más barato que ese café latte que solo te inflama.`
  },

  // FASE 5: CIERRE
  closing: {
    standard: (producto, precio) =>
      `🔥 *¡Perfecto!*\n\n` +
      `📦 ${producto} - S/${precio}\n\n` +
      `📲 *Yape/Plin:* 975455782\n\n` +
      `✅ Envío GRATIS\n\n` +
      `Envía tu comprobante y coordinamos entrega 🚚`,
    
    alternative: 
      `¿Quieres que te llegue mañana en la mañana para empezar cuanto antes o prefieres que lo programemos para el fin de semana?`
  },

  // FASE 6: POST-VENTA
  postSale: {
    digestivo: (nombre, pedido) =>
      `¡Listo ${nombre}! Pedido #${pedido} confirmado ✅.\n\n` +
      `TIP: Toma 2 cápsulas antes de tu comida más pesada. Es normal ir más al baño los primeros 3 días (el cuerpo desechando toxinas).\n\n` +
      `Te escribiré en 3 días para saber cómo va esa pancita. 💪`,
    
    enfoque: (nombre, pedido) =>
      `¡Excelente decisión ${nombre}! Pedido #${pedido} confirmado ✅.\n\n` +
      `TIP: Tómalo con el desayuno. Notarás el efecto al 3er o 4to día. Es una sensación de "calma alerta".`,
    
    energia: (nombre, pedido) =>
      `¡Listo ${nombre}! Pedido #${pedido} confirmado ✅.\n\n` +
      `TIP: Tómalo en ayunas. Es normal sentir un "calor" o energía limpia la primera semana.`
  },

  // FASE 7: CROSS-SELLING
  crossSell: (productoComprado) =>
    `Y hay algo más...\n\n` +
    `Como estás invirtiendo en tu ${productoComprado}, te recuerdo que el cuerpo es un sistema. Muchos clientes combinan y sienten un subidón increíble.\n\n` +
    `Si quieres agregar un segundo producto con envío GRATIS y 10% extra de descuento, solo dime:\n\n` +
    `👉 "AGREGAR DIGESTIVO"\n` +
    `👉 "AGREGAR FOCO"\n` +
    `👉 "AGREGAR NAD"\n\n` +
    `Si no, no hay problema. ¡Tu pedido sale ya mismo!`
};

// =========================
// 🎯 PRECIOS
// =========================
const PRICES = {
  digestivo: { oferta: 110, regular: 214 },
  enfoque: { oferta: 130, regular: 270 },
  energia: { oferta: 150, regular: 278 }
};

// =========================
// 🔄 GESTOR DE ESTADOS DE VENTA
// =========================
class SalesStateManager {
  constructor() {
    this.states = new Map(); // userId -> estado de venta
  }

  // Iniciar flujo de venta
  startFlow(userId, producto) {
    this.states.set(userId, {
      producto,
      step: 'diagnostic_q1',
      startTime: Date.now(),
      answered: false
    });
  }

  // Avanzar paso
  advance(userId) {
    const state = this.states.get(userId);
    if (!state) return null;
    
    const steps = ['diagnostic_q1', 'diagnostic_q2', 'presentation', 'closing', 'post_sale'];
    const currentIndex = steps.indexOf(state.step);
    
    if (currentIndex < steps.length - 1) {
      state.step = steps[currentIndex + 1];
    }
    
    return state;
  }

  // Obtener estado actual
  getState(userId) {
    return this.states.get(userId);
  }

  // Finalizar flujo
  endFlow(userId) {
    this.states.delete(userId);
  }

  // Verificar si está en flujo de venta
  isInSalesFlow(userId) {
    return this.states.has(userId);
  }
}

module.exports = {
  SALES_FLOWS,
  PRICES,
  SalesStateManager
};