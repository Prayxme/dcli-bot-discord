const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
require('dotenv').config();
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const cheerio = require('cheerio');
let vehicleIdNumber



// Configurar los reintentos con axios-retry
axiosRetry(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
  });
  

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

client.once('ready', () => {
  console.log(`Bot conectado como ${client.user.tag}`);
});

// Función principal para manejar el comando !buscar
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('!chassis') || message.content.startsWith('!plate')) {
        const args = message.content.split(' '); // Obtener los argumentos del mensaje
        const searchType = message.content.startsWith('!chassis') ? 'chassis' : 'plate'; // Determinar si es chassis o plate
        const searchValue = args[1]; // El valor de búsqueda (número de chasis o placa)

        if (!searchValue) {
            message.reply('Por favor, proporciona un número de chasis o placa después de "!buscar".');
            return;
        }

        if (!['chassis', 'plate'].includes(searchType)) {
            message.reply('Por favor, utiliza "chassis" o "plate" para especificar el tipo de búsqueda.');
            return;
        }

        try {
            await message.reply('Procesando la solicitud...');

            const { text, downloadLink } = await buscar(searchType, searchValue, message);

            // Intentar generar el screenshot con reintentos
            let screenshotPath = null;

            try {
                screenshotPath = await generarScreenshotChasis(searchType, searchValue, message);
            } catch (error) {
                await message.reply('No se pudo hacer la captura del chassis.');
                return;
            }

            // Si la captura se generó correctamente, enviarla
            if (screenshotPath) {
                await message.channel.send({ files: [screenshotPath] });
            }

            // Si hay un enlace de descarga, lo manejamos
            if (downloadLink) {
                await manejarDocumento(downloadLink, message);
            }

        } catch (error) {
            console.error(error);
            message.reply('Hubo un error al realizar la búsqueda.');
        }
    }
});

// Función para buscar chasis
async function buscar(searchType, searchValue, message) {
    const url = searchType === 'chassis'
        ? `https://dcli.com/track-a-chassis/?0-chassisType=chassis&searchChassis=${searchValue}`
        : `https://dcli.com/track-a-chassis/?0-chassisType=plate&searchChassis=${searchValue}`;

    try {
        console.log(`🔍 Buscando por ${searchType} con valor: ${searchValue}`);
        const { data } = await axios.get(url, { timeout: 15000 });
        console.log("✅ Página obtenida con éxito");

        const $ = cheerio.load(data);
        const wrapper = $('.info-wrapper');

        if (wrapper.length === 0) {
            console.log("❌ No se encontró el contenedor del chasis o placa");
            await message.reply('El chasis o placa no fue encontrado.');
            return;
        }

        let resultText = `**PHYSICAL INFORMATION**\n`;

        const obtenerDato = (label) => {
            const element = wrapper.find(`div.data-wrapper:has(div:contains("${label}")) div:last-child`);
            return element.text().trim() || 'N/A';
        };

        // Obtener toda la información
        resultText += `**Chassis Number**\n${obtenerDato('Chassis Number')}\n`;
        resultText += `**Chassis Size & Type**\n${obtenerDato('Chassis Size & Type')}\n`;
        resultText += `**Chassis Plate Number**\n${obtenerDato('Chassis Plate Number')}\n`;
        resultText += `**Vehicle Id Number**\n${obtenerDato('Vehicle Id Number')}\n`;
        resultText += `**Region**\n${obtenerDato('Region')}\n`;
        resultText += `**Last FMCSA Date**\n${obtenerDato('Last FMCSA Date')}\n`;
        resultText += `**Last BIT Date**\n${obtenerDato('Last BIT Date')}\n`;

        vehicleIdNumber = obtenerDato('Vehicle Id Number');
        console.log(`🚗 Vehicle Id Number: ${vehicleIdNumber}`);

        // Buscando el enlace de descarga
        const downloadElement = wrapper.find('div.data-wrapper.download a.link');
        const downloadLink = downloadElement.attr('href') ? downloadElement.attr('href').trim() : null;

        console.log(`🔗 Enlace extraído de la página: ${downloadLink || 'No encontrado'}`);

        // Enviar toda la información de una vez
        await message.reply(resultText);

        // Si hay un enlace de descarga, lo enviamos también
        if (downloadLink) {
            await message.reply(`📄 **Descargar documento:** ${downloadLink}`);
            return { text: resultText, downloadLink };
        }

        return { text: resultText };
    } catch (error) {
        console.error("❌ Error en la función buscar:", error);
        throw new Error('Hubo un error al realizar la búsqueda.');
    }
}

// Función para generar un screenshot usando Puppeteer
async function generarScreenshotChasis(searchType, searchValue, message) {
    const url = searchType === 'chassis'
        ? `https://dcli.com/track-a-chassis/?0-chassisType=chassis&searchChassis=${searchValue}`
        : `https://dcli.com/track-a-chassis/?0-chassisType=plate&searchChassis=${searchValue}`;
    const screenshotPath = path.join(__dirname, '/screenshoots/chassis_screenshot.jpg');
    const maxRetries = 3;  // Número máximo de intentos en caso de error
    let attempt = 0;  // Contador de intentos

    while (attempt < maxRetries) {
        try {
            console.log(`📸 Generando screenshot para el ${searchType} : ${searchValue}`);
            // Enviar mensaje de progreso
            if (attempt > 0) {
                await message.reply('No se ha podido hacer la captura, reintentando...');
            }

            const browser = await puppeteer.launch({ headless: true });
            const page = await browser.newPage();

            // Establecer el viewport a un tamaño más pequeño si es necesario para mejorar la carga
            await page.setViewport({ width: 1920, height: 1390 });

            // Incrementar el timeout a 30 segundos y usar 'networkidle0' para esperar hasta que la página esté completamente cargada
            await page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: 30000  // Timeout aumentado a 30 segundos
            });

            // Eliminar el footer antes de capturar el screenshot
            await page.evaluate(() => {
                const footer = document.querySelector('footer');
                if (footer) footer.style.display = 'none';
            });

            // Capturar el screenshot en formato JPG
            await page.screenshot({
                path: screenshotPath,
                type: 'jpeg',
                quality: 100,
                clip: {
                    x: 0,
                    y: 0,
                    width: 1920,
                    height: 1390
                }
            });

            await browser.close();

            console.log('📸 Screenshot capturado');
            await message.reply('Screenshot generado con éxito. Enviando...');

            return screenshotPath;
        } catch (error) {
            attempt++;
            console.error(`❌ Error al generar el screenshot (Intento ${attempt}):`, error);

            // Si se alcanzaron los intentos máximos, enviamos un mensaje final de error
            if (attempt >= maxRetries) {
                await message.reply('No se ha podido hacer la captura después de 3 intentos.');
                throw new Error('Hubo un error al generar el screenshot.');
            }

            console.log(`🔁 Intentando nuevamente... (Intento ${attempt})`);
        }
    }
}

async function descargarPDF(vin) {
    try {
        // URL directa del archivo PHP que genera el PDF
        const pdfUrl = `https://secure.tncountyclerk.com/dcli/static/api/201Form/201Form.php?vinNumber=${vin}`;

        console.log(`🔍 Descargando PDF desde: ${pdfUrl}`);

        // Realizar la solicitud GET con headers adecuados
        const response = await axios.get(pdfUrl, {
            responseType: 'arraybuffer', // Necesario para archivos binarios (PDF)
            headers: {
                'User-Agent': 'Mozilla/5.0', // Evita bloqueos por bots
                'Accept': 'application/pdf', // Indica que queremos recibir un PDF
                'Referer': 'https://secure.tncountyclerk.com/dcli/', // Evita bloqueos de CORS en algunos servidores
            },
        });

        // Verificar que la respuesta sea un PDF
        if (response.headers['content-type'] !== 'application/pdf') {
            throw new Error('⚠️ La URL no devolvió un PDF válido. Puede requerir autenticación o parámetros adicionales.');
        }

        console.log('✅ PDF obtenido correctamente.');

        // Crear la carpeta "pdfs" si no existe
        const pdfDir = path.join(__dirname, 'pdfs');
        if (!fs.existsSync(pdfDir)) {
            fs.mkdirSync(pdfDir, { recursive: true });
            console.log('📂 Carpeta "pdfs" creada.');
        }

        // Guardar el archivo PDF en la carpeta "pdfs"
        const pdfPath = path.join(pdfDir, `trailer-lookup-${vin}.pdf`);
        fs.writeFileSync(pdfPath, response.data);

        console.log(`📄 PDF guardado exitosamente en: ${pdfPath}`);


        // if (fs.existsSync(pdfPath)) {
        //     fs.unlinkSync(pdfPath);
        //     console.log('🗑️ Archivo temporal eliminado.');
        // }
        return pdfPath;
    } catch (error) {
        console.error('🚨 Ocurrió un error al descargar el PDF:', error.message);
        return null;
    }
}

// Función para descargar y enviar PDF
async function descargarYEnviarPDF(url, message) {
    let filePath;

    try {
        // Si la URL es una ruta local (como 'C:\...')
        if (url.startsWith('C:')) {
            console.log(`📥 Archivo local detectado: ${url}`);
            filePath = path.resolve(url);  // Resuelve la ruta local al sistema de archivos
        } else {
            // Si es una URL HTTP(S)
            console.log(`📥 Intentando descargar documento desde: ${url}`);
            const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
            const contentType = response.headers['content-type'];
            console.log(`📄 Tipo de contenido recibido: ${contentType}`);

            filePath = path.join(__dirname, 'chassis_document.pdf');
            fs.writeFileSync(filePath, response.data); // Guardamos el archivo temporalmente
        }

        // Verificar tamaño del archivo
        const stats = fs.statSync(filePath);
        const fileSizeInMB = stats.size / (1024 * 1024);
        console.log(`📏 Tamaño del archivo: ${fileSizeInMB.toFixed(2)} MB`);

        if (fileSizeInMB > 8) {
            console.log('⚠️ El archivo es demasiado grande, dividiéndolo en partes...');
            
            // Cargar el PDF original
            const pdfDoc = await PDFDocument.load(fs.readFileSync(filePath));
            const totalPages = pdfDoc.getPages().length;

            // Calcular cuántas partes hacer (máximo 8MB por parte)
            const parts = Math.ceil(fileSizeInMB / 8);
            const pagesPerPart = Math.ceil(totalPages / parts);

            const partPaths = [];

            // Dividir el PDF en partes
            for (let i = 0; i < parts; i++) {
                const startPage = i * pagesPerPart;
                const endPage = Math.min(startPage + pagesPerPart, totalPages);

                // Crear nuevo PDF para esta parte
                const partPdf = await PDFDocument.create();
                const pages = await partPdf.copyPages(pdfDoc, Array.from({ length: endPage - startPage }, (_, idx) => startPage + idx));
                pages.forEach(page => partPdf.addPage(page));

                // Guardar la parte en disco
                const partPath = path.join(__dirname, `chassis_document_part${i + 1}.pdf`);
                fs.writeFileSync(partPath, await partPdf.save());
                partPaths.push(partPath);
            }

            // Enviar las partes
            for (const partPath of partPaths) {
                const attachment = new AttachmentBuilder(partPath);
                await message.channel.send({ files: [attachment] });
                fs.unlinkSync(partPath); // Eliminar la parte después de enviarla
            }

            console.log('📤 Todas las partes del documento han sido enviadas.');
        } else {
            // Si el archivo no es demasiado grande, enviarlo directamente
            const attachment = new AttachmentBuilder(filePath);
            await message.channel.send({ files: [attachment] });
            console.log('📤 Documento enviado.');
        }

        // Eliminar el archivo temporal si existe
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('🗑️ Archivo temporal eliminado.');
        }
    } catch (error) {
        // Manejo de errores de axios
        if (error.response) {
            // La solicitud fue realizada y el servidor respondió con un código de error
            console.error(`❌ Error de respuesta: ${error.response.status} - ${error.response.statusText}`);
        } else if (error.request) {
            // La solicitud fue realizada pero no hubo respuesta
            console.error('❌ No se recibió respuesta del servidor:', error.request);
        } else {
            // Ocurrió un error al configurar la solicitud
            console.error('❌ Error en la configuración de la solicitud:', error.message);
        }

        // Enviar mensaje de error al usuario
        message.reply('Hubo un error al descargar o enviar el documento. Intenta nuevamente más tarde.');
    }
}
// Función para manejar la descarga y conversión del documento
async function manejarDocumento(url, message) {
    try {
        console.log(`📥 Intentando obtener documento desde: ${url}`);

        // Realizar la solicitud al archivo .php con respuesta binaria
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });

        // Verificar si la respuesta es un PDF
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('application/pdf')) {
            console.log('✅ El archivo obtenido es un PDF válido.');

            // Guardar el PDF y enviarlo
            const pdfPath = path.join(__dirname, 'pdfs', `chassis_document.pdf`);
            fs.writeFileSync(pdfPath, response.data);

            // Verificar tamaño del archivo
            const stats = fs.statSync(pdfPath);
            const fileSizeInMB = stats.size / (1024 * 1024);
            console.log(`📏 Tamaño del archivo: ${fileSizeInMB.toFixed(2)} MB`);

            if (fileSizeInMB > 8) {
                console.log('⚠️ El archivo es demasiado grande, dividiéndolo en partes...');
                await descargarYEnviarPDF(pdfPath, message);
            } else {
                // Si el archivo no es demasiado grande, enviarlo directamente
                const attachment = new AttachmentBuilder(pdfPath);
                await message.channel.send({ files: [attachment] });
                console.log('📤 Documento enviado.');
            }

            return;
        }

        // Si no es PDF, tratar de analizar el HTML
        console.log('⚠️ No es un PDF directo. Intentando extraer un enlace de la página...');
        const html = response.data.toString();
        const $ = cheerio.load(html);

        // Buscar enlace a PDF dentro del HTML
        let pdfLink = $('a[href$=".pdf"]').attr('href');

        // Si no hay enlace, intentar buscar dentro de un iframe o embed
        if (!pdfLink) {
            pdfLink = $('iframe[src$=".pdf"]').attr('src') || $('embed[src$=".pdf"]').attr('src');
        }

        if (pdfLink) {
            console.log(`🔗 Enlace de PDF encontrado en la página: ${pdfLink}`);

            // Llamar a la función para descargar el PDF
            await descargarYEnviarPDF(pdfLink, message);
        } else {
            console.log('⚠️ No se encontró un enlace a un PDF en el documento PHP.');
            await message.reply('El archivo esta en formato PHP, intentando convertir...');

            // Intentar descargar el PDF manualmente con el VIN
            const vin = vehicleIdNumber;
            const pdfPath = await descargarPDF(vin);

            if (pdfPath) {
                await message.channel.send({ files: [pdfPath] });
            } else {
                await message.reply('❌ No se pudo generar el archivo PDF.');
            }
        }
    } catch (error) {
        console.error('❌ Error al manejar el archivo .php:', error);
        message.reply('Hubo un error al procesar el documento.');
    }
}


client.login(DISCORD_TOKEN);
