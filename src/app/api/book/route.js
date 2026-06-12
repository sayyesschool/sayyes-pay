import { NextResponse } from 'next/server';

// In-memory store as fallback (resets on cold start)
const memoryStore = { booked: [], submissions: [] };

// Use Vercel KV if available, otherwise memory
async function getBookedSlots() {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        try {
            const resp = await fetch(`${process.env.KV_REST_API_URL}/get/booked_slots`, {
                headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
            });
            const data = await resp.json();
            return data.result ? JSON.parse(data.result) : [];
        } catch (e) {
            console.error('KV read error:', e);
            return memoryStore.booked;
        }
    }
    return memoryStore.booked;
}

async function addBookedSlot(slotKey) {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        try {
            const booked = await getBookedSlots();
            booked.push(slotKey);
            await fetch(`${process.env.KV_REST_API_URL}/set/booked_slots`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(JSON.stringify(booked))
            });
        } catch (e) {
            console.error('KV write error:', e);
            memoryStore.booked.push(slotKey);
        }
    } else {
        memoryStore.booked.push(slotKey);
    }
}

// Verify Cloudflare Turnstile token
async function verifyTurnstile(token) {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret || !token) return true; // Skip if not configured

    try {
        const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret, response: token })
        });
        const data = await resp.json();
        return data.success;
    } catch (e) {
        console.error('Turnstile verification error:', e);
        return true; // Fail open
    }
}

// Send notification to Telegram
async function sendTelegramNotification(booking) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
        console.log('Telegram not configured. Booking:', JSON.stringify(booking));
        return;
    }

    let timeInfo = '';
    if (booking.slot === 'no_time') {
        timeInfo = 'Время: не выбрано (подобрать позже)';
    } else {
        timeInfo = `Дата: ${booking.slotDate}\nВремя (МСК): ${booking.slotMsk}`;
    }

    const message = `📝 Новая заявка SAY YES!\n\n` +
        `👤 Имя: ${booking.name}\n` +
        `📱 Telegram: ${booking.telegram || '—'}\n` +
        `📧 Email: ${booking.email || '—'}\n` +
        `${timeInfo}\n\n` +
        `🕐 Отправлено: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК`;

    try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            })
        });
    } catch (e) {
        console.error('Telegram send error:', e);
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { name, telegram, email, slot, slotMsk, slotDate, turnstileToken } = body;

        // Validate required fields
        if (!name) {
            return NextResponse.json({ error: 'Имя обязательно' }, { status: 400 });
        }
        if (!telegram && !email) {
            return NextResponse.json({ error: 'Укажите Telegram или Email' }, { status: 400 });
        }

        // Verify CAPTCHA
        const captchaValid = await verifyTurnstile(turnstileToken);
        if (!captchaValid) {
            return NextResponse.json({ error: 'Проверка не пройдена. Попробуйте ещё раз.' }, { status: 403 });
        }

        // Check if slot is already booked
        if (slot && slot !== 'no_time') {
            const booked = await getBookedSlots();
            if (booked.includes(slot)) {
                return NextResponse.json({ error: 'Это время уже занято. Выберите другое.' }, { status: 409 });
            }
            await addBookedSlot(slot);
        }

        // Send notification
        await sendTelegramNotification({ name, telegram, email, slot, slotMsk, slotDate });

        return NextResponse.json({ success: true });
    } catch (e) {
        console.error('Booking error:', e);
        return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
    }
}
