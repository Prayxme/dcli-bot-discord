const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
require('dotenv').config();
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const cheerio = require('cheerio');


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

    if (message.content.startsWith('!buscar')) {
        const chassisNumber = message.content.split(' ')[1];

        if (!chassisNumber) {
            message.reply('Por favor, proporciona un número de chasis después de "!buscar".');
            return;
        }

        try {
            await message.reply('Procesando la solicitud...');

            const { text, downloadLink } = await buscarChasis(chassisNumber, message);

            // Generar screenshot
            const screenshotPath = await generarScreenshotChasis(chassisNumber, message);

            // Enviar screenshot
            await message.channel.send({ files: [screenshotPath] });

            // Si hay un enlace de descarga, lo manejamos
            if (downloadLink) {
                await descargarYEnviarPDF(downloadLink, message);
            }

        } catch (error) {
            console.error(error);
            message.reply('Hubo un error al realizar la búsqueda.');
        }
    }
});

// Función para buscar chasis
async function buscarChasis(chassisNumber, message) {
    const url = `https://dcli.com/track-a-chassis/?0-chassisType=chassis&searchChassis=${chassisNumber}`;

    try {
        console.log(`🔍 Buscando chasis con número: ${chassisNumber}`);
        const { data } = await axios.get(url, { timeout: 15000 }); // Aumento el timeout a 15 segundos
        console.log("✅ Página obtenida con éxito");

        const $ = cheerio.load(data);
        const wrapper = $('.info-wrapper');

        if (wrapper.length === 0) {
            console.log("❌ No se encontró el contenedor del chasis");
            await message.reply('El chasis no fue encontrado.');
            return;
        }

        let resultText = `**PHYSICAL INFORMATION**\n`;

        const obtenerDato = (label) => {
            const element = wrapper.find(`div.data-wrapper:has(div:contains("${label}")) div:last-child`);
            return element.text().trim() || 'N/A';
        };

        // Obtener toda la información del chasis primero
        resultText += `**Chassis Number**\n${obtenerDato('Chassis Number')}\n`;
        resultText += `**Chassis Size & Type**\n${obtenerDato('Chassis Size & Type')}\n`;
        resultText += `**Chassis Plate Number**\n${obtenerDato('Chassis Plate Number')}\n`;
        resultText += `**Vehicle Id Number**\n${obtenerDato('Vehicle Id Number')}\n`;
        resultText += `**Region**\n${obtenerDato('Region')}\n`;
        resultText += `**Last FMCSA Date**\n${obtenerDato('Last FMCSA Date')}\n`;
        resultText += `**Last BIT Date**\n${obtenerDato('Last BIT Date')}\n`;

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
        console.error("❌ Error en la función buscarChasis:", error);
        throw new Error('Hubo un error al realizar la búsqueda.');
    }
}

// Función para descargar y enviar PDF
async function descargarYEnviarPDF(url, message) {
    try {
        console.log(`📥 Descargando documento desde: ${url}`);

        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 }); // Timeout de 15 segundos

        const contentType = response.headers['content-type'];
        console.log(`📄 Tipo de contenido recibido: ${contentType}`);

        const filePath = path.join(__dirname, 'chassis_document.pdf');

        if (contentType === 'application/pdf') {
            fs.writeFileSync(filePath, response.data);
        } else {
            await convertirHTMLaPDF(url, filePath);
        }

        console.log(`✅ Documento guardado en: ${filePath}`);

        // Verificar el tamaño del archivo antes de enviarlo
        const stats = fs.statSync(filePath);
        const fileSizeInMB = stats.size / (1024 * 1024); // en MB

        if (fileSizeInMB > 8) {
            console.log('El archivo es demasiado grande para enviarlo directamente. Dividiéndolo...');

            // Dividir el archivo PDF en dos partes
            const pdfDoc = await PDFDocument.load(fs.readFileSync(filePath));

            // Obtener el total de páginas
            const totalPages = pdfDoc.getPages().length;

            // Dividir en dos partes
            const half = Math.ceil(totalPages / 2);

            // Crear el primer documento PDF con la primera mitad
            const part1 = await PDFDocument.create();
            const firstHalfPages = await part1.copyPages(pdfDoc, Array.from({ length: half }, (_, i) => i));
            firstHalfPages.forEach(page => part1.addPage(page));

            // Crear el segundo documento PDF con la segunda mitad
            const part2 = await PDFDocument.create();
            const secondHalfPages = await part2.copyPages(pdfDoc, Array.from({ length: totalPages - half }, (_, i) => half + i));
            secondHalfPages.forEach(page => part2.addPage(page));

            // Guardar las dos partes como archivos temporales
            const part1Path = path.join(__dirname, 'chassis_document_part1.pdf');
            const part2Path = path.join(__dirname, 'chassis_document_part2.pdf');

            const part1Bytes = await part1.save();
            const part2Bytes = await part2.save();

            fs.writeFileSync(part1Path, part1Bytes);
            fs.writeFileSync(part2Path, part2Bytes);

            // Enviar las dos partes como archivos adjuntos
            await message.channel.send({ files: [part1Path] });
            await message.channel.send({ files: [part2Path] });

            console.log('📤 Documentos enviados al canal');

            // Eliminar los archivos temporales
            fs.unlinkSync(part1Path);
            fs.unlinkSync(part2Path);
            console.log('🗑️ Archivos temporales eliminados');
        } else {
            // Si el archivo no es demasiado grande, enviarlo directamente
            const attachment = new AttachmentBuilder(filePath);
            await message.channel.send({ files: [attachment] });

            console.log('📤 Documento enviado al canal');
        }

        // Eliminar el archivo temporal después de enviarlo
        fs.unlinkSync(filePath);
        console.log('🗑️ Archivo temporal eliminado');
    } catch (error) {
        console.error('❌ Error al descargar o enviar el PDF:', error);
        message.reply('Hubo un error al descargar o enviar el documento.');
    }
}

// Función para generar un screenshot usando Puppeteer
async function generarScreenshotChasis(chassisNumber, message) {
    const url = `https://dcli.com/track-a-chassis/?0-chassisType=chassis&searchChassis=${chassisNumber}`;
    const screenshotPath = path.join(__dirname, 'chassis_screenshot.jpg'); // Cambiar extensión a .jpg

    try {
        console.log(`📸 Generando screenshot para el chasis: ${chassisNumber}`);
        await message.reply('Generando el screenshot de la página...');

        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();

        // Establecer el viewport a un tamaño más pequeño si es necesario para mejorar la carga
        await page.setViewport({ width: 1920, height: 1390 });  // Ajustar tamaño del viewport si es necesario

        // Incrementar el timeout a 15 segundos y usar 'networkidle0' para esperar hasta que la página esté completamente cargada
        await page.goto(url, {
            waitUntil: 'networkidle0',  // Esperar hasta que no haya más conexiones de red
            timeout: 30000  // Aumentamos el timeout a 30 segundos si el sitio es lento
        });

        // Eliminar el footer antes de capturar el screenshot
        await page.evaluate(() => {
            const footer = document.querySelector('footer');
            if (footer) footer.style.display = 'none';
        });

        // Capturar el screenshot en formato JPG
        await page.screenshot({
            path: screenshotPath,
            type: 'jpeg',  // Cambiar tipo de imagen a jpeg
            quality: 100,    // Calidad de la imagen JPG (0-100), puedes ajustarlo según lo necesites
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
        console.error('❌ Error al generar el screenshot:', error);
        throw new Error('Hubo un error al generar el screenshot.');
    }
}


client.login(DISCORD_TOKEN);
