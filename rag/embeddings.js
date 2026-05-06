const axios = require('axios');

// =========================
// CONFIGURACIÓN PARA HUGGING FACE
// =========================
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
const HUGGINGFACE_URL = 'https://api-inference.huggingface.co/pipeline/feature-extraction/' + EMBEDDING_MODEL;

// =========================
// 📦 PRODUCTOS (ÚNICA FUENTE DE VERDAD)
// =========================
const PRODUCTOS = {
  energia: {
    keywords: 'energia celular NAD fatiga vitalidad rendimiento fisico',
    descripcion: 'Energía y vitalidad'
  },
  enfoque: {
    keywords: 'memoria concentracion enfoque mental claridad cerebro',
    descripcion: 'Enfoque mental'
  },
  digestivo: {
    keywords: 'digestión intestino limpieza parasitos inflamacion estomacal',
    descripcion: 'Salud digestiva'
  }
};

// Cache global
const cacheEmbeddings = new Map();
let initialized = false;

// =========================
// 🔥 OBTENER EMBEDDING (con caché y timeout aumentado)
// =========================
async function getEmbedding(texto) {
  // Verificar caché primero
  const key = texto.substring(0, 100);
  if (cacheEmbeddings.has(key)) {
    return cacheEmbeddings.get(key);
  }

  // Si no hay API key, usar fallback
  if (!HUGGINGFACE_API_KEY || HUGGINGFACE_API_KEY === 'tu_api_key_de_huggingface') {
    console.log('⚠️ HUGGINGFACE_API_KEY no configurada, usando embedding fallback');
    const fallback = new Array(384).fill(0).map(() => Math.random() * 0.1);
    cacheEmbeddings.set(key, fallback);
    return fallback;
  }

  try {
    const res = await axios.post(HUGGINGFACE_URL, 
      { inputs: texto },
      {
        headers: {
          'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    let embedding = res.data;
    
    // Si la respuesta es un array de arrays, tomar el primero
    if (Array.isArray(embedding) && embedding.length > 0 && Array.isArray(embedding[0])) {
      embedding = embedding[0];
    }
    
    // Verificar que el embedding sea válido
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Embedding inválido');
    }
    
    cacheEmbeddings.set(key, embedding);
    return embedding;
    
  } catch (err) {
    console.error('❌ Error embedding Hugging Face:', err.message);
    
    // 🔥 Fallback: embedding de emergencia
    console.log('⚠️ Usando embedding fallback');
    const fallback = new Array(384).fill(0).map(() => Math.random() * 0.1);
    cacheEmbeddings.set(key, fallback);
    return fallback;
  }
}

// =========================
// 🔥 SIMILITUD COSENO
// =========================
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  
  const similarity = dot / (Math.sqrt(magA) * Math.sqrt(magB));
  return isNaN(similarity) ? 0 : similarity;
}

// =========================
// 🔥 INICIALIZAR PRODUCTOS (más robusto)
// =========================
async function inicializarProductos() {
  if (initialized) return;

  console.log('🔄 Inicializando embeddings de productos...');
  
  for (const [key, data] of Object.entries(PRODUCTOS)) {
    if (!cacheEmbeddings.has(`producto_${key}`)) {
      try {
        const emb = await getEmbedding(data.keywords);
        cacheEmbeddings.set(`producto_${key}`, emb);
        console.log(`  ✅ ${key} listo`);
      } catch (err) {
        console.error(`  ❌ Error ${key}:`, err.message);
      }
    }
  }
  
  initialized = true;
  console.log('✅ Productos inicializados');
}

// =========================
// 🔥 DETECTAR PRODUCTO (ÚNICO MÉTODO)
// =========================
async function detectarProducto(texto, umbral = 0.60) {
  await inicializarProductos();

  try {
    const embQuery = await getEmbedding(texto);
    
    let mejorProducto = null;
    let mejorScore = 0;

    for (const [key] of Object.entries(PRODUCTOS)) {
      const embProducto = cacheEmbeddings.get(`producto_${key}`);
      if (!embProducto) continue;
      
      const score = cosineSimilarity(embQuery, embProducto);
      
      console.log(`  📊 ${key}: ${score.toFixed(3)}`);
      
      if (score > mejorScore) {
        mejorScore = score;
        mejorProducto = key;
      }
    }

    if (mejorScore > umbral) {
      console.log(`✅ Detectado: ${mejorProducto} (${mejorScore.toFixed(3)})`);
      return mejorProducto;
    }

    return null;
  } catch (err) {
    console.error('❌ Error detección:', err.message);
    return null;
  }
}

// =========================
// 🔥 OBTENER INFO PRODUCTO
// =========================
function getInfoProducto(key) {
  return PRODUCTOS[key] || null;
}

module.exports = {
  detectarProducto,
  getInfoProducto,
  getEmbedding,
  PRODUCTOS
};