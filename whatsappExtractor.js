const puppeteer = require('puppeteer-core');
const path = require('path');

async function openWhatsApp() {
    // Ruta de tu perfil de usuario de Brave
    const userDataDirPath = path.join("C:", "Users", "Logistica", "AppData", "Local", "BraveSoftware", "Brave-Browser", "User Data");

    const browser = await puppeteer.launch({
        headless: false,
        executablePath: "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", // Ruta de Brave
        userDataDir: userDataDirPath,  // Perfil de usuario de Brave
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
    });

    const page = await browser.newPage();
    await page.goto('https://web.whatsapp.com');

    console.log("✅ WhatsApp Web abierto en Brave con tu sesión activa.");
}

openWhatsApp();
