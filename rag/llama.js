const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const { getEmbedding } = require('./embeddings');

let vectorStore = null;
let ready = false;
let loading = false;
let initPromise = null;

// =========================
// 🧹 LIMPIEZA MÍNIMA
// =========================
function limpiarTexto(texto) {
  return texto.replace(/\s+/g, ' ').trim();
}

// =========================
// ✂️ CHUNKING MEJORADO (AÍSLA LÍNEAS DE PRECIO)
// =========================
function chunkPorParrafos(texto) {
  const lines = texto.split(/\n/);
  const chunks = [];
  let currentChunk = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      continue;
    }
    
    // Detectar si la línea contiene información de precio
    const esLineaPrecio = /\b(precio|s\/|S\/|USD|PEN|costo|inversión)\b.*\d/i.test(trimmed) || 
                          /^.*\b(precio|s\/|S\/|USD|PEN|costo|inversión)\s*[:\-\s]*[\d\.,]+.*$/i.test(trimmed);
    
    if (esLineaPrecio) {
      // Guardar chunk acumulado antes de procesar el precio
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      // Añadir la línea de precio como chunk independiente
      chunks.push(trimmed);
      continue;
    }
    
    // Acumular líneas normales
    if (currentChunk) {
      currentChunk += ' ' + trimmed;
    } else {
      currentChunk = trimmed;
    }
    
    // Si el chunk acumulado es muy largo, partirlo en oraciones
    if (currentChunk.length > 500) {
      const oraciones = currentChunk.split(/[.!?]+/);
      let temp = '';
      for (const oracion of oraciones) {
        const oracionTrim = oracion.trim();
        if (!oracionTrim) continue;
        if (temp.length + oracionTrim.length > 400) {
          chunks.push(temp.trim());
          temp = oracionTrim;
        } else {
          temp += (temp ? '. ' : '') + oracionTrim;
        }
      }
      if (temp) chunks.push(temp.trim());
      currentChunk = '';
    }
  }
  
  if (currentChunk) chunks.push(currentChunk.trim());
  
  // Filtrar chunks vacíos o muy cortos (excepto precios)
  return chunks.filter(c => c.length > 10 || /\b(precio|s\/|S\/|USD|PEN|costo)\b/i.test(c));
}

// =========================
// 🔧 NORMALIZAR CHUNK (mejora embeddings para precios)
// =========================
function normalizarChunk(texto) {
  return texto.replace(
    /\b(precio|s\/|S\/|USD|PEN|costo|inversión)\s*[:\-\s]*(\d+(?:[.,]\d+)?)/gi,
    (match, tipo, cantidad) => {
      const moneda = tipo.toLowerCase().includes('s/') || tipo.toLowerCase().includes('pen') ? 'soles' : '';
      return `Precio: ${cantidad} ${moneda}`.trim();
    }
  );
}

// =========================
// 📦 DETECTAR PRODUCTO DESDE ARCHIVO
// =========================
function detectarProductoDesdeArchivo(filename) {
  const file = filename.toLowerCase();
  if (file.includes('digestivo')) return 'digestivo';
  if (file.includes('nad') || file.includes('energia')) return 'energia';
  if (file.includes('focus') || file.includes('foco') || file.includes('enfoque')) return 'enfoque';
  return 'general';
}

// =========================
// 🔥 CALCULAR SIMILITUD COSENO
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
// 📄 CARGAR PDFs (PRIORIZA .txt)
// =========================
async function cargarPDFs() {
  const dir = __dirname;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));
  if (files.length === 0) {
    console.log('⚠️ No hay PDFs en', dir);
    return [];
  }

  console.log(`📚 Procesando ${files.length} PDFs (prefiriendo .txt)...\n`);
  const documentos = [];
  
  for (const file of files) {
    try {
      const pdfPath = path.join(dir, file);
      const txtPath = pdfPath.replace(/\.pdf$/i, '.txt');
      let texto = '';
      
      if (fs.existsSync(txtPath)) {
        texto = fs.readFileSync(txtPath, 'utf8');
        console.log(`  📄 ${file} → leído desde .txt (${texto.length} caracteres)`);
      } else {
        console.log(`  📄 ${file} → procesando PDF nativo...`);
        const buffer = fs.readFileSync(pdfPath);
        const data = await pdf(buffer);
        texto = data.text;
        console.log(`    📝 Texto nativo: ${texto.length} caracteres`);
      }
      
      if (texto.length < 50) {
        console.log(`    ⚠️ Texto insuficiente, ignorado\n`);
        continue;
      }
      
      const producto = detectarProductoDesdeArchivo(file);
      console.log(`    🏷 Producto: ${producto}`);
      
      const chunks = chunkPorParrafos(texto);
      
      // Estadísticas
      const conNumeros = chunks.filter(c => /\d/.test(c)).length;
      const conMoneda = chunks.filter(c => /S\/|s\/|\$|€|USD|PEN|precio|costo/i.test(c)).length;
      console.log(`    📊 ${chunks.length} chunks | ${conNumeros} con números | ${conMoneda} con moneda`);
      
      for (const chunk of chunks) {
        const textoNormalizado = normalizarChunk(chunk);
        documentos.push({ texto: textoNormalizado, producto, archivo: file });
      }
      
      console.log('');
      
    } catch (err) {
      console.error(`  ❌ Error ${file}: ${err.message}\n`);
    }
  }
  
  console.log(`✅ Total: ${documentos.length} chunks procesados\n`);
  return documentos;
}

// =========================
// 🧠 CREAR VECTOR STORE
// =========================
async function crearVectorStore(documentos) {
  console.log('🧠 Generando embeddings...');
  const store = [];
  let procesados = 0;
  
  for (let i = 0; i < documentos.length; i++) {
    const doc = documentos[i];
    try {
      const embedding = await getEmbedding(doc.texto);
      if (embedding && embedding.length > 0) {
        store.push({ ...doc, embedding, id: i });
        procesados++;
      }
      if ((i + 1) % 5 === 0 || i === documentos.length - 1) {
        console.log(`  📊 ${i + 1}/${documentos.length} chunks procesados`);
      }
    } catch (err) {
      console.error(`  ❌ Error chunk ${i}: ${err.message}`);
    }
  }
  console.log(`✅ ${procesados} vectores generados\n`);
  return store;
}

// =========================
// ⚡ INICIALIZAR RAG
// =========================
async function initRAG() {
  if (ready) return;
  if (loading) return initPromise;
  loading = true;
  
  initPromise = (async () => {
    const t0 = Date.now();
    try {
      const cachePath = path.join(__dirname, 'vectorstore_cache.json');
      
      if (fs.existsSync(cachePath)) {
        console.log('📦 Verificando caché...');
        const cached = JSON.parse(fs.readFileSync(cachePath));
        if (cached?.length > 0 && cached[0]?.embedding) {
          vectorStore = cached;
          ready = true;
          console.log(`✅ Caché cargada: ${vectorStore.length} vectores\n`);
          return;
        }
      }
      
      const documentos = await cargarPDFs();
      if (documentos.length === 0) {
        ready = true;
        return;
      }
      
      vectorStore = await crearVectorStore(documentos);
      fs.writeFileSync(cachePath, JSON.stringify(vectorStore));
      console.log('💾 Caché guardada\n');
      ready = true;
      console.log(`🚀 RAG inicializado en ${Date.now() - t0}ms\n`);
      
    } catch (err) {
      console.error('❌ Error crítico:', err.message);
      ready = true;
    } finally {
      loading = false;
    }
  })();
  
  return initPromise;
}

// =========================
// 🔍 BUSCAR CONTEXTO (CONTEXTO COMPACTO)
// =========================
async function buscarContexto(query, producto = null) {
  if (!ready) await initRAG();
  if (!vectorStore?.length) {
    console.log('❌ RAG no disponible');
    return null;
  }
  
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🔍 BÚSQUEDA: "${query}"`);
  if (producto) console.log(`🎯 Producto: ${producto}`);
  console.log(`${'─'.repeat(60)}`);
  
  try {
    const queryEmbedding = await getEmbedding(query);
    
    let candidatos = vectorStore;
    if (producto) {
      candidatos = vectorStore.filter(v => v.producto === producto);
      console.log(`📊 Buscando entre ${candidatos.length} chunks de ${producto}`);
    } else {
      console.log(`📊 Buscando entre ${candidatos.length} chunks totales`);
    }
    
    if (candidatos.length === 0) {
      console.log('❌ No hay chunks para buscar');
      return null;
    }
    
    console.log(`\n📋 CHUNKS DE "${producto || 'todos'}":`);
    candidatos.forEach((c, i) => {
      const preview = c.texto.substring(0, 55).replace(/\n/g, ' ').replace(/\s+/g, ' ');
      const tienePrecio = /precio|S\/|s\/|\$|€|USD|PEN|costo|inversión/i.test(c.texto) ? '💰' : '  ';
      console.log(`  ${String(i+1).padStart(2)}. ${tienePrecio} "${preview}..."`);
    });
    console.log('');
    
    const resultados = candidatos
      .map(doc => ({ ...doc, score: cosineSimilarity(queryEmbedding, doc.embedding) }))
      .filter(r => r.score > 0.3)
      .sort((a, b) => b.score - a.score);
    
    if (resultados.length === 0) {
      console.log('❌ Ningún resultado relevante');
      return null;
    }
    
    console.log(`\n📊 Top resultados:`);
    resultados.slice(0, 3).forEach((r, i) => {
      console.log(`  ${i+1}. [${r.score.toFixed(4)}] ${r.producto}`);
      console.log(`     "${r.texto.substring(0, 70)}..."`);
    });
    
    const maxScore = resultados[0]?.score || 0;
    const numChunks = maxScore < 0.6 ? 5 : 3;
    const topChunks = resultados.slice(0, Math.min(numChunks, resultados.length));
    
    // Para cada chunk, tomar un fragmento más extenso (primeras 2-3 oraciones o 300 caracteres)
    const fragmentos = topChunks.map(chunk => {
      const esPrecio = /precio|S\/|s\/|\$|€|USD|PEN|costo|inversión/i.test(chunk.texto);
      if (esPrecio) {
        // Precio: mantener el chunk completo (hasta 120 caracteres)
        return chunk.texto.length > 120 ? chunk.texto.substring(0, 117) + '...' : chunk.texto;
      } else {
        // Texto general: tomar primeras 2-3 oraciones (hasta 300 caracteres)
        const oraciones = chunk.texto.split(/[.!?]+/);
        let fragmento = '';
        for (const oracion of oraciones) {
          if (fragmento.length + oracion.length > 300) break;
          fragmento += (fragmento ? '. ' : '') + oracion.trim();
        }
        return fragmento || chunk.texto.substring(0, 300);
      }
    });
    
    // Unir fragmentos y limitar el contexto total a ~800 caracteres
    let contexto = '';
    let totalLength = 0;
    const fragmentosFinales = [];
    
    for (const frag of fragmentos) {
      if (totalLength + frag.length > 800) {
        // Si aún no hemos añadido nada, añadir truncado
        if (fragmentosFinales.length === 0) {
          fragmentosFinales.push(frag.substring(0, 800 - 3) + '...');
        }
        break;
      }
      fragmentosFinales.push(frag);
      totalLength += frag.length + 3; // separador " | "
    }
    
    contexto = fragmentosFinales.join(' | ');
    
    console.log(`\n✅ Contexto compacto (${topChunks.length} chunks, ${contexto.length} caracteres, score máx ${maxScore.toFixed(4)})`);
    console.log(`📄 Preview: "${contexto}"`);
    console.log(`${'─'.repeat(60)}\n`);
    
    return contexto;
    
  } catch (err) {
    console.error('❌ Error en búsqueda:', err.message);
    return null;
  }
}

function isReady() { return ready; }
function getStats() {
  return {
    ready,
    vectores: vectorStore?.length || 0,
    productos: vectorStore?.reduce((acc, v) => {
      acc[v.producto] = (acc[v.producto] || 0) + 1;
      return acc;
    }, {}) || {}
  };
}

module.exports = { initRAG, buscarContexto, isReady, getStats };