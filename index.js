const { Client, GatewayIntentBits, AttachmentBuilder, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
require('dotenv').config();
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const cheerio = require('cheerio');
let vehicleIdNumber
let lastResultText = "";




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
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PDF_CHANNEL_NAME = "bot-pdf"; // Nombre del canal que queremos monitorear


async function clearCommands() {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    try {
        console.log('🚨 Eliminando comandos antiguos...');
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
        console.log('✅ Comandos eliminados correctamente.');
    } catch (error) {
        console.error('❌ Error al eliminar comandos:', error);
    }
}

clearCommands();


client.once('ready', async () => {
    console.log(`Bot conectado como ${client.user.tag}`);
    await registerCommands();

    const guild = client.guilds.cache.get(GUILD_ID);

    if (guild) {
        const channel = guild.channels.cache.find(ch => ch.name === 'general' && ch.isTextBased()); //busca el canal general por el nombre
        // const channel = guild.channels.cache.find('1332027926098739234'); // ID del canal general

        if (channel) {
            //Mensaje de bienvenida al canal general cuando el bot se inicie

            // channel.send('@everyone 🟢🚀 **Estamos de vuelta!!!** El bot está activo y listo para ayudar. 🔍');
            console.log('✅ Mensaje de activación enviado correctamente.');
        }else{
            console.error('❌ No se pudo encontrar el canal "general".');
        }

    } else {
        console.error('❌ No se pudo conectar al servidor.');
        
    }


});


// 📌 Monitorear mensajes en el canal #bot-pdf
client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // Ignorar mensajes de bots
    if (message.channel.name !== PDF_CHANNEL_NAME) return; // Solo actuar en #bot-pdf

    if (message.attachments.size > 0) {
        await procesarImagenesPDF(message);
    }
});

// 📌 Función para convertir imágenes en PDF con el mismo nombre de archivo

// 📌 Función para convertir múltiples imágenes a un solo PDF
async function procesarImagenesPDF(message) {
    try {
        const imagenes = message.attachments.filter(attachment => 
            attachment.contentType && attachment.contentType.startsWith('image/')
        );

        if (imagenes.size === 0) {
            console.log('⚠️ No se detectaron imágenes válidas.');
            return;
        }

        await message.reply('📥 Procesando imágenes, convirtiéndolas en un PDF...');

        const pdfDoc = await PDFDocument.create();
        let nombresImagenes = [];

        for (const attachment of imagenes.values()) {
            // Obtener nombre de la imagen sin extensión
            const nombreOriginal = path.parse(attachment.name).name;
            nombresImagenes.push(nombreOriginal);

            const imageBytes = (await axios.get(attachment.url, { responseType: 'arraybuffer' })).data;
            let image;

            try {
                image = await pdfDoc.embedJpg(imageBytes);
            } catch {
                image = await pdfDoc.embedPng(imageBytes);
            }

            // Crear una nueva página con el tamaño de la imagen
            const page = pdfDoc.addPage([image.width, image.height]);
            page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
        }

        // Limitar la longitud del nombre si hay muchas imágenes
        let nombreFinalPDF = nombresImagenes.slice(0, 3).join('_') + ".pdf"; 
        if (nombresImagenes.length > 3) {
            nombreFinalPDF = `varias_imagenes_${Date.now()}.pdf`; // Nombre genérico si hay muchas imágenes
        }

        const pdfPath = path.join(__dirname, nombreFinalPDF);

        // Guardar PDF en disco
        const pdfBytes = await pdfDoc.save();
        fs.writeFileSync(pdfPath, pdfBytes);

        // Enviar el PDF generado al canal
        await message.channel.send({
            content: '📄 Aquí está el PDF con todas las imágenes:',
            files: [pdfPath],
        });

        // Eliminar el archivo después de enviarlo
        fs.unlinkSync(pdfPath);
        console.log(`✅ PDF "${nombreFinalPDF}" enviado y eliminado del sistema.`);
    } catch (error) {
        console.error('❌ Error al procesar imágenes:', error);
        await message.reply('❌ Hubo un error al convertir las imágenes a PDF.');
    }
}


async function registerCommands() {

    // Registrar comandos de barra (slash)
    const commands = [
        {
            name: 'chassis',
            description: 'Busca información de un chassis',
            options: [
                {
                    name: 'numero',
                    type: 3, // STRING
                    description: 'Número de chassis a buscar',
                    required: true,
                },
            ],
        },
        {
            name: 'plate',
            description: 'Busca información de una placa',
            options: [
                {
                    name: 'numero',
                    type: 3, // STRING
                    description: 'Número de placa a buscar',
                    required: true,
                },
            ],
        },
    ];

    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

    try {
        console.log('⏳ Registrando comandos de barra...');
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('✅ Comandos registrados correctamente.');
    } catch (error) {
        console.error('❌ Error al registrar comandos:', error);
    }
}


client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;
    const searchValue = options.getString('numero');

    try {
        await interaction.deferReply(); // Deferir la respuesta para evitar el timeout

        await interaction.editReply('🔍 Procesando la solicitud...');

        const searchType = commandName === 'chassis' ? 'chassis' : 'plate';
        const { text, downloadLink } = await buscar(searchType, searchValue, interaction);

        // Enviar la información del chasis o placa
        // await interaction.followUp({ content: text });

        // Intentar generar el screenshot
        try {
            const screenshotPath = await generarScreenshotChasis(searchType, searchValue, interaction);
            await interaction.followUp({ files: [screenshotPath] });
        } catch (error) {
            console.error('❌ Error al generar el screenshot:', error);
            await interaction.followUp('⚠️ No se pudo generar la captura del chasis.');
        }

        // Si hay un enlace de descarga, manejarlo
        if (downloadLink) {
            await manejarDocumento(downloadLink, interaction);
        }

    } catch (error) {
        console.error('❌ Error al procesar la solicitud:', error);
        await interaction.editReply('🚨 Hubo un error al realizar la búsqueda.');
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'copy_info') {
        
        try {
            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            await interaction.editReply({
                content: `\n\n\`\`\`\n${lastResultText}\n\`\`\``,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('❌ Error al manejar el botón de copiar información:', error);
            await interaction.editReply({
                content: '🚨 Hubo un error al copiar la información.',
                flags: MessageFlags.Ephemeral
            });
            
        }
    }
});

//codigo para usar un modal y copiar el texto
// client.on('interactionCreate', async (interaction) => {
//     if (!interaction.isButton()) return;

//     if (interaction.customId === 'copy_info') {
//         const modal = new ModalBuilder()
//             .setCustomId('copy_info_modal')
//             .setTitle('Información para copiar');

//         const textInput = new TextInputBuilder()
//             .setCustomId('copy_data')
//             .setLabel('Selecciona y copia todo el texto')
//             .setStyle(TextInputStyle.Paragraph)
//             .setValue(lastResultText.substring(0, 3950)); // Discord limita a 4000 chars

//         const row = new ActionRowBuilder().addComponents(textInput);
//         modal.addComponents(row);

//         await interaction.showModal(modal);
//     }
// });

// client.on('interactionCreate', async (interaction) => {
//     if (!interaction.isModalSubmit()) return;

//     if (interaction.customId === 'copy_info_modal') {
//         await interaction.reply({
//             content: "📋 ¡Perfecto! Puedes copiar la información desde el cuadro que se abrió.",
//             flags: MessageFlags.Ephemeral
//         });
//     }
// });


// Función para buscar chasis
async function buscar(searchType, searchValue, interaction) {
    const url = searchType === 'chassis'
        ? `https://dcli.com/track-a-chassis/?0-chassisType=chassis&searchChassis=${searchValue}`
        : `https://dcli.com/track-a-chassis/?0-chassisType=plate&searchChassis=${searchValue}`;

    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            console.log(`🔍 Buscando por ${searchType} = ${searchValue} (Intento ${attempt + 1})`);

            const { data } = await axios.get(url, { timeout: 15000 });
            const $ = cheerio.load(data);
            const wrapper = $('.info-wrapper');

            if (wrapper.length === 0) {
                await interaction.followUp('❌ No se encontró el chasis o placa.');
                return;
            }
            

            // ---------- LIMPIEZA SELECTIVA ANTES DE EXTRAER DATOS ----------
            // console.log('🔎 Limpiando posibles elementos "Download" no deseados...');

            try {
            // 1) Encontrar todos los anchors con texto "Download" (mayúsculas/minúsculas)
            const allDownloadAnchors = wrapper.find('a.link').filter((i, el) => {
                const txt = $(el).text() || '';
                return txt.trim().toLowerCase() === 'download';
            });

            // console.log(`ℹ️ Encontrados ${allDownloadAnchors.length} anchors con texto "Download".`);

            // 2) Para cada anchor, si NO está dentro de un contenedor .data-wrapper.download -> eliminarlo
            allDownloadAnchors.each((i, el) => {
                const $el = $(el);
                const downloadWrapperParent = $el.closest('.data-wrapper.download');

                if (downloadWrapperParent.length === 0) {
                // No está dentro del bloque de descarga oficial -> eliminar el elemento causante del espacio
                // Intentamos eliminar el contenedor más cercano que sea .data-wrapper, si existe, sino el anchor mismo
                const parentDataWrapper = $el.closest('.data-wrapper');
                if (parentDataWrapper.length) {
                    console.log(`🗑️ Eliminando contenedor no deseado .data-wrapper (Download) #${i}`);
                    parentDataWrapper.remove();
                } else {
                    console.log(`🗑️ Eliminando anchor "Download" suelto #${i}`);
                    $el.remove();
                }
                } else {
                // console.log(`✅ Conservar anchor "Download" dentro de .data-wrapper.download #${i}`);
                }
            });

            // 3) Como doble seguridad: eliminar cualquier div.data-wrapper.download vacío o que sólo contenga whitespace
            wrapper.find('div.data-wrapper.download').each((i, el) => {
                const $el = $(el);
                if ($el.text().trim() === '') {
                console.log('🧹 Eliminando div.data-wrapper.download vacío (seguridad).');
                $el.remove();
                }
            });

            } catch (err) {
            console.warn('⚠️ Error durante la limpieza selectiva de "Download":', err.message);
            }



            const obtenerDato = (label) => {
                const element = wrapper.find(`div.data-wrapper:has(div:contains("${label}")) div:last-child`);
                return element.text().trim() || 'N/A';
            };

            // Valores extraídos
            const info = {
                chassisNumber: obtenerDato('Chassis Number'),
                sizeType: obtenerDato('Chassis Size & Type'),
                plate: obtenerDato('Chassis Plate Number'),
                vin: obtenerDato('Vehicle Id Number'),
                region: obtenerDato('Region'),
                lastFMCSA: obtenerDato('Last FMCSA Date'),
                lastBIT: obtenerDato('Last BIT Date')
            };

            vehicleIdNumber = info.vin;

            // Texto para copiar
            const resultText =
                `PHYSICAL INFORMATION
Chassis Number
${info.chassisNumber}
Chassis Size & Type
${info.sizeType}
Plate Number
${info.plate}
Vehicle Id Number
${info.vin}
Region
${info.region}
Last FMCSA
${info.lastFMCSA}
Last BIT
${info.lastBIT}`;

            lastResultText = resultText.replace(/\n{2,}/g, '\n').trim();

            // Obtener link de descarga
            const downloadElement = wrapper.find('div.data-wrapper.download a.link');
            const downloadLink = downloadElement.attr('href') || null;

            // ---------------------------------------------------------
            // 📌 EMBED
            // ---------------------------------------------------------
            const embed = new EmbedBuilder()
                .setTitle(`🔍 Información — ${searchType === "chassis" ? "Chassis" : "Plate"}`)
                .setColor('#0099ff')
                .addFields(
                    { name: 'Chassis Number', value: info.chassisNumber, inline: true },
                    { name: 'Size & Type', value: info.sizeType, inline: true },
                    { name: 'Plate Number', value: info.plate, inline: true },
                    { name: 'VIN', value: info.vin, inline: true },
                    { name: 'Region', value: info.region, inline: true },
                    { name: 'Last FMCSA', value: info.lastFMCSA, inline: true },
                    { name: 'Last BIT', value: info.lastBIT, inline: true },
                )
                .setFooter({ text: 'Información generada automáticamente' });

            // ---------------------------------------------------------
            // 📌 BOTONES
            // ---------------------------------------------------------
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('copy_info')
                    .setLabel('📋 Copiar información')
                    .setStyle(ButtonStyle.Primary)
            );

            if (downloadLink) {
                row.addComponents(
                    new ButtonBuilder()
                        .setLabel('📄 Abrir Documento')
                        .setStyle(ButtonStyle.Link)
                        .setURL(downloadLink)
                );
            }

            // Enviar embed + botones
            await interaction.followUp({
                embeds: [embed],
                components: [row]
            });

            // 🧹 LIMPIAR TEXTO: eliminar 'Download' y líneas vacías
            lastResultText = lastResultText
                .replace(/Download/gi, '')            // Elimina palabra "Download"
                .replace(/\n{3,}/g, '\n\n')           // Reduce saltos de línea excesivos
                .trim();                              // Limpia espacios al inicio y final

            return { text: lastResultText, downloadLink };

        } catch (error) {
            attempt++;
            console.error(`❌ Error buscar (Intento ${attempt}):`, error);

            if (attempt >= maxRetries) {
                await interaction.followUp('❌ No se pudo completar la búsqueda.');
                throw error;
            }

            await new Promise(r => setTimeout(r, 3000));
        }
    }
}



// Función para generar un screenshot usando Puppeteer
async function generarScreenshotChasis(searchType, searchValue, interaction) {
    const url = searchType === 'chassis'
        ? `https://dcli.com/track-a-chassis/?0-chassisType=chassis&searchChassis=${searchValue}`
        : `https://dcli.com/track-a-chassis/?0-chassisType=plate&searchChassis=${searchValue}`;

    const screenDir = path.join(__dirname, 'screenshoots');
    if (!fs.existsSync(screenDir)) {
        fs.mkdirSync(screenDir, { recursive: true });
        console.log('📂 Carpeta "screenshoots" creada.');
    }


    const screenshotPath = path.join(screenDir, 'chassis_screenshot.jpg');
    const maxRetries = 3;  // Número máximo de intentos en caso de error
    let attempt = 0;  // Contador de intentos

    while (attempt < maxRetries) {
        try {
            console.log(`📸 Generando screenshot para el ${searchType} : ${searchValue}`);
            // Enviar mensaje de progreso
            if (attempt > 0) {
                await interaction.followUp('No se ha podido hacer la captura, reintentando...');
            }

            const browser = await puppeteer.launch({ headless: true, 
                args: ['--no-sandbox', '--disable-setuid-sandbox'] // Para evitar problemas de sandboxing en algunos entornos como Linux, si se esta en windows se puede comentar esta linea
            });
            const page = await browser.newPage();

            // Establecer el viewport a un tamaño más pequeño si es necesario para mejorar la carga
            await page.setViewport({ width: 1920, height: 1390 });

            // Incrementar el timeout a 30 segundos y usar 'networkidle0' para esperar hasta que la página esté completamente cargada
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 60000  // Timeout aumentado a 30 segundos
            });

            await new Promise(resolve => setTimeout(resolve, 3000)); // Esperar 3 segundos para asegurar que la página esté completamente cargada

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
            await interaction.followUp('Screenshot generado con éxito. Enviando...');

            return screenshotPath;
        } catch (error) {
            attempt++;
            console.error(`❌ Error al generar el screenshot (Intento ${attempt}):`, error);

            // Si se alcanzaron los intentos máximos, enviamos un mensaje final de error
            if (attempt >= maxRetries) {
                await interaction.followUp('No se ha podido hacer la captura después de 3 intentos.');
                throw new Error('Hubo un error al generar el screenshot.');
            }

            console.log(`🔁 Intentando nuevamente... (Intento ${attempt})`);
        }
    }
}

async function descargarPDF(vin) {

    const axiosRetriesGet = 3;
    let intentos = 0;

    while (intentos < axiosRetriesGet) {

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

            // console.log('✅ PDF obtenido correctamente.');

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

            return pdfPath;

        } catch (error) {
            intentos++;
            console.error(`❌ Error al descargar el PDF (Intento ${intentos}):`, error);

            if (intentos >= axiosRetriesGet) {
                console.error('❌ Se alcanzó el número máximo de intentos.');
                return null;

            }
            console.error('🚨 Ocurrió un error al descargar el PDF:', error.message);
        }
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
        message.followUp('Hubo un error al descargar o enviar el documento. Intenta nuevamente más tarde.');
    }
}
// Función para manejar la descarga y conversión del documento
async function manejarDocumento(url, message) {

    const axiosGetDoc = 3;
    let retryAxios = 0;

    while (retryAxios < axiosGetDoc) {

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
            // console.log('⚠️ No es un PDF directo. Intentando extraer un enlace de la página...');
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
                // console.log('⚠️ No se encontró un enlace a un PDF en el documento PHP.');
                await message.followUp('El archivo esta en formato PHP, intentando convertir...');

                // Intentar descargar el PDF manualmente con el VIN
                const vin = vehicleIdNumber;
                const pdfPath = await descargarPDF(vin);

                if (pdfPath) {
                    await message.channel.send({ files: [pdfPath] });
                } else {
                    await message.followUp('❌ No se pudo generar el archivo PDF.');
                }

                return;
            }
        } catch (error) {
            retryAxios++;
            console.error(`❌ Error al obtener documento (Intento ${retryAxios}):`, error);

            if (retryAxios >= axiosGetDoc) {

                console.error('❌ Error al manejar el archivo .php:', error);
                message.followUp('Hubo un error al procesar el documento.');
                return;
            }
        }
    }

}


client.login(DISCORD_TOKEN);
